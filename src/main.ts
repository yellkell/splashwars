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
import { buildPlatform } from './arena/platform.js';
import { WeaponSystem } from './systems/WeaponSystem.js';
import { PaintSystem } from './systems/PaintSystem.js';
import { EnemySystem } from './systems/EnemySystem.js';

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
  buildPlatform(world);

  // Pistols first so the paint bus is fed before the sim drains it, then the
  // paint sim (blobs, splats, hits), then the waves (spawns, pops, the sign).
  world.registerSystem(WeaponSystem);
  world.registerSystem(PaintSystem);
  world.registerSystem(EnemySystem);

  // eslint-disable-next-line no-console
  console.info('[SPLASH WARS] World ready — tanks full, deck gleaming.');
});
