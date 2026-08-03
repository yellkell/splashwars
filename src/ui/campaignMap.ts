/**
 * The campaign's world map: one illustrated, pointer-driven surface rather
 * than fifteen ordinary menu cards. The winding route is always visible,
 * cleared stops stay stamped, the next stop pulses, and later districts sit
 * beyond the locked waterway so progress has a physical shape.
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
import { CAMPAIGN_NODES, campaignComplete, nodeCleared, nodeUnlocked } from '../campaign/campaignState.js';
import { activeBoards, type PointerBoard } from './cardBoard.js';
import { crispTexture, logicalCanvas } from './crispCanvas.js';
import * as sfx from '../audio/sfx.js';

const W = 1400;
const H = 800;
const WORLD_W = 2.75;
const WORLD_H = 1.57;
const BACK_INDEX = CAMPAIGN_NODES.length;

const DISTRICTS = [
  { name: 'LIDO', color: '#55d7e8' },
  { name: 'LAZY RIVER', color: '#63b7ff' },
  { name: 'WATERWORKS', color: '#b08cff' },
  { name: 'SPILLWAY', color: '#ff72ba' },
  { name: 'DEEP END', color: '#ffad4f' },
] as const;

const _ray = new Raycaster();
const _cam = new Vector3();

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, start: number, weight = 900): number {
  let size = start;
  while (size > 18) {
    ctx.font = `${weight} ${size}px system-ui, -apple-system, sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 2;
  }
  return size;
}

export class CampaignMap implements PointerBoard {
  private group = new Group();
  private canvas = document.createElement('canvas');
  private texture: CanvasTexture;
  private mapMesh: Mesh;
  private hitMeshes: Mesh[] = [];
  private hover = -1;
  private time = 0;
  private redrawTimer = 0;

  constructor(
    scene: Scene,
    private onPick: (id: string) => void,
    private onBack: () => void,
  ) {
    logicalCanvas(this.canvas, W, H);
    this.texture = crispTexture(this.canvas);
    this.mapMesh = new Mesh(
      new PlaneGeometry(WORLD_W, WORLD_H),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.group.add(this.mapMesh);

    for (const node of CAMPAIGN_NODES) {
      const size = node.kind === 'boss' ? 0.15 : 0.12;
      const hit = new Mesh(
        new PlaneGeometry(size, size),
        new MeshBasicMaterial({ visible: false }),
      );
      hit.position.set((node.map[0] - 0.5) * WORLD_W, (0.5 - node.map[1]) * WORLD_H, 0.012);
      this.group.add(hit);
      this.hitMeshes.push(hit);
    }

    const back = new Mesh(new PlaneGeometry(0.34, 0.12), new MeshBasicMaterial({ visible: false }));
    back.position.set(-WORLD_W * 0.39, -WORLD_H * 0.415, 0.012);
    this.group.add(back);
    this.hitMeshes.push(back);

    this.group.position.set(0, 1.58, -2.45);
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.group.visible;
  }

  get hovered(): number {
    return this.hover;
  }

  show(): void {
    this.hover = -1;
    this.group.visible = true;
    activeBoards.add(this);
    this.draw();
    sfx.upgradeAppear();
  }

  hide(): void {
    this.group.visible = false;
    this.hover = -1;
    activeBoards.delete(this);
  }

  update(delta: number, cameraWorld: Vector3): void {
    if (!this.group.visible) return;
    this.time += delta;
    this.redrawTimer -= delta;
    _cam.copy(cameraWorld);
    this.group.lookAt(_cam.x, this.group.position.y, _cam.z);
    if (this.redrawTimer <= 0) {
      this.redrawTimer = 0.12;
      this.draw();
    }
  }

  hitTest(origin: Vector3, dir: Vector3, outPoint: Vector3): { index: number; distance: number } | null {
    if (!this.group.visible) return null;
    _ray.set(origin, dir);
    _ray.far = 12;
    const hits = _ray.intersectObjects(this.hitMeshes, false);
    if (hits.length === 0) return null;
    const index = this.hitMeshes.indexOf(hits[0].object as Mesh);
    if (index < 0) return null;
    outPoint.copy(hits[0].point);
    return { index, distance: hits[0].distance };
  }

  setHover(index: number): boolean {
    if (this.hover === index) return false;
    this.hover = index;
    this.draw();
    return true;
  }

  affordableAt(index: number): boolean {
    return index === BACK_INDEX || nodeUnlocked(index);
  }

  activateHover(): boolean {
    if (this.hover < 0) return false;
    if (this.hover === BACK_INDEX) {
      this.hide();
      sfx.upgradePick();
      this.onBack();
      return true;
    }
    if (!nodeUnlocked(this.hover)) {
      sfx.denied();
      return false;
    }
    const node = CAMPAIGN_NODES[this.hover];
    if (!node) return false;
    this.hide();
    sfx.upgradePick();
    this.onPick(node.id);
    return true;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    // Smoked pool glass over passthrough, edged like glossy white plastic.
    roundRect(ctx, 10, 10, W - 20, H - 20, 54);
    ctx.fillStyle = 'rgba(239,251,255,0.94)';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = campaignComplete() ? '#58dc76' : '#78dbe8';
    ctx.stroke();

    const ocean = ctx.createLinearGradient(0, 120, 0, 680);
    ocean.addColorStop(0, 'rgba(111,214,237,0.22)');
    ocean.addColorStop(1, 'rgba(81,155,222,0.34)');
    roundRect(ctx, 42, 118, W - 84, 554, 42);
    ctx.fillStyle = ocean;
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#203640';
    ctx.font = '900 55px system-ui, -apple-system, sans-serif';
    ctx.fillText(campaignComplete() ? 'THE GREAT SPLASH — CLEARED' : 'THE GREAT SPLASH', W / 2, 58);
    ctx.fillStyle = '#537681';
    ctx.font = '700 23px system-ui, sans-serif';
    ctx.fillText('FIVE DISTRICTS  •  FIFTEEN FIGHTS  •  ONE GROWING LOADOUT', W / 2, 98);

    // Five soft district islands. Their overlaps make one continuous coast.
    for (let i = 0; i < DISTRICTS.length; i++) {
      const d = DISTRICTS[i];
      const x = 92 + i * 248;
      const y = i % 2 === 0 ? 185 : 245;
      const grad = ctx.createRadialGradient(x + 120, y + 140, 18, x + 120, y + 140, 165);
      grad.addColorStop(0, `${d.color}70`);
      grad.addColorStop(1, `${d.color}12`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x + 120, y + 140, 166, 206, i % 2 ? -0.12 : 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#41616b';
      ctx.font = '900 19px system-ui, sans-serif';
      ctx.fillText(d.name, x + 120, y + 22);
    }

    // Route first, nodes on top. Cleared water burns aqua; future water is a
    // grey dashed promise. Segment state follows its destination node.
    ctx.lineCap = 'round';
    for (let i = 1; i < CAMPAIGN_NODES.length; i++) {
      const a = CAMPAIGN_NODES[i - 1].map;
      const b = CAMPAIGN_NODES[i].map;
      ctx.beginPath();
      ctx.moveTo(a[0] * W, a[1] * H);
      ctx.lineTo(b[0] * W, b[1] * H);
      ctx.lineWidth = nodeUnlocked(i) ? 10 : 7;
      ctx.strokeStyle = nodeUnlocked(i) ? '#32c6d6' : 'rgba(71,103,113,0.35)';
      ctx.setLineDash(nodeUnlocked(i) ? [] : [12, 14]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const nextIndex = CAMPAIGN_NODES.findIndex((n) => !nodeCleared(n.id));
    for (let i = 0; i < CAMPAIGN_NODES.length; i++) {
      const node = CAMPAIGN_NODES[i];
      const x = node.map[0] * W;
      const y = node.map[1] * H;
      const open = nodeUnlocked(i);
      const done = nodeCleared(node.id);
      const over = this.hover === i;
      const boss = node.kind === 'boss';
      const r = boss ? 31 : 25;
      const pulse = i === nextIndex ? 1 + Math.sin(this.time * 5) * 0.08 : 1;

      if (i === nextIndex) {
        ctx.beginPath();
        ctx.arc(x, y, (r + 16) * pulse, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(over ? 1.13 : pulse, over ? 1.13 : pulse);
      ctx.beginPath();
      if (boss) {
        for (let p = 0; p < 8; p++) {
          const a = -Math.PI / 2 + (p / 8) * Math.PI * 2;
          const rr = p % 2 === 0 ? r * 1.2 : r * 0.84;
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      } else {
        ctx.arc(0, 0, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = done ? '#26bba7' : open ? node.accent : '#71858c';
      ctx.fill();
      ctx.lineWidth = over ? 7 : 5;
      ctx.strokeStyle = done ? '#eafffb' : open ? '#ffffff' : '#bac7cb';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${boss ? 24 : 22}px system-ui, sans-serif`;
      ctx.fillText(done ? '✓' : open ? String(i + 1) : '×', 0, 1);
      ctx.restore();
    }

    // Back is part of the same pointer surface, not a separate floating card.
    const backOver = this.hover === BACK_INDEX;
    roundRect(ctx, 72, 704, 190, 58, 24);
    ctx.fillStyle = backOver ? '#395d68' : '#69848c';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 25px system-ui, sans-serif';
    ctx.fillText('‹  MENU', 167, 734);

    const hoveredNode = this.hover >= 0 && this.hover < CAMPAIGN_NODES.length
      ? CAMPAIGN_NODES[this.hover]
      : CAMPAIGN_NODES[nextIndex >= 0 ? nextIndex : CAMPAIGN_NODES.length - 1];
    if (hoveredNode) {
      const idx = CAMPAIGN_NODES.indexOf(hoveredNode);
      const open = nodeUnlocked(idx);
      const done = nodeCleared(hoveredNode.id);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#27434d';
      fitText(ctx, hoveredNode.title, 560, 34);
      ctx.fillText(hoveredNode.title, 330, 716);
      ctx.fillStyle = open ? hoveredNode.accent : '#82969d';
      ctx.font = '800 22px system-ui, sans-serif';
      const state = done ? 'CLEARED — REPLAY' : open ? (hoveredNode.kind === 'boss' ? 'BOSS FIGHT' : 'NEXT FIGHT') : 'LOCKED';
      ctx.fillText(`${hoveredNode.subtitle}  •  ${state}`, 330, 752);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#52727c';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(`${campaignProgressLabel()} POWER`, 1320, 734);
    }

    this.texture.needsUpdate = true;
  }
}

function campaignProgressLabel(): string {
  const cleared = CAMPAIGN_NODES.filter((n) => nodeCleared(n.id)).length;
  return `${cleared}/${CAMPAIGN_NODES.length}`;
}
