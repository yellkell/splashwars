/**
 * THE JUICE TOWER — placement, rendering, damage, destruction.
 *
 * PLACEMENT: after you shoot START, a translucent cyan GHOST of the tower
 * glides across your real floor wherever you look ("place the tower in the
 * middle of your play space"). Pull either trigger and it plants: the ghost
 * solidifies, the horn sounds, wave one rolls in.
 *
 * THE TOWER is a water-tower silhouette in the pistols' white/red sports
 * kit: four legs up to a big FROSTED RESERVOIR with a red cap — and inside
 * the reservoir you can SEE the juice. That liquid IS the tower's health,
 * the same unified system as the pistol tanks: THE THIRST hits it and the
 * level visibly drops (they are draining it), the surface sloshing with
 * every strike. Empty tank = TOWER DRAINED = run over. No gauge anywhere.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RingGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clearPlastic, glossyPlastic } from '../materials/plastic.js';
import { createLiquid, type LiquidVisual } from '../materials/liquid.js';
import { app } from '../game/appState.js';
import { resetTower, tower } from '../game/tower.js';
import { run } from '../game/run.js';
import { EnemySystem } from './EnemySystem.js';
import { dropletBurst, stampSplat } from '../fx/juice.js';
import * as sfx from '../audio/sfx.js';
import { PALETTE, TOWER } from '../config.js';

const _fwd = new Vector3();
const _head = new Vector3();
const _spot = new Vector3();
const _tank = new Vector3();
const _still = new Vector3(); // zero accel — the tower doesn't get waved about

const HANDS = ['left', 'right'] as const;

// Reservoir proportions (tower-local; the group sits on the floor).
const TANK_R = 0.3;
const TANK_H = 0.52;
const TANK_Y = 0.88; // centre height of the reservoir

/** The whole silhouette as one merged geometry (for the ghost). */
function towerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (geo: BufferGeometry, x: number, y: number, z: number): void => {
    geo.translate(x, y, z);
    parts.push(geo);
  };
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
    add(new CylinderGeometry(0.028, 0.036, 0.66, 10), lx, 0.33, lz);
  }
  add(new BoxGeometry(0.5, 0.05, 0.5), 0, 0.62, 0);
  add(new CylinderGeometry(TANK_R, TANK_R, TANK_H, 18), 0, TANK_Y, 0);
  add(new ConeGeometry(TANK_R * 1.12, 0.24, 18), 0, TANK_Y + TANK_H / 2 + 0.1, 0);
  return mergeGeometries(parts)!;
}

export class TowerSystem extends createSystem({}) {
  private ghost!: Mesh;
  private ghostRing!: Mesh;
  private real!: Group;
  private liquid!: LiquidVisual;
  private tankMarker!: Object3D;
  private triggerWas: [boolean, boolean] = [false, false];
  private time = 0;
  private wasDestroyed = false;
  private lastHealth = TOWER.maxHealth;

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

    this.real = this.buildTower();
    this.real.visible = false;
    this.world.scene.add(this.real);
  }

  /** The real thing: legs, deck, frosted reservoir with LIVE juice inside. */
  private buildTower(): Group {
    const g = new Group();
    const white = glossyPlastic(PALETTE.sportWhite, 0.2);
    const red = glossyPlastic(PALETTE.sportRed, 0.25);

    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
      const leg = new Mesh(new CylinderGeometry(0.028, 0.036, 0.66, 10), white);
      leg.position.set(lx, 0.33, lz);
      g.add(leg);
      // Red cross-brace feet so the base reads planted.
      const foot = new Mesh(new CylinderGeometry(0.05, 0.06, 0.03, 10), red);
      foot.position.set(lx, 0.015, lz);
      g.add(foot);
    }
    const deck = new Mesh(new BoxGeometry(0.5, 0.05, 0.5), white);
    deck.position.y = 0.62;
    g.add(deck);

    // The reservoir: juice inside, frosted shell outside, red bands + cap.
    const inner = new CylinderGeometry(TANK_R * 0.93, TANK_R * 0.93, TANK_H * 0.97, 18);
    this.liquid = createLiquid(inner, PALETTE.juice, PALETTE.juiceDeep, PALETTE.juiceFoam);
    this.liquid.mesh.position.y = TANK_Y;
    g.add(this.liquid.mesh);

    const shell = new Mesh(new CylinderGeometry(TANK_R, TANK_R, TANK_H, 18), clearPlastic());
    shell.position.y = TANK_Y;
    shell.renderOrder = 2;
    g.add(shell);

    for (const dy of [-TANK_H / 2 + 0.04, TANK_H / 2 - 0.04]) {
      const band = new Mesh(new TorusGeometry(TANK_R + 0.008, 0.016, 10, 24), red);
      band.rotation.x = Math.PI / 2;
      band.position.y = TANK_Y + dy;
      g.add(band);
    }
    const cap = new Mesh(new ConeGeometry(TANK_R * 1.12, 0.24, 18), red);
    cap.position.y = TANK_Y + TANK_H / 2 + 0.1;
    g.add(cap);

    this.tankMarker = new Object3D();
    this.tankMarker.position.y = TANK_Y;
    g.add(this.tankMarker);
    return g;
  }

  update(delta: number): void {
    this.time += delta;

    if (app.phase === 'placing') {
      this.updatePlacing();
    } else {
      this.ghost.visible = false;
      this.ghostRing.visible = false;
    }

    this.real.visible = tower.placed && (app.phase === 'playing' || app.phase === 'gameover');
    if (!this.real.visible) return;

    this.real.position.copy(tower.pos);

    // --- The juice level IS the health. Strikes jolt the surface. ---
    if (tower.health < this.lastHealth) this.liquid.slosh.energy = 1;
    this.lastHealth = tower.health;
    this.tankMarker.getWorldPosition(_tank);
    this.liquid.update(
      this.time,
      delta,
      tower.health / tower.maxHealth,
      _tank,
      TANK_H * 0.97,
      _still,
    );

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
    this.lastHealth = tower.health;
    run.dead = false;
    app.phase = 'playing';
    this.world.getSystem(EnemySystem)?.startFresh();
    sfx.placeTower();
    dropletBurst(_spot.copy(at).setY(0.4), 16, 1.2);
  }
}
