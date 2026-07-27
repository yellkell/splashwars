/**
 * A tiny module bus between the combat systems (the same pattern as FIRE
 * FIGHT's opponentBus): producers push events, consumers drain them each
 * frame. Keeps WeaponSystem, JuiceSystem and EnemySystem decoupled and the
 * spawn paths allocation-free at steady state.
 */

import { Vector3 } from 'three';

export interface BlobSpawn {
  pos: Vector3;
  vel: Vector3;
}

/** Player juice balls squirted this frame, awaiting the juice sim. */
export const pendingBlobs: BlobSpawn[] = [];

const spare: BlobSpawn[] = [];

/** Queue a juice ball (recycles spawn records). */
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

/** Enemy return fire queued by EnemySystem, flown by JuiceSystem. */
export const pendingEnemyShots: BlobSpawn[] = [];

export function enemyShot(pos: Vector3, vel: Vector3): void {
  const s = spare.pop() ?? { pos: new Vector3(), vel: new Vector3() };
  s.pos.copy(pos);
  s.vel.copy(vel);
  pendingEnemyShots.push(s);
}

/**
 * Area damage requests (bursts from balls, blasts from thrown pistols).
 * EnemySystem owns the swarm, so it applies these.
 */
export interface BlastRequest {
  pos: Vector3;
  radius: number;
  damage: number;
  /** Show a big damage number and a fat droplet burst. */
  big: boolean;
}

export const pendingBlasts: BlastRequest[] = [];
const spareBlasts: BlastRequest[] = [];

export function requestBlast(pos: Vector3, radius: number, damage: number, big = false): void {
  const b = spareBlasts.pop() ?? { pos: new Vector3(), radius: 0, damage: 0, big: false };
  b.pos.copy(pos);
  b.radius = radius;
  b.damage = damage;
  b.big = big;
  pendingBlasts.push(b);
}

export function recycleBlast(b: BlastRequest): void {
  spareBlasts.push(b);
}
