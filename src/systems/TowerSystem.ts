/**
 * The lifeguard tower — placement, rendering, damage, destruction.
 *
 * PLACEMENT: after you shoot START, a translucent cyan GHOST of the tower
 * glides across your real floor wherever you look ("place the tower in the
 * middle of your play space"). Pull either trigger and it plants: the ghost
 * solidifies into the real tower, the horn sounds, wave one rolls in.
 *
 * THE TOWER is what every toy attacks. It's a little plastic lifeguard
 * chair — four legs, a platform, a seat with a back, a red-and-white
 * umbrella — in the same competition white/red kit as your pistols. Enemy
 * hits soak it in THEIR violet paint via a noise-masked paint shell (the
 * same drip-down trick the toys use), so its health is legible at a glance
 * with no HUD: the purpler it gets, the closer you are to losing. Hits
 * also wobble it; destruction bursts it and ends the run.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glossyPlastic } from '../materials/plastic.js';
import { app } from '../game/appState.js';
import { resetTower, tower } from '../game/tower.js';
import { run } from '../game/run.js';
import { EnemySystem } from './EnemySystem.js';
import { dropletBurst, stampSplat } from '../fx/paint.js';
import * as sfx from '../audio/sfx.js';
import { ENEMY_SHOT, PALETTE, TOWER } from '../config.js';

const _fwd = new Vector3();
const _head = new Vector3();
const _spot = new Vector3();

const HANDS = ['left', 'right'] as const;

/** All the tower's parts as one merged geometry (for ghost + paint shell). */
function towerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (geo: BufferGeometry, x: number, y: number, z: number, rx = 0): void => {
    if (rx) geo.rotateX(rx);
    geo.translate(x, y, z);
    parts.push(geo);
  };
  // Four legs.
  for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
    add(new CylinderGeometry(0.03, 0.035, 0.62, 10), lx, 0.31, lz);
  }
  // Platform, seat, seat back.
  add(new BoxGeometry(0.58, 0.05, 0.58), 0, 0.65, 0);
  add(new BoxGeometry(0.4, 0.07, 0.34), 0, 0.72, 0.05);
  add(new BoxGeometry(0.4, 0.3, 0.06), 0, 0.88, 0.2);
  // Umbrella: pole + canopy.
  add(new CylinderGeometry(0.018, 0.018, 0.62, 8), 0.16, 1.0, -0.12);
  add(new ConeGeometry(0.42, 0.22, 12), 0.16, TOWER.height - 0.08, -0.12);
  return mergeGeometries(parts)!;
}

/** The real tower: white/red plastic, part by part. */
function buildTower(): Group {
  const g = new Group();
  const white = glossyPlastic(PALETTE.sportWhite, 0.2);
  const red = glossyPlastic(PALETTE.sportRed, 0.25);
  const add = (geo: BufferGeometry, mat: typeof white, x: number, y: number, z: number): Mesh => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]] as const) {
    add(new CylinderGeometry(0.03, 0.035, 0.62, 10), white, lx, 0.31, lz);
  }
  add(new BoxGeometry(0.58, 0.05, 0.58), white, 0, 0.65, 0);
  add(new BoxGeometry(0.4, 0.07, 0.34), red, 0, 0.72, 0.05);
  add(new BoxGeometry(0.4, 0.3, 0.06), red, 0, 0.88, 0.2);
  add(new CylinderGeometry(0.018, 0.018, 0.62, 8), white, 0.16, 1.0, -0.12);
  // Red-and-white striped canopy: a red cone with white panel wedges.
  add(new ConeGeometry(0.42, 0.22, 12), red, 0.16, TOWER.height - 0.08, -0.12);
  const panels = new Mesh(new ConeGeometry(0.425, 0.215, 6), white);
  panels.position.set(0.16, TOWER.height - 0.078, -0.12);
  g.add(panels);
  return g;
}

/** The violet coverage shell: enemy paint dripping down the tower. */
const SHELL_FRAG = /* glsl */ `
  uniform float uSoaked;
  uniform vec3 uPaint;
  uniform vec3 uDeep;
  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 p){ vec3 i = floor(p); vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y),
      f.z); }
  void main(){
    float splotch = vnoise(vObjPos * 8.0) * 0.6 + vnoise(vObjPos * 21.0) * 0.4;
    float topDown = 1.0 - clamp(vObjPos.y / ${TOWER.height.toFixed(2)}, 0.0, 1.0);
    float field = splotch * 0.6 + topDown * 0.4;
    float cover = uSoaked * 1.08;
    if (field >= cover) discard;
    vec3 n = normalize(vWorldNormal);
    float up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeep, uPaint, up * 0.7 + 0.3);
    col = mix(col, vec3(0.85, 0.78, 1.0), smoothstep(cover - 0.05, cover - 0.005, field) * 0.6);
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    col += pow(max(dot(n, normalize(lightDir + viewDir)), 0.0), 90.0) * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const SHELL_VERT = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main(){
    vObjPos = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export class TowerSystem extends createSystem({}) {
  private ghost!: Mesh;
  private ghostRing!: Mesh;
  private real!: Group;
  private shell!: Mesh;
  private shellMat!: ShaderMaterial;
  private triggerWas: [boolean, boolean] = [false, false];
  private time = 0;
  private wasDestroyed = false;

  init(): void {
    // The ghost: the whole silhouette in pulsing hologram cyan.
    this.ghost = new Mesh(
      towerGeometry(),
      new MeshBasicMaterial({
        color: PALETTE.water,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    this.world.scene.add(this.ghost);
    // A floor ring under the ghost so the landing spot is unambiguous.
    this.ghostRing = new Mesh(
      new RingGeometry(TOWER.radius * 1.15, TOWER.radius * 1.35, 40),
      new MeshBasicMaterial({ color: PALETTE.water, transparent: true, opacity: 0.7 }),
    );
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.visible = false;
    this.world.scene.add(this.ghostRing);

    // The real thing + its coverage shell (hidden until placed).
    this.real = buildTower();
    this.real.visible = false;
    this.world.scene.add(this.real);
    this.shellMat = new ShaderMaterial({
      uniforms: {
        uSoaked: { value: 0 },
        uPaint: { value: new Color(ENEMY_SHOT.tint) },
        uDeep: { value: new Color(0x4a3592) },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
    });
    this.shell = new Mesh(towerGeometry(), this.shellMat);
    this.shell.scale.setScalar(1.03);
    this.real.add(this.shell);
  }

  update(delta: number): void {
    this.time += delta;

    if (app.phase === 'placing') {
      this.updatePlacing();
    } else {
      this.ghost.visible = false;
      this.ghostRing.visible = false;
    }

    // The real tower shows whenever it's placed and we're in a run context.
    this.real.visible = tower.placed && (app.phase === 'playing' || app.phase === 'gameover');
    if (!this.real.visible) return;

    this.real.position.copy(tower.pos);
    this.shellMat.uniforms.uSoaked.value = tower.soaked;

    // Hit wobble: a quick shudder so every landed attack is felt.
    if (tower.hitFlash > 0) {
      tower.hitFlash = Math.max(0, tower.hitFlash - delta);
      const s = tower.hitFlash / TOWER.hitFlash;
      this.real.rotation.z = Math.sin(this.time * 45) * 0.05 * s;
      this.real.rotation.x = Math.cos(this.time * 39) * 0.04 * s;
    } else {
      this.real.rotation.set(0, 0, 0);
    }

    // Destruction: one big burst, then the game-over flow takes it.
    if (tower.health <= 0 && !this.wasDestroyed) {
      this.wasDestroyed = true;
      _spot.copy(tower.pos);
      _spot.y = 0.7;
      dropletBurst(_spot, 60, 2.6);
      stampSplat(_spot.setY(0), 1.4);
      sfx.towerDown();
    }
    if (tower.health > 0) this.wasDestroyed = false;
  }

  // --- Placement. ----------------------------------------------------------

  private updatePlacing(): void {
    const cam = this.world.camera;
    cam.getWorldPosition(_head);
    cam.getWorldDirection(_fwd);

    // Project the gaze onto the floor; clamp to a sane placing band.
    let t = _fwd.y < -0.05 ? -_head.y / _fwd.y : Infinity;
    if (!isFinite(t)) t = TOWER.placeMax * 2; // looking up: push to max range
    _spot.copy(_head).addScaledVector(_fwd, t);
    _spot.y = 0;
    const dx = _spot.x - _head.x;
    const dz = _spot.z - _head.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const clamped = Math.min(TOWER.placeMax, Math.max(TOWER.placeMin, d));
    _spot.set(_head.x + (dx / d) * clamped, 0, _head.z + (dz / d) * clamped);

    this.ghost.visible = true;
    this.ghostRing.visible = true;
    this.ghost.position.copy(_spot);
    this.ghostRing.position.set(_spot.x, 0.012, _spot.z);
    // Hologram breathing.
    const pulse = 0.35 + 0.15 * Math.sin(this.time * 4);
    (this.ghost.material as MeshBasicMaterial).opacity = pulse;

    // Either trigger plants it.
    for (const hand of [0, 1] as const) {
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = pressed && !this.triggerWas[hand];
      this.triggerWas[hand] = pressed;
      if (down) {
        this.place(_spot);
        return;
      }
    }
  }

  /** Plant the tower and start the fight. Also the dev hook's entry. */
  place(at: Vector3): void {
    tower.pos.copy(at);
    tower.placed = true;
    resetTower();
    run.dead = false;
    app.phase = 'playing';
    this.world.getSystem(EnemySystem)?.startFresh();
    sfx.placeTower();
    dropletBurst(_spot.copy(at).setY(0.4), 16, 1.2);
  }
}
