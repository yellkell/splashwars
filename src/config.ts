/**
 * SPLASH WARS tunables — the game is a wave-survival paint fight: you stand
 * on a plastic pool-deck platform while waves of toy enemies close in, and
 * you hose them down with water pistols full of thick, vivid paint. Numbers
 * the gameplay feel depends on live here so they are easy to find and adjust.
 * Dimensions are in metres.
 *
 * The fantasy: a chunky plastic super-soaker in each hand with a transparent
 * tank on top — you can SEE the paint sloshing inside (Half-Life: Alyx style
 * liquid), and the liquid in the tank IS your ammo. Fire and the level drops;
 * ease off and it refills. One unified system: what you see is what you have.
 *
 * Where FIRE FIGHT was metal — gunmetal, hazard amber, anvil clangs — SPLASH
 * WARS is plastic and beautiful water: glossy toy shells, pastel decks,
 * squirts, plops and glugs.
 */

export const GAME_TITLE = 'SPLASH WARS';

/**
 * The player's pool-deck platform: a round glossy slab, Blaston-ish footprint
 * so a real play space maps onto it. Enemies advance toward its rim.
 */
export const PLATFORM = {
  radius: 0.95, // deck radius — your whole play space
  thickness: 0.12, // slab depth below the floor line — reads as a pedestal
  rimRadius: 0.045, // the inflatable-looking rounded rim tube
  rimLift: 0.012, // paint-colour glow line height above the floor
};

/**
 * The water pistol — the whole game. One per hand.
 *
 *  - Hold the trigger and it lobs fat tennis-ball paint orbs.
 *  - The visible tank level drains exactly as fast as you fire.
 *  - Let go and the pump gurgles the tank full again.
 */
export const PISTOL = {
  // Tank + ammo. `capacity` is seconds of continuous fire in a full tank.
  capacity: 6.5,
  refillDelay: 0.9, // seconds after the last shot before refill starts
  refillRate: 0.28, // tank fraction per second (empty → full in ~3.6 s)

  // The balls. Tennis-ball-sized paint orbs, Blaston-slow: MUCH slower than
  // real projectiles but quick enough that you'd have to dodge one — this is
  // the game's shared projectile language, so when enemies and bosses shoot
  // back later their fire is readable and dodgeable the same way.
  fireRate: 9, // balls per second at a full trigger pull
  muzzleSpeed: 4.6, // launch speed (m/s) — watchable in flight, dodge-or-else
  inheritVel: 0.55, // fraction of hand velocity added to the launch
  spread: 0.02, // radians of random cone spread — a lob, not a laser
  blobRadius: 0.034, // collision + visual radius — a tennis ball (Ø ~6.8 cm)
  gravity: 2.4, // gentle arc so slow balls still reach the spawn ring
  lifetime: 3.0, // seconds of flight before a ball is culled
  coverPerHit: 0.32, // enemy coverage per landed ball — 3-4 clean hits pops

  // Feel.
  hapticEvery: 1, // a chunky ball deserves a thump per shot
  sputterShots: 4, // weak dribble shots fired as the tank hits empty

  // The slosh sim — a damped 2D pendulum tilting the liquid surface plane.
  slosh: {
    accelGain: 0.045, // hand acceleration (m/s²) → surface tilt drive
    spring: 34, // pull of the surface back toward level
    damping: 4.2, // how fast the slosh settles
    maxTilt: 0.55, // tilt clamp (rise/run) so the surface never flips
    rippleGain: 2.2, // slosh energy → shader ripple amplitude
    energyDecay: 1.6, // per-second decay of ripple energy
  },
};

/** Where paint may fly: a generous invisible cage around the arena. */
export const ARENA_BOUNDS = {
  radius: 14, // blobs beyond this are culled
  ceiling: 8,
};

/**
 * Wave survival, vampire-survivors pacing: each wave spawns a bigger, faster
 * squad of toy enemies that bob in toward the deck. Coverage is their health
 * bar — paint one fully and it pops. Wave 10 is the boss: one huge toy that
 * soaks a whole tank. (Per-run upgrades slot in here later.)
 */
export const WAVES = {
  count: 10, // waves per loop; the last one is the boss
  baseEnemies: 3, // wave 1 squad size
  enemiesPerWave: 2, // extra enemies per wave after the first
  baseSpeed: 0.32, // m/s drift toward the deck on wave 1
  speedPerWave: 0.045, // extra m/s per wave
  spawnRadius: [6.5, 9] as [number, number], // ring the squad appears on
  spawnStagger: 1.1, // seconds between squad member entrances
  standoffRadius: 1.6, // enemies hold this far from the deck centre
  interWaveDelay: 3.5, // breather between waves
  bossCoverageSoak: 7, // boss needs this many enemies' worth of paint
  bossScale: 2.6, // boss body scale multiplier
};

/** One toy enemy: a glossy bobbing plastic blob with eyes. */
export const ENEMY = {
  bodyRadius: 0.21, // base body radius (waves scale slightly)
  bobAmplitude: 0.08, // idle vertical bob
  bobRate: 1.7, // bobs per second-ish (each enemy gets its own phase)
  hoverHeight: 1.05, // body centre height above the floor
  popDroplets: 26, // droplet burst size when one pops
};

/**
 * Plastic-and-water palette. Player paint is bubblegum magenta — thick,
 * glossy, unmistakably yours. The world is pastel poolside plastic.
 */
export const PALETTE = {
  paint: 0xf0299b, // your paint — bubblegum magenta
  paintDeep: 0xa50f66, // shadowed depths of the same paint
  paintFoam: 0xffb8df, // meniscus/foam line where paint meets air
  toyOrange: 0xff8a2a, // pistol body shell
  toyTeal: 0x1fc4c9, // pistol grip + accents
  toyYellow: 0xffd23f, // pump + cap details
  deckWhite: 0xf7f4ec, // pool-deck plastic
  deckAqua: 0x8fdfe8, // deck rim tube
  enemyShell: 0xe8f6f8, // unpainted enemy plastic
  water: 0x5ecfe0, // beautiful-water accents / sky tint
  sky: 0xcfeef7,
  charcoal: 0x22303a, // fallback clear colour (non-AR)
};
