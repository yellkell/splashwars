/**
 * Damage numbers — white digits with thick black outlines that pop off every
 * hit, so you can read your damage as text as well as feel it in the paint.
 *
 * Built for swarm scale: a canvas atlas of the ten digits is rendered once,
 * and every digit of every live number is an instance of ONE quad mesh. A
 * hundred simultaneous hit markers is still one draw call and zero per-frame
 * allocation. Instances billboard to the camera, rise, and fade out.
 *
 * Crits (big hits) come up larger and tinted, so a Paint Bomb detonation
 * reads differently from a chip hit at a glance.
 */

import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';

/** Max digits on screen at once (≈ 40 numbers of up to 4 digits). */
const MAX_DIGITS = 192;
const DIGIT_W = 0.055; // world width of one digit at scale 1
const DIGIT_H = 0.085;
const RISE = 0.85; // metres/second the number floats up
const LIFE = 0.9; // seconds before it's gone

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _c = new Color();

/**
 * Render 0-9 into a 10-cell strip: fat white glyphs with a heavy black
 * outline so they stay legible against paint, plastic or passthrough.
 */
function digitAtlas(): CanvasTexture {
  const cellW = 96;
  const cellH = 144;
  const canvas = document.createElement('canvas');
  canvas.width = cellW * 10;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 108px system-ui, -apple-system, sans-serif';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  for (let d = 0; d < 10; d++) {
    const cx = d * cellW + cellW / 2;
    const cy = cellH / 2;
    // Thick black outline, stroked twice for a really solid edge.
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 22;
    ctx.strokeText(String(d), cx, cy);
    ctx.lineWidth = 14;
    ctx.strokeText(String(d), cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(d), cx, cy);
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

export class DamageNumbers {
  readonly mesh: InstancedMesh;
  private uvOffset: InstancedBufferAttribute;
  private tint: InstancedBufferAttribute;
  private alpha: InstancedBufferAttribute;

  // Per-instance CPU state.
  private x = new Float32Array(MAX_DIGITS);
  private y = new Float32Array(MAX_DIGITS);
  private z = new Float32Array(MAX_DIGITS);
  private offX = new Float32Array(MAX_DIGITS); // horizontal offset within the number
  private life = new Float32Array(MAX_DIGITS);
  private scale = new Float32Array(MAX_DIGITS);
  private drift = new Float32Array(MAX_DIGITS);
  private cursor = 0;

  constructor() {
    // A quad whose UVs cover one tenth of the atlas; the instance's uvOffset
    // slides it to the right digit.
    const geo = new PlaneGeometry(DIGIT_W, DIGIT_H);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.1);

    this.uvOffset = new InstancedBufferAttribute(new Float32Array(MAX_DIGITS), 1);
    this.tint = new InstancedBufferAttribute(new Float32Array(MAX_DIGITS * 3), 3);
    this.alpha = new InstancedBufferAttribute(new Float32Array(MAX_DIGITS), 1);
    for (const a of [this.uvOffset, this.tint, this.alpha]) a.setUsage(DynamicDrawUsage);
    geo.setAttribute('aUvOffset', this.uvOffset);
    geo.setAttribute('aTint', this.tint);
    geo.setAttribute('aAlpha', this.alpha);

    const mat = new MeshBasicMaterial({
      map: digitAtlas(),
      transparent: true,
      depthWrite: false,
      // Draw over the world: a hit marker hidden behind an enemy is useless.
      depthTest: false,
    });
    // Patch the stock basic shader to honour the per-instance UV slide,
    // tint and fade — cheaper than authoring a whole material.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute float aUvOffset;
           attribute vec3 aTint;
           attribute float aAlpha;
           varying vec3 vTint;
           varying float vAlpha;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
           vMapUv.x += aUvOffset;
           vTint = aTint;
           vAlpha = aAlpha;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vTint;
           varying float vAlpha;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
           diffuseColor.rgb *= vTint;
           diffuseColor.a *= vAlpha;`,
        );
    };

    this.mesh = new InstancedMesh(geo, mat, MAX_DIGITS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_DIGITS;
    this.mesh.renderOrder = 999;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_DIGITS; i++) this.mesh.setMatrixAt(i, _m);
  }

  /**
   * Pop a number at a world point. `big` scales it up and tints it for
   * heavy hits (explosions, crits, kills).
   */
  spawn(pos: Vector3, amount: number, big = false, color = 0xffffff): void {
    const text = String(Math.max(1, Math.round(amount)));
    const n = text.length;
    const scale = big ? 1.7 : 1;
    const drift = (Math.random() - 0.5) * 0.35;
    _c.set(color);
    for (let d = 0; d < n; d++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_DIGITS;
      this.x[i] = pos.x;
      this.y[i] = pos.y;
      this.z[i] = pos.z;
      // Centre the digit string on the hit point.
      this.offX[i] = (d - (n - 1) / 2) * DIGIT_W * 0.82 * scale;
      this.life[i] = 1;
      this.scale[i] = scale;
      this.drift[i] = drift;
      this.uvOffset.array[i] = (text.charCodeAt(d) - 48) * 0.1;
      const t = this.tint.array as Float32Array;
      t[i * 3] = _c.r;
      t[i * 3 + 1] = _c.g;
      t[i * 3 + 2] = _c.b;
    }
    this.uvOffset.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  /** Dev probe — see debugLiveDigits(). */
  debugCounts(): { live: number; visible: number } {
    let live = 0;
    let visible = 0;
    const alpha = this.alpha.array as Float32Array;
    for (let i = 0; i < MAX_DIGITS; i++) {
      if (this.life[i] > 0) live++;
      if (alpha[i] > 0.01) visible++;
    }
    return { live, visible };
  }

  /** Integrate and billboard. Call once per frame with the camera rotation. */
  update(dt: number, cameraQuat: Quaternion): void {
    const alpha = this.alpha.array as Float32Array;
    for (let i = 0; i < MAX_DIGITS; i++) {
      if (this.life[i] <= 0) {
        if (alpha[i] !== 0) {
          alpha[i] = 0;
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
        }
        continue;
      }
      this.life[i] = Math.max(0, this.life[i] - dt / LIFE);
      const t = this.life[i];
      this.y[i] += RISE * dt * t;
      this.x[i] += this.drift[i] * dt;

      // Pop in fast, then ease out — a little scale punch on arrival.
      const pop = 1 + (1 - t) * 0.15;
      const s = this.scale[i] * pop * Math.min(1, t * 4);
      alpha[i] = Math.min(1, t * 2.5);

      _q.copy(cameraQuat);
      _p.set(this.x[i], this.y[i], this.z[i]);
      // Offset along the camera's right vector so digits stay side by side
      // no matter where you're standing.
      _s.set(this.offX[i], 0, 0).applyQuaternion(_q);
      _p.add(_s);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

let numbers: DamageNumbers | undefined;

export function initDamageNumbers(scene: Scene): DamageNumbers {
  if (!numbers) {
    numbers = new DamageNumbers();
    scene.add(numbers.mesh);
  }
  return numbers;
}

/** Pop a damage number. Safe to call before init (it just no-ops). */
export function popDamage(pos: Vector3, amount: number, big = false, color = 0xffffff): void {
  numbers?.spawn(pos, amount, big, color);
}

export function updateDamageNumbers(dt: number, cameraQuat: Quaternion): void {
  numbers?.update(dt, cameraQuat);
}

/** Dev probe: the live pool, for headless tests to inspect directly. */
export function debugNumbersInstance(): DamageNumbers | undefined {
  return numbers;
}

/** Dev probe: how many digit instances are currently alive and visible. */
export function debugLiveDigits(): { live: number; visible: number } | null {
  if (!numbers) return null;
  return numbers.debugCounts();
}
