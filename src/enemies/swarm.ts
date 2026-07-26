/**
 * THE SWARM — every enemy in the game, in one draw call.
 *
 * The old build gave each toy its own Group of six meshes and a private
 * ShaderMaterial. That is lovely for a dozen enemies and fatal for a
 * thousand. This is the rebuild:
 *
 *  - **One InstancedMesh.** All enemies share a single sphere geometry and
 *    one material. Per-instance attributes carry everything that differs:
 *    paint coverage, shell tint, a random seed, and a facing angle.
 *  - **Eyes in the shader.** Rather than two extra meshes per enemy, the
 *    fragment shader draws the eyes procedurally from object-space position,
 *    rotated by the instance's facing. Free eyes, no extra geometry.
 *  - **Paint coverage in the same shader.** The noise-masked, top-down,
 *    drip-style coverage from the original toy now runs per-instance off the
 *    `aCoverage` attribute — so a thousand enemies can each be individually
 *    half-painted with zero extra cost.
 *  - **Structure-of-arrays state + a uniform spatial grid.** Enemy positions
 *    live in typed arrays, and a grid hash over XZ lets the paint sim ask
 *    "what's near this point?" without scanning the whole swarm. Without it
 *    the blob↔enemy test would be O(blobs × enemies) — half a million
 *    distance checks a frame at swarm scale.
 */

import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { ENEMY_TYPES, type EnemyKindId } from '../config.js';

export const MAX_ENEMIES = 2048;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

// ---------------------------------------------------------------------------
// The shader: plastic shell + paint coverage + procedural eyes.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
  attribute float aCoverage;
  attribute float aSeed;
  attribute float aFacing;
  attribute vec3 aTint;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying float vCoverage;
  varying float vSeed;
  varying float vFacing;
  varying vec3 vTint;
  void main(){
    vObjPos = position;
    vCoverage = aCoverage;
    vSeed = aSeed;
    vFacing = aFacing;
    vTint = aTint;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uPaint;
  uniform vec3 uPaintDeep;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  varying float vCoverage;
  varying float vSeed;
  varying float vFacing;
  varying vec3 vTint;

  float hash(vec3 p){
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 p){
    vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main(){
    // Object space is a unit sphere; rotate it so the face points the way
    // this instance is travelling (cheaper than rotating the instance).
    float c = cos(vFacing), s = sin(vFacing);
    vec3 p = normalize(vObjPos);
    vec3 look = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);

    // --- Base plastic shell, top-lit. ---
    float up = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = vTint * (0.62 + 0.45 * up);

    // --- Eyes: two dark discs on the face (-Z), with a specular catchlight. ---
    vec2 eyeL = vec2(-0.34, 0.22);
    vec2 eyeR = vec2(0.34, 0.22);
    if (look.z < 0.0) {
      vec2 face = vec2(look.x, look.y);
      float dL = length(face - eyeL);
      float dR = length(face - eyeR);
      float d = min(dL, dR);
      float white = smoothstep(0.30, 0.26, d);
      float pupil = smoothstep(0.17, 0.13, d);
      col = mix(col, vec3(1.0), white * 0.95);
      col = mix(col, vec3(0.09, 0.13, 0.16), pupil);
      // Catchlight, offset up-left so they read as wet and alive.
      float gl = min(length(face - eyeL - vec2(-0.06, 0.06)), length(face - eyeR - vec2(-0.06, 0.06)));
      col = mix(col, vec3(1.0), smoothstep(0.06, 0.03, gl) * pupil);
    }

    // --- Paint coverage: noise splotches, biased to paint from the top down. ---
    float splotch = vnoise(vObjPos * 9.0 + vSeed * 31.0) * 0.6
                  + vnoise(vObjPos * 23.0 + vSeed * 17.0) * 0.4;
    float topDown = 1.0 - clamp(vObjPos.y * 2.2 + 0.5, 0.0, 1.0);
    float field = splotch * 0.55 + topDown * 0.45;
    float cover = vCoverage * 1.08;
    if (field < cover) {
      float pup = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 paint = mix(uPaintDeep, uPaint, pup * 0.7 + 0.3);
      // Wet bright lip along the advancing paint edge.
      paint = mix(paint, vec3(1.0, 0.72, 0.88), smoothstep(cover - 0.06, cover - 0.005, field) * 0.6);
      col = paint;
    }

    float gloss = pow(1.0 - abs(vWorldNormal.y), 3.0) * 0.14;
    gl_FragColor = vec4(col + gloss, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Spatial grid — a uniform hash over XZ so proximity queries stay cheap.
// ---------------------------------------------------------------------------

const CELL = 0.75; // metres; a bit wider than the biggest common enemy

class SpatialGrid {
  private cells = new Map<number, number[]>();

  private key(x: number, z: number): number {
    // Pack two 16-bit cell coords into one number.
    const cx = Math.floor(x / CELL) + 32768;
    const cz = Math.floor(z / CELL) + 32768;
    return cx * 65536 + cz;
  }

  clear(): void {
    // Reuse the arrays; clearing them beats reallocating every frame.
    for (const list of this.cells.values()) list.length = 0;
  }

  insert(i: number, x: number, z: number): void {
    const k = this.key(x, z);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(i);
  }

  /** Append the indices in every cell overlapping the query circle. */
  query(x: number, z: number, radius: number, out: number[]): void {
    out.length = 0;
    const span = Math.max(1, Math.ceil(radius / CELL));
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -span; dx <= span; dx++) {
      for (let dz = -span; dz <= span; dz++) {
        const list = this.cells.get((cx + dx + 32768) * 65536 + (cz + dz + 32768));
        if (list) for (let n = 0; n < list.length; n++) out.push(list[n]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The swarm itself.
// ---------------------------------------------------------------------------

export class Swarm {
  readonly mesh: InstancedMesh;
  readonly grid = new SpatialGrid();

  // Structure-of-arrays enemy state.
  readonly px = new Float32Array(MAX_ENEMIES);
  readonly py = new Float32Array(MAX_ENEMIES);
  readonly pz = new Float32Array(MAX_ENEMIES);
  readonly hp = new Float32Array(MAX_ENEMIES);
  readonly maxHp = new Float32Array(MAX_ENEMIES);
  readonly radius = new Float32Array(MAX_ENEMIES);
  readonly speed = new Float32Array(MAX_ENEMIES);
  readonly phase = new Float32Array(MAX_ENEMIES);
  readonly facing = new Float32Array(MAX_ENEMIES);
  readonly kind = new Uint8Array(MAX_ENEMIES);
  readonly alive = new Uint8Array(MAX_ENEMIES);
  /** Per-enemy attack cooldown. */
  readonly cooldown = new Float32Array(MAX_ENEMIES);
  /** Squash-and-stretch impulse from being hit, decays to 0. */
  readonly hitPulse = new Float32Array(MAX_ENEMIES);
  /** Which way it paces across the front arc: +1 or -1. */
  readonly strafeDir = new Int8Array(MAX_ENEMIES);

  private coverageAttr: InstancedBufferAttribute;
  private seedAttr: InstancedBufferAttribute;
  private facingAttr: InstancedBufferAttribute;
  private tintAttr: InstancedBufferAttribute;
  private cursor = 0;
  count = 0;

  constructor(paint: number, paintDeep: number) {
    const geo = new SphereGeometry(1, 16, 12);

    const coverage = new Float32Array(MAX_ENEMIES);
    const seed = new Float32Array(MAX_ENEMIES);
    const facing = new Float32Array(MAX_ENEMIES);
    const tint = new Float32Array(MAX_ENEMIES * 3);
    this.coverageAttr = new InstancedBufferAttribute(coverage, 1);
    this.seedAttr = new InstancedBufferAttribute(seed, 1);
    this.facingAttr = new InstancedBufferAttribute(facing, 1);
    this.tintAttr = new InstancedBufferAttribute(tint, 3);
    for (const a of [this.coverageAttr, this.facingAttr]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('aCoverage', this.coverageAttr);
    geo.setAttribute('aSeed', this.seedAttr);
    geo.setAttribute('aFacing', this.facingAttr);
    geo.setAttribute('aTint', this.tintAttr);

    const mat = new ShaderMaterial({
      uniforms: {
        uPaint: { value: new Color(paint) },
        uPaintDeep: { value: new Color(paintDeep) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new InstancedMesh(geo, mat, MAX_ENEMIES);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_ENEMIES;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_ENEMIES; i++) this.mesh.setMatrixAt(i, _m);
  }

  /** Spawn one enemy. Returns its slot, or -1 if the swarm is full. */
  spawn(kind: EnemyKindId, x: number, y: number, z: number, hpScale = 1, speedScale = 1, scale = 1): number {
    // Find a free slot, starting from the rolling cursor.
    let slot = -1;
    for (let n = 0; n < MAX_ENEMIES; n++) {
      const i = (this.cursor + n) % MAX_ENEMIES;
      if (!this.alive[i]) {
        slot = i;
        this.cursor = (i + 1) % MAX_ENEMIES;
        break;
      }
    }
    if (slot < 0) return -1;

    const def = ENEMY_TYPES[kind];
    this.px[slot] = x;
    this.py[slot] = y;
    this.pz[slot] = z;
    this.maxHp[slot] = def.hp * hpScale;
    this.hp[slot] = this.maxHp[slot];
    this.radius[slot] = def.radius * scale;
    this.speed[slot] = def.speed * speedScale;
    this.phase[slot] = Math.random() * Math.PI * 2;
    this.facing[slot] = 0;
    this.kind[slot] = kind;
    this.alive[slot] = 1;
    this.cooldown[slot] = Math.random() * def.attackInterval;
    this.hitPulse[slot] = 0;
    this.strafeDir[slot] = Math.random() < 0.5 ? -1 : 1;

    this.coverageAttr.array[slot] = 0;
    this.seedAttr.array[slot] = Math.random() * 10;
    _c.set(def.tint);
    const t = this.tintAttr.array as Float32Array;
    t[slot * 3] = _c.r;
    t[slot * 3 + 1] = _c.g;
    t[slot * 3 + 2] = _c.b;
    this.seedAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
    this.count++;
    return slot;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    _m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, _m);
  }

  /**
   * Apply damage. Returns true if this killed it. Coverage tracks the damage
   * taken, so an enemy visibly fills with paint as it dies.
   */
  damage(i: number, amount: number): boolean {
    if (!this.alive[i]) return false;
    this.hp[i] -= amount;
    this.hitPulse[i] = 1;
    const covered = 1 - Math.max(0, this.hp[i]) / this.maxHp[i];
    this.coverageAttr.array[i] = covered;
    return this.hp[i] <= 0;
  }

  /** Rebuild the spatial grid from the live enemies. Call once per frame. */
  rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (this.alive[i]) this.grid.insert(i, this.px[i], this.pz[i]);
    }
  }

  /** Indices of enemies whose cells overlap the circle (broad phase). */
  near(x: number, z: number, radius: number, out: number[]): void {
    this.grid.query(x, z, radius, out);
  }

  /** Push the current state into the instance buffers. Once per frame. */
  commit(time: number): void {
    const cov = this.coverageAttr.array as Float32Array;
    const fac = this.facingAttr.array as Float32Array;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this.alive[i]) continue;
      const r = this.radius[i];
      // Squash-and-stretch on hit: a wobble that reads at any distance.
      const pulse = this.hitPulse[i];
      const wob = 1 + Math.sin(time * 40 + this.phase[i]) * 0.18 * pulse;
      _p.set(this.px[i], this.py[i], this.pz[i]);
      _s.set(r * (2 - wob), r * wob * 1.08, r * (2 - wob));
      _q.identity();
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      fac[i] = this.facing[i];
      void cov;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.coverageAttr.needsUpdate = true;
    this.facingAttr.needsUpdate = true;
  }
}
