/**
 * The tower's shared state — what the whole fight is about. Module singleton
 * like `run`: EnemySystem drives attacks into it, JuiceSystem tests enemy
 * shots against it, TowerSystem renders it, MenuSystem reports on it.
 */

import { Vector3 } from 'three';
import { TOWER } from '../config.js';
import { run } from './run.js';

export const tower = {
  /** True once the player has planted it this session (survives AGAIN). */
  placed: false,
  pos: new Vector3(0, 0, -1.5),
  health: TOWER.maxHealth,
  maxHealth: TOWER.maxHealth,
  /** Seconds of hit-wobble remaining (drives the visual shake). */
  hitFlash: 0,
  /** 0..1 — how much enemy juice covers it. This IS its health readout. */
  get soaked(): number {
    return 1 - Math.max(0, this.health) / this.maxHealth;
  },
};

/** Fresh tank of health for a new run (position is kept). */
export function resetTower(): void {
  tower.health = TOWER.maxHealth;
  tower.hitFlash = 0;
}

/** Enemy damage to the tower. Returns true if this hit destroyed it. */
export function damageTower(amount: number): boolean {
  if (run.dead || tower.health <= 0) return false;
  tower.health -= amount;
  tower.hitFlash = TOWER.hitFlash;
  if (tower.health <= 0) {
    tower.health = 0;
    run.dead = true;
    run.endReason = 'tower';
    run.deathTimer = 2.5;
    return true;
  }
  return false;
}
