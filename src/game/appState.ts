/**
 * The app's top-level flow — the skeleton the whole production experience
 * hangs off:
 *
 *   TITLE ─start─▶ PLACING ─trigger─▶ PLAYING ─death/tower─▶ GAMEOVER
 *                  (plant the ghost                     │        │
 *                   lifeguard tower)                    ◀──again─┘
 *                                            GAMEOVER ──menu──▶ TITLE
 *
 * A plain module singleton (same pattern as run/juiceBus). MenuSystem drives
 * the transitions; EnemySystem's wave director only runs while `playing`.
 * The pistols work in every phase — the menus are made of the same juiceable
 * cards as the upgrades, so shooting is the only verb the game ever needs.
 */

export type AppPhase = 'title' | 'placing' | 'playing' | 'gameover';

/**
 * Which game you're playing:
 *  - 'defense' — the tower-defense mode: portal, waves, walls, the tower;
 *  - 'duel'    — the 1v1 economy fight: mine minerals, buy juice/turrets/
 *    shields, soak the rival before they soak you (systems/DuelSystem.ts).
 * Chosen on the title screen; AGAIN keeps the mode, MENU returns to choose.
 */
export type AppMode = 'defense' | 'duel';

export const app = {
  phase: 'title' as AppPhase,
  mode: 'defense' as AppMode,
};
