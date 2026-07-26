/**
 * The player's pool-deck platform — SPLASH WARS' answer to FIRE FIGHT's
 * gunmetal pedestal, in poolside plastic: a glossy white slab sunk so its top
 * face sits at floor level (your real floor IS the deck), a chunky aqua
 * rim tube like a paddling-pool edge, and a thin paint-magenta glow line
 * marking the rim. Static set-dressing parented under `world.scene`;
 * dynamic, interactive things become ECS entities.
 */

import {
  CylinderGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
  TorusGeometry,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import { PALETTE, PLATFORM } from '../config.js';
import { glossyPlastic, mattePlastic } from '../materials/plastic.js';
import { createTitleBanner } from './banner.js';

export function buildPlatform(world: World): Object3D {
  const scene = world.scene;
  const deck = new Group();
  deck.name = 'pool-deck';

  // The slab: top face at y=0 (the real floor), body just below it.
  const slab = new Mesh(
    new CylinderGeometry(PLATFORM.radius, PLATFORM.radius * 0.92, PLATFORM.thickness, 48),
    glossyPlastic(PALETTE.deckWhite, 0.35),
  );
  slab.position.y = -PLATFORM.thickness / 2;
  deck.add(slab);

  // A matte underside skirt so the slab reads thick, not hollow.
  const skirt = new Mesh(
    new CylinderGeometry(PLATFORM.radius * 0.92, PLATFORM.radius * 0.82, PLATFORM.thickness * 0.8, 48),
    mattePlastic(PALETTE.water),
  );
  skirt.position.y = -PLATFORM.thickness * 1.35;
  deck.add(skirt);

  // The inflatable-looking rim tube hugging the edge at floor level.
  const rim = new Mesh(
    new TorusGeometry(PLATFORM.radius, PLATFORM.rimRadius, 18, 64),
    glossyPlastic(PALETTE.deckAqua, 0.22),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0;
  deck.add(rim);

  // Paint-magenta glow ring just inside the tube — your colour, your deck.
  const ring = new Mesh(
    new RingGeometry(PLATFORM.radius - 0.075, PLATFORM.radius - 0.055, 64),
    new MeshBasicMaterial({ color: PALETTE.paint, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = PLATFORM.rimLift;
  deck.add(ring);

  // "SPLASH WARS" signage floating out where wave one will come from.
  createTitleBanner(scene);

  // --- Lighting: bright poolside key + soft sky fill so plastic gleams ---
  deck.add(new HemisphereLight(0xeaf7ff, 0xfff2d8, 1.25));
  const sun = new PointLight(0xfff3dc, 9, 18);
  sun.position.set(2.5, 4.2, -2.0);
  deck.add(sun);
  const bounce = new PointLight(PALETTE.water, 3, 10);
  bounce.position.set(-2.0, 1.2, 2.5);
  deck.add(bounce);

  scene.add(deck);
  return deck;
}
