/**
 * The "SPLASH WARS" title sign — up on the TITLE screen only. The moment a
 * run starts it vanishes (MenuSystem drives visibility): a menu floating
 * over the fight read as clutter, and you never want set-dressing between
 * you and an incoming wave.
 *
 * Drawn at 2× with real lettering work: chunky caps with a hard offset
 * shadow, wet gradient fills, thin rim highlights, and juice drips with
 * catchlights — poster, not default-font-with-glow. Pure canvas, no assets.
 */

import { Mesh, MeshBasicMaterial, PlaneGeometry, type Scene } from 'three';
import { crispTexture, logicalCanvas } from '../ui/crispCanvas.js';

const W = 1024;
const H = 512;

let banner: Mesh | undefined;

/** MenuSystem calls this every frame: title screen only. */
export function setTitleBannerVisible(v: boolean): void {
  if (banner) banner.visible = v;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A word in the game's poster style: offset shadow, gradient, rim light. */
function posterWord(
  ctx: CanvasRenderingContext2D,
  word: string,
  y: number,
  top: string,
  bottom: string,
  shadow: string,
): void {
  ctx.font = '900 168px system-ui, -apple-system, sans-serif';
  // Hard offset shadow first — it reads as thickness, not blur.
  ctx.fillStyle = shadow;
  ctx.fillText(word, W / 2 + 7, y + 9);
  // The wet gradient body.
  const grad = ctx.createLinearGradient(0, y - 80, 0, y + 80);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillText(word, W / 2, y);
  // A thin bright rim so the letters catch the light like the pistols do.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeText(word, W / 2, y);
}

export function createTitleBanner(scene: Scene): Mesh {
  const canvas = document.createElement('canvas');
  const ctx = logicalCanvas(canvas, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Frosted plate: white falling to the palest aqua, with the sport rim.
  const plate = ctx.createLinearGradient(0, 0, 0, H);
  plate.addColorStop(0, 'rgba(252,254,255,0.94)');
  plate.addColorStop(1, 'rgba(228,246,250,0.94)');
  roundedRect(ctx, 16, 16, W - 32, H - 32, 64);
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#8fdfe8';
  ctx.stroke();
  // Inner top highlight line — moulded plastic, not flat paper.
  roundedRect(ctx, 34, 34, W - 68, 60, 40);
  const gloss = ctx.createLinearGradient(0, 34, 0, 94);
  gloss.addColorStop(0, 'rgba(255,255,255,0.8)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fill();

  posterWord(ctx, 'SPLASH', 160, '#ff8fd0', '#e2158b', '#8f0a56');

  // Juice drips off the top word, each with a catchlight on its head.
  for (const [dx, len, r] of [[-218, 58, 12], [-88, 96, 15], [42, 46, 10], [175, 78, 13]] as const) {
    const x = W / 2 + dx;
    ctx.fillStyle = '#e2158b';
    roundedRect(ctx, x - r * 0.45, 226, r * 0.9, len, r * 0.45);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, 226 + len, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(x - r * 0.18, 226 + len - r * 0.2, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  posterWord(ctx, 'WARS', 350, '#b8f1fd', '#159fb5', '#0a5866');

  ctx.fillStyle = '#4d6b76';
  ctx.font = '800 34px system-ui, sans-serif';
  ctx.fillText('DEFEND THE JUICE TOWER', W / 2, 458);

  banner = new Mesh(
    new PlaneGeometry(2.4, 1.2),
    new MeshBasicMaterial({ map: crispTexture(canvas), transparent: true }),
  );
  banner.name = 'title-banner';
  // Crowning the title column: just above the HOW TO PLAY plate at the
  // same UI distance. (It used to float at z -4.5, where the plate hid it
  // almost entirely from where you actually stand.)
  banner.position.set(0, 2.78, -2.5);
  banner.scale.setScalar(0.75);
  scene.add(banner);
  return banner;
}
