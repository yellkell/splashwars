/**
 * CardBoard — the game's ONE menu primitive.
 *
 * A grid of frosted plastic cards floating in front of you, chosen with a
 * POINTER: a beam leaves your hand down the same aim axis the pistol barrel
 * uses, a cursor lands on the card under it, and the trigger clicks it
 * (systems/PointerSystem.ts drives all of that). Menus used to be picked by
 * HOSING them with juice, which was novel for about four seconds and then
 * just slow — you had to draw a gun to answer a menu, and every choice cost
 * you half a tank.
 *
 * Used by UpgradeSystem (between-wave choices), MenuSystem (title, game
 * over), TurretSystem (the defense shop) and DuelSystem (the duel shop).
 * Every shown board registers itself in `activeBoards`; PointerSystem
 * raycasts them all and drives hover/click.
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Vector3,
  type Scene,
} from 'three';
import { crispTexture, logicalCanvas } from './crispCanvas.js';
import * as sfx from '../audio/sfx.js';
import { UPGRADES } from '../config.js';

const CARD_PX_W = 512;
const CARD_PX_H = 668;

/**
 * Hit padding, metres. A hand-held cursor at arm's length wanders a couple
 * of centimetres no matter how steady you are, so every card catches the
 * ray a little beyond its printed edge — the difference between a pointer
 * that feels magnetic and one that feels like threading a needle.
 */
const HIT_PAD = 0.07;

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
  /** Invisible, slightly oversized plane used ONLY for pointer hits. */
  hitMesh: Mesh;
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  spec: CardSpec;
  w: number;
  h: number;
  /** Drawn state, so we only repaint the canvas when something changes. */
  drawnHover: boolean;
  drawnAfford: boolean;
  affordable: boolean;
  /** Countdown of the refusal shake, seconds. */
  shake: number;
}

/** Every board currently on screen — PointerSystem raycasts these. */
export const activeBoards = new Set<CardBoard>();

/**
 * Set when the pointer consumes a trigger press on a menu. While it's
 * counting down, firing and ghost-planting stay locked out, so the click
 * that picks a card can't also squirt juice or plant a turret the instant
 * the board disappears. PointerSystem owns the countdown.
 */
export const menuClick = { cooldown: 0 };

const _cam = new Vector3();
const _ray = new Raycaster();

export class CardBoard {
  private board = new Group();
  private cards: Card[] = [];
  private onPick: ((id: string) => void) | undefined;
  private canPick: ((id: string) => boolean) | undefined;
  private hover = -1;
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
    opts: {
      y?: number;
      distance?: number;
      onPick: (id: string) => void;
      /** Gate a pick (e.g. affordability). Cards that fail render dimmed,
       * and clicking one shakes it with a dead buzz instead of resolving. */
      canPick?: (id: string) => boolean;
      /** Grid layout: cards per row (default: everything on one row). */
      perRow?: number;
    },
  ): void {
    this.clear();
    this.onPick = opts.onPick;
    this.canPick = opts.canPick;
    this.hover = -1;

    // Lay out as a centred grid, respecting per-card scale.
    const perRow = opts.perRow ?? specs.length;
    const rows: CardSpec[][] = [];
    for (let i = 0; i < specs.length; i += perRow) rows.push(specs.slice(i, i + perRow));
    const rowH = UPGRADES.cardHeight * (specs[0]?.scale ?? 1) + 0.1;
    const yTop = ((rows.length - 1) / 2) * rowH;
    for (let r = 0; r < rows.length; r++) {
      const rowSpecs = rows[r];
      const widths = rowSpecs.map((s) => UPGRADES.cardWidth * (s.scale ?? 1));
      const total = widths.reduce((a, b) => a + b, 0) + UPGRADES.cardGap * (rowSpecs.length - 1);
      let x = -total / 2;
      for (let i = 0; i < rowSpecs.length; i++) {
        const card = this.buildCard(rowSpecs[i]);
        card.group.position.set(x + widths[i] / 2, yTop - r * rowH, 0);
        card.group.userData.baseY = yTop - r * rowH;
        card.group.userData.baseX = x + widths[i] / 2;
        x += widths[i] + UPGRADES.cardGap;
        this.board.add(card.group);
        this.cards.push(card);
      }
    }

    this.board.position.set(0, opts.y ?? UPGRADES.cardHeightY, -(opts.distance ?? UPGRADES.cardDistance));
    this.board.visible = true;
    activeBoards.add(this);
    sfx.upgradeAppear();
  }

  hide(): void {
    this.board.visible = false;
    this.hover = -1;
    activeBoards.delete(this);
    this.clear();
  }

  /** Face the player, idle-bob, and keep affordability current. */
  update(dt: number, camWorldPos: Vector3): void {
    if (!this.board.visible) return;
    this.time += dt;
    _cam.copy(camWorldPos);
    this.board.lookAt(_cam.x, this.board.position.y, _cam.z);
    for (let i = 0; i < this.cards.length; i++) {
      const card = this.cards[i];
      const baseY = (card.group.userData.baseY as number) ?? 0;
      const baseX = (card.group.userData.baseX as number) ?? 0;
      const hovered = i === this.hover;
      card.group.position.y = baseY + Math.sin(this.time * 1.7 + i * 1.3) * 0.012;
      // Refusal shake: the card jitters sideways and settles.
      if (card.shake > 0) {
        card.shake = Math.max(0, card.shake - dt);
        card.group.position.x = baseX + Math.sin(this.time * 70) * 0.018 * card.shake * 4;
      } else {
        card.group.position.x = baseX;
      }
      // Hovered cards lift toward you a touch — depth does the pop, so a
      // cursor never has to fight a busy card face to read as "selected".
      const targetZ = hovered ? 0.045 : 0;
      card.group.position.z += (targetZ - card.group.position.z) * Math.min(1, dt * 14);
      const targetS = hovered ? 1.05 : 1;
      const s = card.group.scale.x + (targetS - card.group.scale.x) * Math.min(1, dt * 14);
      card.group.scale.setScalar(s);

      const affordable = this.canPick ? this.canPick(card.spec.id) : true;
      if (affordable !== card.affordable) card.affordable = affordable;
      if (card.drawnHover !== hovered || card.drawnAfford !== affordable) this.drawCard(card);
    }
  }

  /**
   * Ray vs this board. Returns the hit distance and the card index, or null.
   * `outPoint` receives the world-space hit point (the cursor goes there).
   */
  hitTest(origin: Vector3, dir: Vector3, outPoint: Vector3): { index: number; distance: number } | null {
    if (!this.board.visible || this.cards.length === 0) return null;
    _ray.set(origin, dir);
    _ray.far = 12;
    const hits = _ray.intersectObjects(
      this.cards.map((c) => c.hitMesh),
      false,
    );
    if (hits.length === 0) return null;
    const hit = hits[0];
    const index = this.cards.findIndex((c) => c.hitMesh === hit.object);
    if (index < 0) return null;
    outPoint.copy(hit.point);
    return { index, distance: hit.distance };
  }

  /** Highlight a card (-1 = nothing). Returns true if the hover changed. */
  setHover(index: number): boolean {
    if (this.hover === index) return false;
    this.hover = index;
    return true;
  }

  get hovered(): number {
    return this.hover;
  }

  /** Is the card at `index` currently pickable? (Drives the cursor colour.) */
  affordableAt(index: number): boolean {
    const card = this.cards[index];
    return card ? card.affordable : true;
  }

  /** Click whatever is hovered. Returns true if a pick actually resolved. */
  activateHover(): boolean {
    if (this.hover < 0 || this.hover >= this.cards.length) return false;
    const card = this.cards[this.hover];
    const id = card.spec.id;
    if (this.canPick && !this.canPick(id)) {
      card.shake = 0.25;
      sfx.denied();
      return false;
    }
    const pick = this.onPick;
    this.hide();
    sfx.upgradePick();
    pick?.(id);
    return true;
  }

  // --- Internals. ----------------------------------------------------------

  private clear(): void {
    for (const card of this.cards) {
      card.tex.dispose();
      (card.mesh.material as MeshBasicMaterial).dispose();
      card.mesh.geometry.dispose();
      (card.hitMesh.material as MeshBasicMaterial).dispose();
      card.hitMesh.geometry.dispose();
      this.board.remove(card.group);
    }
    this.cards.length = 0;
  }

  private buildCard(spec: CardSpec): Card {
    const scale = spec.scale ?? 1;
    const canvas = document.createElement('canvas');
    logicalCanvas(canvas, CARD_PX_W, CARD_PX_H);
    const tex = crispTexture(canvas);
    const w = UPGRADES.cardWidth * scale;
    const h = UPGRADES.cardHeight * scale;
    const mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: tex, transparent: true }),
    );
    // The pointer target: bigger than the art, and invisible via the
    // MATERIAL (an invisible Object3D would be skipped by the raycaster).
    const hitMesh = new Mesh(
      new PlaneGeometry(w + HIT_PAD, h + HIT_PAD),
      new MeshBasicMaterial({ visible: false }),
    );
    const group = new Group();
    group.add(mesh, hitMesh);
    const card: Card = {
      group,
      mesh,
      hitMesh,
      canvas,
      tex,
      spec,
      w,
      h,
      drawnHover: false,
      drawnAfford: true,
      affordable: true,
      shake: 0,
    };
    this.drawCard(card);
    return card;
  }

  private drawCard(card: Card): void {
    const ctx = card.canvas.getContext('2d')!;
    const { spec } = card;
    const hovered = this.cards[this.hover] === card;
    const affordable = card.affordable;
    card.drawnHover = hovered;
    card.drawnAfford = affordable;
    const W = CARD_PX_W;
    const H = CARD_PX_H;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Unaffordable cards sit back: everything but the price greys out.
    ctx.globalAlpha = affordable ? 1 : 0.55;

    // Frosted plastic card with the accent rim, brighter under the cursor.
    ctx.fillStyle = hovered ? 'rgba(255,255,255,0.99)' : 'rgba(250,252,255,0.93)';
    ctx.beginPath();
    ctx.roundRect(12, 12, W - 24, H - 24, 48);
    ctx.fill();
    ctx.lineWidth = hovered ? 22 : 14;
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

    // The call to action doubles as the hover read.
    ctx.fillStyle = hovered ? spec.color : '#9fb0ba';
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.fillText(
      !affordable ? "CAN'T AFFORD" : hovered ? 'PULL TRIGGER' : 'POINT TO SELECT',
      W / 2,
      H - 58,
    );
    ctx.globalAlpha = 1;

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
