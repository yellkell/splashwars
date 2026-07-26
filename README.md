# SPLASH WARS 🔫💦

Wave-survival paint fighting in WebXR passthrough. A sleek white-and-red
sports water pistol riding each hip, a pool-deck platform under your feet,
and squads of glossy toy enemies bobbing in across your real room. Squeeze
your grip near a holster to **draw**, then **hold the trigger** (it's analog —
a light squeeze lobs lazily, a full pull volleys) and fat cricket-ball orbs
of bubblegum-magenta paint arc out and land with a wet plop — on the floor
as layered splats, on the enemies as creeping coverage. Paint a toy
completely and it pops in a shower of droplets. The balls fly Blaston-slow —
much slower than real projectiles, but quick enough that you'd have to dodge
one — because that's the game's shared projectile language for when enemies
and bosses start shooting back.

The hero piece is the **tank**: every pistol has a frosted blow-moulded tank
on top and you can SEE the paint sloshing inside — a Half-Life: Alyx-style liquid whose
surface stays level as you tilt the gun, surges when you swing it, ripples
when you jolt it. That liquid **is** the ammo, one unified system: fire and
the level visibly drains; run dry and you get a sad dribble and plastic
clicks; ease off for a beat and the tank glugs itself full again. No gauge,
no HUD — the water is the UI.

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
  whatever it hits, and a fresh one respawns on your hip.
- **The sloshing tank** — world-space clipped-liquid shader (the Alyx
  trick): spring-damper slosh driven by real hand acceleration, ripple
  energy, meniscus foam, and a **frosted** blow-moulded shell over fully
  opaque paint, so the liquid reads as a solid volume rather than a glass
  box. Fill level = ammo; a held trigger drains the tank in ~2.6 s.
- **Fat, slow paint balls** — cricket-ball-sized orbs at 4.5/s, lobbed at
  Blaston speeds: slow enough to watch fly, fast enough to have to dodge.
  Enemy return fire speaks the same visual language.
- **Damage numbers** — white digits with thick black outlines popping off
  every hit (bigger and gold for blasts), drawn from one instanced digit
  atlas so hundreds of hit markers cost a single draw call.
- **A swarm built for thousands** — every enemy is one instance of a single
  InstancedMesh. Eyes and paint coverage are drawn *procedurally in the
  fragment shader* per instance, so a thousand individually half-painted
  toys still cost one draw call and no extra geometry. A uniform spatial
  grid keeps ball-vs-enemy and blast queries near-constant instead of
  O(balls x enemies).
- **Six enemy types** — Drifters (slow crowd), Scurriers (fast swarm),
  Lobbers (throw paint from range), Brutes (big and tanky), Splitters
  (burst into Scurriers), and the wave-10 Boss. They deal real damage at
  the deck rim, with an invulnerability window so a crowd is pressure
  rather than instant death.
- **Health without a HUD** — damage throws paint across your **visor**; it
  thickens as you weaken and washes off as you recover. Same philosophy as
  the ammo: read the paint, not a number.
- **Upgrades you pick by shooting** — between every wave three plastic
  cards swing up and you **hose the one you want** (no menus, no laser
  pointers). Heavy Paint (damage), Orbiters (vampire-survivors globes that
  grind anything they touch), Buoyancy (max health + full heal), Paint Bomb
  (thrown pistols detonate), Splash (balls burst with AOE) — all stacking.
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
- **More upgrades**: tank capacity, refill speed, fire rate, pierce, chain
  splash, and weapon-specific branches.
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
  systems/                WeaponSystem (draw/fire/drain/throw/slosh),
                          PaintSystem (ball flight, hits, splash, splats),
                          EnemySystem (waves, AI, threat, deaths, blasts),
                          UpgradeSystem (the shoot-to-pick card board),
                          PlayerSystem (health, visor, orbiters, death)
  weapons/waterPistol.ts  the procedural pistol build (primitives only)
  materials/              plastic PBR helpers + the clipped-liquid shader
  enemies/swarm.ts        the instanced swarm + spatial grid + eye shader
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
