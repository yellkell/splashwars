/**
 * A tiny module bus between the weapon and the paint sim (the same pattern
 * as FIRE FIGHT's opponentBus): WeaponSystem pushes freshly-squirted blobs,
 * PaintSystem drains them into its pooled simulation each frame. Keeps the
 * two systems decoupled and the spawn path allocation-free at steady state.
 */

import { Vector3 } from 'three';

export interface BlobSpawn {
  pos: Vector3;
  vel: Vector3;
}

/** Blobs squirted this frame, waiting for the paint sim to claim them. */
export const pendingBlobs: BlobSpawn[] = [];

const spare: BlobSpawn[] = [];

/** Queue a blob (recycles spawn records). */
export function squirtBlob(pos: Vector3, vel: Vector3): void {
  const s = spare.pop() ?? { pos: new Vector3(), vel: new Vector3() };
  s.pos.copy(pos);
  s.vel.copy(vel);
  pendingBlobs.push(s);
}

/** Hand a drained spawn record back to the pool. */
export function recycleSpawn(s: BlobSpawn): void {
  spare.push(s);
}
