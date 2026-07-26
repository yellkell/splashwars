/**
 * The toy enemy — a glossy blow-moulded plastic blob with cartoon eyes,
 * bobbing in over the water. No assets: body, eyes and feet are primitives.
 *
 * The paint mechanic lives in its PAINT SHELL: a second copy of the body a
 * few millimetres proud of it, wearing a shader that DISCARDS wherever a
 * noise field is above the current coverage. As `coverage` rises the shell
 * materialises patch by patch — top first, dripping downward — until the toy
 * is fully painted and pops. The noise makes every enemy's paint job unique.
 */

import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { ENEMY, PALETTE } from '../config.js';
import { glossyPlastic } from '../materials/plastic.js';

const PAINT_VERT = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;
  void main(){
    vObjPos = position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Cheap 3D value noise — enough character for splotchy coverage, far
// lighter than simplex.
const PAINT_FRAG = /* glsl */ `
  uniform float uCoverage;
  uniform vec3 uColor;
  uniform vec3 uDeep;
  varying vec3 vObjPos;
  varying vec3 vWorldNormal;

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
    // Coverage field: noise splotches biased so the TOP paints first and the
    // coats read as having dripped downward.
    float splotch = vnoise(vObjPos * 9.0) * 0.6 + vnoise(vObjPos * 23.0) * 0.4;
    float topDown = 1.0 - clamp(vObjPos.y * 2.2 + 0.5, 0.0, 1.0);
    float field = splotch * 0.55 + topDown * 0.45;
    float cover = uCoverage * 1.08; // slight overshoot so 1.0 fully seals
    if (field >= cover) discard;

    // Thick glossy paint shading, same family as the tank liquid.
    float up = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeep, uColor, up * 0.7 + 0.3);
    // Wet bright lip along the advancing paint edge.
    col = mix(col, vec3(1.0, 0.72, 0.88), smoothstep(cover - 0.06, cover - 0.005, field) * 0.6);
    float gloss = pow(1.0 - abs(vWorldNormal.y), 3.0) * 0.15;
    gl_FragColor = vec4(col + gloss, 1.0);
  }
`;

export interface ToyVisual {
  group: Group;
  /** Feed the enemy's coverage (0..1) every time it takes paint. */
  setCoverage(v: number): void;
  dispose(): void;
}

export function createToyEnemy(scale = 1): ToyVisual {
  const group = new Group();
  group.name = 'toy-enemy';
  const r = ENEMY.bodyRadius * scale;

  // Body: a slightly pear-squashed sphere.
  const bodyGeo = new SphereGeometry(r, 24, 20);
  const body = new Mesh(bodyGeo, glossyPlastic(PALETTE.enemyShell, 0.2));
  body.scale.set(1, 1.12, 0.96);
  group.add(body);

  // The paint shell, a hair proud of the body.
  const paintMat = new ShaderMaterial({
    uniforms: {
      uCoverage: { value: 0 },
      uColor: { value: new Color(PALETTE.paint) },
      uDeep: { value: new Color(PALETTE.paintDeep) },
    },
    vertexShader: PAINT_VERT,
    fragmentShader: PAINT_FRAG,
  });
  const shell = new Mesh(bodyGeo, paintMat);
  shell.scale.copy(body.scale).multiplyScalar(1.035);
  group.add(shell);

  // Cartoon eyes — wide, worried, extremely paintable.
  const eyeWhite = new MeshBasicMaterial({ color: 0xffffff });
  const eyeDark = new MeshBasicMaterial({ color: 0x22303a });
  for (const side of [-1, 1]) {
    const white = new Mesh(new SphereGeometry(r * 0.24, 12, 10), eyeWhite);
    white.position.set(side * r * 0.34, r * 0.28, -r * 0.82);
    group.add(white);
    const pupil = new Mesh(new SphereGeometry(r * 0.11, 10, 8), eyeDark);
    pupil.position.set(side * r * 0.34, r * 0.28, -r * 1.02);
    group.add(pupil);
  }

  // Stubby feet nubs so it reads as a creature, not a balloon.
  for (const side of [-1, 1]) {
    const foot = new Mesh(new SphereGeometry(r * 0.22, 10, 8), glossyPlastic(PALETTE.deckAqua, 0.3));
    foot.scale.set(1, 0.55, 1.2);
    foot.position.set(side * r * 0.42, -r * 1.02, 0);
    group.add(foot);
  }

  return {
    group,
    setCoverage(v: number): void {
      paintMat.uniforms.uCoverage.value = v;
    },
    dispose(): void {
      paintMat.dispose();
      group.removeFromParent();
    },
  };
}
