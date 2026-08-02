/**
 * Ball targets — things juice balls can hit that are NOT the swarm, the
 * tower, the player or a menu card: duel crystals, shield panels, the
 * rival, its turrets. A tiny registry so JuiceSystem stays the one place
 * ball collision happens, without knowing what a "shield" is.
 *
 * Each target declares which SIDE's juice hurts it: your shields soak
 * HOSTILE balls, everything of the rival's soaks YOURS. The list is small
 * (a dozen entries at most), so a plain scan per ball is nothing.
 */

import type { Vector3 } from 'three';

export interface BallTarget {
  /** Live world position — the sim reads it every frame. */
  pos: Vector3;
  radius: number;
  /** true: consumed by ENEMY balls (it's yours). false: by YOUR balls. */
  hitByHostile: boolean;
  /** False once dead/expired — skipped and eventually swept. */
  alive(): boolean;
  /**
   * A ball connected. `damage` is what the ball carries (your live
   * ballDamage, or the enemy-shot figure); the target applies its own
   * rules. Return true to consume the ball.
   */
  onHit(damage: number, at: Vector3): boolean;
}

export const ballTargets: BallTarget[] = [];

export function addBallTarget(t: BallTarget): void {
  ballTargets.push(t);
}

export function removeBallTarget(t: BallTarget): void {
  const i = ballTargets.indexOf(t);
  if (i >= 0) ballTargets.splice(i, 1);
}

export function clearBallTargets(): void {
  ballTargets.length = 0;
}
