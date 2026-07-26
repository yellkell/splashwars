/**
 * One toy enemy bobbing in toward the deck. Paint coverage is its health:
 * `EnemySystem` moves it, `PaintSystem` splats it, full coverage pops it.
 */

import { createComponent, Types } from '@iwsdk/core';

export const Enemy = createComponent(
  'Enemy',
  {
    /** Paint coverage 0 (clean plastic) .. 1 (popped). */
    coverage: { type: Types.Float32, default: 0 },
    /** How much a single blob's coverage counts (boss soaks more). */
    soak: { type: Types.Float32, default: 1 },
    /** Collision radius (body scale applied). */
    radius: { type: Types.Float32, default: 0.21 },
    /** Drift speed toward the deck, m/s. */
    speed: { type: Types.Float32, default: 0.3 },
    /** Per-enemy bob phase so the squad doesn't march in sync. */
    phase: { type: Types.Float32, default: 0 },
    /** 1 for the wave-10 boss. */
    boss: { type: Types.Int32, default: 0 },
  },
  'A glossy plastic toy that gets painted over until it pops.',
);
