/**
 * THE SWARM — every enemy in the game, in six draw calls.
 *
 * Creative direction lives in enemies/geometry.ts (THE THIRST — the rival
 * team's drinking machines); this file makes it scale AND makes it read as
 * finished hardware. One InstancedMesh PER KIND, all sharing a shader with:
 *
 *  - role colouring: white shell (takes juice coverage), team-violet
 *    accents, emissive lenses, smoked intakes;
 *  - PER-PART ANIMATION in the vertex shader (`aPart`): rotor rings spin,
 *    fins bob, lenses breathe — phase-offset per instance via aSeed, so a
 *    hundred machines never move in lockstep and every one is alive even
 *    while the AI just glides it;
 *  - two-tone ramp lighting + a cool FRESNEL RIM so silhouettes separate
 *    from the room like graded footage, plus hot gloss on the shells and a
 *    hotter glint on juice coverage;
 *  - instances yaw to face the tower, BANK into lateral motion (the roll
 *    array), squash on hits and rear-back/snap on the attack telegraph.
 *
 * State stays structure-of-arrays over GLOBAL slots (the rest of the game
 * addresses enemies by slot); each slot additionally owns a compact LOCAL
 * index inside its kind's mesh, allocated from a free list so mesh.count
 * stays near the live count (zero-scaled corpses don't pile up vertex work).
 * A uniform spatial grid over XZ keeps ball/blast/orbiter queries cheap.
 */

import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { enemyGeometry } from './geometry.js';
import { ENEMY_TYPES, EnemyKind, type EnemyKindId } from '../config.js';

export const MAX_ENEMIES = 2048;

/** Per-kind instance capacity — far above any sane wave, way below waste. */
const KIND_CAPACITY: Record<EnemyKindId, number> = {
  [EnemyKind.Drifter]: 1024,
  [EnemyKind.Scurrier]: 1024,
  [EnemyKind.Lobber]: 384,
  [EnemyKind.Brute]: 256,
  [EnemyKind.Splitter]: 384,
  [EnemyKind.Boss]: 8,
};

const ALL_KINDS = Object.values(EnemyKind) as EnemyKindId[];

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _q2 = new Quaternion();
const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);

// ---------------------------------------------------------------------------
// The shader: role-coloured plastic + stripes + glossy juice coverage.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
  uniform float uTime;
  attribute float aRole;
  attribute float aPart;
  attribute float aCoverage;
  attribute float aSeed;
  attribute vec3 aTint;
  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vRole;
  varying float vCoverage;
  varying float vSeed;
  varying vec3 vTint;
  void main(){
    vec3 p = position;
    vec3 nrm = normal;

    // --- Per-part life, phase-offset per machine via aSeed. ---
    if (aPart > 0.5 && aPart < 1.5) {
      // Rotor: spin about the machine's vertical axis.
      float a = uTime * 5.0 + aSeed * 6.28;
      float c = cos(a), s = sin(a);
      p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
      nrm = vec3(nrm.x * c - nrm.z * s, nrm.y, nrm.x * s + nrm.z * c);
    } else if (aPart > 1.5 && aPart < 2.5) {
      // Bobber: fins/antennas float on their own beat.
      p.y += sin(uTime * 3.2 + aSeed * 7.0 + position.x * 3.0) * 0.06;
    } else if (aPart > 2.5) {
      // Pulser: lenses and reservoirs breathe along their normals.
      p += nrm * sin(uTime * 3.6 + aSeed * 9.0) * 0.03;
    }

    vObjPos = position;
    vRole = aRole;
    vCoverage = aCoverage;
    vSeed = aSeed;
    vTint = aTint;
    vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nrm);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uJuice;
  uniform vec3 uJuiceDeep;
  uniform vec3 uAccent;
  uniform vec3 uGlow; // the eyes' emissive colour
  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vRole;
  varying float vCoverage;
  varying float vSeed;
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
    vec3 n = normalize(vWorldNormal);
    float up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);

    // --- Two-tone ramp: warm key over cool sky ambient, like the rest of
    // the game's plastic — these are the OTHER TEAM's machines, same sport.
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    float key = max(dot(n, lightDir), 0.0);
    vec3 ramp = mix(vec3(0.52, 0.56, 0.62), vec3(1.05, 1.02, 0.98), key * 0.75 + up * 0.25);

    vec3 col =
      vRole < 0.5 ? vTint * ramp :
      vRole < 1.5 ? uAccent * ramp :
      vRole < 2.5 ? uGlow * 1.8 :
                    vec3(0.13, 0.14, 0.18) * ramp;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h = normalize(lightDir + viewDir);
    float specDot = max(dot(n, h), 0.0);
    // Glossy competition shells — the pistols' finish, in their colours.
    if (vRole < 1.5) col += pow(specDot, 55.0) * 0.5;
    // Cool fresnel rim: lifts every silhouette off the passthrough room.
    float rim = pow(1.0 - abs(dot(n, viewDir)), 3.0);
    if (vRole < 2.5) col += vec3(0.35, 0.55, 0.75) * rim * 0.3;

    // --- Juice coverage: noise splotches, dripping from the top down. ---
    // (Skip the glow so the lens burns through until the very end.)
    if (vRole < 1.5 || vRole > 2.5) {
      float splotch = vnoise(vObjPos * 6.0 + vSeed * 31.0) * 0.6
                    + vnoise(vObjPos * 15.0 + vSeed * 17.0) * 0.4;
      float topDown = 1.0 - clamp(vObjPos.y * 1.6 + 0.5, 0.0, 1.0);
      float field = splotch * 0.55 + topDown * 0.45;
      float cover = vCoverage * 1.08;
      if (field < cover) {
        vec3 juice = mix(uJuiceDeep, uJuice, up * 0.7 + 0.3);
        juice = mix(juice, vec3(1.0, 0.72, 0.88), smoothstep(cover - 0.06, cover - 0.005, field) * 0.6);
        // …and a much hotter, tighter glint on the wet juice itself.
        col = juice + pow(specDot, 90.0) * 0.9;
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Spatial grid — a uniform hash over XZ so proximity queries stay cheap.
// ---------------------------------------------------------------------------

const CELL = 0.75; // metres; a bit wider than the biggest common enemy

class SpatialGrid {
  private cells = new Map<number, number[]>();

  private key(x: number, z: number): number {
    const cx = Math.floor(x / CELL) + 32768;
    const cz = Math.floor(z / CELL) + 32768;
    return cx * 65536 + cz;
  }

  clear(): void {
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
// One kind's rendering block.
// ---------------------------------------------------------------------------

class KindBlock {
  readonly mesh: InstancedMesh;
  readonly coverage: InstancedBufferAttribute;
  readonly seed: InstancedBufferAttribute;
  readonly tint: InstancedBufferAttribute;
  readonly free: number[] = [];
  highWater = 0;

  constructor(kind: EnemyKindId, juice: number, juiceDeep: number) {
    const cap = KIND_CAPACITY[kind];
    const def = ENEMY_TYPES[kind];
    const geo = enemyGeometry(kind).clone();

    this.coverage = new InstancedBufferAttribute(new Float32Array(cap), 1);
    this.seed = new InstancedBufferAttribute(new Float32Array(cap), 1);
    this.tint = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.coverage.setUsage(DynamicDrawUsage);
    geo.setAttribute('aCoverage', this.coverage);
    geo.setAttribute('aSeed', this.seed);
    geo.setAttribute('aTint', this.tint);

    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uJuice: { value: new Color(juice) },
        uJuiceDeep: { value: new Color(juiceDeep) },
        uAccent: { value: new Color(def.accent) },
        uGlow: { value: new Color(def.glow) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
  }

  alloc(): number {
    const i = this.free.pop() ?? (this.highWater < this.mesh.instanceMatrix.count ? this.highWater++ : -1);
    if (i >= 0) this.mesh.count = this.highWater;
    return i;
  }

  release(i: number): void {
    _m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(i);
  }
}

// ---------------------------------------------------------------------------
// The swarm itself.
// ---------------------------------------------------------------------------

export class Swarm {
  /** Add this to the scene — it holds one InstancedMesh per enemy kind. */
  readonly group = new Group();
  readonly grid = new SpatialGrid();

  // Structure-of-arrays enemy state, addressed by GLOBAL slot.
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
  readonly cooldown = new Float32Array(MAX_ENEMIES);
  readonly hitPulse = new Float32Array(MAX_ENEMIES);
  /**
   * Attack telegraph animation, 1 → 0 (see ENEMY.attackDuration). While
   * non-zero the instance rears back, SNAPS toward its target, and
   * recovers — commit() renders it, EnemySystem lands the damage exactly
   * at the snap. 0 = not attacking.
   */
  readonly attackAnim = new Float32Array(MAX_ENEMIES);
  /** Banking roll (radians) — drones lean into lateral motion. */
  readonly roll = new Float32Array(MAX_ENEMIES);
  /** Juice stolen from the tower and being carried away (Sippers). */
  readonly carrying = new Float32Array(MAX_ENEMIES);
  /** 1 while running for the exit with stolen juice. */
  readonly fleeing = new Uint8Array(MAX_ENEMIES);
  /** Arrival swoop, 1 → 0 over the first beat after spawn. */
  readonly arrive = new Float32Array(MAX_ENEMIES);
  readonly strafeDir = new Int8Array(MAX_ENEMIES);
  /** This slot's instance index inside its kind's mesh. */
  private readonly local = new Int32Array(MAX_ENEMIES);

  private blocks: Record<EnemyKindId, KindBlock>;
  private cursor = 0;
  count = 0;

  constructor(juice: number, juiceDeep: number) {
    this.blocks = Object.fromEntries(
      ALL_KINDS.map((k) => [k, new KindBlock(k, juice, juiceDeep)]),
    ) as Record<EnemyKindId, KindBlock>;
    for (const k of ALL_KINDS) this.group.add(this.blocks[k].mesh);
  }

  /** Spawn one enemy. Returns its global slot, or -1 if full. */
  spawn(kind: EnemyKindId, x: number, y: number, z: number, hpScale = 1, speedScale = 1, scale = 1): number {
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

    const block = this.blocks[kind];
    const li = block.alloc();
    if (li < 0) return -1;

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
    this.attackAnim[slot] = 0;
    this.roll[slot] = 0;
    this.carrying[slot] = 0;
    this.fleeing[slot] = 0;
    this.arrive[slot] = 1;
    this.strafeDir[slot] = Math.random() < 0.5 ? -1 : 1;
    this.local[slot] = li;

    block.coverage.array[li] = 0;
    block.seed.array[li] = Math.random() * 10;
    _c.set(def.tint).offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
    const t = block.tint.array as Float32Array;
    t[li * 3] = _c.r;
    t[li * 3 + 1] = _c.g;
    t[li * 3 + 2] = _c.b;
    block.seed.needsUpdate = true;
    block.tint.needsUpdate = true;
    this.count++;
    return slot;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.blocks[this.kind[i] as EnemyKindId].release(this.local[i]);
  }

  /** Apply damage; coverage tracks it so a toy visibly fills with juice. */
  damage(i: number, amount: number): boolean {
    if (!this.alive[i]) return false;
    this.hp[i] -= amount;
    this.hitPulse[i] = 1;
    const block = this.blocks[this.kind[i] as EnemyKindId];
    block.coverage.array[this.local[i]] = 1 - Math.max(0, this.hp[i]) / this.maxHp[i];
    block.coverage.needsUpdate = true;
    return this.hp[i] <= 0;
  }

  rebuildGrid(): void {
    this.grid.clear();
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (this.alive[i]) this.grid.insert(i, this.px[i], this.pz[i]);
    }
  }

  near(x: number, z: number, radius: number, out: number[]): void {
    this.grid.query(x, z, radius, out);
  }

  /**
   * Push the current state into the instance buffers. Once per frame.
   * (tx, tz) is the tower — attack lunges aim at it.
   */
  commit(time: number, tx: number, tz: number): void {
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!this.alive[i]) continue;
      const block = this.blocks[this.kind[i] as EnemyKindId];
      const r = this.radius[i];
      const pulse = this.hitPulse[i];
      let wob = 1 + Math.sin(time * 40 + this.phase[i]) * 0.18 * pulse;

      // --- The attack telegraph: rear back, SNAP forward, recover. ---
      let lunge = 0;
      const a = this.attackAnim[i];
      if (a > 0) {
        if (a > 0.6) {
          const t = (1 - a) / 0.4; // windup: crouch and rear back
          lunge = -0.4 * t;
          wob *= 1 - 0.22 * t;
        } else if (a > 0.35) {
          const t = (0.6 - a) / 0.25; // strike: snap at the target
          lunge = -0.4 + 1.5 * t;
          wob *= 0.78 + 0.5 * t;
        } else {
          const t = (0.35 - a) / 0.35; // recover: ease home
          lunge = 1.1 * (1 - t);
          wob *= 1.28 - 0.28 * t;
        }
      }

      _p.set(this.px[i], this.py[i], this.pz[i]);
      if (lunge !== 0) {
        const ddx = tx - this.px[i];
        const ddz = tz - this.pz[i];
        const dd = Math.hypot(ddx, ddz) || 1;
        _p.x += (ddx / dd) * lunge * r;
        _p.z += (ddz / dd) * lunge * r;
      }
      // Arrival swoop: drop in from above with a small scale pop.
      const arr = this.arrive[i];
      if (arr > 0) _p.y += arr * arr * 2.4;
      const popIn = 1 - arr * 0.35;
      _s.set(r * (2 - wob) * popIn, r * wob * 1.08 * popIn, r * (2 - wob) * popIn);
      // Yaw toward the target, banked into the turn.
      _q.setFromAxisAngle(UP, this.facing[i]);
      if (this.roll[i] !== 0) {
        _q2.setFromAxisAngle(FWD, this.roll[i]);
        _q.multiply(_q2);
      }
      _m.compose(_p, _q, _s);
      block.mesh.setMatrixAt(this.local[i], _m);
    }
    for (const k of ALL_KINDS) {
      this.blocks[k].mesh.instanceMatrix.needsUpdate = true;
      (this.blocks[k].mesh.material as ShaderMaterial).uniforms.uTime.value = time;
    }
  }
}
