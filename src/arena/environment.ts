/**
 * The look foundation for passthrough SPLASH WARS.
 *
 * In an immersive-AR session the player's real room IS the backdrop, so no
 * sky dome and no big floor — just tone mapping and a soft poolside
 * image-based light: bright aqua sky above, warm sun-on-white-plastic bounce
 * below, so every glossy shell picks up gentle beautiful-water tints. If the
 * device can't do AR, IWSDK falls back to VR and we clear to a soft sky blue.
 */

import { Color, IBLGradient, type World } from '@iwsdk/core';
import { PALETTE } from '../config.js';

/** hex → [r,g,b,a] in 0..1 for Types.Color component fields. */
function rgba(hex: number, a = 1): [number, number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b, a];
}

export function setupEnvironment(world: World): void {
  world.renderer.toneMappingExposure = 1.0;

  // Transparent backdrop so the AR passthrough feed shows through.
  world.scene.background = null;
  world.renderer.setClearColor(new Color(PALETTE.sky), 0);

  // Aqua sky, white-plastic equator, sunny bounce off the deck.
  const env = world.createTransformEntity(undefined, { persistent: true });
  env.addComponent(IBLGradient, {
    sky: rgba(0xbfe9f5),
    equator: rgba(0xffffff),
    ground: rgba(0xffe9c4),
    intensity: 1.15,
  });
}
