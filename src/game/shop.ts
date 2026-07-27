/**
 * The bank and the build state — the tower-defense economy's shared truth.
 *
 * DROPS are the currency: kills pay them (gold popups beside the damage
 * numbers), the wrist watch shows them on a rolling counter, and the shop
 * spends them on turrets. Module singleton like `run` and `tower`.
 */

import { Vector3 } from 'three';
import { SINK_COST_GROWTH, type TurretKindId } from '../config.js';

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
  sinks.power = 0;
  sinks.tanks = 0;
  sinks.reservoir = 0;
}

/** Bought stat levels — permanent for the run, price climbing per level. */
export const sinks = {
  power: 0, // +15% base ball damage each
  tanks: 0, // +3 balls per fresh tank each
  reservoir: 0, // +60 tower max juice each
};

/** The next level's price for a sink. */
export function sinkCost(baseCost: number, level: number): number {
  return Math.round(baseCost * Math.pow(SINK_COST_GROWTH, level));
}

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
