/**
 * Duel-mode shared state — the slice other systems need without touching
 * DuelSystem itself (module singleton, same pattern as run/tower/shop).
 *
 * The one cross-system rule that matters: in a duel your pistols do NOT
 * respawn full for free. Fresh guns fill from a RESERVE of tanks, and the
 * reserve is bought with minerals — juice is the second resource, minted
 * from the first. Out of reserve, a respawned pistol arrives with dregs:
 * a few balls, enough to chip a crystal and claw your way back, never
 * enough to fight with.
 */

export const duel = {
  /** True while a duel match is live — gates the reserve rule below. */
  active: false,
  /** Your juice reserve, in pistol tanks. */
  tanks: 0,
};

/** How full a freshly-respawned pistol arrives (WeaponSystem calls this). */
export function claimTank(): number {
  if (!duel.active) return 1;
  if (duel.tanks > 0) {
    duel.tanks -= 1;
    return 1;
  }
  return 0.18; // the dregs — two or three balls to bootstrap with
}
