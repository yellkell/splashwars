/**
 * Hand-ray floor picking — the placement pointer.
 *
 * Ghosts (the tower, bought turrets, wall pieces) used to glide on your
 * GAZE, which meant steering furniture with your neck. Now they follow your
 * HAND, down the very same aim axis the pistol barrel uses (input/aim.ts),
 * so the ghost lands where the gun in your hand is pointing — point at the
 * floor, pull the trigger, planted. The right hand wins when both are
 * tracked; head gaze stays as the no-controller fallback.
 */

import { Vector3, type World } from '@iwsdk/core';
import { handAimRay } from './aim.js';
import { TOWER } from '../config.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _head = new Vector3();

/**
 * Where the player is pointing on the floor, clamped to the placing band
 * (TOWER.placeMin..placeMax, measured around the head like before).
 */
export function placementSpot(world: World, out: Vector3): void {
  world.camera.getWorldPosition(_head);

  // Same aim axis the pistol barrel uses, so the ghost lands exactly where
  // the gun in your hand is pointing.
  const found = handAimRay(world, 1, _origin, _dir) || handAimRay(world, 0, _origin, _dir);
  if (!found) {
    _origin.copy(_head);
    world.camera.getWorldDirection(_dir);
  }

  // Project the ray onto the floor; pointing level or up pushes to max range.
  let t = _dir.y < -0.05 ? -_origin.y / _dir.y : Infinity;
  if (!isFinite(t)) t = TOWER.placeMax * 2;
  out.copy(_origin).addScaledVector(_dir, t);
  out.y = 0;

  const dx = out.x - _head.x;
  const dz = out.z - _head.z;
  const d = Math.hypot(dx, dz) || 1e-3;
  const clamped = Math.min(TOWER.placeMax, Math.max(TOWER.placeMin, d));
  out.set(_head.x + (dx / d) * clamped, 0, _head.z + (dz / d) * clamped);
}
