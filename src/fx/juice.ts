/**
 * The juice. Everything that makes the juice read THICK and weighty:
 *
 *  - blob pool: one InstancedMesh of glossy tennis-ball-sized juice orbs,
 *    each slightly stretched along its velocity so it wobbles like a thrown
 *    water balloon rather than reading as a rigid marble;
 *  - splat pool: a ring buffer of flat splat decals stamped where juice
 *    lands, each a randomly-rotated, randomly-scaled blobby canvas splat;
 *  - droplet pool: opaque round particles (NORMAL blending — juice is
 *    opaque, unlike fire) that burst off impacts and juiced enemies.
 *
 * All pooled, all instanced, zero allocations at runtime — cheap in stereo.
 */

import {
  CanvasTexture,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { wetJuice } from '../materials/plastic.js';
import { ENEMY_SHOT, PALETTE, PISTOL } from '../config.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _dummy = new Object3D();
const _zAxis = new Vector3(0, 0, 1);
const _dir = new Vector3();
const _c = new Color();

// ---------------------------------------------------------------------------
// Blobs in flight.
// ---------------------------------------------------------------------------

export const MAX_BLOBS = 256;

/** GPU-side rendering of every blob; CPU state lives in JuiceSystem. */
export class BlobPool {
  readonly mesh: InstancedMesh;

  constructor() {
    const geo = new SphereGeometry(PISTOL.blobRadius, 12, 10);
    const mat = wetJuice(PALETTE.juice);
    this.mesh = new InstancedMesh(geo, mat, MAX_BLOBS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_BLOBS;
    // Enemy fire is tinted per instance so incoming juice reads instantly
    // as theirs, not yours.
    for (let i = 0; i < MAX_BLOBS; i++) {
      _c.set(PALETTE.juice);
      this.mesh.setColorAt(i, _c);
    }
    // Park everything at zero scale until a blob claims the slot.
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BLOBS; i++) this.mesh.setMatrixAt(i, _m);
  }

  /**
   * Place slot `i` at `pos`, slightly stretched along `vel` — enough wobble
   * to read as liquid, not so much that a fat ball becomes a rope.
   */
  place(
    i: number,
    pos: Vector3,
    vel: Vector3,
    hostile = false,
    radius = hostile ? ENEMY_SHOT.radius : PISTOL.blobRadius,
    tint = 0,
  ): void {
    const speed = vel.length();
    const stretch = 1 + Math.min(0.45, speed * 0.06);
    _dir.copy(vel).normalize();
    _q.setFromUnitVectors(_zAxis, _dir);
    // Enemy shots are a bit smaller than your fat rounds.
    const size = radius / PISTOL.blobRadius;
    _s.set(size / Math.sqrt(stretch), size / Math.sqrt(stretch), size * stretch);
    _m.compose(pos, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    _c.set(tint || (hostile ? ENEMY_SHOT.tint : PALETTE.juice));
    this.mesh.setColorAt(i, _c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  hide(i: number): void {
    _m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, _m);
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Splat decals.
// ---------------------------------------------------------------------------

const MAX_SPLATS = 480;

/** A blobby splat texture: a core puddle with satellite droplets. */
function splatTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  const cx = size / 2;
  // Core puddle: overlapping discs make an irregular blob outline.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = size * (0.16 + Math.random() * 0.1);
    const d = size * 0.1 * Math.random();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cx + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Satellite droplets flung outward.
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = size * (0.26 + Math.random() * 0.2);
    const r = size * (0.015 + Math.random() * 0.035);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cx + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A soft baked wet highlight across the puddle, so even a splat that no
  // light catches still reads as gloss, not chalk.
  const hl = ctx.createRadialGradient(cx - size * 0.12, cx - size * 0.14, 0, cx, cx, size * 0.4);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return new CanvasTexture(canvas);
}

/** How fast the between-wave wipe ring expands, m/s. */
const WIPE_SPEED = 2.6;
/** Seconds for one splat to shrink away once the ring passes it. */
const WIPE_SHRINK = 0.35;

/** Flat juice stamps on the floor/deck; a ring buffer so old juice recycles. */
export class SplatPool {
  readonly mesh: InstancedMesh;
  private cursor = 0;
  // Per-slot state so splats can be animated after they're stamped.
  private readonly px = new Float32Array(MAX_SPLATS);
  private readonly py = new Float32Array(MAX_SPLATS);
  private readonly pz = new Float32Array(MAX_SPLATS);
  private readonly yaw = new Float32Array(MAX_SPLATS);
  private readonly siz = new Float32Array(MAX_SPLATS); // 0 = empty slot
  private readonly shrink = new Float32Array(MAX_SPLATS).fill(-1); // <0 = not shrinking
  // THE WIPE: between waves an aqua ring sweeps out from the tower and
  // every splat it passes is slurped away — the floor comes back clean.
  wipeActive = false;
  wipeX = 0;
  wipeZ = 0;
  wipeR = 0;
  wipeMax = 1;

  constructor() {
    const geo = new CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2); // lie flat on the floor
    // Lit and near-mirror-smooth: the scene's point lights streak across
    // the puddles as you move your head — cheap, and very "wet floor".
    const mat = new MeshStandardMaterial({
      map: splatTexture(),
      // Near-mirror: puddles should throw the room's light back at you as
      // you move your head — that streak is what makes a floor read WET.
      roughness: 0.035,
      metalness: 0,
      envMapIntensity: 1.6,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new InstancedMesh(geo, mat, MAX_SPLATS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_SPLATS;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_SPLATS; i++) this.mesh.setMatrixAt(i, _m);
    // Slightly varied juice shades per stamp read as wet layered coats.
    for (let i = 0; i < MAX_SPLATS; i++) {
      _c.set(PALETTE.juice).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08);
      this.mesh.setColorAt(i, _c);
    }
  }

  /** Stamp a splat at a world point (y is lifted a hair above the surface). */
  stamp(pos: Vector3, size: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_SPLATS;
    this.px[i] = pos.x;
    this.py[i] = pos.y + 0.004 + (this.cursor % 16) * 0.0004;
    this.pz[i] = pos.z;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.siz[i] = size * (0.8 + Math.random() * 0.5);
    this.shrink[i] = -1;
    this.compose(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Start the wipe: a ring from (cx,cz) that reaches every live splat. */
  beginWipe(cx: number, cz: number): void {
    this.wipeActive = true;
    this.wipeX = cx;
    this.wipeZ = cz;
    this.wipeR = 0;
    let max = 1;
    for (let i = 0; i < MAX_SPLATS; i++) {
      if (this.siz[i] <= 0) continue;
      max = Math.max(max, Math.hypot(this.px[i] - cx, this.pz[i] - cz));
    }
    this.wipeMax = max + 0.6;
  }

  /** Advance the wipe ring and any shrinking splats. Call once per frame. */
  update(dt: number): void {
    if (this.wipeActive) {
      this.wipeR += WIPE_SPEED * dt;
      if (this.wipeR > this.wipeMax) this.wipeActive = false;
    }
    let dirty = false;
    // Droplet sparkles as splats get slurped, budgeted so a floor covered
    // in juice doesn't burst hundreds of particles in one frame.
    let sparkles = 3;
    for (let i = 0; i < MAX_SPLATS; i++) {
      if (this.siz[i] <= 0) continue;
      if (this.shrink[i] < 0) {
        if (!this.wipeActive) continue;
        const dx = this.px[i] - this.wipeX;
        const dz = this.pz[i] - this.wipeZ;
        if (dx * dx + dz * dz > this.wipeR * this.wipeR) continue;
        // The ring just reached this splat: start its shrink, flick a few
        // droplets up off it so the clean-up reads as the juice LEAVING.
        this.shrink[i] = 0;
        if (sparkles > 0) {
          sparkles--;
          dropletBurst(_dummy.position.set(this.px[i], 0.02, this.pz[i]), 4, 0.7);
        }
      }
      this.shrink[i] += dt / WIPE_SHRINK;
      const k = 1 - this.shrink[i];
      if (k <= 0) {
        this.siz[i] = 0;
        this.shrink[i] = -1;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
      } else {
        // Accelerating shrink with a slight spin — swirling down a drain.
        this.compose(i, k * k, this.shrink[i] * 1.8);
      }
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private compose(i: number, scale: number, extraYaw = 0): void {
    _dummy.position.set(this.px[i], this.py[i], this.pz[i]);
    _dummy.rotation.set(0, this.yaw[i] + extraYaw, 0);
    _dummy.scale.setScalar(this.siz[i] * scale);
    _dummy.updateMatrix();
    this.mesh.setMatrixAt(i, _dummy.matrix);
  }
}

// ---------------------------------------------------------------------------
// Droplet particles.
// ---------------------------------------------------------------------------

/** Opaque juice droplets — ring-buffer point pool, normal blending. */
class DropletPool {
  readonly points: Points;
  private readonly geo: BufferGeometry;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private cursor = 0;

  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);

    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('aLife', new BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new BufferAttribute(this.size, 1));

    const mat = new ShaderMaterial({
      uniforms: { uScale: { value: 480 } },
      vertexShader: /* glsl */ `
        uniform float uScale;
        attribute vec3 aColor; attribute float aLife; attribute float aSize;
        varying vec3 vColor; varying float vLife;
        void main(){ vColor=aColor; vLife=aLife;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(aSize * (uScale / -mv.z), 1.0, 48.0);
          gl_Position = projectionMatrix * mv; }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vLife;
        void main(){ if(vLife<=0.0) discard;
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if(r>0.5) discard;
          // Hard round droplet with a wet catchlight up-left plus a tight
          // hot pin inside it, and a bright rim where the surface turns
          // away — thick glossy juice, not glowing spray.
          float lit = 0.85 + 0.3 * max(0.0, -d.y * 2.0);
          float spec = smoothstep(0.19, 0.0, length(d + vec2(0.14, -0.14))) * 1.15;
          spec += smoothstep(0.07, 0.0, length(d + vec2(0.15, -0.15))) * 0.8;
          float rim = smoothstep(0.34, 0.5, r) * 0.35;
          gl_FragColor = vec4(vColor * lit + spec + rim, smoothstep(0.5, 0.42, r)); }
      `,
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(p: Vector3, vx: number, vy: number, vz: number, life: number, size: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    _c.set(PALETTE.juice).offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = _c.r; this.col[i * 3 + 1] = _c.g; this.col[i * 3 + 2] = _c.b;
    this.life[i] = 1;
    this.maxLife[i] = life;
    this.size[i] = size;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.vel[i * 3 + 1] -= 5.5 * dt; // droplets fall like juice, not sparks
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.002) this.life[i] = 0; // gone on touchdown
      else this.life[i] = Math.max(0, this.life[i] - dt / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Shared instances.
// ---------------------------------------------------------------------------

let blobPool: BlobPool | undefined;
let splatPool: SplatPool | undefined;
let dropletPool: DropletPool | undefined;
let wipeRing: Mesh | undefined;

/** Create the shared pools and add them to the scene. Call once at boot. */
export function initJuicePools(scene: Scene): { blobs: BlobPool; splats: SplatPool } {
  if (!blobPool) {
    blobPool = new BlobPool();
    splatPool = new SplatPool();
    dropletPool = new DropletPool(768);
    // The wipe ring: a unit floor ring scaled out to the wipe radius.
    const ringGeo = new RingGeometry(0.9, 1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    wipeRing = new Mesh(
      ringGeo,
      new MeshBasicMaterial({
        color: PALETTE.water,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    wipeRing.position.y = 0.01;
    wipeRing.visible = false;
    scene.add(blobPool.mesh, splatPool!.mesh, dropletPool.points, wipeRing);
  }
  return { blobs: blobPool, splats: splatPool! };
}

/** Integrate droplets and the floor wipe. Call once per frame (JuiceSystem does). */
export function updateJuicePools(dt: number): void {
  dropletPool?.update(dt);
  splatPool?.update(dt);
  if (wipeRing && splatPool) {
    wipeRing.visible = splatPool.wipeActive;
    if (splatPool.wipeActive) {
      wipeRing.position.x = splatPool.wipeX;
      wipeRing.position.z = splatPool.wipeZ;
      wipeRing.scale.setScalar(Math.max(0.01, splatPool.wipeR));
      // Fade as it travels so it dies out at the edge of the mess.
      (wipeRing.material as MeshBasicMaterial).opacity =
        0.55 * (1 - splatPool.wipeR / splatPool.wipeMax);
    }
  }
}

/** Sweep the floor clean from a point — the between-wave reset. */
export function wipeFloor(center: Vector3): void {
  splatPool?.beginWipe(center.x, center.z);
}

/** Stamp a floor splat directly (thrown guns burst outside JuiceSystem). */
export function stampSplat(pos: Vector3, size: number): void {
  splatPool?.stamp(pos, size);
}

/** A wet burst of droplets off an impact point. */
export function dropletBurst(pos: Vector3, count: number, punch = 1): void {
  if (!dropletPool) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = 0.6 + Math.random() * 1.4 * punch;
    const out = (0.4 + Math.random() * 0.9) * punch;
    dropletPool.spawn(
      pos,
      Math.cos(a) * out,
      up,
      Math.sin(a) * out,
      0.5 + Math.random() * 0.5,
      0.02 + Math.random() * 0.028 * punch,
    );
  }
}
