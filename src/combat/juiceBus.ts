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
  curve: Vector3;
  /** Zero/negative values ask JuiceSystem for the ordinary Raptor default. */
  radius: number;
  gravity: number;
  lifetime: number;
  damageScale: number;
  /** Optional per-shot RGB tint; 0 asks the renderer for its team default. */
  tint: number;
}

export interface BlobProfile {
  radius: number;
  gravity: number;
  lifetime: number;
  damageScale: number;
  /** Constant bend acceleration, derived from an Ellipse punch. */
  curve?: Vector3;
}

/** Player juice balls squirted this frame, awaiting the juice sim. */
export const pendingBlobs: BlobSpawn[] = [];

const spare: BlobSpawn[] = [];

function takeSpawn(): BlobSpawn {
  return spare.pop() ?? {
    pos: new Vector3(),
    vel: new Vector3(),
    curve: new Vector3(),
    radius: 0,
    gravity: -1,
    lifetime: -1,
    damageScale: 1,
    tint: 0,
  };
}

/** Queue a juice ball (recycles spawn records). */
export function squirtBlob(pos: Vector3, vel: Vector3, profile?: BlobProfile): void {
  const s = takeSpawn();
  s.pos.copy(pos);
  s.vel.copy(vel);
  if (profile?.curve) s.curve.copy(profile.curve);
  else s.curve.set(0, 0, 0);
  s.radius = profile?.radius ?? 0;
  s.gravity = profile?.gravity ?? -1;
  s.lifetime = profile?.lifetime ?? -1;
  s.damageScale = profile?.damageScale ?? 1;
  s.tint = 0;
  pendingBlobs.push(s);
}

/** Hand a drained spawn record back to the pool. */
export function recycleSpawn(s: BlobSpawn): void {
  spare.push(s);
}

/** Enemy return fire queued by EnemySystem, flown by JuiceSystem. */
export const pendingEnemyShots: BlobSpawn[] = [];

export function enemyShot(pos: Vector3, vel: Vector3, tint = 0): void {
  const s = takeSpawn();
  s.pos.copy(pos);
  s.vel.copy(vel);
  s.curve.set(0, 0, 0);
  s.radius = 0;
  s.gravity = -1;
  s.lifetime = -1;
  s.damageScale = 1;
  s.tint = tint;
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
