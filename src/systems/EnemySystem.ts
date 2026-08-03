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
import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  TorusGeometry,
} from 'three';
import { fleeAt, flowAt, portal, setupField, wallAt } from '../game/field.js';
import { Swarm } from '../enemies/swarm.js';
import { dropletBurst, initJuicePools, wipeFloor } from '../fx/juice.js';
import { initDamageNumbers, popDamage } from '../fx/damageNumbers.js';
import { enemyShot, pendingBlasts, recycleBlast } from '../combat/juiceBus.js';
import { damagePlayer, run } from '../game/run.js';
import { damageTower, tower } from '../game/tower.js';
import { app } from '../game/appState.js';
import { addDrops, placedTurrets } from '../game/shop.js';
import * as sfx from '../audio/sfx.js';
import { SHOP as SHOP_CFG } from '../config.js';
import type { SwarmEncounter } from '../campaign/campaignState.js';

const SHOP_BONUS = SHOP_CFG.waveClearBonus;

import {
  ENEMY,
  ENEMY_SHOT,
  ENEMY_TYPES,
  EnemyKind,
  PALETTE,
  PORTAL,
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
const _flow = new Vector3();
const _near: number[] = [];

type Phase = 'intermission' | 'wave' | 'campaign' | 'upgrade';

export class EnemySystem extends createSystem({}) {
  swarm!: Swarm;
  private phase: Phase = 'intermission';
  private timer = WAVES.interWaveDelay;
  private toSpawn = 0;
  private spawnAcc = 0;
  private time = 0;
  private coinStreak = 0;
  private sinceCoin = 99;
  private campaignEncounter: SwarmEncounter | null = null;
  private campaignWon = false;
  private spawnHpScale = 1;


  // THE PORTAL — the one door THE THIRST comes through.
  private portalGroup!: Group;
  private portalSwirl!: ShaderMaterial;
  private portalPulse = 0;

  init(): void {
    initJuicePools(this.world.scene);
    initDamageNumbers(this.world.scene);
    this.swarm = new Swarm(PALETTE.juice, PALETTE.juiceDeep);
    this.world.scene.add(this.swarm.group);
    this.buildPortal();
  }

  /** The rival team's door: a violet ring with a swirling drink inside. */
  private buildPortal(): void {
    this.portalGroup = new Group();
    const ring = new Mesh(
      new TorusGeometry(PORTAL.radius, 0.06, 12, 40),
      new MeshBasicMaterial({ color: 0x7b5cff }),
    );
    this.portalGroup.add(ring);
    const rim = new Mesh(
      new TorusGeometry(PORTAL.radius + 0.07, 0.02, 8, 40),
      new MeshBasicMaterial({ color: 0xcdbcff }),
    );
    this.portalGroup.add(rim);
    this.portalSwirl = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPulse;
        varying vec2 vUv;
        void main(){
          float r = length(vUv);
          if (r > 1.0) discard;
          float a = atan(vUv.y, vUv.x);
          // Spiral bands winding INWARD — the drink going down the drain.
          float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 14.0 - uTime * 3.4);
          swirl *= swirl;
          vec3 deep = vec3(0.09, 0.05, 0.22);
          vec3 glow = vec3(0.55, 0.42, 1.0);
          vec3 col = mix(deep, glow, swirl * (0.35 + 0.65 * r) + uPulse * 0.5);
          float alpha = smoothstep(1.0, 0.86, r) * (0.82 + uPulse * 0.18);
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const disc = new Mesh(new CircleGeometry(PORTAL.radius * 0.94, 40), this.portalSwirl);
    this.portalGroup.add(disc);
    this.portalGroup.visible = false;
    this.world.scene.add(this.portalGroup);
  }

  /** UpgradeSystem calls this when the player has picked their card. */
  resumeAfterUpgrade(): void {
    this.phase = 'intermission';
    this.timer = 1.2;
  }

  /** MenuSystem calls this when a run starts: clean board, wave 1 queued. */
  startFresh(): void {
    // Plant the board: grid centred on the tower, portal opened past it
    // along the line you stood on, both flow fields computed.
    this.world.camera.getWorldPosition(_head);
    setupField(tower.pos, _head);
    wipeFloor(tower.pos); // last run's juice sweeps away as the new one starts
    for (let i = 0; i < this.swarm.px.length; i++) {
      if (this.swarm.alive[i]) this.swarm.kill(i);
    }
    this.toSpawn = 0;
    this.spawnAcc = 0;
    upgradeGate.pending = false;
    upgradeGate.afterPick = null;
    this.campaignEncounter = null;
    this.campaignWon = false;
    this.phase = 'intermission';
    this.timer = WAVES.interWaveDelay;
  }

  /**
   * Start one world-map fight. It uses the same tower, portal, swarm and
   * combat rules as DEFENSE, but has a finite authored roster and hands the
   * clear back to CampaignSystem instead of looping into another wave.
   */
  startCampaignEncounter(spec: SwarmEncounter): void {
    this.world.camera.getWorldPosition(_head);
    setupField(tower.pos, _head);
    wipeFloor(tower.pos);
    for (let i = 0; i < this.swarm.px.length; i++) {
      if (this.swarm.alive[i]) this.swarm.kill(i);
    }
    this.campaignEncounter = spec;
    this.campaignWon = false;
    this.spawnHpScale = spec.hpScale;
    this.toSpawn = spec.enemies;
    this.spawnAcc = 0;
    this.phase = 'campaign';
    run.wave = 1;
    upgradeGate.pending = false;
    upgradeGate.afterPick = null;
    sfx.waveHorn();
  }

  /** One-shot clear flag consumed by CampaignSystem. */
  takeCampaignVictory(): boolean {
    if (!this.campaignWon) return false;
    this.campaignWon = false;
    return true;
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
    upgradeGate.afterPick = null;
    this.campaignEncounter = null;
    this.campaignWon = false;
    this.phase = 'intermission';
    this.timer = WAVES.interWaveDelay;
  }

  update(delta: number): void {
    this.time += delta;
    this.sinceCoin += delta;
    const swarm = this.swarm;

    this.world.camera.getWorldPosition(_head);

    const campaignFight = app.mode === 'campaign' && this.campaignEncounter !== null;

    // The portal stands past the tower — or past YOU, in a campaign route
    // where the machines come straight for the player — drink swirling.
    const showPortal =
      (tower.placed || campaignFight) && (app.phase === 'playing' || app.phase === 'gameover');
    this.portalGroup.visible = showPortal;
    if (showPortal) {
      this.portalGroup.position.copy(portal);
      this.portalGroup.lookAt(tower.pos.x, portal.y, tower.pos.z);
      this.portalPulse = Math.max(0, this.portalPulse - delta * 2.2);
      this.portalSwirl.uniforms.uTime.value = this.time;
      this.portalSwirl.uniforms.uPulse.value = this.portalPulse;
      const s = 1 + this.portalPulse * 0.12 + Math.sin(this.time * 1.8) * 0.02;
      this.portalGroup.scale.setScalar(s);
    }

    // Outside a run — or outside DEFENSE mode entirely (the duel and the
    // campaign run their own directors) — there is nothing to steer here.
    if (app.phase !== 'playing' || (app.mode !== 'defense' && !campaignFight)) {
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
    } else if (this.phase === 'campaign') {
      if (this.toSpawn > 0) {
        this.spawnAcc += WAVES.spawnRate * delta;
        while (this.spawnAcc >= 1 && this.toSpawn > 0) {
          this.spawnAcc -= 1;
          this.toSpawn -= 1;
          this.spawnCampaignEnemy();
        }
      } else if (swarm.count === 0) {
        wipeFloor(tower.pos);
        sfx.floorClean();
        this.campaignEncounter = null;
        this.campaignWon = true;
        this.phase = 'upgrade';
      }
    }

    // --- Area damage requested by other systems (bursts, bombs, orbiters). ---
    for (const blast of pendingBlasts.splice(0)) {
      this.applyBlast(blast.pos, blast.radius, blast.damage, blast.big);
      recycleBlast(blast);
    }

    // --- Drive every live enemy. In DEFENSE everything wants the TOWER;
    // on a campaign route there is no tower — they come straight FOR YOU. ---
    swarm.rebuildGrid();
    const tx = campaignFight ? _head.x : tower.pos.x;
    const tz = campaignFight ? _head.z : tower.pos.z;

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
      const boss = kind === EnemyKind.Boss;
      const dx = tx - swarm.px[i];
      const dz = tz - swarm.pz[i];
      const dist = Math.hypot(dx, dz) || 1e-3;

      // Which way is this machine trying to go? Attackers descend the
      // FLOW FIELD toward the tower — which is what routes the whole
      // swarm around your walls with zero per-enemy pathfinding. Fleeing
      // Sippers descend the FLEE field back to the portal they came from.
      // THE GULP is too big for the maze: it plows the straight line.
      let mx: number;
      let mz: number;
      if (fleeing) {
        if (!boss && fleeAt(swarm.px[i], swarm.pz[i], _flow)) {
          mx = _flow.x;
          mz = _flow.z;
        } else {
          mx = -dx / dist;
          mz = -dz / dist;
        }
      } else if (!boss && !campaignFight && flowAt(swarm.px[i], swarm.pz[i], _flow)) {
        mx = _flow.x;
        mz = _flow.z;
      } else {
        mx = dx / dist;
        mz = dz / dist;
      }
      // Yaw so the machine faces where it's actually going.
      swarm.facing[i] = Math.atan2(-mx, -mz);

      // Ranged types stop further out; melee press right up to the mark —
      // the tower's skirt, or arm's reach of YOU on a campaign route.
      const standoff = def.ranged
        ? 2.2 + (kind === EnemyKind.Boss ? 1.4 : 0)
        : (campaignFight ? 0.55 : TOWER.radius + 0.12) + swarm.radius[i];
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

      const ox = swarm.px[i];
      const oz = swarm.pz[i];
      if (fleeing) {
        // Run the maze back to the portal with the goods.
        const flee = speed * ENEMY.fleeSpeedMult;
        swarm.px[i] += mx * flee * delta;
        swarm.pz[i] += mz * flee * delta;
        // Through the door (or off the board): the juice is gone for good.
        const pdx = swarm.px[i] - portal.x;
        const pdz = swarm.pz[i] - portal.z;
        if (pdx * pdx + pdz * pdz < 0.36 || dist > ENEMY.escapeRadius) {
          swarm.kill(i);
          continue;
        }
      } else if (dist > standoff) {
        swarm.px[i] += mx * speed * delta;
        swarm.pz[i] += mz * speed * delta;
        if (lateral !== 0) {
          // Perpendicular sway (left of the travel direction).
          swarm.px[i] += -mz * lateral * speed * delta;
          swarm.pz[i] += mx * lateral * speed * delta;
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

      // --- Walls are SOLID to the swarm: slide along them, never through.
      // The flow field already routes around walls; this catches lateral
      // sway and crowd shoving nudging someone into a cell edge. The boss
      // is exempt — it's too big for the maze and plows straight through.
      if (!boss && wallAt(swarm.px[i], swarm.pz[i])) {
        if (!wallAt(ox, swarm.pz[i])) swarm.px[i] = ox;
        else if (!wallAt(swarm.px[i], oz)) swarm.pz[i] = oz;
        else {
          swarm.px[i] = ox;
          swarm.pz[i] = oz;
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
            if (campaignFight) this.strikePlayer(def.attack, i);
            else this.strikeTower(def.attack, i);
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
      const hpScale = app.mode === 'campaign'
        ? this.spawnHpScale
        : 1 + (run.wave - 1) * WAVES.hpPerWave;
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
    const atPlayer =
      (app.mode === 'campaign' && this.campaignEncounter !== null) || Math.random() < 0.35;
    if (atPlayer) this.world.camera.getWorldPosition(_head);
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

  /** A campaign machine's snap landing on YOU — droplets right in your face. */
  private strikePlayer(amount: number, i: number): void {
    const swarm = this.swarm;
    this.world.camera.getWorldPosition(_pos);
    _pos.x += (swarm.px[i] - _pos.x) * 0.4;
    _pos.z += (swarm.pz[i] - _pos.z) * 0.4;
    dropletBurst(_pos, 6, 0.9);
    if (damagePlayer(amount)) sfx.playerDown();
    else sfx.playerHurt();
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
  }

  private finishWave(): void {
    // The floor comes back: an aqua ring sweeps out from the tower and
    // slurps every splat it passes — a clean arena for the next wave.
    wipeFloor(tower.pos);
    sfx.floorClean();
    // Clear bonus: the later the wave, the fatter the payout.
    addDrops(WAVES.count >= run.wave ? SHOP_BONUS * run.wave : 0);
    if (run.wave >= WAVES.count) {
      run.wave = 0;
    } else {
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

    this.spawnAtPortal(kind, hpScale, speedScale, boss ? WAVES.bossScale : 1);

    // The boss never comes alone.
    if (boss) {
      for (let n = 0; n < 12; n++) {
        this.spawnAtPortal(EnemyKind.Scurrier, hpScale, speedScale);
      }
    }
  }

  private spawnCampaignEnemy(): void {
    const spec = this.campaignEncounter;
    if (!spec || spec.roster.length === 0) return;
    const kind = spec.roster[Math.floor(Math.random() * spec.roster.length)];
    this.spawnAtPortal(kind, spec.hpScale, spec.speedScale);
  }

  /** Everything comes through THE door — with a flare as it does. */
  private spawnAtPortal(kind: EnemyKindId, hpScale: number, speedScale: number, scale = 1): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.45;
    this.swarm.spawn(
      kind,
      portal.x + Math.cos(a) * r,
      ENEMY.hoverHeight,
      portal.z + Math.sin(a) * r,
      hpScale,
      speedScale,
      scale,
    );
    this.portalPulse = 1;
  }
}

/** Tiny handshake flag between the wave director and the upgrade board. */
export const upgradeGate = {
  pending: false,
  /** Campaign clears return to the map; defense clears start another wave. */
  afterPick: null as (() => void) | null,
};
