/**
 * The swarm brain: waves, movement, threat, death — and the between-wave
 * upgrade board.
 *
 * Enemies are NOT ECS entities. They live in the Swarm's typed arrays and
 * render as six per-kind InstancedMeshes (see enemies/swarm.ts and the
 * pool-toy roster in enemies/geometry.ts), because the late waves put
 * hundreds of them on the deck at once. This system is the only thing that
 * writes swarm state, so all the AOE requests from elsewhere (splash, paint
 * bombs, orbiters) come in over the paint bus and are applied here.
 *
 * Behaviour by type:
 *  - melee toys (Bobbers, Squirts, Big Ducks, Foamers) close on you,
 *    crowd-separate, and chew on your health at the deck rim;
 *  - Slingers hold at range and throw the same slow, dodgeable paint balls
 *    you use, so incoming fire is readable;
 *  - Foamers burst into a spray of Squirts when killed;
 *  - THE BIG ONE is a wave-10 crowned duck the size of a car.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { Swarm } from '../enemies/swarm.js';
import { dropletBurst, initPaintPools } from '../fx/paint.js';
import { initDamageNumbers, popDamage } from '../fx/damageNumbers.js';
import { enemyShot, pendingBlasts, recycleBlast } from '../combat/paintBus.js';
import { damagePlayer, run } from '../game/run.js';
import { app } from '../game/appState.js';
import * as sfx from '../audio/sfx.js';
import {
  ENEMY,
  ENEMY_SHOT,
  ENEMY_TYPES,
  EnemyKind,
  PALETTE,
  PLATFORM,
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

  // The floating wave sign.
  private sign!: Mesh;
  private signCanvas!: HTMLCanvasElement;
  private signTex!: CanvasTexture;

  init(): void {
    initPaintPools(this.world.scene);
    initDamageNumbers(this.world.scene);
    this.swarm = new Swarm(PALETTE.paint, PALETTE.paintDeep);
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

    // --- Area damage requested by other systems (splash, bombs, orbiters). ---
    for (const blast of pendingBlasts.splice(0)) {
      this.applyBlast(blast.pos, blast.radius, blast.damage, blast.big);
      recycleBlast(blast);
    }

    // --- Drive every live enemy. ---
    swarm.rebuildGrid();
    const deckEdge = PLATFORM.radius + 0.25;

    for (let i = 0; i < swarm.px.length; i++) {
      if (!swarm.alive[i]) continue;

      const kind = swarm.kind[i] as EnemyKindId;
      const def = ENEMY_TYPES[kind];
      swarm.hitPulse[i] = Math.max(0, swarm.hitPulse[i] - delta * 4);

      const dx = -swarm.px[i];
      const dz = -swarm.pz[i];
      const dist = Math.hypot(dx, dz) || 1e-3;
      // Yaw so the geometry's -Z face looks at the player (rotY(θ) maps -Z
      // onto (-sinθ, -cosθ), so θ = atan2(-dx̂, -dẑ)).
      swarm.facing[i] = Math.atan2(-dx / dist, -dz / dist);

      // Ranged types stop further out; melee press right to the rim.
      const standoff = def.ranged ? 2.6 + (kind === EnemyKind.Boss ? 1.2 : 0) : WAVES.standoffRadius;
      const speed = WAVES.baseSpeed * swarm.speed[i] * (1 + (run.wave - 1) * 0.06);

      if (dist > standoff) {
        swarm.px[i] += (dx / dist) * speed * delta;
        swarm.pz[i] += (dz / dist) * speed * delta;
      } else if (!def.ranged) {
        // Pace across the deck rather than piling on one spot. Direction is
        // per-enemy and flips at the arc edges (below), so the crowd paces
        // back and forth in front of you instead of wrapping around behind.
        const a = Math.atan2(swarm.pz[i], swarm.px[i]) + swarm.strafeDir[i] * speed * 0.5 * delta;
        swarm.px[i] = Math.cos(a) * dist;
        swarm.pz[i] = Math.sin(a) * dist;
      }

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

      // --- Hard containment in the FRONT arc. ---
      // Spawning in front is not enough on its own: pacing and crowd shoving
      // would both walk enemies around behind you over time, which is
      // exactly the thing that makes a headset fight feel unfair. Clamp
      // every enemy back inside the arc each frame and bounce its pacing.
      {
        const r = Math.hypot(swarm.px[i], swarm.pz[i]);
        if (r > 1e-3) {
          const centre = -Math.PI / 2;
          const half = WAVES.spawnArc / 2;
          let d = Math.atan2(swarm.pz[i], swarm.px[i]) - centre;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) > half) {
            const edge = centre + Math.sign(d) * half;
            swarm.px[i] = Math.cos(edge) * r;
            swarm.pz[i] = Math.sin(edge) * r;
            swarm.strafeDir[i] = -swarm.strafeDir[i] as -1 | 1;
          }
        }
      }

      // Bob, weighed down as it takes paint. Hover height leans on the
      // body radius just enough that big toys loom, clamped so nothing —
      // especially the boss — ever floats away or clips the floor.
      const covered = 1 - Math.max(0, swarm.hp[i]) / swarm.maxHp[i];
      swarm.py[i] =
        Math.max(ENEMY.hoverHeight * 0.7 + swarm.radius[i] * 0.3, swarm.radius[i] * 1.02) +
        Math.sin(this.time * ENEMY.bobRate + swarm.phase[i]) * ENEMY.bobAmplitude * (1 - covered * 0.6) -
        covered * 0.1;

      // --- Threat: attack the player. ---
      swarm.cooldown[i] -= delta;
      if (swarm.cooldown[i] <= 0 && !run.dead) {
        if (def.ranged) {
          swarm.cooldown[i] = def.attackInterval * (0.75 + Math.random() * 0.5);
          this.fireAtPlayer(i);
        } else if (dist <= deckEdge + swarm.radius[i]) {
          swarm.cooldown[i] = def.attackInterval;
          this.hitPlayer(def.attack, i);
        }
      }
    }

    swarm.commit(this.time);
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

  private fireAtPlayer(i: number): void {
    const swarm = this.swarm;
    this.world.camera.getWorldPosition(_head);
    _pos.set(swarm.px[i], swarm.py[i], swarm.pz[i]);
    _shotVel.copy(_head).sub(_pos);
    const dist = _shotVel.length();
    _shotVel.normalize();
    // Lead the arc so a lobbed shot actually lands near your head.
    _shotVel.multiplyScalar(ENEMY_SHOT.speed);
    _shotVel.y += (ENEMY_SHOT.gravity * dist) / (2 * ENEMY_SHOT.speed);
    // A little slop so a wall of lobbers isn't a wall of perfect shots.
    _shotVel.x += (Math.random() - 0.5) * 0.6;
    _shotVel.z += (Math.random() - 0.5) * 0.6;
    enemyShot(_pos, _shotVel);
    sfx.enemyLob();
  }

  private hitPlayer(amount: number, i: number): void {
    const swarm = this.swarm;
    _pos.set(swarm.px[i], swarm.py[i], swarm.pz[i]);
    dropletBurst(_pos, 6, 0.8);
    if (damagePlayer(amount)) sfx.playerDown();
    else sfx.playerHurt();
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
      Math.cos(a) * r,
      ENEMY.hoverHeight,
      Math.sin(a) * r,
      hpScale,
      speedScale,
      boss ? WAVES.bossScale : 1,
    );

    // The boss never comes alone.
    if (boss) {
      for (let n = 0; n < 12; n++) {
        const aa = frontAngle();
        const rr = rMin + Math.random() * (rMax - rMin);
        this.swarm.spawn(EnemyKind.Scurrier, Math.cos(aa) * rr, ENEMY.hoverHeight, Math.sin(aa) * rr, hpScale, speedScale);
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
