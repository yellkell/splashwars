/**
 * WHERE THE HAND IS ACTUALLY POINTING.
 *
 * WebXR reports two poses per hand:
 *  - the GRIP pose — where the controller BODY is, -Z running along the
 *    handle like a held rod;
 *  - the TARGET RAY pose — where the platform says the user is AIMING.
 *
 * They are not the same: on Quest the handle sits well below the aim line,
 * so a gun parented raw to the grip shoots high, and no hand-picked tilt
 * fixes that across devices (or hand tracking, where the offset moves with
 * your fingers). So the pistol carries the platform's own aim axis: the
 * barrel is rotated by exactly the grip→ray delta, which is self-calibrating
 * — the gun shoots where the system says you're pointing.
 *
 * Two guards keep that honest. The delta is CLAMPED (HOLSTER.aimMaxCorrection)
 * because the ray is tuned for UI pointing and can sit far enough off the
 * grip that an exactly-aligned gun would visibly droop in your real hand —
 * we take the ray's direction, not necessarily all of its magnitude. And
 * when the runtime reports no distinct ray (the desktop emulator poses both
 * spaces identically), everything falls back to HOLSTER.heldPitch.
 */

import { Quaternion, Vector3 } from 'three';
import type { World } from '@iwsdk/core';
import { HOLSTER } from '../config.js';

const HANDS = ['left', 'right'] as const;
const X_AXIS = new Vector3(1, 0, 0);

const _gq = new Quaternion();
const _rq = new Quaternion();
const _delta = new Quaternion();
const _trim = new Quaternion();
const _aim = new Quaternion(); // handAimRay's own slot — never aliases _delta

/** Below this the ray is just the grip again — emulator, or no ray. */
const MEANINGFUL = 0.05;

function gripOf(world: World, hand: 0 | 1) {
  return world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
}

function rayOf(world: World, hand: 0 | 1) {
  return world.playerSpaceEntities.raySpaces?.[HANDS[hand]]?.object3D;
}

/**
 * The LOCAL rotation for a pistol parented under `hand`'s grip so its
 * barrel (-Z) runs along the aim axis. Always writes a usable rotation.
 */
export function heldAimQuat(world: World, hand: 0 | 1, out: Quaternion): void {
  const grip = gripOf(world, hand);
  const ray = rayOf(world, hand);
  if (grip && ray) {
    grip.getWorldQuaternion(_gq);
    ray.getWorldQuaternion(_rq);
    _delta.copy(_gq).invert().multiply(_rq).normalize();
    // Double cover: |w| is what encodes the angle regardless of sign.
    const angle = 2 * Math.acos(Math.min(1, Math.abs(_delta.w)));
    if (angle > MEANINGFUL) {
      const t = angle > HOLSTER.aimMaxCorrection ? HOLSTER.aimMaxCorrection / angle : 1;
      out.set(0, 0, 0, 1).slerp(_delta, t);
      if (HOLSTER.aimTrim !== 0) {
        out.multiply(_trim.setFromAxisAngle(X_AXIS, HOLSTER.aimTrim));
      }
      return;
    }
  }
  out.setFromAxisAngle(X_AXIS, HOLSTER.heldPitch + HOLSTER.aimTrim);
}

/**
 * The world-space aim ray for a hand: origin and unit direction, matching
 * the barrel of a gun held in it. False when that hand isn't posed.
 */
export function handAimRay(
  world: World,
  hand: 0 | 1,
  outOrigin: Vector3,
  outDir: Vector3,
): boolean {
  const grip = gripOf(world, hand);
  if (!grip) return false;
  // Aim first (it owns _gq/_delta as scratch), then compose onto the grip.
  heldAimQuat(world, hand, _aim);
  grip.getWorldPosition(outOrigin);
  grip.getWorldQuaternion(_gq);
  outDir.set(0, 0, -1).applyQuaternion(_gq.multiply(_aim));
  return true;
}
