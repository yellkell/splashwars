/**
 * Shared canvas-texture quality settings for every piece of drawn UI.
 *
 * Three fixes that together are the difference between "printed decal" and
 * "blurry webpage screenshot":
 *  - draw at 2× the logical resolution (UI_DPR) so strokes stay sharp;
 *  - tag the texture sRGB so the authored colours arrive un-washed
 *    (untagged canvases get re-encoded and everything goes pale);
 *  - keep mipmaps + anisotropy so text viewed at an angle stays crisp
 *    instead of shimmering (the old LinearFilter override disabled them).
 */

import { CanvasTexture, SRGBColorSpace } from 'three';

/** Device-pixel multiplier for UI canvases: author in logical px, render 2×. */
export const UI_DPR = 2;

/** Size a canvas at UI_DPR and return a ctx pre-scaled to logical pixels. */
export function logicalCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
): CanvasRenderingContext2D {
  canvas.width = w * UI_DPR;
  canvas.height = h * UI_DPR;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(UI_DPR, 0, 0, UI_DPR, 0, 0);
  return ctx;
}

/** A CanvasTexture with the game's quality settings applied. */
export function crispTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
