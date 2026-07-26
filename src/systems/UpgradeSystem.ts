/**
 * The upgrade board — three cards, and you choose by SHOOTING the one you
 * want.
 *
 * No menus, no laser pointers, no thumbstick: between waves three plastic
 * cards swing up in front of you and you hose the one you like. A card fills
 * with paint as you cover it, and once it's past the threshold it's taken.
 * The pick is the same verb as the whole rest of the game.
 *
 * Cards register hits by asking PaintSystem to test blobs against their
 * plane, so a card is hit by exactly the same paint balls that kill enemies.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Group,
} from 'three';
import { EnemySystem, upgradeGate } from './EnemySystem.js';
import { applyUpgrade, offerUpgrades, run, type UpgradeDef } from '../game/run.js';
import { dropletBurst } from '../fx/paint.js';
import * as sfx from '../audio/sfx.js';
import { UPGRADES } from '../config.js';

const CARD_W = 512;
const CARD_H = 668;

interface Card {
  group: Group;
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  def: UpgradeDef;
  /** 0..1 paint coverage — the progress toward picking it. */
  fill: number;
  /** Splats already drawn onto the card face, so paint accumulates. */
  splats: { x: number; y: number; r: number }[];
}

const _hit = new Vector3();
const _local = new Vector3();

export class UpgradeSystem extends createSystem({}) {
  private cards: Card[] = [];
  private board = new Group();
  private active = false;

  init(): void {
    this.board.visible = false;
    this.world.scene.add(this.board);
  }

  /** True while the board is up — PaintSystem routes hits here. */
  get isActive(): boolean {
    return this.active;
  }

  update(delta: number): void {
    if (!this.active && upgradeGate.pending) {
      upgradeGate.pending = false;
      this.show();
    }
    if (!this.active) return;

    // Face the board at the player, gently.
    const cam = this.world.camera;
    cam.getWorldPosition(_hit);
    this.board.lookAt(_hit.x, this.board.position.y, _hit.z);

    for (const card of this.cards) {
      // A picked card flies off; the rest just idle-bob.
      card.group.position.y = Math.sin(performance.now() * 0.002 + card.group.position.x) * 0.012;
    }
    void delta;
  }

  /**
   * Test a paint ball against the cards. Returns true if it hit one (so the
   * paint sim can consume the ball). Called by PaintSystem.
   */
  testHit(pos: Vector3, radius: number): boolean {
    if (!this.active) return false;
    for (const card of this.cards) {
      card.mesh.worldToLocal(_local.copy(pos));
      const halfW = UPGRADES.cardWidth / 2;
      const halfH = UPGRADES.cardHeight / 2;
      if (
        Math.abs(_local.z) <= radius + 0.05 &&
        _local.x >= -halfW - radius &&
        _local.x <= halfW + radius &&
        _local.y >= -halfH - radius &&
        _local.y <= halfH + radius
      ) {
        this.paintCard(card, _local.x / UPGRADES.cardWidth + 0.5, 0.5 - _local.y / UPGRADES.cardHeight);
        dropletBurst(pos, 7, 0.8);
        sfx.hitSplat();
        return true;
      }
    }
    return false;
  }

  // --- Board lifecycle. ----------------------------------------------------

  private show(): void {
    this.clear();
    const offers = offerUpgrades();
    if (offers.length === 0) {
      // Everything maxed — nothing to choose, carry straight on.
      this.finish(null);
      return;
    }

    const step = UPGRADES.cardWidth + UPGRADES.cardGap;
    const startX = -((offers.length - 1) / 2) * step;
    for (let i = 0; i < offers.length; i++) {
      const card = this.buildCard(offers[i]);
      card.group.position.set(startX + i * step, 0, 0);
      this.board.add(card.group);
      this.cards.push(card);
    }

    this.board.position.set(0, UPGRADES.cardHeightY, -UPGRADES.cardDistance);
    this.board.visible = true;
    this.active = true;
    sfx.upgradeAppear();
  }

  private finish(chosen: UpgradeDef | null): void {
    if (chosen) {
      applyUpgrade(chosen.id);
      sfx.upgradePick();
    }
    this.active = false;
    this.board.visible = false;
    this.clear();
    // Hand control back to the wave director.
    const enemies = this.world.getSystem(EnemySystem);
    enemies?.resumeAfterUpgrade();
  }

  private clear(): void {
    for (const card of this.cards) {
      card.tex.dispose();
      (card.mesh.material as MeshBasicMaterial).dispose();
      card.mesh.geometry.dispose();
      this.board.remove(card.group);
    }
    this.cards.length = 0;
  }

  // --- Card rendering. -----------------------------------------------------

  private buildCard(def: UpgradeDef): Card {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    const mesh = new Mesh(
      new PlaneGeometry(UPGRADES.cardWidth, UPGRADES.cardHeight),
      new MeshBasicMaterial({ map: tex, transparent: true }),
    );
    const group = new Group();
    group.add(mesh);
    const card: Card = { group, mesh, canvas, tex, def, fill: 0, splats: [] };
    this.drawCard(card);
    return card;
  }

  private paintCard(card: Card, u: number, v: number): void {
    card.splats.push({
      x: u * CARD_W,
      y: v * CARD_H,
      r: 46 + Math.random() * 34,
    });
    // Coverage estimate: splat area over card area, saturating.
    const area = card.splats.reduce((sum, s) => sum + Math.PI * s.r * s.r, 0);
    card.fill = Math.min(1, area / (CARD_W * CARD_H) / 1.35);
    this.drawCard(card);

    if (card.fill >= UPGRADES.paintToPick) this.finish(card.def);
  }

  private drawCard(card: Card): void {
    const ctx = card.canvas.getContext('2d')!;
    const { def, fill } = card;
    ctx.clearRect(0, 0, CARD_W, CARD_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Frosted plastic card with the upgrade's accent rim.
    ctx.fillStyle = 'rgba(250,252,255,0.93)';
    ctx.beginPath();
    ctx.roundRect(12, 12, CARD_W - 24, CARD_H - 24, 48);
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = def.color;
    ctx.stroke();

    // Accent header band.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(12, 12, CARD_W - 24, 150, 48);
    ctx.clip();
    ctx.fillStyle = def.color;
    ctx.fillRect(12, 12, CARD_W - 24, 150);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 62px system-ui, -apple-system, sans-serif';
    ctx.fillText(def.title, CARD_W / 2, 92);

    // Body copy.
    ctx.fillStyle = '#2b3a44';
    ctx.font = '700 34px system-ui, sans-serif';
    this.wrapText(ctx, def.blurb, CARD_W / 2, 250, CARD_W - 90, 44);

    ctx.fillStyle = def.color;
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.fillText(def.effect(run.stacks[def.id]), CARD_W / 2, 430);

    const stacks = run.stacks[def.id];
    if (stacks > 0) {
      ctx.fillStyle = '#7c8a94';
      ctx.font = '700 30px system-ui, sans-serif';
      ctx.fillText(`owned ×${stacks}`, CARD_W / 2, 486);
    }

    ctx.fillStyle = '#9fb0ba';
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.fillText('SHOOT TO PICK', CARD_W / 2, CARD_H - 62);

    // The paint the player has already put on it.
    ctx.fillStyle = '#f0299b';
    for (const s of card.splats) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      // A couple of satellite droplets per splat so it reads as thrown paint.
      for (let n = 0; n < 3; n++) {
        const a = Math.random() * Math.PI * 2;
        const d = s.r * (1.1 + Math.random() * 0.5);
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, s.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Progress bar along the bottom so the threshold is legible.
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(40, CARD_H - 34, CARD_W - 80, 14);
    ctx.fillStyle = '#f0299b';
    ctx.fillRect(40, CARD_H - 34, (CARD_W - 80) * Math.min(1, fill / UPGRADES.paintToPick), 14);

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
