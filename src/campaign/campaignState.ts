/**
 * SPLASH WARS campaign data and persistence.
 *
 * The route is deliberately linear for the first campaign: five districts,
 * two escalating THE THIRST fights, then one new form of GOOPLIATH. The map
 * makes the whole journey visible from the start, while only the next stop
 * is open. Upgrade stacks are saved with the route, so the player really does
 * grow from district to district instead of beginning every card from zero.
 */

import { EnemyKind, type EnemyKindId } from '../config.js';
import { UpgradeId, type UpgradeIdT } from '../game/run.js';
import type { BossFormId } from './bossForms.js';

export type CampaignNodeKind = 'skirmish' | 'elite' | 'boss';
export type BossAttackKind = 'slam' | 'sweep' | 'beam' | 'volley' | 'nova' | 'seesaw';
export type SlamPattern = 'single' | 'rehit' | 'march';

export interface SwarmEncounter {
  enemies: number;
  roster: EnemyKindId[];
  hpScale: number;
  speedScale: number;
  towerCapacity: number;
}

export interface GoopliathEncounter {
  name: string;
  form: BossFormId;
  health: number;
  scale: number;
  attacks: BossAttackKind[];
  cooldown: [number, number];
  charge: number;
  slamPattern: SlamPattern;
  slamCount: number;
  trackingBeam: boolean;
  enrageAt: number;
}

export interface CampaignNode {
  id: string;
  act: number;
  title: string;
  subtitle: string;
  kind: CampaignNodeKind;
  /** Normalised point on the illustrated map. */
  map: readonly [number, number];
  accent: string;
  swarm?: SwarmEncounter;
  boss?: GoopliathEncounter;
}

const S = EnemyKind.Scurrier;
const D = EnemyKind.Drifter;
const L = EnemyKind.Lobber;
const B = EnemyKind.Brute;
const P = EnemyKind.Splitter;

/**
 * The five districts snake left-to-right across the map. Boss one teaches
 * patience, boss two rhythm, boss three late dodges, boss four lane reading,
 * and the final form combines the whole Fire Fight language.
 */
export const CAMPAIGN_NODES: CampaignNode[] = [
  {
    id: 'lido-dry-run', act: 0, title: 'DRY RUN', subtitle: 'LIDO', kind: 'skirmish',
    map: [0.08, 0.68], accent: '#55d7e8',
    swarm: { enemies: 12, roster: [D, S], hpScale: 0.9, speedScale: 0.92, towerCapacity: 430 },
  },
  {
    id: 'lido-first-wave', act: 0, title: 'FIRST WAVE', subtitle: 'LIDO', kind: 'elite',
    map: [0.15, 0.53], accent: '#55d7e8',
    swarm: { enemies: 18, roster: [D, S, L], hpScale: 1.0, speedScale: 1.0, towerCapacity: 450 },
  },
  {
    id: 'lido-goop', act: 0, title: 'THE PUDDLE', subtitle: 'GOOPLIATH I', kind: 'boss',
    map: [0.22, 0.36], accent: '#5ce5ad',
    boss: {
      name: 'GOOPLIATH: THE PUDDLE', form: 'puddle', health: 900, scale: 1.05,
      attacks: ['slam', 'volley'], cooldown: [2.7, 3.5], charge: 2.05,
      slamPattern: 'rehit', slamCount: 2, trackingBeam: false, enrageAt: 0,
    },
  },
  {
    id: 'river-downstream', act: 1, title: 'DOWNSTREAM', subtitle: 'LAZY RIVER', kind: 'skirmish',
    map: [0.29, 0.30], accent: '#63b7ff',
    swarm: { enemies: 24, roster: [D, S, L], hpScale: 1.08, speedScale: 1.05, towerCapacity: 500 },
  },
  {
    id: 'river-rapids', act: 1, title: 'THE RAPIDS', subtitle: 'LAZY RIVER', kind: 'elite',
    map: [0.35, 0.45], accent: '#63b7ff',
    swarm: { enemies: 32, roster: [S, L, B], hpScale: 1.16, speedScale: 1.12, towerCapacity: 520 },
  },
  {
    id: 'river-goop', act: 1, title: 'THE CURRENT', subtitle: 'GOOPLIATH II', kind: 'boss',
    map: [0.41, 0.61], accent: '#52c9ff',
    boss: {
      name: 'GOOPLIATH: THE CURRENT', form: 'current', health: 1550, scale: 1.17,
      attacks: ['slam', 'sweep', 'volley'], cooldown: [2.35, 3.05], charge: 1.85,
      slamPattern: 'march', slamCount: 3, trackingBeam: false, enrageAt: 0,
    },
  },
  {
    id: 'works-pump-house', act: 2, title: 'PUMP HOUSE', subtitle: 'WATERWORKS', kind: 'skirmish',
    map: [0.48, 0.66], accent: '#b08cff',
    swarm: { enemies: 40, roster: [D, L, B, P], hpScale: 1.28, speedScale: 1.14, towerCapacity: 570 },
  },
  {
    id: 'works-pressure-line', act: 2, title: 'PRESSURE LINE', subtitle: 'WATERWORKS', kind: 'elite',
    map: [0.54, 0.48], accent: '#b08cff',
    swarm: { enemies: 50, roster: [S, L, B, P], hpScale: 1.4, speedScale: 1.2, towerCapacity: 600 },
  },
  {
    id: 'works-goop', act: 2, title: 'THE PRESSURE', subtitle: 'GOOPLIATH III', kind: 'boss',
    map: [0.59, 0.29], accent: '#c56bff',
    boss: {
      name: 'GOOPLIATH: THE PRESSURE', form: 'pressure', health: 2350, scale: 1.3,
      attacks: ['slam', 'volley', 'sweep', 'beam'], cooldown: [2.05, 2.75], charge: 1.7,
      slamPattern: 'single', slamCount: 1, trackingBeam: true, enrageAt: 0.35,
    },
  },
  {
    id: 'spillway-high-water', act: 3, title: 'HIGH WATER', subtitle: 'SPILLWAY', kind: 'skirmish',
    map: [0.66, 0.33], accent: '#ff72ba',
    swarm: { enemies: 62, roster: [D, S, B, P], hpScale: 1.55, speedScale: 1.25, towerCapacity: 660 },
  },
  {
    id: 'spillway-breach', act: 3, title: 'THE BREACH', subtitle: 'SPILLWAY', kind: 'elite',
    map: [0.72, 0.49], accent: '#ff72ba',
    swarm: { enemies: 76, roster: [S, L, B, P], hpScale: 1.7, speedScale: 1.3, towerCapacity: 700 },
  },
  {
    id: 'spillway-goop', act: 3, title: 'THE FLOOD', subtitle: 'GOOPLIATH IV', kind: 'boss',
    map: [0.77, 0.65], accent: '#ff6aa3',
    boss: {
      name: 'GOOPLIATH: THE FLOOD', form: 'flood', health: 3450, scale: 1.43,
      attacks: ['slam', 'volley', 'sweep', 'beam', 'seesaw'], cooldown: [1.8, 2.5], charge: 1.55,
      slamPattern: 'single', slamCount: 1, trackingBeam: true, enrageAt: 0.5,
    },
  },
  {
    id: 'deep-last-light', act: 4, title: 'LAST LIGHT', subtitle: 'DEEP END', kind: 'skirmish',
    map: [0.83, 0.59], accent: '#ffad4f',
    swarm: { enemies: 90, roster: [D, S, L, B, P], hpScale: 1.9, speedScale: 1.34, towerCapacity: 760 },
  },
  {
    id: 'deep-dead-pool', act: 4, title: 'DEAD POOL', subtitle: 'DEEP END', kind: 'elite',
    map: [0.88, 0.41], accent: '#ffad4f',
    swarm: { enemies: 110, roster: [S, L, B, P], hpScale: 2.1, speedScale: 1.4, towerCapacity: 820 },
  },
  {
    id: 'deep-goopliath', act: 4, title: 'GOOPLIATH', subtitle: 'THE DEEP END', kind: 'boss',
    map: [0.93, 0.22], accent: '#d7ef43',
    boss: {
      name: 'GOOPLIATH', form: 'goopliath', health: 5200, scale: 1.62,
      attacks: ['slam', 'beam', 'sweep', 'volley', 'nova', 'seesaw'],
      cooldown: [1.5, 2.2], charge: 1.45,
      slamPattern: 'march', slamCount: 3, trackingBeam: true, enrageAt: 0.58,
    },
  },
];

export interface CampaignProgress {
  version: 1;
  cleared: string[];
  stacks: Record<UpgradeIdT, number>;
  victories: number;
}

const STORAGE_KEY = 'splash-wars-campaign-v1';

function blankStacks(): Record<UpgradeIdT, number> {
  return {
    [UpgradeId.Damage]: 0,
    [UpgradeId.AutoFire]: 0,
    [UpgradeId.Orbital]: 0,
    [UpgradeId.Health]: 0,
    [UpgradeId.ThrowBlast]: 0,
    [UpgradeId.Burst]: 0,
  };
}

function freshProgress(): CampaignProgress {
  return { version: 1, cleared: [], stacks: blankStacks(), victories: 0 };
}

function loadProgress(): CampaignProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshProgress();
    const saved = JSON.parse(raw) as Partial<CampaignProgress>;
    return {
      version: 1,
      cleared: Array.isArray(saved.cleared)
        ? saved.cleared.filter((id): id is string => CAMPAIGN_NODES.some((n) => n.id === id))
        : [],
      stacks: { ...blankStacks(), ...(saved.stacks ?? {}) },
      victories: Number.isFinite(saved.victories) ? Math.max(0, saved.victories ?? 0) : 0,
    };
  } catch {
    return freshProgress();
  }
}

export const campaignProgress = loadProgress();

export const campaignRuntime = {
  activeNode: null as CampaignNode | null,
  firstClear: false,
  bossHealth: 0,
  bossMaxHealth: 0,
};

export function nodeIndex(id: string): number {
  return CAMPAIGN_NODES.findIndex((n) => n.id === id);
}

export function nodeCleared(id: string): boolean {
  return campaignProgress.cleared.includes(id);
}

export function nodeUnlocked(index: number): boolean {
  return index === 0 || nodeCleared(CAMPAIGN_NODES[index - 1]?.id ?? '');
}

export function campaignComplete(): boolean {
  return campaignProgress.cleared.length >= CAMPAIGN_NODES.length;
}

export function clearCampaignNode(id: string): boolean {
  if (nodeCleared(id)) return false;
  campaignProgress.cleared.push(id);
  campaignProgress.cleared.sort((a, b) => nodeIndex(a) - nodeIndex(b));
  campaignProgress.victories += 1;
  saveCampaignProgress();
  return true;
}

export function saveCampaignLoadout(stacks: Record<UpgradeIdT, number>): void {
  campaignProgress.stacks = { ...stacks };
  saveCampaignProgress();
}

export function saveCampaignProgress(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(campaignProgress));
  } catch {
    /* Private browsing/storage denial: the live journey still works. */
  }
}

/** Dev hook and future NEW JOURNEY button. */
export function resetCampaignProgress(): void {
  const fresh = freshProgress();
  campaignProgress.cleared = fresh.cleared;
  campaignProgress.stacks = fresh.stacks;
  campaignProgress.victories = 0;
  saveCampaignProgress();
}
