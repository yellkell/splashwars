/**
 * One plastic water pistol, bonded to a hand. `WeaponSystem` runs the firing
 * loop, drains/refills the tank and drives the sloshing liquid visual — the
 * tank's visible level IS this component's `ammo`.
 */

import { createComponent, Types } from '@iwsdk/core';

export const WaterPistol = createComponent(
  'WaterPistol',
  {
    /** Which hand holds it: 0 = left, 1 = right. */
    hand: { type: Types.Int32, default: 0 },
    /** Tank level, 0 (dry) .. 1 (brimming). Rendered by the liquid shader. */
    ammo: { type: Types.Float32, default: 1 },
    /** Seconds since the trigger last fired a blob (gates the refill). */
    idle: { type: Types.Float32, default: 999 },
    /** Blob emission accumulator (carries fractional blobs between frames). */
    emit: { type: Types.Float32, default: 0 },
    /** Blobs fired since the last haptic tick. */
    ticks: { type: Types.Int32, default: 0 },
    /** Dribble shots left in the empty-tank sputter. */
    sputter: { type: Types.Int32, default: 0 },
    /** 1 while the refill glug is audibly running. */
    refilling: { type: Types.Int32, default: 0 },
  },
  'A plastic water pistol with a visible, sloshing paint tank.',
);
