/**
 * The six tools arranged around the campaign's octagonal boss pad.
 *
 * The array order IS physical: slots 0..2 run down the left edge of the
 * platform and slots 3..5 run back up the right edge. Nothing is unique — a
 * player who wants six Wildcats or six grenades may equip exactly that.
 */

export const ToolId = {
  Raptor: 'raptor',
  Wildcat: 'wildcat',
  Viper: 'viper',
  Shotgun: 'shotgun',
  ShotgunEllipse: 'shotgun-ellipse',
  RaptorEllipse: 'raptor-ellipse',
  ViperEllipse: 'viper-ellipse',
  SplashGrenade: 'splash-grenade',
  ClusterGrenade: 'cluster-grenade',
} as const;

export type ToolIdT = (typeof ToolId)[keyof typeof ToolId];
export type ToolKind = 'gun' | 'grenade';

export interface ToolDefinition {
  id: ToolIdT;
  name: string;
  shortName: string;
  family: 'raptor' | 'wildcat' | 'viper' | 'shotgun' | 'grenade';
  kind: ToolKind;
  blurb: string;
  color: string;
  /** Visible rounds / throws before the tool is spent. */
  shots: number;
  /** Trigger-hold cadence. Semi-auto guns still use this after AUTO SOAKER. */
  fireRate: number;
  automatic: boolean;
  muzzleSpeed: number;
  spread: number;
  radius: number;
  gravity: number;
  lifetime: number;
  damageScale: number;
  /** Continuous curve acceleration taken from the sideways punch velocity. */
  curveStrength: number;
  /** Muzzle-rise recoil at full kick, radians — decays over ~0.15 s. */
  kick: number;
  /** Balls per trigger pull. >1 is a shot CONE (the shotguns). */
  pellets?: number;
  respawn: number;
  haptic: number;
  visualScale: readonly [number, number, number];
  fuse?: number;
  blastRadius?: number;
  blastDamageScale?: number;
  clusterPellets?: number;
}

/**
 * Raptor is the current Splash pistol, deliberately slowed a touch so Viper
 * owns speed. Wildcat owns screen-time: tiny, cheap pellets that remain live
 * much longer. Ellipse changes trajectory, not the underlying gun economy.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: ToolId.Raptor,
    name: 'RAPTOR',
    shortName: 'RAPTOR',
    family: 'raptor',
    kind: 'gun',
    blurb: 'The dependable paint pistol. Fat, readable rounds.',
    color: '#f04f5f',
    shots: 9,
    fireRate: 2.2,
    automatic: false,
    muzzleSpeed: 7.4,
    spread: 0.014,
    radius: 0.052,
    gravity: 1.55,
    lifetime: 2.8,
    damageScale: 1,
    curveStrength: 0,
    kick: 0.085,
    respawn: 2.5,
    haptic: 0.85,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.Wildcat,
    name: 'WILDCAT',
    shortName: 'WILDCAT',
    family: 'wildcat',
    kind: 'gun',
    blurb: 'A storm of tiny paint. Low damage, long-lived pellets.',
    color: '#38d7e7',
    shots: 20,
    fireRate: 5.5,
    automatic: true,
    muzzleSpeed: 4.8,
    spread: 0.021,
    radius: 0.022,
    gravity: 0.65,
    lifetime: 5,
    damageScale: 0.24,
    curveStrength: 0,
    kick: 0.03,
    respawn: 2.8,
    haptic: 0.3,
    visualScale: [0.94, 0.94, 0.94],
  },
  {
    id: ToolId.Viper,
    name: 'VIPER',
    shortName: 'VIPER',
    family: 'viper',
    kind: 'gun',
    blurb: 'Three tiny, vicious rounds. Fast, flat and accurate.',
    color: '#ffb33f',
    shots: 3,
    fireRate: 0.75,
    automatic: false,
    muzzleSpeed: 15.5,
    spread: 0.003,
    radius: 0.025,
    gravity: 0.2,
    lifetime: 2.35,
    damageScale: 3,
    curveStrength: 0,
    kick: 0.17,
    respawn: 4.8,
    haptic: 1,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.Shotgun,
    name: 'SHOTGUN',
    shortName: 'SHOTGUN',
    family: 'shotgun',
    kind: 'gun',
    blurb: 'Eight fat pellets at once. Devastating close, useless far.',
    color: '#ff7a2f',
    shots: 5,
    fireRate: 1.05,
    automatic: false,
    muzzleSpeed: 9.6,
    spread: 0.075,
    radius: 0.031,
    gravity: 1.5,
    lifetime: 1.5,
    damageScale: 0.52,
    curveStrength: 0,
    kick: 0.24,
    pellets: 8,
    respawn: 4.2,
    haptic: 1,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.ShotgunEllipse,
    name: 'SHOTGUN ELLIPSE',
    shortName: 'SHOT ELL.',
    family: 'shotgun',
    kind: 'gun',
    blurb: 'The whole cone banks with the swing of your arm.',
    color: '#ff5fa8',
    shots: 4,
    fireRate: 0.95,
    automatic: false,
    muzzleSpeed: 9.2,
    spread: 0.07,
    radius: 0.03,
    gravity: 1.45,
    lifetime: 1.9,
    damageScale: 0.5,
    curveStrength: 4.4,
    kick: 0.24,
    pellets: 8,
    respawn: 4.8,
    haptic: 1,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.RaptorEllipse,
    name: 'RAPTOR ELLIPSE',
    shortName: 'RAPTOR ELL.',
    family: 'raptor',
    kind: 'gun',
    blurb: 'The Raptor round follows the arc of your punch.',
    color: '#b176ff',
    shots: 7,
    fireRate: 1.9,
    automatic: false,
    muzzleSpeed: 7.2,
    spread: 0.012,
    radius: 0.048,
    gravity: 1.4,
    lifetime: 3.2,
    damageScale: 1.05,
    curveStrength: 5.0,
    kick: 0.09,
    respawn: 3.1,
    haptic: 0.82,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.ViperEllipse,
    name: 'VIPER ELLIPSE',
    shortName: 'VIPER ELL.',
    family: 'viper',
    kind: 'gun',
    blurb: 'A sniper round that bends with the swing of your arm.',
    color: '#ff78bb',
    shots: 3,
    fireRate: 0.7,
    automatic: false,
    muzzleSpeed: 15,
    spread: 0.003,
    radius: 0.024,
    gravity: 0.18,
    lifetime: 2.7,
    damageScale: 3,
    curveStrength: 8.0,
    kick: 0.17,
    respawn: 5.2,
    haptic: 1,
    visualScale: [1, 1, 1],
  },
  {
    id: ToolId.SplashGrenade,
    name: 'SPLASH GRENADE',
    shortName: 'SPLASH BOMB',
    family: 'grenade',
    kind: 'grenade',
    blurb: 'Prime, throw, and burst one heavy circle of paint.',
    color: '#57dd73',
    shots: 1,
    fireRate: 0,
    automatic: false,
    muzzleSpeed: 0,
    spread: 0,
    radius: 0.06,
    gravity: 0,
    lifetime: 0,
    damageScale: 0,
    curveStrength: 0,
    kick: 0,
    respawn: 5.2,
    haptic: 0.75,
    visualScale: [1, 1, 1],
    fuse: 1.65,
    blastRadius: 1.05,
    blastDamageScale: 4.5,
  },
  {
    id: ToolId.ClusterGrenade,
    name: 'CLUSTER GRENADE',
    shortName: 'CLUSTER BOMB',
    family: 'grenade',
    kind: 'grenade',
    blurb: 'Prime and scatter a halo of long-lived Wildcat paint.',
    color: '#4ea6ff',
    shots: 1,
    fireRate: 0,
    automatic: false,
    muzzleSpeed: 0,
    spread: 0,
    radius: 0.06,
    gravity: 0,
    lifetime: 0,
    damageScale: 0,
    curveStrength: 0,
    kick: 0,
    respawn: 5.6,
    haptic: 0.7,
    visualScale: [1, 1, 1],
    fuse: 1.8,
    blastRadius: 0.42,
    blastDamageScale: 0.85,
    clusterPellets: 16,
  },
];

const TOOL_BY_ID = new Map(TOOL_DEFINITIONS.map((tool) => [tool.id, tool]));

export function toolById(id: ToolIdT): ToolDefinition {
  return TOOL_BY_ID.get(id) ?? TOOL_DEFINITIONS[0];
}

export function toolIndex(id: ToolIdT): number {
  return Math.max(0, TOOL_DEFINITIONS.findIndex((tool) => tool.id === id));
}

export function toolByIndex(index: number): ToolDefinition {
  return TOOL_DEFINITIONS[index] ?? TOOL_DEFINITIONS[0];
}

export const LOADOUT_SLOT_COUNT = 6;

/**
 * Normalised boss-pad coordinates: x crosses the pad, z points at GOOPLIATH.
 * The front and rear octagon faces stay open; three tools sit down each side.
 */
export const LOADOUT_SLOT_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0.52],
  [-1, 0],
  [-1, -0.52],
  [1, -0.52],
  [1, 0],
  [1, 0.52],
];

export interface LoadoutState {
  version: 1;
  slots: ToolIdT[];
}

const STORAGE_KEY = 'splash-wars-loadout-v1';
const DEFAULT_SLOTS: ToolIdT[] = [
  ToolId.Raptor,
  ToolId.Wildcat,
  ToolId.RaptorEllipse,
  ToolId.ViperEllipse,
  ToolId.Viper,
  ToolId.SplashGrenade,
];

function freshLoadout(): LoadoutState {
  return { version: 1, slots: [...DEFAULT_SLOTS] };
}

function loadSavedLoadout(): LoadoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshLoadout();
    const parsed = JSON.parse(raw) as Partial<LoadoutState>;
    const slots = Array.isArray(parsed.slots)
      ? parsed.slots.slice(0, LOADOUT_SLOT_COUNT).map((id, i) =>
          typeof id === 'string' && TOOL_BY_ID.has(id as ToolIdT)
            ? id as ToolIdT
            : DEFAULT_SLOTS[i],
        )
      : [];
    while (slots.length < LOADOUT_SLOT_COUNT) slots.push(DEFAULT_SLOTS[slots.length]);
    return { version: 1, slots };
  } catch {
    return freshLoadout();
  }
}

export const loadout = loadSavedLoadout();

export function setLoadoutSlot(slot: number, tool: ToolIdT): void {
  if (slot < 0 || slot >= LOADOUT_SLOT_COUNT || !TOOL_BY_ID.has(tool)) return;
  loadout.slots[slot] = tool;
  saveLoadout();
}

export function saveLoadout(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    /* The live layout still works if storage is unavailable. */
  }
}

export function resetLoadout(): void {
  loadout.slots.splice(0, LOADOUT_SLOT_COUNT, ...DEFAULT_SLOTS);
  saveLoadout();
}
