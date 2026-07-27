# SPLASH WARS 🔫💦

Tower-defense paint fighting in WebXR passthrough. A ghost LIFEGUARD TOWER
follows your gaze across your real floor — pull the trigger and it PLANTS,
and every wave of runaway pool toys that follows comes for IT: striped
beach balls bouncing in, squirt droplets zigzagging, knotted water balloons
lobbing from range, inflatable ducks bulldozing straight at it. You are the
defense: a sleek white-and-red sports water pistol rides each hip. Squeeze
your grip near a holster to **draw**, then pull the trigger — SEMI-AUTO,
one fat cricket-ball orb of bubblegum-magenta paint per press, on that very
frame. Paint lands as layered splats on your real floor and as creeping
coverage on the toys; cover one completely and it pops. Every attack is
TELEGRAPHED: a toy rears back, crouches, and SNAPS at the tower — the hit
lands exactly at the snap, and popping it mid-windup cancels the attack.
The balls fly Blaston-slow — quick enough that you'd have to dodge one —
because that's the shared projectile language of enemy return fire too.

The hero piece is the **tank**: every pistol has a frosted blow-moulded tank
on top and you can SEE the paint sloshing inside — a Half-Life: Alyx-style liquid whose
surface stays level as you tilt the gun, surges when you swing it, ripples
when you jolt it. That liquid **is** the ammo, one unified system: fire and
the level visibly drains; run dry and you get a sad dribble and plastic
clicks. **There is no refill** — a tank is a magazine, and **throwing the
spent gun away is the reload**, because a fresh full one respawns on your
hip. The tower reads the same way: enemy hits soak it in THEIR violet
paint, so the purpler it gets, the closer you are to losing. No gauge, no
HUD — the paint is the UI, on your guns, on the toys, on the tower, on
your visor.

Where FIRE FIGHT (iron-balls-boxing) was metal — gunmetal, hazard amber,
anvil clangs — SPLASH WARS is **plastic aesthetics and beautiful water**:
injection-moulded clearcoat shells, pastel poolside light, and a fully
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
  auto-refill, that throw is your reload.
- **The sloshing tank** — world-space clipped-liquid shader (the Alyx
  trick): spring-damper slosh driven by real hand acceleration, ripple
  energy, meniscus foam, and a **frosted** blow-moulded shell over fully
  opaque paint, so the liquid reads as a solid volume rather than a glass
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
- **Gloss everywhere** — paint is WET: Blinn-Phong glints on the tank
  liquid and on enemy coverage, near-zero-roughness clearcoat on balls and
  orbiter globes, lit low-roughness floor splats that catch the scene's
  lights, and a baked wet highlight in every splat and card splash.
- **A swarm built for thousands** — one InstancedMesh per enemy kind, all
  sharing a single shader; paint coverage is per-instance (noise-masked,
  dripping top-down, with a hot wet glint), so a thousand individually
  half-painted toys still cost six draw calls. A uniform spatial grid keeps
  ball-vs-enemy and blast queries near-constant instead of
  O(balls x enemies).
- **The pool-toy roster** — everything that attacks the tower escaped from
  a pool inflatables crate, each with its own silhouette AND its own way of
  moving: Bobbers bounce in pulses, Squirts dart in zigzags, Slingers
  waddle and sway, Big Ducks plow dead straight. **Bobbers** (striped beach balls, the crowd),
  **Squirts** (water droplets, fast, one-hit pops), **Slingers** (knotted
  water balloons lobbing paint from range), **Big Ducks** (inflatable pool
  ducks, the tanks), **Foamers** (bubble clumps that burst into Squirts),
  and **THE BIG ONE** (a wave-10 crowned colossus duck). Bodies are merged
  primitives with a per-vertex colour-role attribute (body/accent/eyes), so
  the whole roster is six draw calls at any crowd size. They deal real
  damage at the deck rim, with an invulnerability window so a crowd is
  pressure rather than instant death. **Everything comes from the front
  180°** and is held there — nothing spawns or paces around behind you.
- **Health without a HUD** — damage throws paint across your **visor**; it
  thickens as you weaken and washes off as you recover. Same philosophy as
  the ammo: read the paint, not a number.
- **Place the tower to start** — shooting START hands you a pulsing cyan
  ghost of the lifeguard tower that glides across the real floor wherever
  you look; either trigger plants it (a plastic KACHUNK) and wave one rolls
  in. AGAIN after a wipe keeps your spot; MENU takes the tower up for a
  fresh placement.
- **Menus you shoot** — the game has exactly one interaction verb. The
  title screen is a HOW TO PLAY plate over a big START card: draw and shoot
  it to begin. Losing brings a WIPED OUT / TOWER SOAKED plate (wave / pops
  / score) with AGAIN and MENU cards. Between waves, three upgrade cards swing up and you
  **hose the one you want** — about three balls, well under a second. Heavy
  Paint (damage), Orbiters (vampire-survivors globes that grind anything
  they touch), Buoyancy (max health + full heal), Paint Bomb (thrown
  pistols detonate), Splash (balls burst with AOE) — all stacking. All of
  it is one shared shoot-to-pick CardBoard primitive (ui/cardBoard.ts).
- **Synth SFX** — squirt loops, splats, glugs, empty clicks, enemy lobs,
  paint-bomb whumps, wave horns, upgrade chimes.

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
  pierce, chain splash, and weapon-specific branches.
- **Squeegee your visor** — wipe the paint off your view with a hand swipe
  instead of waiting for regen.
- **Deck-hop locomotion** (the Eye of the Temple trick, XR-safe): at set
  moments, spare decks appear to your left and right across the void. Walk
  to that edge of YOUR deck — a real, physical walk — and the whole platform
  lifts and carries you over, setting you down on the far deck. You moved
  through the space, but you never left your platform and never touched a
  thumbstick. On the back burner until the combat sandbox is dialled.
- **Boss battles** with FIRE FIGHT-style mechanics every 10th wave.
- **Plastic + water everywhere**: caustic light dapple on the deck, drips
  running off the rim, paint that drips down enemies in world space.

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
  systems/                WeaponSystem (draw/fire/drain/throw/slosh),
                          PaintSystem (ball flight, hits, splash, splats),
                          EnemySystem (waves, AI, threat, deaths, blasts),
                          UpgradeSystem (between-wave offers),
                          MenuSystem (title + game-over boards),
                          PlayerSystem (health, visor, orbiters, death)
  weapons/waterPistol.ts  the procedural pistol build (primitives only)
  materials/              plastic PBR helpers + the clipped-liquid shader
  enemies/geometry.ts     the pool-toy bodies (merged primitives + roles)
  enemies/swarm.ts        per-kind instanced swarm + spatial grid + shader
  fx/paint.ts             instanced ball/splat/droplet pools
  fx/damageNumbers.ts     instanced digit-atlas hit markers
  combat/paintBus.ts      weapon -> paint-sim -> swarm event queues
  audio/sfx.ts            synthesised squirts, plops, glugs
  input/haptics.ts        session-live controller rumble (from FIRE FIGHT)
```

**Nothing high-frequency is an ECS entity.** Paint balls, enemies and damage
digits all live in typed-array slots rendered through instanced meshes — at
swarm scale, per-entity Groups and materials would sink the frame budget.
Only the two pistols are entities. Enemy state has exactly one writer
(`EnemySystem`); everything else — splash, paint bombs, orbiters — requests
damage over the paint bus.

In dev (`npm run dev`) the game exposes `window.SPLASH` — `stats()`,
`digits()`, `hitFirstEnemy()`, `popAt()` — for debugging and for the headless
smoke tests. It is compiled out of production builds.
