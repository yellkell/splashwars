/**
 * One Splash tool. Defense/Duel create two hip-bound Raptors; campaign boss
 * fights create the six guns or grenades selected for the pad sockets.
 * `WeaponSystem` owns pickup, firing, throwing, respawn and visible ammo.
 */

import { createComponent, Types } from '@iwsdk/core';

export const PistolState = {
  /** Riding the hip holster, waiting to be drawn (grip squeeze nearby). */
  Holstered: 0,
  /** In the hand: trigger fires, releasing the grip throws it. */
  Held: 1,
  /** Thrown: tumbling through the air, tank sloshing, until it hits. */
  Flying: 2,
  /** Burst on impact; a fresh gun is on its way to the hip. */
  Respawning: 3,
  /** Resting in one of the six boss-platform pickup sockets. */
  Docked: 4,
} as const;

export const WaterPistol = createComponent(
  'WaterPistol',
  {
    /** Current/last hand: 0 = left, 1 = right, -1 = no hand. */
    hand: { type: Types.Int32, default: 0 },
    /** Permanent hip owner for ordinary Raptors; -1 for platform tools. */
    homeHand: { type: Types.Int32, default: -1 },
    /** Index into TOOL_DEFINITIONS. */
    tool: { type: Types.Int32, default: 0 },
    /** Boss-platform socket 0..5, or -1 for an ordinary hip tool. */
    station: { type: Types.Int32, default: -1 },
    /** PistolState — see above. */
    state: { type: Types.Int32, default: 0 },
    /** Respawn countdown while Respawning. */
    timer: { type: Types.Float32, default: 0 },
    /** Tank level, 0 (dry) .. 1 (brimming). Rendered by the liquid shader. */
    ammo: { type: Types.Float32, default: 1 },
    /** Blob emission accumulator (carries fractional blobs between frames). */
    emit: { type: Types.Float32, default: 0 },
    /** Blobs fired since the last haptic tick. */
    ticks: { type: Types.Int32, default: 0 },
    /** Dribble shots left in the empty-tank sputter. */
    sputter: { type: Types.Int32, default: 0 },
  },
  'A grabbable Splash tool with visible juice and a physical spawn point.',
);
