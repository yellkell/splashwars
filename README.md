# SPLASH WARS 🔫💦

Tower-defense JUICE fighting in WebXR passthrough. A ghost JUICE TOWER
follows your hand's point across your real floor — pull the trigger and it PLANTS,
and every wave of THE THIRST comes for it — the rival team's DRINKING
MACHINES: sleek hover-drones in the same competition-plastic kit as your
pistols, white shells with violet team trim, each built around one big
glowing lens and a drinking apparatus. Sippers drink from the tower and
FLEE with the juice — shoot the thief down before it escapes and every
drop goes back in the reservoir. Zippers dart in zigzags, Spouts lob from
range, Chuggers bulldoze dead straight. You are the defense: a sleek
white-and-red sports pistol rides each hip. Squeeze your grip near a
holster to **draw**, then pull the trigger — SEMI-AUTO, one fat orb of
vivid magenta juice per press, on that very frame. Juice lands as layered
splats on your real floor and as glossy creeping coverage over their white
shells — your colour claiming their kit — and a fully juiced machine
bursts. Every attack is TELEGRAPHED: a machine rears
back, crouches, and SNAPS at the tower — the hit lands exactly at the
snap, and bursting it mid-windup cancels the attack. Juice balls fly
Blaston-slow — quick enough that you'd have to dodge one — and enemy
return fire speaks the same language.

The hero piece is the **tank**: every pistol has a frosted blow-moulded tank
on top and you can SEE the juice sloshing inside — a Half-Life: Alyx-style liquid whose
surface stays level as you tilt the gun, surges when you swing it, ripples
when you jolt it. That liquid **is** the ammo, one unified system: fire and
the level visibly drains; run dry and you get a sad dribble and plastic
clicks. **There is no refill** — a tank is a magazine, and **throwing the
spent gun away is the reload**, because a fresh full one respawns on your
hip. The tower reads the same way: its health is the JUICE LEVEL standing
in its frosted reservoir, and every hit from THE THIRST visibly drains it —
that is what they came for. Empty tank = TOWER DRAINED. No gauge, no HUD —
the juice is the UI, in your guns, on the husks, in the tower, on your
visor.

Where FIRE FIGHT (iron-balls-boxing) was metal — gunmetal, hazard amber,
anvil clangs — SPLASH WARS is **a televised juice sport**: two kits of
glossy competition plastic (your white/red versus their white/violet),
beautiful liquid everywhere, pastel poolside light, and a fully
synthesised soundscape of squirts, plops, glugs and toy clicks (no audio
assets — everything is WebAudio at runtime).

Built on Meta's [Immersive Web SDK](https://iwsdk.dev/) (Three.js + ECS),
same stack and architecture as FIRE FIGHT. Everything is procedural —
no models, no textures, no sounds shipped.

## What's in this build

- **Dual sports water pistols** — sleek competition-white shells with
  racing-red accents (flank stripes, trigger, muzzle collar), built from
  primitives. They ride your **hips**: squeeze the grip near a holster to
  draw, release it to **throw the whole gun** — it tumbles, bursts on
  whatever it hits, and a fresh, full one respawns on your hip. With no
  auto-refill, that throw is your reload. And you can **CATCH**: squeeze
  any EMPTY hand near a thrown gun and it snaps into that palm, ammo
  intact — snatch your own throw back, or lob a pistol clean across your
  body to the other hand (on a cross-catch the spare gun trades hips, so
  each side always carries one).
- **The sloshing tank** — world-space clipped-liquid shader (the Alyx
  trick): spring-damper slosh driven by real hand acceleration, ripple
  energy, meniscus foam, and a **frosted** blow-moulded shell over fully
  opaque juice, so the liquid reads as a solid volume rather than a glass
  box. Fill level = ammo; a held trigger drains the tank in ~2.6 s and it
  does not come back on its own.
- **Semi-auto, then AUTO SOAKER** — one ball per trigger press, landing on
  the frame you pull; the tank is a 14-ball magazine. The AUTO SOAKER
  upgrade unlocks hold-to-fire and each stack cranks the cadence 35%.
  Balls fly at Blaston speeds — slow enough to watch, fast enough to have
  to dodge — and enemy return fire speaks the same language.
- **Damage numbers** — white digits with thick black outlines popping off
  every hit (bigger and gold for blasts), drawn from one instanced digit
  atlas so hundreds of hit markers cost a single draw call.
- **Gloss everywhere** — juice is WET: Blinn-Phong glints on the tank
  liquid and on enemy coverage, near-zero-roughness clearcoat on balls and
  orbiter globes, lit low-roughness floor splats that catch the scene's
  lights, and a baked wet highlight in every splat and card splodge.
- **A swarm built for thousands** — one InstancedMesh per enemy kind, all
  sharing a single shader; juice coverage is per-instance (noise-masked,
  dripping top-down, with a hot wet glint), so a thousand individually
  half-juiced husks still cost six draw calls. A uniform spatial grid keeps
  ball-vs-enemy and blast queries near-constant instead of
  O(balls x enemies).
- **THE THIRST** — the rival team's drinking machines, in the pistols'
  own design language: glossy white shells, violet team trim, smoked
  intakes, one big glowing lens recessed in a dark socket. **Sippers**
  (drinker drones with straws — they steal juice and RUN; kill the thief
  and the tower gets it back), **Zippers** (dart interceptors), **Spouts**
  (mortar drones, deliberately scarce and soft), **Chuggers** (armoured
  barrels), **Pods** (carrier shells that burst into Zippers), and
  **THE GULP** (a wave-10 industrial drinker crowned with straws). Rotor
  rings spin, fins bob and lenses breathe via per-part vertex-shader
  animation phase-offset per instance; machines bank into turns, swoop in
  on arrival, and rear-back-and-snap on telegraphed attacks. Fresnel rim
  light and two-tone ramp shading lift every silhouette off the room.
  One InstancedMesh per kind — six draw calls at any crowd size — and
  **everything comes from the front 180°**.
- **Health without a HUD** — damage throws juice across your **visor**; it
  thickens as you weaken and washes off as you recover. Same philosophy as
  the ammo: read the juice, not a number.
- **Place the tower to start** — shooting START hands you a pulsing cyan
  ghost of the juice tower that glides across the real floor wherever your
  HAND points (the ray leaves the grip along the pistol's own barrel axis);
  either trigger plants it (a plastic KACHUNK) and wave one rolls in.
- **The board: one portal, one grid, your maze** — planting the tower
  opens THE PORTAL 6 m past it: a violet ring with a swirling drink
  inside, and every machine in every wave pours out of that ONE door
  (flaring as it does). An aqua grid fades onto the real floor around the
  tower ONLY while a placement ghost is out (the fight itself stays
  clean passthrough), and WALL pieces from the shop snap to its cells. Enemies never body through a
  wall: two flow fields (Dijkstra from tower and portal, recomputed only
  when the board changes) steer the whole swarm around your build with
  zero per-enemy pathfinding — attackers descend one field to the tower,
  juice-laden Sippers descend the other to flee back out the door. A
  placement that would seal portal from tower entirely glows RED and
  refuses to plant: you may funnel THE THIRST through your turret
  gauntlet, you may not brick it out. THE GULP is the exception — too big
  for a maze, it plows the straight line. Balls from either side smash
  wetly on the walls.
  The reservoir shows its LIVE juice level through frosted plastic (the
  same clipped-liquid shader as the pistol tanks), and strikes jolt the
  surface. AGAIN after a wipe keeps your spot; MENU lifts the tower for a
  fresh placement.
- **The economy: DROPS and the wrist shop** — kills mint DROPS (a gold
  "+10" pops beside the damage number, pitched coin blips on streaks, and
  a wave-clear bonus that grows with the wave). A smoked-glass WATCH on
  your left wrist shows the balance on a rolling odometer. Press Y — the
  button on your watch wrist — any time mid-battle and the shop board
  flips up as a 3×2 grid. Top row, turrets: SPRINKLER (150 — an
  auto-firing tripod that locks a target, slews its head onto it at a
  finite turn rate and only fires once aligned), CHILLER (250 — an icy
  field that halves the speed of everything inside its floor ring), PUMP
  (350 — trickles juice back into the tower), and WALL (45 — the maze
  piece; snaps to the grid, capped per run). Bottom row, permanent money
  sinks that level base stats forever, each card wearing its LV badge:
  POWER (+15% ball damage per level), BIG TANKS (+3 balls in every fresh
  pistol per level), RESERVOIR (+60 tower capacity per level, filled on
  purchase). Every level bought multiplies that sink's price by 1.5, so
  late-game DROPS always have somewhere to go. Cards you can't
  afford shake their juice off with a dead buzz. Buying a turret hands you
  a ghost that rides your hand's point — trigger plants it, exactly like
  the tower. The fight does not pause: shopping under pressure is the game.
  Turrets render from module-cached merged geometry and shared
  MeshStandard materials, so a maxed field stays a handful of draw calls.
- **Menus you shoot** — the game has exactly one interaction verb. The
  title screen is a HOW TO PLAY plate over a big START card: draw and shoot
  it to begin. Losing brings a WIPED OUT / TOWER DRAINED plate (wave / pops
  / score) with AGAIN and MENU cards. Between waves, three upgrade cards swing up and you
  **hose the one you want** — about three balls, well under a second. Heavy
  Juice (damage), Orbiters (vampire-survivors globes that grind anything
  they touch), Buoyancy (max health + full heal), Juice Bomb (thrown
  pistols detonate), Burst (balls burst with AOE) — all stacking. All of
  it is one shared shoot-to-pick CardBoard primitive (ui/cardBoard.ts).
- **The floor comes back** — clearing a wave sends an aqua ring sweeping
  out from the tower that slurps every floor splat it passes (with a long
  rising slurp to match), so each wave starts on a clean arena and the
  splat budget never silts up. The SPLASH WARS sign is title-screen-only —
  nothing floats over the fight — and every canvas-drawn UI (cards, plates,
  watch, signs) renders at 2× with sRGB colour and anisotropy, so menus
  read crisp instead of washed and shimmery.
- **Synth SFX** — every shot is a round wet PLOP (a dip-and-swoop droplet
  sine over a low pump thump, pitch wandering shot to shot so full-auto
  BURBLES over a lowpassed gurgle bed instead of hissing), plus splats,
  glugs, empty clicks, enemy lobs, juice-bomb whumps, wave horns, upgrade
  chimes.

## Running it

```bash
npm install
npm run dev        # Vite + IWSDK dev plugin (WebXR emulator on desktop)
npm run typecheck  # tsc --noEmit
npm run build
```

On a Quest browser you'll get an "Enter AR" offer — the deck and the waves
appear in your real room. On desktop the IWER emulator drives a virtual
Quest 3 (WASD + mouse).

## The design (where this is going)

- **More weapons**: the pistol is weapon one of a family — a pump shotgun
  that needs real pump-action, a pressure sprayer you charge up, a balloon
  lobber — all sharing the unified visible-liquid ammo system.
- **More upgrades**: tank capacity, faster holster respawn, fire rate,
  pierce, chain bursts, and weapon-specific branches.
- **Squeegee your visor** — wipe the juice off your view with a hand swipe
  instead of waiting for regen.
- **Deck-hop locomotion** (the Eye of the Temple trick, XR-safe): at set
  moments, spare decks appear to your left and right across the void. Walk
  to that edge of YOUR deck — a real, physical walk — and the whole platform
  lifts and carries you over, setting you down on the far deck. You moved
  through the space, but you never left your platform and never touched a
  thumbstick. On the back burner until the combat sandbox is dialled.
- **Boss battles** with FIRE FIGHT-style mechanics every 10th wave.
- **Plastic + water everywhere**: caustic light dapple on the deck, drips
  running off the rim, juice that drips down enemies in world space.

## Architecture

```
src/
  config.ts               every tunable the feel depends on, in one place
  main.ts                 World boot + system registration (+ dev hooks)
  game/run.ts             run state: health, upgrade stacks, score
  arena/                  static set-dressing: deck, lighting, title banner
  components/             ECS data: WaterPistol
  game/appState.ts        title -> playing -> gameover flow
  ui/cardBoard.ts         the ONE menu primitive: shoot-to-pick cards
  game/shop.ts            the bank (DROPS), placed turrets, build state
  systems/                WeaponSystem (draw/fire/drain/throw/slosh),
                          JuiceSystem (ball flight, hits, bursts, splats),
                          EnemySystem (waves, AI, threat, deaths, blasts),
                          UpgradeSystem (between-wave offers),
                          MenuSystem (title + game-over boards),
                          TowerSystem (ghost placement, reservoir, wobble),
                          TurretSystem (watch, shop, turrets),
                          PlayerSystem (health, visor, orbiters, death)
  weapons/waterPistol.ts  the procedural pistol build (primitives only)
  materials/              plastic PBR helpers + the clipped-liquid shader
  enemies/geometry.ts     the pool-toy bodies (merged primitives + roles)
  enemies/swarm.ts        per-kind instanced swarm + spatial grid + shader
  fx/juice.ts             instanced ball/splat/droplet pools
  fx/damageNumbers.ts     instanced digit-atlas hit markers
  combat/juiceBus.ts      weapon -> juice-sim -> swarm event queues
  audio/sfx.ts            synthesised squirts, plops, glugs
  input/haptics.ts        session-live controller rumble (from FIRE FIGHT)
```

**Nothing high-frequency is an ECS entity.** Juice balls, enemies and damage
digits all live in typed-array slots rendered through instanced meshes — at
swarm scale, per-entity Groups and materials would sink the frame budget.
Only the two pistols are entities. Enemy state has exactly one writer
(`EnemySystem`); everything else — bursts, juice bombs, orbiters — requests
damage over the juice bus.

In dev (`npm run dev`) the game exposes `window.SPLASH` — `stats()`,
`digits()`, `hitFirstEnemy()`, `popAt()` — for debugging and for the headless
smoke tests. It is compiled out of production builds.
