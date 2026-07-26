/**
 * The paint sim: every blob in flight, everywhere paint lands.
 *
 * Blobs live in flat typed-array slots (no per-blob entities — at 26/s per
 * hand that would churn the ECS) and render through the shared InstancedMesh
 * pool, stretched along their velocity so the stream reads as a liquid rope.
 * Each frame a blob:
 *  - arcs under paint-gravity;
 *  - tests the toy enemies — a hit adds coverage, bursts droplets and
 *    sticks a shade onto them (the coverage shader does the painting);
 *  - tests the floor — a landing stamps a pooled splat decal and plops;
 *  - is culled beyond the arena bounds or its lifetime.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { Enemy } from '../components/Enemy.js';
import { pendingBlobs, recycleSpawn } from '../combat/paintBus.js';
import { MAX_BLOBS, dropletBurst, initPaintPools, updatePaintPools, type BlobPool, type SplatPool } from '../fx/paint.js';
import * as sfx from '../audio/sfx.js';
import { ARENA_BOUNDS, PISTOL } from '../config.js';

const _pos = new Vector3();
const _vel = new Vector3();
const _enemyPos = new Vector3();

export class PaintSystem extends createSystem({
  enemies: { required: [Enemy] },
}) {
  private blobs!: BlobPool;
  private splats!: SplatPool;
  // Structure-of-arrays blob state.
  private px = new Float32Array(MAX_BLOBS);
  private py = new Float32Array(MAX_BLOBS);
  private pz = new Float32Array(MAX_BLOBS);
  private vx = new Float32Array(MAX_BLOBS);
  private vy = new Float32Array(MAX_BLOBS);
  private vz = new Float32Array(MAX_BLOBS);
  private age = new Float32Array(MAX_BLOBS);
  private alive = new Uint8Array(MAX_BLOBS);
  private cursor = 0;
  private splatSfxAcc = 0;

  init(): void {
    const pools = initPaintPools(this.world.scene);
    this.blobs = pools.blobs;
    this.splats = pools.splats;
  }

  update(delta: number): void {
    this.splatSfxAcc = Math.max(0, this.splatSfxAcc - delta);

    // Claim freshly-squirted blobs from the weapon.
    for (const s of pendingBlobs.splice(0)) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_BLOBS;
      this.px[i] = s.pos.x; this.py[i] = s.pos.y; this.pz[i] = s.pos.z;
      this.vx[i] = s.vel.x; this.vy[i] = s.vel.y; this.vz[i] = s.vel.z;
      this.age[i] = 0;
      this.alive[i] = 1;
      recycleSpawn(s);
    }

    const enemies = [...this.queries.enemies.entities];

    for (let i = 0; i < MAX_BLOBS; i++) {
      if (!this.alive[i]) continue;

      this.vy[i] -= PISTOL.gravity * delta;
      this.px[i] += this.vx[i] * delta;
      this.py[i] += this.vy[i] * delta;
      this.pz[i] += this.vz[i] * delta;
      this.age[i] += delta;

      _pos.set(this.px[i], this.py[i], this.pz[i]);

      // --- Enemy hits: paint the toy. ---
      let hit = false;
      for (const e of enemies) {
        const obj = e.object3D;
        if (!obj) continue;
        obj.getWorldPosition(_enemyPos);
        const r = (e.getValue(Enemy, 'radius') ?? 0.2) + PISTOL.blobRadius;
        if (_pos.distanceToSquared(_enemyPos) <= r * r) {
          const soak = e.getValue(Enemy, 'soak') ?? 1;
          const coverage = Math.min(1, (e.getValue(Enemy, 'coverage') ?? 0) + PISTOL.coverPerHit / soak);
          e.setValue(Enemy, 'coverage', coverage);
          dropletBurst(_pos, 5, 0.7);
          if (this.splatSfxAcc <= 0) {
            sfx.hitSplat();
            this.splatSfxAcc = 0.09;
          }
          hit = true;
          break;
        }
      }

      // --- Floor landing: stamp the splat. ---
      if (!hit && this.py[i] <= PISTOL.blobRadius) {
        _pos.y = 0;
        this.splats.stamp(_pos, 0.1 + Math.random() * 0.08);
        dropletBurst(_pos, 3, 0.5);
        if (this.splatSfxAcc <= 0) {
          sfx.splat();
          this.splatSfxAcc = 0.12;
        }
        hit = true;
      }

      // --- Cull: lifetime and the invisible cage. ---
      if (
        hit ||
        this.age[i] >= PISTOL.lifetime ||
        this.py[i] > ARENA_BOUNDS.ceiling ||
        this.px[i] * this.px[i] + this.pz[i] * this.pz[i] > ARENA_BOUNDS.radius * ARENA_BOUNDS.radius
      ) {
        this.alive[i] = 0;
        this.blobs.hide(i);
        continue;
      }

      _vel.set(this.vx[i], this.vy[i], this.vz[i]);
      this.blobs.place(i, _pos, _vel);
    }

    this.blobs.commit();
    updatePaintPools(delta);
  }
}
