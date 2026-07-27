/**
 * The run — everything that persists across waves within a single attempt,
 * and the upgrade catalogue that grows it.
 *
 * A plain module singleton (same pattern as the juice bus): every system
 * reads and writes the same `run` object, so there is exactly one source of
 * truth for your health, your stacks and your score. `resetRun()` starts a
 * fresh attempt.
 */

import { PISTOL, PLAYER, SINK_POWER_PER_LEVEL } from '../config.js';
import { sinks } from './shop.js';

export const UpgradeId = {
  Damage: 'damage',
  AutoFire: 'autoFire',
  Orbital: 'orbital',
  Health: 'health',
  ThrowBlast: 'throwBlast',
  Burst: 'burst',
} as const;
export type UpgradeIdT = (typeof UpgradeId)[keyof typeof UpgradeId];

export interface UpgradeDef {
  id: UpgradeIdT;
  title: string;
  /** One short line, readable at 2 m in a headset. */
  blurb: string;
  /** Accent colour for the card. */
  color: string;
  max: number;
  /** What the next stack gives you, for the card's "+N" line. */
  effect(stacks: number): string;
}

export const UPGRADE_CATALOGUE: UpgradeDef[] = [
  {
    id: UpgradeId.Damage,
    title: 'HEAVY JUICE',
    blurb: 'Every ball hits harder',
    color: '#e0312e',
    max: 8,
    effect: () => '+35% ball damage',
  },
  {
    id: UpgradeId.AutoFire,
    title: 'AUTO SOAKER',
    blurb: 'The trigger holds itself',
    color: '#53c8ec',
    max: 5,
    effect: (s) => (s === 0 ? 'Hold to fire: FULL AUTO' : '+35% fire rate'),
  },
  {
    id: UpgradeId.Orbital,
    title: 'ORBITERS',
    blurb: 'Juice globes circle you and grind anything they touch',
    color: '#1fc4c9',
    max: 6,
    effect: (s) => (s === 0 ? 'Gain 2 orbiting globes' : '+1 globe, faster orbit'),
  },
  {
    id: UpgradeId.Health,
    title: 'BUOYANCY',
    blurb: 'More health, and patch up right now',
    color: '#8fd6a8',
    max: 8,
    effect: () => '+25 max health, full heal',
  },
  {
    id: UpgradeId.ThrowBlast,
    title: 'JUICE BOMB',
    blurb: 'Thrown pistols detonate in a wave of juice',
    color: '#ffb000',
    max: 6,
    effect: (s) => (s === 0 ? 'Thrown guns explode' : '+bigger, +harder blast'),
  },
  {
    id: UpgradeId.Burst,
    title: 'BURST',
    blurb: 'Balls burst, spattering everything nearby',
    color: '#b9a8ff',
    max: 6,
    effect: (s) => (s === 0 ? 'Balls deal burst damage' : '+burst radius'),
  },
];

export interface RunState {
  health: number;
  maxHealth: number;
  /** Seconds since you last took a hit (gates regeneration). */
  sinceHit: number;
  /** Remaining invulnerability, seconds — see damagePlayer(). */
  iframes: number;
  /** 0..1 visor juice, driven by damage — the HUD-free health read. */
  hurt: number;
  dead: boolean;
  deathTimer: number;
  wave: number;
  score: number;
  kills: number;
  /** Why the run ended, for the game-over plate. */
  endReason: 'player' | 'tower' | '';
  stacks: Record<UpgradeIdT, number>;
}

function emptyStacks(): Record<UpgradeIdT, number> {
  return {
    [UpgradeId.Damage]: 0,
    [UpgradeId.AutoFire]: 0,
    [UpgradeId.Orbital]: 0,
    [UpgradeId.Health]: 0,
    [UpgradeId.ThrowBlast]: 0,
    [UpgradeId.Burst]: 0,
  };
}

export const run: RunState = {
  health: PLAYER.maxHealth,
  maxHealth: PLAYER.maxHealth,
  sinceHit: 999,
  iframes: 0,
  hurt: 0,
  dead: false,
  deathTimer: 0,
  wave: 0,
  score: 0,
  kills: 0,
  endReason: '',
  stacks: emptyStacks(),
};

export function resetRun(): void {
  run.maxHealth = PLAYER.maxHealth;
  run.health = PLAYER.maxHealth;
  run.sinceHit = 999;
  run.iframes = 0;
  run.hurt = 0;
  run.dead = false;
  run.deathTimer = 0;
  run.wave = 0;
  run.score = 0;
  run.kills = 0;
  run.endReason = '';
  run.stacks = emptyStacks();
}

/** Apply a chosen upgrade. */
export function applyUpgrade(id: UpgradeIdT): void {
  run.stacks[id] += 1;
  if (id === UpgradeId.Health) {
    run.maxHealth += 25;
    run.health = run.maxHealth;
    run.hurt = 0;
  }
}

/** Damage one juice ball deals: HEAVY JUICE stacks × bought POWER levels. */
export function ballDamage(): number {
  return (
    PISTOL.damage *
    (1 + 0.35 * run.stacks[UpgradeId.Damage]) *
    (1 + SINK_POWER_PER_LEVEL * sinks.power)
  );
}

/** Three distinct upgrades to offer, skipping any that are maxed out. */
export function offerUpgrades(): UpgradeDef[] {
  const pool = UPGRADE_CATALOGUE.filter((u) => run.stacks[u.id] < u.max);
  const picked: UpgradeDef[] = [];
  const bag = [...pool];
  while (picked.length < 3 && bag.length > 0) {
    picked.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  }
  return picked;
}

/**
 * Hurt the player. Returns true if this was the killing blow.
 *
 * Hits inside the invulnerability window are ignored: in a swarm every
 * enemy in reach resolves its attack independently, so without this a ring
 * of ten Scurriers lands ten simultaneous hits and deletes you outright.
 */
export function damagePlayer(amount: number): boolean {
  if (run.dead || run.iframes > 0) return false;
  run.health -= amount;
  run.sinceHit = 0;
  run.iframes = PLAYER.invulnerable;
  run.hurt = Math.min(1, run.hurt + amount / 45);
  if (run.health <= 0) {
    run.health = 0;
    run.dead = true;
    run.endReason = 'player';
    run.deathTimer = PLAYER.deathRespawnDelay;
    return true;
  }
  return false;
}
