/**
 * The swarm brain: waves, movement, threat, death — and the between-wave
 * upgrade board.
 *
 * Enemies are NOT ECS entities. They live in the Swarm's typed arrays and
 * render as six per-kind InstancedMeshes (see enemies/swarm.ts and the
 * pool-toy roster in enemies/geometry.ts), because the late waves put
 * hundreds of them on the deck at once. This system is the only thing that
 * writes swarm state, so all the AOE requests from elsewhere (splash, juice
 * bombs, orbiters) come in over the juice bus and are applied here.
 *
 * Behaviour by type (THE THIRST — the rival team's drinking machines,
 * see enemies/geometry.ts):
 *  - Sippers drink from the tower and FLEE with the juice — kill the
 *    thief before it escapes and the tower gets every drop back;
 *  - Zippers, Chuggers and Pods close in and strike with telegraphed
 *    snaps; Pods burst into a flight of Zippers;
 *  - Spouts hold at range and lob the same slow, dodgeable juice balls
 *    you use — kept scarce and soft;
 *  - THE GULP is a wave-10 industrial drinker the size of a car.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { Swarm } from '../enemies/swarm.js';
import { dropletBurst, initJuicePools } from '../fx/juice.js';
import { initDamageNumbers, popDamage } from '../fx/damageNumbers.js';
import { enemyShot, pendingBlasts, recycleBlast } from '../combat/juiceBus.js';
import { run } from '../game/run.js';
import { damageTower, tower } from '../game/tower.js';
import { app } from '../game/appState.js';
import { addDrops, placedTurrets } from '../game/shop.js';
import * as sfx from '../audio/sfx.js';
import { SHOP as SHOP_CFG } from '../config.js';

const SHOP_BONUS = SHOP_CFG.waveClearBonus;
import {
  ENEMY,
  ENEMY_SHOT,
  ENEMY_TYPES,
  EnemyKind,
  PALETTE,
  TOWER,
  TURRET,
  TurretKind,
  WAVES,
  WAVE_ROSTER,
  type EnemyKindId,
} from '../config.js';

const _pos = new Vector3();
const _head = new Vector3();
const _shotVel = new Vector3();
const _near: number[] = [];

/**
 * A random spawn bearing across the FRONT arc only. Angles are measured so
 * that -PI/2 is straight ahead (-Z); WAVES.spawnArc opens symmetrically
 * around it. Nothing ever spawns behind you — in a headset you cannot watch
 * your back, so a rear spawn is damage you never had a chance to answer.
 */
function frontAngle(): number {
  return -Math.PI / 2 + (Math.random() - 0.5) * WAVES.spawnArc;
}

type Phase = 'intermission' | 'wave' | 'upgrade';

export class EnemySystem extends createSystem({}) {
  swarm!: Swarm;
  private phase: Phase = 'intermission';
  private timer = WAVES.interWaveDelay;
  private toSpawn = 0;
  private spawnAcc = 0;
  private time = 0;
  private coinStreak = 0;
  private sinceCoin = 99;

  // The floating wave sign.
  private sign!: Mesh;
  private signCanvas!: HTMLCanvasElement;
  private signTex!: CanvasTexture;

  init(): void {
    initJuicePools(this.world.scene);
    initDamageNumbers(this.world.scene);
    this.swarm = new Swarm(PALETTE.juice, PALETTE.juiceDeep);
    this.world.scene.add(this.swarm.group);
    this.buildSign();
    this.setSign('SHOOT START TO PLAY', '#1fc4c9');
  }

  /** UpgradeSystem calls this when the player has picked their card. */
  resumeAfterUpgrade(): void {
    this.phase = 'intermission';
    this.timer = 1.2;
  }

  /** MenuSystem calls this when a run starts: clean board, wave 1 queued. */
  startFresh(): void {
    for (let i = 0; i < this.swarm.px.length; i++) {
      if (this.swarm.alive[i]) this.swarm.kill(i);
    }
    this.toSpawn = 0;
    this.spawnAcc = 0;
    upgradeGate.pending = false;
    this.phase = 'intermission';
    this.timer = WAVES.interWaveDelay;
    this.setSign('WAVE 1 INCOMING', '#1fc4c9');
  }

  /**
   * Wipe the board and start over — called when you die. Without this the
   * swarm that killed you survives your respawn, immediately kills you
   * again, and the wave director never reaches its "wave cleared" check
   * (the swarm is never empty), so the run deadlocks.
   */
  resetFight(): void {
    for (let i = 0; i < this.swarm.px.length; i++) {
      if (this.swarm.alive[i]) this.swarm.kill(i);
    }
    this.toSpawn = 0;
    this.spawnAcc = 0;
    upgradeGate.pending = false;
    this.phase = 'intermission';
    this.timer = WAVES.interWaveDelay;
    this.setSign('WIPED OUT — GOING AGAIN', '#e0312e');
  }

  update(delta: number): void {
    this.time += delta;
    this.sinceCoin += delta;
    const swarm = this.swarm;

    this.world.camera.getWorldPosition(_head);
    // The sign gently faces the player in every phase.
    this.sign.lookAt(_head);

    // Outside a run there is nothing to direct — the menus own the stage.
    // (resetFight/startFresh have already emptied the swarm.)
    if (app.phase !== 'playing') {
      pendingBlasts.length = 0;
      return;
    }

    // --- Wave director. ---
    if (this.phase === 'intermission') {
      this.timer -= delta;
      if (this.timer <= 0) this.startWave(run.wave + 1);
    } else if (this.phase === 'wave') {
      if (this.toSpawn > 0) {
        this.spawnAcc += WAVES.spawnRate * delta;
        while (this.spawnAcc >= 1 && this.toSpawn > 0) {
          this.spawnAcc -= 1;
          this.toSpawn -= 1;
          this.spawnFromRoster(run.wave);
        }
      } else if (swarm.count === 0) {
        this.finishWave();
      }
    }

    // --- Area damage requested by other systems (bursts, bombs, orbiters). ---
    for (const blast of pendingBlasts.splice(0)) {
      this.applyBlast(blast.pos, blast.radius, blast.damage, blast.big);
      recycleBlast(blast);
    }

    // --- Drive every live enemy. Everything wants the TOWER. ---
    swarm.rebuildGrid();
    const tx = tower.pos.x;
    const tz = tower.pos.z;

    for (let i = 0; i < swarm.px.length; i++) {
      if (!swarm.alive[i]) continue;

      const kind = swarm.kind[i] as EnemyKindId;
      const def = ENEMY_TYPES[kind];
      swarm.hitPulse[i] = Math.max(0, swarm.hitPulse[i] - delta * 4);

      // Arrival swoop: no moving or attacking until it has dropped in.
      if (swarm.arrive[i] > 0) {
        swarm.arrive[i] = Math.max(0, swarm.arrive[i] - delta / 0.8);
      }

      const fleeing = swarm.fleeing[i] === 1;
      const dx = tx - swarm.px[i];
      const dz = tz - swarm.pz[i];
      const dist = Math.hypot(dx, dz) || 1e-3;
      // Yaw so the machine faces where it's going: at the tower normally,
      // AWAY from it when fleeing with stolen juice.
      swarm.facing[i] = fleeing
        ? Math.atan2(dx / dist, dz / dist)
        : Math.atan2(-dx / dist, -dz / dist);

      // Ranged types stop further out; melee press right up to the tower.
      const standoff = def.ranged
        ? 2.2 + (kind === EnemyKind.Boss ? 1.4 : 0)
        : TOWER.radius + swarm.radius[i] + 0.12;
      let speed = WAVES.baseSpeed * swarm.speed[i] * (1 + (run.wave - 1) * 0.06);

      // --- Movement personality: each toy travels like what it is. ---
      let lateral = 0;
      switch (kind) {
        case EnemyKind.Drifter:
          // Husks tumble in surges: forward motion pulses like falling rock.
          speed *= 0.35 + 1.5 * Math.max(0, Math.sin(this.time * 3.2 + swarm.phase[i]));
          break;
        case EnemyKind.Scurrier:
          // Skitters dart in a zigzag — quick, jittery, hard to lead.
          speed *= 0.45 + 1.2 * (0.5 + 0.5 * Math.sin(this.time * 5.1 + swarm.phase[i]));
          lateral = Math.sin(this.time * 4.3 + swarm.phase[i]) * 0.6;
          break;
        case EnemyKind.Lobber:
          // Spitters lean side to side as they stalk into range.
          lateral = Math.sin(this.time * 1.9 + swarm.phase[i]) * 0.3;
          break;
        case EnemyKind.Splitter:
          // Clusters shiver along a lazy weave.
          lateral = Math.sin(this.time * 2.6 + swarm.phase[i]) * 0.45;
          break;
        // Clods and THE DROUGHT just PLOW: dead straight, inevitable.
      }

      // CHILLER fields: half-speed inside any icy circle (few turrets,
      // so a plain loop beats touching the grid).
      for (const t of placedTurrets) {
        if (t.kind !== TurretKind.Chiller) continue;
        const cdx = swarm.px[i] - t.pos.x;
        const cdz = swarm.pz[i] - t.pos.z;
        if (cdx * cdx + cdz * cdz <= TURRET.chiller.radius * TURRET.chiller.radius) {
          speed *= TURRET.chiller.slowTo;
          break;
        }
      }

      // Freeze forward motion during an attack so the lunge reads clean;
      // stop entirely during the arrival swoop.
      if (swarm.attackAnim[i] > 0 || swarm.arrive[i] > 0) speed = 0;

      if (fleeing) {
        // Run for the exit with the goods. Kill it to get the juice back.
        const flee = speed > 0 ? speed * ENEMY.fleeSpeedMult : 0;
        swarm.px[i] -= (dx / dist) * flee * delta;
        swarm.pz[i] -= (dz / dist) * flee * delta;
        if (dist > ENEMY.escapeRadius) {
          // Escaped: the juice is gone for good. No refunds.
          swarm.kill(i);
          continue;
        }
      } else if (dist > standoff) {
        swarm.px[i] += (dx / dist) * speed * delta;
        swarm.pz[i] += (dz / dist) * speed * delta;
        if (lateral !== 0) {
          // Perpendicular sway (left of the approach direction).
          swarm.px[i] += (-dz / dist) * lateral * speed * delta;
          swarm.pz[i] += (dx / dist) * lateral * speed * delta;
        }
      }

      // Bank into lateral motion — hover machines lean like they mean it.
      const targetRoll = Math.max(-0.5, Math.min(0.5, -lateral * 0.55 * (speed > 0 ? 1 : 0)));
      swarm.roll[i] += (targetRoll - swarm.roll[i]) * Math.min(1, delta * 6);

      // --- Crowd separation so hundreds don't collapse into one blob. ---
      swarm.near(swarm.px[i], swarm.pz[i], swarm.radius[i] * 2.2, _near);
      for (let n = 0; n < _near.length; n++) {
        const j = _near[n];
        if (j === i || !swarm.alive[j]) continue;
        const sx = swarm.px[i] - swarm.px[j];
        const sz = swarm.pz[i] - swarm.pz[j];
        const d2 = sx * sx + sz * sz;
        const min = swarm.radius[i] + swarm.radius[j];
        if (d2 > 1e-6 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = ((min - d) / min) * ENEMY.separation * delta * 8;
          swarm.px[i] += (sx / d) * push;
          swarm.pz[i] += (sz / d) * push;
        }
      }

      // --- Hard containment in the FRONT arc (measured from the tower). ---
      // Spawning in front is not enough on its own: weaving and crowd
      // shoving would both walk enemies around behind you over time — the
      // thing that makes a headset fight feel unfair. Clamp every enemy
      // back inside the arc each frame.
      {
        const rx = swarm.px[i] - tx;
        const rz = swarm.pz[i] - tz;
        const r = Math.hypot(rx, rz);
        if (r > 1e-3) {
          const centre = -Math.PI / 2;
          const half = WAVES.spawnArc / 2;
          let d = Math.atan2(rz, rx) - centre;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) > half) {
            const edge = centre + Math.sign(d) * half;
            swarm.px[i] = tx + Math.cos(edge) * r;
            swarm.pz[i] = tz + Math.sin(edge) * r;
            swarm.strafeDir[i] = -swarm.strafeDir[i] as -1 | 1;
          }
        }
      }

      // Bob, weighed down as it takes juice. Hover height leans on the
      // body radius just enough that big toys loom, clamped so nothing —
      // especially the boss — ever floats away or clips the floor.
      const covered = 1 - Math.max(0, swarm.hp[i]) / swarm.maxHp[i];
      swarm.py[i] =
        Math.max(ENEMY.hoverHeight * 0.7 + swarm.radius[i] * 0.3, swarm.radius[i] * 1.02) +
        Math.sin(this.time * ENEMY.bobRate + swarm.phase[i]) * ENEMY.bobAmplitude * (1 - covered * 0.6) -
        covered * 0.1;

      // --- Threat: telegraphed attacks on the TOWER. ---
      // The cooldown only STARTS the windup; nothing lands until the snap
      // (ENEMY.attackStrikeAt), so every hit is readable — and popping the
      // toy mid-windup cancels the attack entirely.
      if (swarm.attackAnim[i] > 0) {
        const before = swarm.attackAnim[i];
        swarm.attackAnim[i] = Math.max(0, before - delta / ENEMY.attackDuration);
        if (before > ENEMY.attackStrikeAt && swarm.attackAnim[i] <= ENEMY.attackStrikeAt && !run.dead) {
          if (def.ranged) {
            this.fireLob(i);
          } else if (dist <= standoff + swarm.radius[i] * 1.6) {
            this.strikeTower(def.attack, i);
          }
        }
      } else if (!fleeing && swarm.arrive[i] <= 0) {
        swarm.cooldown[i] -= delta;
        const inRange = def.ranged ? dist <= standoff + 0.4 : dist <= standoff + 0.05;
        if (swarm.cooldown[i] <= 0 && inRange && !run.dead) {
          swarm.cooldown[i] = def.attackInterval * (0.8 + Math.random() * 0.4);
          swarm.attackAnim[i] = 1;
          sfx.enemyWindup();
        }
      }
    }

    swarm.commit(this.time, tx, tz);
  }

  // --- Damage application (the swarm's only writer). ----------------------

  /** Damage one enemy, with the number pop and the death handling. */
  hit(i: number, amount: number, big = false, showNumber = true): void {
    const swarm = this.swarm;
    if (!swarm.alive[i]) return;
    _pos.set(swarm.px[i], swarm.py[i] + swarm.radius[i] * 0.8, swarm.pz[i]);
    const killed = swarm.damage(i, amount);
    if (showNumber) popDamage(_pos, amount, big, big ? 0xffe07a : 0xffffff);
    if (killed) this.pop(i);
  }

  /** Everything inside `radius` takes `damage`. */
  applyBlast(pos: Vector3, radius: number, damage: number, big: boolean): void {
    const swarm = this.swarm;
    swarm.near(pos.x, pos.z, radius, _near);
    // Snapshot: hit() can kill and spawn (splitters), mutating the swarm.
    const targets = _near.slice();
    for (const i of targets) {
      if (!swarm.alive[i]) continue;
      const dx = swarm.px[i] - pos.x;
      const dy = swarm.py[i] - pos.y;
      const dz = swarm.pz[i] - pos.z;
      const r = radius + swarm.radius[i];
      if (dx * dx + dy * dy + dz * dz <= r * r) this.hit(i, damage, big);
    }
  }

  /** Kill an enemy: burst, score, and split if it's a Splitter. */
  private pop(i: number): void {
    const swarm = this.swarm;
    const kind = swarm.kind[i] as EnemyKindId;
    const def = ENEMY_TYPES[kind];
    _pos.set(swarm.px[i], swarm.py[i], swarm.pz[i]);
    const boss = kind === EnemyKind.Boss;
    dropletBurst(_pos, boss ? ENEMY.popDroplets * 5 : ENEMY.popDroplets, boss ? 2.4 : 1.2);
    sfx.enemyPop();
    run.score += def.score;
    run.kills += 1;

    // --- Payday: kills mint DROPS, with a gold popup riding beside the
    // damage numbers and a coin blip that pitches up on a hot streak. ---
    addDrops(def.score);
    _pos.set(swarm.px[i] + 0.14, swarm.py[i] + swarm.radius[i] * 0.9 + 0.12, swarm.pz[i]);
    popDamage(_pos, def.score, false, 0xffd23f);
    this.coinStreak = this.sinceCoin < 1.4 ? this.coinStreak + 1 : 0;
    this.sinceCoin = 0;
    sfx.coin(this.coinStreak);

    // Shot down a thief: every stolen drop goes back in the reservoir.
    if (swarm.carrying[i] > 0 && tower.health > 0) {
      tower.health = Math.min(tower.maxHealth, tower.health + swarm.carrying[i]);
      _pos.set(tower.pos.x, 1.3, tower.pos.z);
      popDamage(_pos, swarm.carrying[i], false, 0x7dffa8);
      sfx.refund();
    }

    if (def.splitInto !== undefined && def.splitCount) {
      const hpScale = 1 + (run.wave - 1) * WAVES.hpPerWave;
      for (let n = 0; n < def.splitCount; n++) {
        const a = (n / def.splitCount) * Math.PI * 2;
        swarm.spawn(
          def.splitInto,
          swarm.px[i] + Math.cos(a) * 0.3,
          swarm.py[i],
          swarm.pz[i] + Math.sin(a) * 0.3,
          hpScale,
          1,
        );
      }
    }
    swarm.kill(i);
  }

  // --- Enemy offence. ------------------------------------------------------

  /**
   * A Slinger's lob, released at the snap of its windup. Mostly aimed at
   * the tower (that's what they're here for), sometimes at YOU — keeping
   * the dodge game alive and the player a real participant in the threat.
   */
  private fireLob(i: number): void {
    const swarm = this.swarm;
    if (Math.random() < 0.35) this.world.camera.getWorldPosition(_head);
    else _head.set(tower.pos.x, 0.85, tower.pos.z);
    _pos.set(swarm.px[i], swarm.py[i], swarm.pz[i]);
    _shotVel.copy(_head).sub(_pos);
    const dist = _shotVel.length();
    _shotVel.normalize();
    // Lead the arc so the lob actually lands near the mark.
    _shotVel.multiplyScalar(ENEMY_SHOT.speed);
    _shotVel.y += (ENEMY_SHOT.gravity * dist) / (2 * ENEMY_SHOT.speed);
    // A little slop so a wall of Slingers isn't a wall of perfect shots.
    _shotVel.x += (Math.random() - 0.5) * 0.6;
    _shotVel.z += (Math.random() - 0.5) * 0.6;
    enemyShot(_pos, _shotVel);
    sfx.enemyLob();
  }

  /** A machine's snap landing on the tower. Sippers DRINK and bolt. */
  private strikeTower(amount: number, i: number): void {
    const swarm = this.swarm;
    _pos.set(
      tower.pos.x + (swarm.px[i] - tower.pos.x) * 0.3,
      0.5 + Math.random() * 0.4,
      tower.pos.z + (swarm.pz[i] - tower.pos.z) * 0.3,
    );
    dropletBurst(_pos, 6, 0.8);
    sfx.towerHit();
    damageTower(amount);
    // The Sipper's whole deal: it fills its tank and runs for the exit.
    if ((swarm.kind[i] as EnemyKindId) === EnemyKind.Drifter) {
      swarm.carrying[i] = amount;
      swarm.fleeing[i] = 1;
    }
  }

  // --- Waves. --------------------------------------------------------------

  private startWave(n: number): void {
    this.phase = 'wave';
    run.wave = n;
    // Compounding growth is what turns this into a swarm by wave 8+.
    this.toSpawn =
      n >= WAVES.count
        ? 1
        : Math.round(
            (WAVES.baseEnemies + (n - 1) * WAVES.enemiesPerWave) * Math.pow(WAVES.growth, n - 1),
          );
    this.spawnAcc = 0;
    sfx.waveHorn();
    this.setSign(n >= WAVES.count ? 'FINAL WAVE — THE BIG ONE' : `WAVE ${n}`, '#1fc4c9');
  }

  private finishWave(): void {
    // Clear bonus: the later the wave, the fatter the payout.
    addDrops(WAVES.count >= run.wave ? SHOP_BONUS * run.wave : 0);
    if (run.wave >= WAVES.count) {
      this.setSign('ALL WAVES CLEARED — LOOPING, HARDER', '#f0299b');
      run.wave = 0;
    } else {
      this.setSign(`WAVE ${run.wave} CLEARED`, '#f0299b');
    }
    // Hand off to the upgrade board; it calls resumeAfterUpgrade() when done.
    this.phase = 'upgrade';
    upgradeGate.pending = true;
  }

  private spawnFromRoster(wave: number): void {
    const roster = WAVE_ROSTER[Math.min(wave, WAVE_ROSTER.length) - 1];
    const kind = roster[Math.floor(Math.random() * roster.length)];
    const hpScale = 1 + (wave - 1) * WAVES.hpPerWave;
    const speedScale = 1 + (wave - 1) * (WAVES.speedPerWave / WAVES.baseSpeed) * 0.25;
    const boss = kind === EnemyKind.Boss;

    const [rMin, rMax] = WAVES.spawnRadius;
    const r = rMin + Math.random() * (rMax - rMin);
    const a = frontAngle();
    this.swarm.spawn(
      kind,
      tower.pos.x + Math.cos(a) * r,
      ENEMY.hoverHeight,
      tower.pos.z + Math.sin(a) * r,
      hpScale,
      speedScale,
      boss ? WAVES.bossScale : 1,
    );

    // The boss never comes alone.
    if (boss) {
      for (let n = 0; n < 12; n++) {
        const aa = frontAngle();
        const rr = rMin + Math.random() * (rMax - rMin);
        this.swarm.spawn(
          EnemyKind.Scurrier,
          tower.pos.x + Math.cos(aa) * rr,
          ENEMY.hoverHeight,
          tower.pos.z + Math.sin(aa) * rr,
          hpScale,
          speedScale,
        );
      }
    }
  }

  // --- The wave sign. ------------------------------------------------------

  private buildSign(): void {
    this.signCanvas = document.createElement('canvas');
    this.signCanvas.width = 1024;
    this.signCanvas.height = 200;
    this.signTex = new CanvasTexture(this.signCanvas);
    this.signTex.minFilter = LinearFilter;
    this.sign = new Mesh(
      new PlaneGeometry(1.7, 0.33),
      new MeshBasicMaterial({ map: this.signTex, transparent: true }),
    );
    this.sign.position.set(0, 2.05, -3.2);
    this.world.scene.add(this.sign);
  }

  setSign(text: string, color: string): void {
    const ctx = this.signCanvas.getContext('2d')!;
    const { width: w, height: h } = this.signCanvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(250,252,255,0.82)';
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 90);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.font = '900 84px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 4);
    this.signTex.needsUpdate = true;
  }
}

/** Tiny handshake flag between the wave director and the upgrade board. */
export const upgradeGate = { pending: false };
