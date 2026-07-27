/**
 * The build layer: the wrist watch, the shop, and the turrets.
 *
 * THE WATCH: a small plate riding your left wrist with the DROPS counter on
 * a rolling odometer (and the OVERDRIVE countdown when it's running). It is
 * always there, so the economy is always one glance away — no floating HUD.
 *
 * THE SHOP: press Y (the button on your watch wrist) any time mid-battle
 * and the shop board flips up — a 3×2 grid of the same shoot-to-pick cards
 * as everything else. Top row: turrets. Bottom row: STAT SINKS — POWER,
 * BIG TANKS and RESERVOIR levels you can buy again and again, each level
 * pricier than the last, so late-run money always has somewhere to go and
 * every purchase is a permanent base-stat bump. A card you can't afford shakes its
 * juice off with a dead buzz. Buying a turret hands you a ghost that glides
 * on your gaze; trigger plants it. The fight does not pause.
 *
 * PERFORMANCE: turrets are built from MODULE-CACHED geometry and materials —
 * every static part of a turret kind is pre-merged into two meshes (shell +
 * accent) shared by all instances of that kind, materials are plain
 * MeshStandard (no clearcoat) and shared globally. Eight turrets cost
 * ~5 draw calls each with zero per-placement allocation or shader compiles,
 * where the first build spawned ~12 meshes with fresh clearcoat materials
 * per turret and sank the frame rate at max field.
 *
 * TARGETING: a Sprinkler KEEPS its target until it dies or leaves range
 * (no flickering between equidistant machines), slews its head onto it at a
 * finite turn rate, and only fires once roughly aligned — acquire, track,
 * shoot, like real hardware.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  BufferGeometry,
  CanvasTexture,
  Euler,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CardBoard } from '../ui/cardBoard.js';
import { app } from '../game/appState.js';
import { bank, build, placedTurrets, sinkCost, sinks, spendDrops } from '../game/shop.js';
import { tower } from '../game/tower.js';
import { EnemySystem } from './EnemySystem.js';
import { squirtBlob } from '../combat/juiceBus.js';
import { dropletBurst } from '../fx/juice.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import {
  PALETTE,
  SHOP,
  SINK_DEFS,
  SINK_RESERVOIR_PER_LEVEL,
  TOWER,
  TURRET,
  TURRET_DEFS,
  TurretKind,
  type TurretKindId,
} from '../config.js';

const HANDS = ['left', 'right'] as const;

const _cam = new Vector3();
const _fwd = new Vector3();
const _spot = new Vector3();
const _muzzle = new Vector3();
const _vel = new Vector3();
const _near: number[] = [];

// ---------------------------------------------------------------------------
// Shared turret assets — built once, used by every placement and ghost.
// ---------------------------------------------------------------------------

function bake(geo: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): BufferGeometry {
  return geo.applyMatrix4(
    new Matrix4().compose(
      new Vector3(x, y, z),
      new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
      new Vector3(sx, sy, sz),
    ),
  );
}

interface TurretAssets {
  /** Static shell parts, pre-merged (competition white). */
  shell: BufferGeometry;
  /** Static accent parts, pre-merged (racing red / ice). */
  accent: BufferGeometry;
  /** Head parts for the animated bit, pre-merged per material. */
  headShell?: BufferGeometry;
  headAccent?: BufferGeometry;
  headY: number;
}

let assets: Record<TurretKindId, TurretAssets> | undefined;
let matWhite: MeshStandardMaterial;
let matRed: MeshStandardMaterial;
let matIce: MeshStandardMaterial;
let matGhost: MeshBasicMaterial;
let auraGeo: RingGeometry;

function tripodBase(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(
      bake(new CylinderGeometry(0.02, 0.028, 0.4, 8), Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14, 1, 1, 1, -Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35),
    );
  }
  return parts;
}

function buildAssets(): Record<TurretKindId, TurretAssets> {
  matWhite = new MeshStandardMaterial({ color: PALETTE.sportWhite, roughness: 0.25, metalness: 0 });
  matRed = new MeshStandardMaterial({ color: PALETTE.sportRed, roughness: 0.3, metalness: 0 });
  matIce = new MeshStandardMaterial({ color: 0x9fe8f8, roughness: 0.15, metalness: 0 });
  matGhost = new MeshBasicMaterial({ color: PALETTE.water, transparent: true, opacity: 0.4, depthWrite: false });
  auraGeo = new RingGeometry(TURRET.chiller.radius - 0.05, TURRET.chiller.radius, 48);
  auraGeo.rotateX(-Math.PI / 2);

  return {
    [TurretKind.Sprinkler]: {
      shell: mergeGeometries(tripodBase())!,
      accent: bake(new CylinderGeometry(0.09, 0.11, 0.1, 14), 0, 0.42, 0),
      // The yawing head: dome + barrel in white, collar + tank cap in red.
      headShell: mergeGeometries([
        bake(new SphereGeometry(0.11, 16, 12), 0, 0, 0),
        bake(new CylinderGeometry(0.028, 0.034, 0.24, 10), 0, 0.02, -0.16, 1, 1, 1, Math.PI / 2, 0, 0),
      ])!,
      headAccent: mergeGeometries([
        bake(new TorusGeometry(0.035, 0.012, 8, 16), 0, 0.02, -0.28),
        bake(new SphereGeometry(0.07, 12, 10), 0, 0.12, 0.03),
      ])!,
      headY: 0.5,
    },
    [TurretKind.Chiller]: {
      shell: mergeGeometries([...tripodBase(), bake(new CylinderGeometry(0.03, 0.03, 0.3, 10), 0, 0.6, 0)])!,
      accent: bake(new CylinderGeometry(0.09, 0.11, 0.1, 14), 0, 0.42, 0),
      // The spinning halo with its fins, all ice.
      headAccent: mergeGeometries([
        bake(new TorusGeometry(0.16, 0.025, 10, 26), 0, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0),
        ...[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2;
          return bake(new ConeGeometry(0.03, 0.1, 6), Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
        }),
      ])!,
      headY: 0.78,
    },
    [TurretKind.Pump]: {
      shell: mergeGeometries([...tripodBase(), bake(new CylinderGeometry(0.12, 0.14, 0.26, 14), 0, 0.56, 0)])!,
      accent: mergeGeometries([
        bake(new CylinderGeometry(0.09, 0.11, 0.1, 14), 0, 0.42, 0),
        bake(new TorusGeometry(0.07, 0.016, 8, 18), 0.14, 0.56, 0, 1, 1, 1, 0, Math.PI / 2, 0),
      ])!,
      // The bobbing piston.
      headShell: bake(new CylinderGeometry(0.045, 0.045, 0.2, 10), 0, 0, 0),
      headY: 0.62,
    },
  };
}

interface TurretRig {
  kind: TurretKindId;
  group: Group;
  head?: Object3D;
  data: (typeof placedTurrets)[number];
  /** Sprinkler: the swarm slot it is locked onto (-1 = none). */
  target: number;
}

export class TurretSystem extends createSystem({}) {
  private board!: CardBoard;
  private watch!: Mesh;
  private watchCanvas!: HTMLCanvasElement;
  private watchTex!: CanvasTexture;
  private watchAttached = false;
  private lastWatchValue = -1;
  private toggleWas = false;
  private lastPlacingShown: string | null = null;
  private triggerWas: [boolean, boolean] = [false, false];
  private rigs: TurretRig[] = [];
  private ghost?: Group;
  private ghostRing?: Mesh;
  private time = 0;

  init(): void {
    this.board = new CardBoard(this.world.scene);
    this.buildWatch();
    if (!assets) assets = buildAssets();
  }

  update(delta: number): void {
    this.time += delta;
    this.world.camera.getWorldPosition(_cam);
    this.board.update(delta, _cam);

    this.updateWatch(delta);

    // Run resets (new game) clear the field.
    if (app.phase !== 'playing' && app.phase !== 'gameover') {
      if (this.rigs.length > 0) this.clearField();
      if (this.board.active) this.board.hide();
      this.hideGhost();
      build.placing = null;
    }
    if (app.phase !== 'playing') return;

    // --- Y on the watch wrist toggles the shop. ---
    const gp = this.input.xr.gamepads[HANDS[SHOP.toggleHand]];
    const toggle =
      (gp?.getButtonPressed(InputComponent.Y_Button) ?? false) ||
      (gp?.getButtonPressed(InputComponent.X_Button) ?? false);
    if (toggle && !this.toggleWas) {
      if (build.placing) {
        build.placing = null;
        this.hideGhost();
        sfx.shopToggle(false);
      } else if (this.board.active) {
        this.board.hide();
        sfx.shopToggle(false);
      } else {
        this.showShop();
        sfx.shopToggle(true);
      }
    }
    this.toggleWas = toggle;

    if (build.placing) this.updatePlacing(build.placing);

    // --- Drive the standing turrets. ---
    const enemies = this.world.getSystem(EnemySystem);
    for (const rig of this.rigs) {
      switch (rig.kind) {
        case TurretKind.Sprinkler:
          this.updateSprinkler(rig, delta, enemies);
          break;
        case TurretKind.Chiller:
          if (rig.head) rig.head.rotation.y += delta * 2.4;
          break;
        case TurretKind.Pump: {
          if (rig.head) rig.head.position.y = assets![TurretKind.Pump].headY + Math.abs(Math.sin(this.time * 3)) * 0.08;
          if (tower.placed && tower.health > 0) {
            tower.health = Math.min(tower.maxHealth, tower.health + TURRET.pump.healPerSec * delta);
          }
          break;
        }
      }
    }
  }

  // --- The shop: turrets on top, consumables below. ------------------------

  private showShop(): void {
    const turretCards = TURRET_DEFS.map((def) => ({
      id: def.id as string,
      title: def.name,
      blurb: def.blurb,
      effectLine: `${def.cost} DROPS`,
      footnote:
        placedTurrets.length >= SHOP.maxTurrets
          ? 'FIELD FULL'
          : bank.drops < def.cost
            ? `need ${def.cost - bank.drops} more`
            : undefined,
      color: def.color,
      scale: 0.85,
    }));
    // Bottom row: the stat sinks — buy forever, price climbs per level.
    const sinkCards = SINK_DEFS.map((def) => {
      const level = sinks[def.id];
      const cost = sinkCost(def.baseCost, level);
      return {
        id: def.id as string,
        title: def.name,
        blurb: def.blurb,
        effectLine: `${cost} DROPS`,
        footnote:
          level > 0
            ? `LV ${level}${bank.drops < cost ? ` · need ${cost - bank.drops} more` : ''}`
            : bank.drops < cost
              ? `need ${cost - bank.drops} more`
              : undefined,
        color: def.color,
        scale: 0.85,
      };
    });

    this.board.show([...turretCards, ...sinkCards], {
      y: SHOP.boardHeight,
      distance: SHOP.boardDistance,
      perRow: 3,
      canPick: (id) => {
        const turret = TURRET_DEFS.find((d) => d.id === id);
        if (turret) return bank.drops >= turret.cost && placedTurrets.length < SHOP.maxTurrets;
        const def = SINK_DEFS.find((d) => d.id === id)!;
        return bank.drops >= sinkCost(def.baseCost, sinks[def.id]);
      },
      onPick: (id) => this.purchase(id),
    });
  }

  /** Buy by id — shop cards land here; public for the dev hooks. */
  purchase(id: string): void {
    const turret = TURRET_DEFS.find((d) => d.id === id);
    if (turret) {
      if (!spendDrops(turret.cost)) return;
      sfx.buy();
      build.placing = turret.id;
      pulseHand(this.world.session, HANDS[SHOP.toggleHand], 0.4, 60);
      return;
    }
    const def = SINK_DEFS.find((d) => d.id === id)!;
    if (!spendDrops(sinkCost(def.baseCost, sinks[def.id]))) return;
    sfx.buy();
    sinks[def.id] += 1;
    if (def.id === 'reservoir') {
      // The new capacity arrives FULL — the level visibly rises.
      tower.maxHealth += SINK_RESERVOIR_PER_LEVEL;
      tower.health = Math.min(tower.maxHealth, tower.health + SINK_RESERVOIR_PER_LEVEL);
      sfx.refund();
    }
  }

  // --- Placement (the same gaze-ghost ritual as the tower). ----------------

  private updatePlacing(kind: TurretKindId): void {
    if (!this.ghost) {
      this.ghost = this.buildTurretMesh(kind, true);
      this.ghostRing = new Mesh(
        new RingGeometry(0.28, 0.36, 32),
        new MeshBasicMaterial({ color: PALETTE.water, transparent: true, opacity: 0.7 }),
      );
      this.ghostRing.rotation.x = -Math.PI / 2;
      this.world.scene.add(this.ghost, this.ghostRing);
    }
    const cam = this.world.camera;
    cam.getWorldPosition(_cam);
    cam.getWorldDirection(_fwd);
    let t = _fwd.y < -0.05 ? -_cam.y / _fwd.y : Infinity;
    if (!isFinite(t)) t = TOWER.placeMax * 2;
    _spot.copy(_cam).addScaledVector(_fwd, t);
    _spot.y = 0;
    const dx = _spot.x - _cam.x;
    const dz = _spot.z - _cam.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const clamped = Math.min(TOWER.placeMax, Math.max(TOWER.placeMin, d));
    _spot.set(_cam.x + (dx / d) * clamped, 0, _cam.z + (dz / d) * clamped);

    this.ghost.position.copy(_spot);
    this.ghostRing!.position.set(_spot.x, 0.012, _spot.z);

    for (const hand of [0, 1] as const) {
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const down = pressed && !this.triggerWas[hand];
      this.triggerWas[hand] = pressed;
      if (down) {
        this.placeTurret(kind, _spot);
        return;
      }
    }
  }

  /** Plant a bought turret. Public for the dev hooks. */
  placeTurret(kind: TurretKindId, at: Vector3): void {
    const data = { kind, pos: at.clone(), cooldown: 0 };
    placedTurrets.push(data);
    const group = this.buildTurretMesh(kind, false);
    group.position.copy(at);
    this.world.scene.add(group);
    this.rigs.push({ kind, group, head: group.userData.head as Object3D | undefined, data, target: -1 });
    build.placing = null;
    this.hideGhost();
    sfx.placeTower();
    dropletBurst(_spot.copy(at).setY(0.3), 10, 0.9);
  }

  private hideGhost(): void {
    this.ghost?.removeFromParent();
    this.ghost = undefined;
    this.ghostRing?.removeFromParent();
    this.ghostRing = undefined;
  }

  /** Wipe every standing turret (new run). */
  resetField(): void {
    this.clearField();
    this.hideGhost();
    build.placing = null;
    if (this.board.active) this.board.hide();
  }

  private clearField(): void {
    for (const rig of this.rigs) rig.group.removeFromParent();
    this.rigs.length = 0;
    placedTurrets.length = 0;
  }

  // --- Turret bodies, assembled from the shared cached assets. -------------

  private buildTurretMesh(kind: TurretKindId, ghost: boolean): Group {
    const a = assets![kind];
    const g = new Group();
    g.add(new Mesh(a.shell, ghost ? matGhost : matWhite));
    g.add(new Mesh(a.accent, ghost ? matGhost : kind === TurretKind.Chiller ? matIce : matRed));

    const head = new Group();
    head.position.y = a.headY;
    if (a.headShell) head.add(new Mesh(a.headShell, ghost ? matGhost : matWhite));
    if (a.headAccent) {
      head.add(
        new Mesh(a.headAccent, ghost ? matGhost : kind === TurretKind.Sprinkler ? matRed : matIce),
      );
    }
    g.add(head);
    g.userData.head = head;

    if (kind === TurretKind.Chiller && !ghost) {
      // The slow field painted on the floor so its reach is legible.
      const aura = new Mesh(auraGeo, new MeshBasicMaterial({ color: 0x9fe8f8, transparent: true, opacity: 0.35 }));
      aura.position.y = 0.015;
      g.add(aura);
    }
    return g;
  }

  // --- The Sprinkler's brain: acquire, slew, fire when aligned. ------------

  private updateSprinkler(rig: TurretRig, delta: number, enemies: EnemySystem | undefined): void {
    rig.data.cooldown -= delta;
    const swarm = enemies?.swarm;
    if (!swarm || !rig.head) return;

    const px = rig.group.position.x;
    const pz = rig.group.position.z;
    const range2 = TURRET.sprinkler.range * TURRET.sprinkler.range;

    // Keep the locked target while it lives and stays in range — no
    // flicking between equidistant machines mid-burst.
    if (rig.target >= 0) {
      const j = rig.target;
      const dx = swarm.px[j] - px;
      const dz = swarm.pz[j] - pz;
      if (!swarm.alive[j] || dx * dx + dz * dz > range2 * 1.15) rig.target = -1;
    }
    if (rig.target < 0) {
      swarm.near(px, pz, TURRET.sprinkler.range, _near);
      let bestD2 = range2;
      for (let n = 0; n < _near.length; n++) {
        const j = _near[n];
        if (!swarm.alive[j] || swarm.arrive[j] > 0) continue;
        const dx = swarm.px[j] - px;
        const dz = swarm.pz[j] - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          rig.target = j;
        }
      }
    }
    if (rig.target < 0) return;

    // Slew the head onto the target at a finite turn rate; hold fire until
    // the barrel is actually pointing at it.
    const dx = swarm.px[rig.target] - px;
    const dz = swarm.pz[rig.target] - pz;
    const desired = Math.atan2(-dx, -dz);
    let dyaw = desired - rig.head.rotation.y;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    rig.head.rotation.y += dyaw * Math.min(1, delta * 7);
    const aligned = Math.abs(dyaw) < 0.22;

    if (!aligned || rig.data.cooldown > 0) return;
    rig.data.cooldown = 1 / TURRET.sprinkler.rate;

    // Lob a ball with the same arc maths the machines use against you.
    rig.head.getWorldPosition(_muzzle);
    _vel.set(swarm.px[rig.target], swarm.py[rig.target], swarm.pz[rig.target]).sub(_muzzle);
    const dist = _vel.length();
    _vel.normalize().multiplyScalar(TURRET.sprinkler.muzzleSpeed);
    _vel.y += (2.0 * dist) / (2 * TURRET.sprinkler.muzzleSpeed);
    squirtBlob(_muzzle, _vel);
    sfx.turretShot();
  }

  // --- The watch. ----------------------------------------------------------

  private buildWatch(): void {
    this.watchCanvas = document.createElement('canvas');
    this.watchCanvas.width = 320;
    this.watchCanvas.height = 160;
    this.watchTex = new CanvasTexture(this.watchCanvas);
    this.watchTex.minFilter = LinearFilter;
    this.watch = new Mesh(
      new PlaneGeometry(0.085, 0.0425),
      new MeshBasicMaterial({ map: this.watchTex, transparent: true, depthTest: false }),
    );
    this.watch.renderOrder = 900;
    this.drawWatch(0);
  }

  private updateWatch(delta: number): void {
    if (!this.watchAttached) {
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[SHOP.toggleHand]]?.object3D;
      if (grip) {
        grip.add(this.watch);
        this.watch.position.set(0, 0.02, 0.1);
        this.watch.rotation.set(-0.9, 0, 0);
        this.watchAttached = true;
      }
    }

    bank.shown += (bank.drops - bank.shown) * Math.min(1, delta * 6);
    if (Math.abs(bank.drops - bank.shown) < 0.6) bank.shown = bank.drops;
    const display = Math.round(bank.shown);
    if (display !== this.lastWatchValue || build.placing !== this.lastPlacingShown) {
      this.lastWatchValue = display;
      this.lastPlacingShown = build.placing;
      this.drawWatch(display);
    }
  }

  private drawWatch(value: number): void {
    const ctx = this.watchCanvas.getContext('2d')!;
    const W = this.watchCanvas.width;
    const H = this.watchCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(20,26,34,0.85)';
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 34);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#e0312e';
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.font = '900 74px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(value), W - 36, H / 2 - 14);
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb0ba';
    ctx.fillText('DROPS', 30, H / 2 - 18);
    ctx.fillText(build.placing ? 'Y: CANCEL' : 'Y: SHOP', 30, H - 40);
    this.watchTex.needsUpdate = true;
  }
}
