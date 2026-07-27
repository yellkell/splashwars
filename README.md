# SPLASH WARS 🔫💦

Tower-defense JUICE fighting in WebXR passthrough. A ghost JUICE TOWER
follows your gaze across your real floor — pull the trigger and it PLANTS,
and every wave of THE THIRST comes for it: parched, faceted husk-creatures
with glowing eyes, crawled out of somewhere waterless to drain your
reservoir. Husks tumble in surges, Skitters dart in zigzags, Spitters lob
from range, Clods bulldoze dead straight. You are the defense: a sleek
white-and-red sports pistol rides each hip. Squeeze your grip near a
holster to **draw**, then pull the trigger — SEMI-AUTO, one fat orb of
vivid magenta juice per press, on that very frame. Juice lands as layered
splats on your real floor and as glossy creeping coverage on the husks'
dry crust — the dry-vs-wet contrast is the game's whole visual language —
and a fully juiced husk bursts. Every attack is TELEGRAPHED: a husk rears
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
anvil clangs — SPLASH WARS is **glossy plastic and beautiful liquid against
dry, cracked husks**: injection-moulded clearcoat shells, pastel poolside
light, and a fully synthesised soundscape of squirts, plops, glugs and toy
clicks (no audio assets — everything is WebAudio at runtime).

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
  lights, and a baked wet highlight in every splat and card splash.
- **A swarm built for thousands** — one InstancedMesh per enemy kind, all
  sharing a single shader; juice coverage is per-instance (noise-masked,
  dripping top-down, with a hot wet glint), so a thousand individually
  half-juiced husks still cost six draw calls. A uniform spatial grid keeps
  ball-vs-enemy and blast queries near-constant instead of
  O(balls x enemies).
- **THE THIRST** — the enemy roster: dry, matte, faceted husk-creatures
  (non-indexed low-poly solids, per-face normals) whose glowing eyes are
  the only bright thing on them until your juice hits. **Husks** (crystal
  boulders, the crowd), **Skitters** (spiked shards, fast, one-hit pops),
  **Spitters** (leaning obelisks that lob from range — deliberately scarce
  and soft, capped at ~a fifth of any squad), **Clods** (rubble golems,
  the tanks), **Clusters** (shard aggregates that burst into Skitters),
  and **THE DROUGHT** (a wave-10 crowned monolith). Merged primitives with
  a colour-role attribute (body/crust/glow/maw), one InstancedMesh per
  kind — six draw calls at any crowd size — with per-kind movement
  personalities and telegraphed rear-back-and-snap attacks. **Everything
  comes from the front 180°** and is held there.
- **Health without a HUD** — damage throws juice across your **visor**; it
  thickens as you weaken and washes off as you recover. Same philosophy as
  the ammo: read the juice, not a number.
- **Place the tower to start** — shooting START hands you a pulsing cyan
  ghost of the juice tower that glides across the real floor wherever you
  look; either trigger plants it (a plastic KACHUNK) and wave one rolls in.
  The reservoir shows its LIVE juice level through frosted plastic (the
  same clipped-liquid shader as the pistol tanks), and strikes jolt the
  surface. AGAIN after a wipe keeps your spot; MENU lifts the tower for a
  fresh placement.
- **Menus you shoot** — the game has exactly one interaction verb. The
  title screen is a HOW TO PLAY plate over a big START card: draw and shoot
  it to begin. Losing brings a WIPED OUT / TOWER DRAINED plate (wave / pops
  / score) with AGAIN and MENU cards. Between waves, three upgrade cards swing up and you
  **hose the one you want** — about three balls, well under a second. Heavy
  Juice (damage), Orbiters (vampire-survivors globes that grind anything
  they touch), Buoyancy (max health + full heal), Juice Bomb (thrown
  pistols detonate), Burst (balls burst with AOE) — all stacking. All of
  it is one shared shoot-to-pick CardBoard primitive (ui/cardBoard.ts).
- **Synth SFX** — squirt loops, splats, glugs, empty clicks, enemy lobs,
  juice-bomb whumps, wave horns, upgrade chimes.

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
  systems/                WeaponSystem (draw/fire/drain/throw/slosh),
                          JuiceSystem (ball flight, hits, splash, splats),
                          EnemySystem (waves, AI, threat, deaths, blasts),
                          UpgradeSystem (between-wave offers),
                          MenuSystem (title + game-over boards),
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
(`EnemySystem`); everything else — splash, juice bombs, orbiters — requests
damage over the juice bus.

In dev (`npm run dev`) the game exposes `window.SPLASH` — `stats()`,
`digits()`, `hitFirstEnemy()`, `popAt()` — for debugging and for the headless
smoke tests. It is compiled out of production builds.
