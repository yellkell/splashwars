/**
 * The stage — lighting and signage only. There is no platform any more:
 * the game is played wherever you PLACE THE TOWER in your real room
 * (see systems/TowerSystem.ts), so the floor is your floor, and juice
 * lands straight on it as splat decals.
 *
 * What's left here is the look: bright poolside key light, soft sky fill
 * and an aqua bounce. Static set-dressing parented under `world.scene`.
 */

import { Group, HemisphereLight, PointLight, type Object3D } from 'three';
import type { World } from '@iwsdk/core';
import { PALETTE } from '../config.js';

export function buildStage(world: World): Object3D {
  const scene = world.scene;
  const stage = new Group();
  stage.name = 'stage';

  // --- Lighting: bright poolside key + soft sky fill so plastic gleams ---
  stage.add(new HemisphereLight(0xeaf7ff, 0xfff2d8, 1.25));
  const sun = new PointLight(0xfff3dc, 9, 18);
  sun.position.set(2.5, 4.2, -2.0);
  stage.add(sun);
  const bounce = new PointLight(PALETTE.water, 3, 10);
  bounce.position.set(-2.0, 1.2, 2.5);
  stage.add(bounce);

  scene.add(stage);
  return stage;
}
