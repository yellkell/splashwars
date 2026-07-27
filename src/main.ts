/**
 * SPLASH WARS — entry point.
 *
 * Boots an IWSDK World with a WebXR **passthrough** (immersive-AR) session:
 * the pool-deck platform and the incoming toy waves float in your real room.
 * If the device can't do AR, IWSDK falls back to VR.
 *
 * Run `npm run dev` and open the page: on a headset you'll get an "Enter AR"
 * offer; on desktop the IWSDK dev plugin provides a WebXR emulator
 * (WASD + mouse).
 */

import { SessionMode, World } from '@iwsdk/core';
import { setupEnvironment } from './arena/environment.js';
import { buildStage } from './arena/platform.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { JuiceSystem } from './systems/JuiceSystem.js';
import { EnemySystem } from './systems/EnemySystem.js';
import { UpgradeSystem } from './systems/UpgradeSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { TowerSystem } from './systems/TowerSystem.js';
import { TurretSystem } from './systems/TurretSystem.js';
import { run } from './game/run.js';
import { app } from './game/appState.js';
import { tower as towerState } from './game/tower.js';
import { addDrops as debugAddDrops, bank, boost as boostState, placedTurrets } from './game/shop.js';
import { WaterPistol } from './components/WaterPistol.js';
import { debugLiveDigits, debugNumbersInstance, popDamage } from './fx/damageNumbers.js';
import { Vector3 as DebugVec3 } from 'three';

const container = document.getElementById('scene-container') as HTMLDivElement;

World.create(container, {
  // Offer an immersive-AR (passthrough) session as soon as the page is
  // interacted with — SPLASH WARS plays in your real room.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'always',
  },
  // A stationary wave shooter: no locomotion yet (the deck-hop movement idea
  // comes later — the platform will move with you on it), no grab system
  // (the pistols live on your hips and hand off between grip/hand via
  // WeaponSystem's own draw/throw logic, not the generic grab system).
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // We light the scene ourselves (see setupEnvironment) and let passthrough
    // provide the backdrop, so the default sky is off.
    defaultLighting: false,
    camera: { position: [0, 1.6, 0] },
  },
}).then((world) => {
  setupEnvironment(world);
  buildStage(world);

  // Order matters: the swarm must exist before anything queries it, pistols
  // feed the juice bus before the sim drains it, and the juice sim applies
  // hits before the wave director resolves deaths and area damage.
  world.registerSystem(EnemySystem);
  world.registerSystem(UpgradeSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(TowerSystem);
  world.registerSystem(TurretSystem);
  world.registerSystem(WeaponSystem);
  world.registerSystem(JuiceSystem);
  world.registerSystem(PlayerSystem);

  // Dev-only inspection hook: lets the browser console (and the headless
  // smoke tests) read live game state — wave, health, swarm size, upgrade
  // stacks — without hunting through the scene graph. Stripped from builds.
  if (import.meta.env.DEV) {
    (window as unknown as { SPLASH: unknown }).SPLASH = {
      world,
      run,
      frames: 0,
      /** Damage the first live enemy — exercises the hit/number pipeline. */
      hitFirstEnemy(amount = 40) {
        const es = world.getSystem(EnemySystem);
        if (!es) return -1;
        for (let i = 0; i < es.swarm.px.length; i++) {
          if (es.swarm.alive[i]) {
            es.hit(i, amount);
            return i;
          }
        }
        return -1;
      },
      digits: () => debugLiveDigits(),
      startGame: () => world.getSystem(MenuSystem)?.startRun(),
      placeTower: (x = 0, z = -1.5) =>
        world.getSystem(TowerSystem)?.place(new DebugVec3(x, 0, z)),
      towerState: () => ({
        placed: towerState.placed,
        health: Math.round(towerState.health),
        soaked: +towerState.soaked.toFixed(3),
        pos: [+towerState.pos.x.toFixed(2), +towerState.pos.z.toFixed(2)],
      }),
      appPhase: () => app.phase,
      drops: () => ({ drops: bank.drops, shown: Math.round(bank.shown), turrets: placedTurrets.map((t) => t.kind) }),
      addDrops: (n = 500) => debugAddDrops(n),
      buyItem: (id = 'overdrive') => world.getSystem(TurretSystem)?.purchase(id),
      boost: () => ({ ...boostState }),
      buyTurret: (kind = 'sprinkler', x = 0.8, z = -1.2) =>
        world.getSystem(TurretSystem)?.placeTurret(kind as never, new DebugVec3(x, 0, z)),
      pistols: () => {
        const ws = world.getSystem(WeaponSystem);
        if (!ws) return [];
        return [...ws.queries.pistols.entities].map((ent) => ({
          hand: ent.getValue(WaterPistol, 'hand'),
          state: ent.getValue(WaterPistol, 'state'),
          ammo: +(ent.getValue(WaterPistol, 'ammo') ?? 0).toFixed(4),
        }));
      },
      popAt: (x: number, y: number, z: number, n: number, big = false) =>
        popDamage(new DebugVec3(x, y, z), n, big),
      numbers: () => debugNumbersInstance(),
      stats() {
        const enemies = world.getSystem(EnemySystem);
        return {
          frames: (window as unknown as { SPLASH: { frames: number } }).SPLASH.frames,
          wave: run.wave,
          health: Math.round(run.health),
          maxHealth: run.maxHealth,
          dead: run.dead,
          score: run.score,
          kills: run.kills,
          enemies: enemies?.swarm.count ?? -1,
          stacks: run.stacks,
        };
      },
    };
    // Tick a frame counter so a test can tell "frozen" from "quiet".
    const tick = () => {
      (window as unknown as { SPLASH: { frames: number } }).SPLASH.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // eslint-disable-next-line no-console
  console.info('[SPLASH WARS] World ready — tanks full, deck gleaming.');
});
