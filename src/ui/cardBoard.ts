/**
 * CardBoard — the game's ONE menu primitive.
 *
 * A row of frosted plastic cards floating in front of you, and you choose
 * by SHOOTING the one you want: juice accumulates on the card face and once
 * coverage passes the threshold, that card is picked. No laser pointers, no
 * ray-and-click, no wrist menus — the menu speaks the same verb as the rest
 * of the game, which is what makes it feel like a VR-native product rather
 * than a ported settings dialog.
 *
 * Used by UpgradeSystem (the between-wave choices) and MenuSystem (title
 * screen, game over). Every shown board registers itself in `activeBoards`,
 * and JuiceSystem tests live juice balls against every active board — so a
 * menu card is hit by exactly the same projectiles that pop enemies.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Scene,
} from 'three';
import { dropletBurst } from '../fx/juice.js';
import * as sfx from '../audio/sfx.js';
import { UPGRADES } from '../config.js';

const CARD_PX_W = 512;
const CARD_PX_H = 668;

export interface CardSpec {
  id: string;
  title: string;
  blurb?: string;
  /** The big accent line (e.g. "+35% ball damage" or "START"). */
  effectLine?: string;
  /** Small grey line under the effect (e.g. "owned ×2"). */
  footnote?: string;
  color: string;
  /** Card size multiplier — menus use bigger cards than upgrade triples. */
  scale?: number;
}

interface Card {
  group: Group;
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  spec: CardSpec;
  w: number;
  h: number;
  fill: number;
  splats: { x: number; y: number; r: number }[];
}

/** Every board currently on screen — JuiceSystem tests balls against these. */
export const activeBoards = new Set<CardBoard>();

const _local = new Vector3();
const _cam = new Vector3();

export class CardBoard {
  private board = new Group();
  private cards: Card[] = [];
  private onPick: ((id: string) => void) | undefined;
  private time = 0;

  constructor(private scene: Scene) {
    this.board.visible = false;
    this.scene.add(this.board);
  }

  get active(): boolean {
    return this.board.visible;
  }

  show(
    specs: CardSpec[],
    opts: { y?: number; distance?: number; onPick: (id: string) => void },
  ): void {
    this.clear();
    this.onPick = opts.onPick;

    // Lay the row out around centre, respecting per-card scale.
    const widths = specs.map((s) => UPGRADES.cardWidth * (s.scale ?? 1));
    const total = widths.reduce((a, b) => a + b, 0) + UPGRADES.cardGap * (specs.length - 1);
    let x = -total / 2;
    for (let i = 0; i < specs.length; i++) {
      const card = this.buildCard(specs[i]);
      card.group.position.set(x + widths[i] / 2, 0, 0);
      x += widths[i] + UPGRADES.cardGap;
      this.board.add(card.group);
      this.cards.push(card);
    }

    this.board.position.set(0, opts.y ?? UPGRADES.cardHeightY, -(opts.distance ?? UPGRADES.cardDistance));
    this.board.visible = true;
    activeBoards.add(this);
    sfx.upgradeAppear();
  }

  hide(): void {
    this.board.visible = false;
    activeBoards.delete(this);
    this.clear();
  }

  /** Face the player and idle-bob. Call once per frame. */
  update(dt: number, camWorldPos: Vector3): void {
    if (!this.board.visible) return;
    this.time += dt;
    _cam.copy(camWorldPos);
    this.board.lookAt(_cam.x, this.board.position.y, _cam.z);
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].group.position.y = Math.sin(this.time * 1.7 + i * 1.3) * 0.012;
    }
  }

  /** Test a juice ball; true consumes the ball (it splatted on a card). */
  testHit(pos: Vector3, radius: number): boolean {
    if (!this.board.visible) return false;
    for (const card of this.cards) {
      card.mesh.worldToLocal(_local.copy(pos));
      const halfW = card.w / 2;
      const halfH = card.h / 2;
      if (
        Math.abs(_local.z) <= radius + 0.05 &&
        _local.x >= -halfW - radius &&
        _local.x <= halfW + radius &&
        _local.y >= -halfH - radius &&
        _local.y <= halfH + radius
      ) {
        this.juiceCard(card, _local.x / card.w + 0.5, 0.5 - _local.y / card.h);
        dropletBurst(pos, 7, 0.8);
        sfx.hitSplat();
        return true;
      }
    }
    return false;
  }

  // --- Internals. ----------------------------------------------------------

  private clear(): void {
    for (const card of this.cards) {
      card.tex.dispose();
      (card.mesh.material as MeshBasicMaterial).dispose();
      card.mesh.geometry.dispose();
      this.board.remove(card.group);
    }
    this.cards.length = 0;
  }

  private buildCard(spec: CardSpec): Card {
    const scale = spec.scale ?? 1;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_PX_W;
    canvas.height = CARD_PX_H;
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    const w = UPGRADES.cardWidth * scale;
    const h = UPGRADES.cardHeight * scale;
    const mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: tex, transparent: true }),
    );
    const group = new Group();
    group.add(mesh);
    const card: Card = { group, mesh, canvas, tex, spec, w, h, fill: 0, splats: [] };
    this.drawCard(card);
    return card;
  }

  private juiceCard(card: Card, u: number, v: number): void {
    // Fat splats: a card falls to ~3 balls — picking is a beat, not a chore.
    card.splats.push({
      x: u * CARD_PX_W,
      y: v * CARD_PX_H,
      r: 70 + Math.random() * 50,
    });
    const area = card.splats.reduce((sum, s) => sum + Math.PI * s.r * s.r, 0);
    card.fill = Math.min(1, area / (CARD_PX_W * CARD_PX_H) / 1.35);
    this.drawCard(card);

    if (card.fill >= UPGRADES.juiceToPick) {
      const id = card.spec.id;
      const pick = this.onPick;
      this.hide();
      sfx.upgradePick();
      pick?.(id);
    }
  }

  private drawCard(card: Card): void {
    const ctx = card.canvas.getContext('2d')!;
    const { spec, fill } = card;
    const W = CARD_PX_W;
    const H = CARD_PX_H;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Frosted plastic card with the accent rim.
    ctx.fillStyle = 'rgba(250,252,255,0.93)';
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 24, 48);
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = spec.color;
    ctx.stroke();

    // Accent header band.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, 150, 48);
    ctx.clip();
    ctx.fillStyle = spec.color;
    ctx.fillRect(12, 12, W - 24, 150);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 62px system-ui, -apple-system, sans-serif';
    ctx.fillText(spec.title, W / 2, 92);

    if (spec.blurb) {
      ctx.fillStyle = '#2b3a44';
      ctx.font = '700 34px system-ui, sans-serif';
      this.wrapText(ctx, spec.blurb, W / 2, 250, W - 90, 44);
    }

    if (spec.effectLine) {
      ctx.fillStyle = spec.color;
      ctx.font = '900 44px system-ui, sans-serif';
      ctx.fillText(spec.effectLine, W / 2, 430);
    }

    if (spec.footnote) {
      ctx.fillStyle = '#7c8a94';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.fillText(spec.footnote, W / 2, 486);
    }

    ctx.fillStyle = '#9fb0ba';
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText('SHOOT TO PICK', W / 2, H - 62);

    // The juice the player has already landed, with a wet highlight per splat.
    for (const s of card.splats) {
      ctx.fillStyle = '#f0299b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      for (let n = 0; n < 3; n++) {
        const a = Math.random() * Math.PI * 2;
        const d = s.r * (1.1 + Math.random() * 0.5);
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.ellipse(s.x - s.r * 0.3, s.y - s.r * 0.35, s.r * 0.34, s.r * 0.2, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Progress bar along the bottom so the threshold is legible.
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(40, H - 34, W - 80, 14);
    ctx.fillStyle = '#f0299b';
    ctx.fillRect(40, H - 34, (W - 80) * Math.min(1, fill / UPGRADES.juiceToPick), 14);

    card.tex.needsUpdate = true;
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): void {
    const words = text.split(' ');
    let line = '';
    let cy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = word;
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cy);
  }
}
