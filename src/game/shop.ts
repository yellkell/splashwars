/**
 * The bank and the build state — the tower-defense economy's shared truth.
 *
 * DROPS are the currency: kills pay them (gold popups beside the damage
 * numbers), the wrist watch shows them on a rolling counter, and the shop
 * spends them on turrets. Module singleton like `run` and `tower`.
 */

import { Vector3 } from 'three';
import type { TurretKindId } from '../config.js';

export const bank = {
  drops: 0,
  /** What the watch currently displays — rolls toward `drops`. */
  shown: 0,
};

export function addDrops(n: number): void {
  bank.drops += n;
}

/** Try to spend. False (and no charge) if the bank can't cover it. */
export function spendDrops(n: number): boolean {
  if (bank.drops < n) return false;
  bank.drops -= n;
  return true;
}

export function resetBank(): void {
  bank.drops = 0;
  bank.shown = 0;
  boost.overdrive = 0;
  boost.tankStacks = 0;
}

/** Paid power: OVERDRIVE seconds remaining, and BIG TANKS stacks. */
export const boost = {
  /** Seconds of double ball damage remaining. */
  overdrive: 0,
  /** Each stack adds 4 balls to every fresh tank. */
  tankStacks: 0,
};

/** A turret standing in the room. */
export interface PlacedTurret {
  kind: TurretKindId;
  pos: Vector3;
  /** Sprinkler fire cooldown. */
  cooldown: number;
}

/** Every placed turret — TurretSystem owns visuals, EnemySystem reads
 * positions for the Chiller slow field. */
export const placedTurrets: PlacedTurret[] = [];

/** Build-mode state: non-null while a bought turret's ghost is out. */
export const build = {
  placing: null as TurretKindId | null,
};

export function clearTurrets(): void {
  placedTurrets.length = 0;
  build.placing = null;
}
