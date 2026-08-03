/**
 * Spatial loadout editor. The drawing and the live arena use the same six
 * ordered slot coordinates, so moving a tool on this board has an immediate,
 * physical meaning when the next GOOPLIATH fight begins.
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
import {
  LOADOUT_SLOT_COUNT,
  loadout,
  toolById,
} from '../game/loadout.js';
import { activeBoards, type PointerBoard } from './cardBoard.js';
import { crispTexture, logicalCanvas } from './crispCanvas.js';
import * as sfx from '../audio/sfx.js';

const W = 1400;
const H = 800;
const WORLD_W = 2.75;
const WORLD_H = 1.57;
const DONE_INDEX = LOADOUT_SLOT_COUNT;

const SLOT_PX: ReadonlyArray<readonly [number, number]> = [
  [285, 250],
  [255, 400],
  [285, 550],
  [1115, 550],
  [1145, 400],
  [1115, 250],
];

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

function localX(px: number): number {
  return (px / W - 0.5) * WORLD_W;
}

function localY(py: number): number {
  return (0.5 - py / H) * WORLD_H;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number): void {
  let size = start;
  do {
    ctx.font = `900 ${size}px system-ui, -apple-system, sans-serif`;
    size -= 2;
  } while (size > 18 && ctx.measureText(text).width > maxWidth);
}

export class LoadoutBoard implements PointerBoard {
  private group = new Group();
  private canvas = document.createElement('canvas');
  private texture: CanvasTexture;
  private hitMeshes: Mesh[] = [];
  private hover = -1;
  private time = 0;
  private redraw = 0;

  constructor(
    scene: Scene,
    private onSlot: (slot: number) => void,
    private onDone: () => void,
  ) {
    logicalCanvas(this.canvas, W, H);
    this.texture = crispTexture(this.canvas);
    const plane = new Mesh(
      new PlaneGeometry(WORLD_W, WORLD_H),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.group.add(plane);

    for (const [x, y] of SLOT_PX) {
      const hit = new Mesh(
        new PlaneGeometry(0.63, 0.22),
        new MeshBasicMaterial({ visible: false }),
      );
      hit.position.set(localX(x), localY(y), 0.012);
      this.group.add(hit);
      this.hitMeshes.push(hit);
    }

    const done = new Mesh(new PlaneGeometry(0.52, 0.14), new MeshBasicMaterial({ visible: false }));
    done.position.set(localX(700), localY(733), 0.012);
    this.group.add(done);
    this.hitMeshes.push(done);

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

  refresh(): void {
    if (this.group.visible) this.draw();
  }

  update(delta: number, cameraWorld: Vector3): void {
    if (!this.group.visible) return;
    this.time += delta;
    this.redraw -= delta;
    _cam.copy(cameraWorld);
    this.group.lookAt(_cam.x, this.group.position.y, _cam.z);
    if (this.redraw <= 0) {
      this.redraw = 0.12;
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

  affordableAt(): boolean {
    return true;
  }

  activateHover(): boolean {
    if (this.hover < 0) return false;
    const picked = this.hover;
    this.hide();
    sfx.upgradePick();
    if (picked === DONE_INDEX) this.onDone();
    else if (picked < LOADOUT_SLOT_COUNT) this.onSlot(picked);
    return true;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    roundRect(ctx, 10, 10, W - 20, H - 20, 54);
    ctx.fillStyle = 'rgba(239,251,255,0.96)';
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#62d8e7';
    ctx.stroke();

    ctx.fillStyle = '#203640';
    ctx.font = '900 54px system-ui, -apple-system, sans-serif';
    ctx.fillText('BOSS LOADOUT', W / 2, 60);
    ctx.fillStyle = '#537681';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('PICK A SOCKET, THEN PICK ANY TOOL  •  DUPLICATES ARE ALLOWED', W / 2, 101);

    // The live pad is a flat-sided octagon; keep the same orientation here.
    const cx = W / 2;
    const cy = 405;
    const radius = 250;
    const water = ctx.createRadialGradient(cx, cy, 40, cx, cy, radius);
    water.addColorStop(0, 'rgba(86,209,229,0.12)');
    water.addColorStop(1, 'rgba(86,173,229,0.34)');
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = water;
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#45cedd';
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();

    ctx.fillStyle = '#496d77';
    ctx.font = '900 28px system-ui, sans-serif';
    ctx.fillText('GOOPLIATH', cx, 285);
    ctx.fillStyle = '#84a7b0';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText('FRONT', cx, 321);
    ctx.fillStyle = '#2a4b55';
    ctx.font = '900 42px system-ui, sans-serif';
    ctx.fillText('YOUR PAD', cx, 405);
    ctx.fillStyle = '#60818b';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText('MOVE • REACH • GRAB', cx, 451);

    for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
      const [x, y] = SLOT_PX[i];
      const tool = toolById(loadout.slots[i]);
      const over = this.hover === i;
      const pulse = over ? 1.04 : 1 + Math.sin(this.time * 2.2 + i) * 0.008;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      roundRect(ctx, -154, -53, 308, 106, 28);
      ctx.fillStyle = over ? '#ffffff' : 'rgba(250,253,255,0.96)';
      ctx.fill();
      ctx.lineWidth = over ? 10 : 7;
      ctx.strokeStyle = tool.color;
      ctx.stroke();

      ctx.textAlign = i < 3 ? 'left' : 'right';
      const tx = i < 3 ? -105 : 105;
      ctx.fillStyle = '#708a93';
      ctx.font = '800 18px system-ui, sans-serif';
      ctx.fillText(`SLOT ${i + 1}`, tx, -24);
      ctx.fillStyle = '#253f49';
      fitFont(ctx, tool.shortName, 215, 27);
      ctx.fillText(tool.shortName, tx, 14);
      ctx.fillStyle = tool.color;
      ctx.font = '800 17px system-ui, sans-serif';
      ctx.fillText(over ? 'PULL TO CHANGE' : tool.kind === 'grenade' ? 'GRENADE' : tool.family.toUpperCase(), tx, 39);
      ctx.restore();

      // A short cable makes the relationship to the octagon explicit.
      ctx.beginPath();
      const innerX = i < 3 ? x + 158 : x - 158;
      const padX = i < 3 ? 465 : 935;
      ctx.moveTo(innerX, y);
      ctx.lineTo(padX, y + (405 - y) * 0.18);
      ctx.lineWidth = 6;
      ctx.strokeStyle = tool.color;
      ctx.stroke();
    }

    roundRect(ctx, 560, 694, 280, 70, 28);
    ctx.fillStyle = this.hover === DONE_INDEX ? '#27616d' : '#5e7e87';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 27px system-ui, sans-serif';
    ctx.fillText(this.hover === DONE_INDEX ? 'PULL TRIGGER' : '‹  DONE', 700, 730);

    this.texture.needsUpdate = true;
  }
}
