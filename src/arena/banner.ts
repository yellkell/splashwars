/**
 * The "SPLASH WARS" title sign — a rounded bubbly plastic plate floating out
 * over the water line, dripping juice. Pure canvas texture, no assets.
 */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';

const W = 1024;
const H = 512;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createTitleBanner(scene: Scene): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Frosted white plastic plate with an aqua rim.
  roundedRect(ctx, 16, 16, W - 32, H - 32, 60);
  ctx.fillStyle = 'rgba(250,252,255,0.88)';
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#8fdfe8';
  ctx.stroke();

  // Title: SPLASH in juice magenta with drips, WARS in water aqua.
  const font = '900 150px system-ui, -apple-system, sans-serif';
  ctx.font = font;
  const juice = ctx.createLinearGradient(0, 90, 0, 230);
  juice.addColorStop(0, '#ff7ec9');
  juice.addColorStop(1, '#f0299b');
  ctx.fillStyle = juice;
  ctx.shadowColor = 'rgba(240,41,155,0.55)';
  ctx.shadowBlur = 24;
  ctx.fillText('SPLASH', W / 2, 165);
  ctx.shadowBlur = 0;

  // Juice drips running off the word.
  ctx.fillStyle = '#f0299b';
  for (const [dx, len, r] of [[-215, 66, 13], [-90, 108, 16], [40, 52, 11], [172, 88, 14]] as const) {
    const x = W / 2 + dx;
    ctx.fillRect(x - r * 0.45, 210, r * 0.9, len);
    ctx.beginPath();
    ctx.arc(x, 210 + len, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  const water = ctx.createLinearGradient(0, 270, 0, 400);
  water.addColorStop(0, '#aeeefc');
  water.addColorStop(1, '#1fc4c9');
  ctx.font = font;
  ctx.fillStyle = water;
  ctx.shadowColor = 'rgba(31,196,201,0.55)';
  ctx.shadowBlur = 24;
  ctx.fillText('WARS', W / 2, 345);
  ctx.shadowBlur = 0;

  ctx.font = '700 36px system-ui, sans-serif';
  ctx.fillStyle = '#4d6b76';
  ctx.fillText('hold trigger · hose them down · watch your tank', W / 2, 452);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const banner = new Mesh(
    new PlaneGeometry(2.4, 1.2),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
  banner.name = 'title-banner';
  banner.position.set(0, 2.4, -4.5);
  scene.add(banner);
  return banner;
}
