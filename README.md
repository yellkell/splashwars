# SPLASH WARS 🔫💦

Wave-survival paint fighting in WebXR passthrough. A plastic water pistol in
each hand, a pool-deck platform under your feet, and squads of glossy toy
enemies bobbing in across your real room. **Hold the trigger** (it's analog —
a light squeeze lobs lazily, a full pull volleys) and fat tennis-ball orbs
of bubblegum-magenta paint arc out and land with a wet plop — on the floor
as layered splats, on the enemies as creeping coverage. Paint a toy
completely and it pops in a shower of droplets. The balls fly Blaston-slow —
much slower than real projectiles, but quick enough that you'd have to dodge
one — because that's the game's shared projectile language for when enemies
and bosses start shooting back.

The hero piece is the **tank**: every pistol has a clear blow-moulded tank on
top and you can SEE the paint inside — a Half-Life: Alyx-style liquid whose
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

- **Dual plastic water pistols** — procedural super-soaker-style toys
  (mirrored teal/orange liveries), squeezable trigger on a pivot, muzzle
  spread, hand-velocity inheritance on the stream, haptic ticks per squirt.
- **The sloshing tank** — world-space clipped-liquid shader (the Alyx
  trick): spring–damper slosh sim driven by real hand acceleration, ripple
  energy, meniscus foam line, bright cut-surface fake for the liquid top,
  fill level = ammo. Refilling churns the surface.
- **Thick paint** — instanced tennis-ball paint orbs, slightly stretched
  along velocity so they wobble like water balloons; opaque droplet bursts
  (normal blending — paint isn't fire); a ring buffer of blobby splat
  decals stamped on the floor.
- **Toy enemies** — glossy plastic blobs with cartoon eyes that bob in on a
  spawn ring and tread water at a standoff ring. A noise-masked paint shell
  covers them top-down, drip-style, as you land hits; full coverage pops
  them. They visibly wallow lower as the paint weighs them down.
- **Waves 1–10** — vampire-survivors pacing: each wave a bigger, faster
  squad, breathers between, a floating plastic wave sign announcing each.
  **Wave 10 is the boss**: one huge toy that soaks a whole tank of paint.
- **Synth SFX** — squirt loops (one per hand, detuned), splats, plops,
  glugs, empty clicks, pop corks, wave horns.

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

- **Vampire-survivors loop**: waves keep escalating; between waves you pick
  an upgrade — tank capacity, refill speed, spread, blob weight, new
  weapons. The water pistol is weapon one of a family (pump shotgun that
  needs real pump-action, pressure sprayer you charge up, balloon lobber…)
  all sharing the unified visible-liquid ammo system.
- **Enemies that fight back** + player paint-health (you get painted, you
  squeegee off by shaking your controllers?).
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
  main.ts                 World boot + system registration
  arena/                  static set-dressing: deck, lighting, title banner
  components/             ECS data: WaterPistol, Enemy
  systems/                WeaponSystem (fire/drain/refill/slosh),
                          PaintSystem (blob flight, hits, splats),
                          EnemySystem (waves, bobbing, pops, the sign)
  weapons/waterPistol.ts  the procedural pistol build (primitives only)
  materials/              plastic PBR helpers + the clipped-liquid shader
  enemies/toy.ts          the toy build + noise-masked paint-coverage shell
  fx/paint.ts             instanced blob/splat/droplet pools
  combat/paintBus.ts      weapon → paint-sim spawn queue
  audio/sfx.ts            synthesised squirts, plops, glugs
  input/haptics.ts        session-live controller rumble (from FIRE FIGHT)
```

Paint balls deliberately are **not** ECS entities — dual-wielded volleys
would churn the world; they live in typed-array slots rendered through one
InstancedMesh. Enemies and pistols are entities, queried by the systems
above.
