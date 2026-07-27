/**
 * The app's top-level flow — the skeleton the whole production experience
 * hangs off:
 *
 *   TITLE ──start──▶ PLAYING ──death──▶ GAMEOVER ──again──▶ PLAYING
 *                                          └────menu────▶ TITLE
 *
 * A plain module singleton (same pattern as run/paintBus). MenuSystem drives
 * the transitions; EnemySystem's wave director only runs while `playing`.
 * The pistols work in every phase — the menus are made of the same paintable
 * cards as the upgrades, so shooting is the only verb the game ever needs.
 */

export type AppPhase = 'title' | 'playing' | 'gameover';

export const app = {
  phase: 'title' as AppPhase,
};
