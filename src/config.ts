/**
 * SPLASH WARS tunables — tower-defense juice fighting: you plant a JUICE
 * TOWER in your real room, and waves of THE THIRST — parched, faceted
 * husk-creatures — come to drain it while you hose them down with pistols
 * full of thick, vivid juice. Numbers the gameplay feel depends on live
 * here so they are easy to find and adjust. Dimensions are in metres.
 *
 * The fantasy: a chunky plastic super-soaker in each hand with a transparent
 * tank on top — you can SEE the juice sloshing inside (Half-Life: Alyx style
 * liquid), and the liquid in the tank IS your ammo. Fire and the level drops.
 * There is no refill — when a tank runs dry you throw the gun away and draw a
 * fresh one off your hip. One unified system: what you see is what you have.
 *
 * Where FIRE FIGHT was metal — gunmetal, hazard amber, anvil clangs —
 * SPLASH WARS is glossy plastic and beautiful liquid against dry, cracked
 * husks: squirts, plops and glugs versus dust.
 */

export const GAME_TITLE = 'SPLASH WARS';

/**
 * THE TOWER — what the whole fight is about. To start a run you PLACE it:
 * a ghost lifeguard tower follows your gaze across the real floor, you pull
 * the trigger, and it plants there. Every wave then comes for the tower,
 * not for you — you are the defense. Its health is the JUICE LEVEL visibly
 * standing in its reservoir: every hit drains it a little (that is what
 * THE THIRST is here for). Empty tank = TOWER DRAINED = run over.
 */
export const TOWER = {
  radius: 0.34, // collision footprint the toys mob
  height: 1.35, // top of the umbrella
  maxHealth: 400,
  placeMin: 0.6, // metres from you the ghost may sit
  placeMax: 3.0,
  hitFlash: 0.25, // seconds of wobble when it takes a hit
};

/**
 * The water pistol — the whole game. One per hand.
 *
 *  - Pull the trigger and it fires INSTANTLY — no charge, no spin-up.
 *  - The visible tank level drains exactly as fast as you fire.
 *  - When it's dry it stays dry: throw the gun and draw a fresh one.
 */
export const PISTOL = {
  // Tank + ammo. SEMI-AUTO: one ball per trigger PRESS (the AUTO SOAKER
  // upgrade unlocks hold-to-fire — see AUTO). The tank is a magazine of
  // `shotsPerTank` balls with NO auto-refill: when it runs dry you throw
  // the gun away and draw the fresh one off your hip — the throw IS the
  // reload, which is what makes the holster loop the ammo economy.
  shotsPerTank: 14,

  // The balls. Chunky juice orbs, Blaston-slow: MUCH slower than real
  // projectiles but quick enough that you'd have to dodge one — this is the
  // game's shared projectile language, so enemy return fire reads the same.
  muzzleSpeed: 7.2, // launch speed (m/s) — snappier, still readable in flight
  inheritVel: 0.55, // fraction of hand velocity added to the launch
  spread: 0.018, // radians of random cone spread — a lob, not a laser
  blobRadius: 0.052, // collision + visual radius — a big fat cricket ball
  gravity: 2.0, // gentle arc so the balls still reach the spawn ring
  lifetime: 3.0, // seconds of flight before a ball is culled
  damage: 40, // damage per landed ball (see ENEMY_TYPES for HP pools)

  // Feel.
  hapticEvery: 1, // a chunky ball deserves a thump per shot

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

/**
 * AUTO SOAKER — the auto-fire upgrade path. Stack 1 turns the pistol from
 * semi-auto into hold-to-fire at `rate`; every further stack multiplies the
 * cadence. The semi-auto press always stays available (and is still the
 * fastest possible single shot).
 */
export const AUTO = {
  rate: 3.2, // balls per second at the first AUTO SOAKER stack
  ratePerStack: 1.35, // cadence multiplier per additional stack
};

/**
 * The hip holsters — one pistol rides each hip. Reach down, squeeze the GRIP
 * to draw; release the grip to throw the whole gun. A thrown pistol tumbles
 * (juice sloshing all the way), bursts on whatever it hits — floor or enemy —
 * and a fresh one respawns on your hip a beat later. Throwing a full tank at
 * an enemy dumps the whole tank's juice on it at once.
 */
export const HOLSTER = {
  /**
   * Pitch applied to a HELD pistol, radians. The XR grip space's -Z runs
   * along the controller handle, which sits nose-up when you hold a
   * controller naturally — so a gun parented raw to the grip aims above
   * where you think you're pointing. Negative tips the barrel back down to
   * where your hand feels like it's aiming.
   */
  heldPitch: -0.32,
  lateral: 0.24, // hip offset left/right of the head, metres
  height: 0.96, // holster height above the floor
  forward: 0.03, // nudged forward so it's visible in your periphery
  drawRadius: 0.45, // squeeze the grip within this of the holster to draw
  respawnDelay: 1.2, // seconds after a throw before the fresh gun appears
  throwBoost: 1.15, // hand velocity multiplier on release
  minThrowSpeed: 1.2, // a limp drop still clears your platform edge
  throwGravity: 5.5, // guns are heavier than juice balls
  throwSpin: 9, // rad/s tumble in flight — the tank sloshes wildly
  hitRadius: 0.14, // the gun's collision radius vs enemies
  // Damage a direct hit deals, scaled by how full the thrown tank was — a
  // brimming pistol to the face is a serious opener.
  throwDamage: 220,
};

/** Where juice may fly: a generous invisible cage around the arena. */
export const ARENA_BOUNDS = {
  radius: 14, // blobs beyond this are culled
  ceiling: 8,
};

/**
 * Wave survival, vampire-survivors pacing. Waves escalate hard in COUNT, not
 * just in stats — by the late waves the deck is ringed by a swarm, which the
 * instanced renderer (enemies/swarm.ts) is built to eat. Between every wave
 * you pick one of three upgrades. Wave 10 is the boss.
 */
export const WAVES = {
  count: 10, // waves per loop; the last one is the boss
  baseEnemies: 6, // wave 1 squad size
  enemiesPerWave: 5, // extra enemies per wave (compounding — see growth)
  growth: 1.35, // squad size multiplier per wave — this is the swarm curve
  baseSpeed: 0.34, // m/s drift toward the deck on wave 1
  speedPerWave: 0.04, // extra m/s per wave
  hpPerWave: 0.11, // fractional HP bump per wave
  spawnRadius: [6.0, 9.5] as [number, number], // ring the squad appears on
  /**
   * Enemies only ever come from the FRONT — this arc, centred on -Z (the
   * way the deck and the wave sign face). Being surrounded in a headset is
   * miserable: you cannot watch your back, so anything spawning behind you
   * is damage you never had a chance to answer.
   */
  spawnArc: Math.PI, // 180° across the front

  spawnRate: 14, // enemies released per second while a wave pours in
  standoffRadius: 1.35, // enemies press to this radius, then attack
  interWaveDelay: 2.0, // breather before the upgrade board appears
  bossScale: 2.8, // boss body scale multiplier
};

/** Shared enemy shape constants. */
export const ENEMY = {
  bobAmplitude: 0.07, // idle vertical bob
  bobRate: 1.7, // bobs per second-ish (each enemy gets its own phase)
  hoverHeight: 1.05, // body centre height above the floor
  popDroplets: 14, // droplet burst size when one pops
  separation: 0.55, // crowd push-apart strength so the swarm doesn't stack
  /**
   * The attack telegraph: every attack (melee chomp or ranged lob) runs a
   * fixed-length animation — rear back and crouch, SNAP forward, recover —
   * and the damage/shot lands exactly at the snap. You can always see an
   * attack coming, and interrupting the windup (popping the toy) cancels it.
   */
  attackDuration: 0.9, // seconds for the whole windup-snap-recover
  attackStrikeAt: 0.45, // anim position (1→0) where the hit actually lands
};

/**
 * The roster — POOL TOYS. The creative direction: everything that attacks
 * you escaped from a pool inflatables crate, so each type is a silhouette
 * you can read across the room (see enemies/geometry.ts): a striped beach
 * ball, a squirt droplet, a knotted water balloon, an inflatable duck, a
 * clump of foam bubbles, and a giant crowned duck for the boss.
 *
 * `attack` is damage dealt to YOU: melee toys on contact at the deck rim,
 * ranged toys by throwing a juice ball at you from range.
 *
 * Balance: tuned soft. PISTOL.damage is 40, so a Squirt is one clean hit,
 * a Bobber two, a Slinger three — the swarm is a mowing fantasy, and the
 * threat comes from volume and the Big Ducks, not from bullet sponges.
 */
export const EnemyKind = {
  Drifter: 0, // "Husk" — parched crystal boulder, the crowd
  Scurrier: 1, // "Skitter" — small spiked shard, fast, one-hit pop
  Lobber: 2, // "Spitter" — leaning obelisk that lobs from range
  Brute: 3, // "Clod" — rubble golem, big, tanky, hits hard
  Splitter: 4, // "Cluster" — shard aggregate that bursts into Skitters
  Boss: 5, // "THE DROUGHT" — the wave-10 crowned monolith
} as const;
export type EnemyKindId = (typeof EnemyKind)[keyof typeof EnemyKind];

export interface EnemyTypeDef {
  name: string;
  radius: number;
  hp: number;
  speed: number; // multiplier on the wave's base speed
  tint: number; // dry crust colour (before your juice covers it)
  accent: number; // darker crust: spikes, plates, the boss's crown
  glow: number; // the eyes' emissive colour
  attack: number; // damage per hit on the player
  attackInterval: number; // seconds between its attacks
  ranged: boolean; // true = throws at you instead of touching you
  splitInto?: EnemyKindId; // what it becomes when killed
  splitCount?: number;
  score: number;
}

export const ENEMY_TYPES: Record<EnemyKindId, EnemyTypeDef> = {
  [EnemyKind.Drifter]: {
    name: 'Husk', radius: 0.19, hp: 72, speed: 1, tint: 0xcfc4b0,
    accent: 0x8a7f6c, glow: 0xffb03f,
    attack: 3, attackInterval: 2.0, ranged: false, score: 10,
  },
  [EnemyKind.Scurrier]: {
    name: 'Skitter', radius: 0.12, hp: 34, speed: 2.05, tint: 0xb8bfd0,
    accent: 0x707a91, glow: 0x9ff2ff,
    attack: 2, attackInterval: 1.5, ranged: false, score: 15,
  },
  [EnemyKind.Lobber]: {
    // The ranged threat — deliberately SOFT: it chips, it doesn't shell.
    name: 'Spitter', radius: 0.22, hp: 90, speed: 0.72, tint: 0x9a8fb8,
    accent: 0x5f5480, glow: 0x7b5cff,
    attack: 3, attackInterval: 4.4, ranged: true, score: 25,
  },
  [EnemyKind.Brute]: {
    name: 'Clod', radius: 0.36, hp: 300, speed: 0.5, tint: 0x93998f,
    accent: 0x5c6158, glow: 0xffb03f,
    attack: 9, attackInterval: 2.2, ranged: false, score: 50,
  },
  [EnemyKind.Splitter]: {
    name: 'Cluster', radius: 0.26, hp: 120, speed: 0.85, tint: 0xd9d2c4,
    accent: 0x9a917e, glow: 0xff8a5c,
    attack: 4, attackInterval: 2.0, ranged: false,
    splitInto: EnemyKind.Scurrier, splitCount: 4, score: 30,
  },
  [EnemyKind.Boss]: {
    name: 'THE DROUGHT', radius: 0.75, hp: 3600, speed: 0.34, tint: 0x6e6459,
    accent: 0x3f3831, glow: 0xff4d3d,
    attack: 8, attackInterval: 2.6, ranged: true, score: 500,
  },
};

/**
 * Which types show up when. Each wave draws from its unlocked pool, so the
 * fight gets more varied as well as bigger.
 */
export const WAVE_ROSTER: EnemyKindId[][] = [
  // Weighted draws: duplicates raise a kind's share of the wave. Spitters
  // (ranged) are kept to roughly a fifth of any squad — a wall of ranged
  // chip damage was unanswerable and unfun.
  [EnemyKind.Drifter], // 1
  [EnemyKind.Drifter, EnemyKind.Scurrier], // 2
  [EnemyKind.Drifter, EnemyKind.Drifter, EnemyKind.Scurrier, EnemyKind.Lobber], // 3
  [EnemyKind.Drifter, EnemyKind.Scurrier, EnemyKind.Scurrier, EnemyKind.Lobber], // 4
  [EnemyKind.Drifter, EnemyKind.Scurrier, EnemyKind.Splitter, EnemyKind.Splitter, EnemyKind.Lobber], // 5
  [EnemyKind.Scurrier, EnemyKind.Splitter, EnemyKind.Brute, EnemyKind.Brute, EnemyKind.Lobber], // 6
  [EnemyKind.Drifter, EnemyKind.Drifter, EnemyKind.Scurrier, EnemyKind.Brute, EnemyKind.Lobber], // 7
  [EnemyKind.Scurrier, EnemyKind.Splitter, EnemyKind.Brute, EnemyKind.Brute, EnemyKind.Lobber], // 8
  [EnemyKind.Scurrier, EnemyKind.Scurrier, EnemyKind.Splitter, EnemyKind.Brute, EnemyKind.Lobber], // 9
  [EnemyKind.Boss], // 10
];

/** You. Juice splashed on your visor is the damage read; it fades as you heal. */
export const PLAYER = {
  maxHealth: 100,
  regenDelay: 4, // seconds without a hit before you start recovering
  regenPerSec: 5,
  hurtFlash: 0.5, // seconds the visor splat lingers at full strength
  deathRespawnDelay: 4, // seconds down before the run restarts
  /**
   * Invulnerability after any hit. Without this a crowd all landing on the
   * same frame deletes you instantly — every enemy in reach resolves its
   * attack independently, so ten of them is ten simultaneous hits. This is
   * what keeps a swarm a threat rather than a coin flip.
   */
  invulnerable: 0.6,
};

/** Enemy return fire — the same slow, dodgeable ball language as yours. */
export const ENEMY_SHOT = {
  speed: 3.9,
  gravity: 2.4,
  radius: 0.075,
  lifetime: 4,
  hitRadius: 0.34, // how close to your head counts as a hit
  damagePlayer: 5, // a Spitter lob that catches your head
  damageTower: 6, // a Spitter lob that lands on the tower
  tint: 0x7b5cff,
};

/**
 * Upgrades — between every wave you're offered three at random and you PICK
 * BY SHOOTING the one you want (no menus in VR: juice the card you want).
 * Each can stack; `max` caps the stack.
 */
export const UPGRADES = {
  cardWidth: 0.46,
  cardHeight: 0.6,
  cardGap: 0.13,
  cardDistance: 1.9, // metres in front of you
  cardHeightY: 1.45,
  // Deliberately low: a card should fall to two or three balls. Picking an
  // upgrade is a beat between waves, not a chore.
  juiceToPick: 0.18, // fraction of a card you must cover to choose it (~3 balls)
};

/** Orbital juice globes — the vampire-survivors passive. */
export const ORBITALS = {
  radius: 0.85, // orbit radius around you
  height: 1.05,
  speed: 1.9, // rad/s
  globeRadius: 0.11,
  damage: 26, // damage per tick to anything it touches
  tickInterval: 0.45, // per-enemy damage cooldown
};

/** Splash + explosion tuning for the AOE upgrades. */
export const AOE = {
  burstRadius: 0.55, // juice-ball splash radius at stack 1
  burstRadiusPerStack: 0.22,
  burstFraction: 0.45, // fraction of direct damage dealt in the splash
  throwRadius: 1.1, // thrown-pistol explosion radius at stack 0
  throwRadiusPerStack: 0.5,
  throwDamage: 120, // thrown-pistol explosion damage at stack 0
  throwDamagePerStack: 110,
};

/**
 * Plastic-and-water palette. Player juice is bubblegum magenta — thick,
 * glossy, unmistakably yours. The world is pastel poolside plastic.
 */
export const PALETTE = {
  juice: 0xf0299b, // your juice — bubblegum magenta
  juiceDeep: 0xa50f66, // shadowed depths of the same juice
  juiceFoam: 0xffb8df, // meniscus/foam line where juice meets air
  sportWhite: 0xf7f9fc, // pistol shell — competition white
  sportRed: 0xe0312e, // racing-red accents: stripes, trigger, nozzle
  sportSmoke: 0x39424b, // smoked details: grip inlay, nozzle bore
  deckWhite: 0xf7f4ec, // pool-deck plastic
  deckAqua: 0x8fdfe8, // deck rim tube
  enemyShell: 0xe8f6f8, // unjuiced enemy plastic
  water: 0x5ecfe0, // beautiful-water accents / sky tint
  sky: 0xcfeef7,
  charcoal: 0x22303a, // fallback clear colour (non-AR)
};
