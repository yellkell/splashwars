/**
 * The juice sim: every ball in flight — yours and theirs — and everywhere
 * juice lands.
 *
 * Balls live in flat typed-array slots (no per-ball entities) and render
 * through the shared InstancedMesh pool, slightly stretched along their
 * velocity so they wobble like thrown water balloons. Each frame a ball:
 *  - arcs under juice-gravity;
 *  - tests the swarm through its SPATIAL GRID, so we only check the handful
 *    of enemies sharing a cell rather than all of them — this is what keeps
 *    hundreds of enemies × dozens of balls affordable;
 *  - on a hit, deals damage (scaled by your HEAVY JUICE stacks), pops a
 *    damage number, and requests a burst blast if you have SPLASH;
 *  - tests the upgrade cards while the board is up (you pick by shooting);
 *  - tests the floor — a landing stamps a pooled splat decal and plops.
 *
 * Enemy return fire flies in the same loop with the same physics, but tests
 * against your head instead of the swarm.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { EnemySystem } from './EnemySystem.js';
import { activeBoards } from '../ui/cardBoard.js';
import {
  pendingBlobs,
  pendingEnemyShots,
  recycleSpawn,
  requestBlast,
} from '../combat/juiceBus.js';
import {
  MAX_BLOBS,
  dropletBurst,
  initJuicePools,
  updateJuicePools,
  type BlobPool,
  type SplatPool,
} from '../fx/juice.js';
import { initDamageNumbers, popDamage, updateDamageNumbers } from '../fx/damageNumbers.js';
import { ballDamage, damagePlayer, run, UpgradeId } from '../game/run.js';
import { damageTower, tower } from '../game/tower.js';
import * as sfx from '../audio/sfx.js';
import { AOE, ARENA_BOUNDS, ENEMY_SHOT, PISTOL, TOWER } from '../config.js';
import { Quaternion } from 'three';

const _pos = new Vector3();
const _vel = new Vector3();
const _head = new Vector3();
const _camQ = new Quaternion();
const _near: number[] = [];

export class JuiceSystem extends createSystem({}) {
  private blobs!: BlobPool;
  private splats!: SplatPool;
  // Structure-of-arrays ball state.
  private px = new Float32Array(MAX_BLOBS);
  private py = new Float32Array(MAX_BLOBS);
  private pz = new Float32Array(MAX_BLOBS);
  private vx = new Float32Array(MAX_BLOBS);
  private vy = new Float32Array(MAX_BLOBS);
  private vz = new Float32Array(MAX_BLOBS);
  private age = new Float32Array(MAX_BLOBS);
  private alive = new Uint8Array(MAX_BLOBS);
  /** 1 = enemy return fire (hurts you), 0 = yours (hurts them). */
  private hostile = new Uint8Array(MAX_BLOBS);
  private cursor = 0;
  private splatSfxAcc = 0;

  init(): void {
    const pools = initJuicePools(this.world.scene);
    this.blobs = pools.blobs;
    this.splats = pools.splats;
    initDamageNumbers(this.world.scene);
  }

  update(delta: number): void {
    this.splatSfxAcc = Math.max(0, this.splatSfxAcc - delta);
    const enemies = this.world.getSystem(EnemySystem);
    const swarm = enemies?.swarm;

    this.world.camera.getWorldPosition(_head);
    this.world.camera.getWorldQuaternion(_camQ);

    // Claim freshly-fired balls from both sides.
    for (const s of pendingBlobs.splice(0)) this.claim(s.pos, s.vel, 0), recycleSpawn(s);
    for (const s of pendingEnemyShots.splice(0)) this.claim(s.pos, s.vel, 1), recycleSpawn(s);

    const burstStacks = run.stacks[UpgradeId.Burst];
    const damage = ballDamage();

    for (let i = 0; i < MAX_BLOBS; i++) {
      if (!this.alive[i]) continue;

      const hostile = this.hostile[i] === 1;
      const gravity = hostile ? ENEMY_SHOT.gravity : PISTOL.gravity;
      const radius = hostile ? ENEMY_SHOT.radius : PISTOL.blobRadius;

      this.vy[i] -= gravity * delta;
      this.px[i] += this.vx[i] * delta;
      this.py[i] += this.vy[i] * delta;
      this.pz[i] += this.vz[i] * delta;
      this.age[i] += delta;

      _pos.set(this.px[i], this.py[i], this.pz[i]);
      let hit = false;

      if (hostile) {
        // --- Their juice vs your head… ---
        if (_pos.distanceToSquared(_head) <= ENEMY_SHOT.hitRadius * ENEMY_SHOT.hitRadius) {
          dropletBurst(_pos, 10, 1.1);
          if (damagePlayer(ENEMY_SHOT.damagePlayer)) sfx.playerDown();
          else sfx.playerHurt();
          hit = true;
        }
        // --- …and vs the tower (a fat cylinder around its frame). ---
        if (!hit && tower.placed) {
          const tdx = this.px[i] - tower.pos.x;
          const tdz = this.pz[i] - tower.pos.z;
          const rr = TOWER.radius + ENEMY_SHOT.radius;
          if (tdx * tdx + tdz * tdz <= rr * rr && this.py[i] <= TOWER.height) {
            dropletBurst(_pos, 8, 0.9);
            sfx.towerHit();
            damageTower(ENEMY_SHOT.damageTower);
            hit = true;
          }
        }
      } else {
        // --- Your juice vs the swarm, via the grid. ---
        if (swarm) {
          swarm.near(this.px[i], this.pz[i], radius + 0.5, _near);
          for (let n = 0; n < _near.length; n++) {
            const j = _near[n];
            if (!swarm.alive[j]) continue;
            const dx = swarm.px[j] - this.px[i];
            const dy = swarm.py[j] - this.py[i];
            const dz = swarm.pz[j] - this.pz[i];
            const r = swarm.radius[j] + radius;
            if (dx * dx + dy * dy + dz * dz <= r * r) {
              enemies!.hit(j, damage);
              dropletBurst(_pos, 8, 0.9);
              if (burstStacks > 0) {
                requestBlast(
                  _pos,
                  AOE.burstRadius + AOE.burstRadiusPerStack * (burstStacks - 1),
                  damage * AOE.burstFraction,
                  false,
                );
              }
              if (this.splatSfxAcc <= 0) {
                sfx.hitSplat();
                this.splatSfxAcc = 0.06;
              }
              hit = true;
              break;
            }
          }
        }

        // --- Your juice vs any card board on screen (menus, upgrades). ---
        if (!hit) {
          for (const board of activeBoards) {
            if (board.testHit(_pos, radius)) {
              hit = true;
              break;
            }
          }
        }
      }

      // --- Floor landing: stamp the splat. ---
      if (!hit && this.py[i] <= radius) {
        _pos.y = 0;
        this.splats.stamp(_pos, (hostile ? 0.1 : 0.18) + Math.random() * 0.1);
        dropletBurst(_pos, hostile ? 4 : 7, 0.7);
        if (this.splatSfxAcc <= 0) {
          sfx.splat();
          this.splatSfxAcc = 0.1;
        }
        hit = true;
      }

      // --- Cull: lifetime and the invisible cage. ---
      if (
        hit ||
        this.age[i] >= (hostile ? ENEMY_SHOT.lifetime : PISTOL.lifetime) ||
        this.py[i] > ARENA_BOUNDS.ceiling ||
        this.px[i] * this.px[i] + this.pz[i] * this.pz[i] > ARENA_BOUNDS.radius * ARENA_BOUNDS.radius
      ) {
        this.alive[i] = 0;
        this.blobs.hide(i);
        continue;
      }

      _vel.set(this.vx[i], this.vy[i], this.vz[i]);
      this.blobs.place(i, _pos, _vel, hostile);
    }

    this.blobs.commit();
    updateJuicePools(delta);
    updateDamageNumbers(delta, _camQ);
    void popDamage;
  }

  private claim(pos: Vector3, vel: Vector3, hostile: 0 | 1): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_BLOBS;
    this.px[i] = pos.x; this.py[i] = pos.y; this.pz[i] = pos.z;
    this.vx[i] = vel.x; this.vy[i] = vel.y; this.vz[i] = vel.z;
    this.age[i] = 0;
    this.alive[i] = 1;
    this.hostile[i] = hostile;
  }
}
