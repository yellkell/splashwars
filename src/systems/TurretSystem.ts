/**
 * The build layer: the wrist watch, the shop, and the turrets.
 *
 * THE WATCH: a small plate riding your left wrist with the DROPS counter on
 * a rolling odometer. It is always there, so the economy is always one
 * glance away — no HUD floating in world space.
 *
 * THE SHOP: press Y (the button on your watch wrist) any time mid-battle
 * and the shop board flips up — the same shoot-to-pick cards as everything
 * else. Cards show live prices; a card you can't afford shakes its juice
 * off with a dead buzz. Buying hands you a turret GHOST that glides across
 * the floor on your gaze, exactly like the tower did; trigger plants it.
 * The fight does not pause. Shopping under pressure is the game.
 *
 * THE TURRETS — your team's kit (white/red), one silhouette each:
 *  - SPRINKLER: tripod + yawing head, auto-lobs juice balls at the nearest
 *    machine in range. Its balls are the SAME balls you fire — one sim.
 *  - CHILLER: a spinning icy ring on a post; everything inside its floor
 *    circle moves at half speed (EnemySystem reads placedTurrets).
 *  - PUMP: a piston station that trickles juice back into the tower.
 */

import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { CardBoard } from '../ui/cardBoard.js';
import { app } from '../game/appState.js';
import { bank, build, placedTurrets, spendDrops } from '../game/shop.js';
import { tower } from '../game/tower.js';
import { EnemySystem } from './EnemySystem.js';
import { squirtBlob } from '../combat/juiceBus.js';
import { dropletBurst } from '../fx/juice.js';
import { glossyPlastic, mattePlastic, wetJuice } from '../materials/plastic.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { PALETTE, SHOP, TOWER, TURRET, TURRET_DEFS, TurretKind, type TurretKindId } from '../config.js';

const HANDS = ['left', 'right'] as const;

const _cam = new Vector3();
const _fwd = new Vector3();
const _spot = new Vector3();
const _muzzle = new Vector3();
const _vel = new Vector3();
const _near: number[] = [];

interface TurretRig {
  kind: TurretKindId;
  group: Group;
  /** Sprinkler: the yawing head; Chiller/Pump: the animated bit. */
  head?: Object3D;
  data: (typeof placedTurrets)[number];
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
        // Cancel a pending placement instead.
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
          if (rig.head) rig.head.position.y = 0.62 + Math.abs(Math.sin(this.time * 3)) * 0.08;
          if (tower.placed && tower.health > 0) {
            tower.health = Math.min(tower.maxHealth, tower.health + TURRET.pump.healPerSec * delta);
          }
          break;
        }
      }
    }
  }

  // --- The shop. -----------------------------------------------------------

  private showShop(): void {
    this.board.show(
      TURRET_DEFS.map((def) => ({
        id: def.id,
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
      })),
      {
        y: SHOP.boardHeight,
        distance: SHOP.boardDistance,
        canPick: (id) => {
          const def = TURRET_DEFS.find((d) => d.id === id)!;
          return bank.drops >= def.cost && placedTurrets.length < SHOP.maxTurrets;
        },
        onPick: (id) => {
          const def = TURRET_DEFS.find((d) => d.id === id)!;
          if (!spendDrops(def.cost)) return;
          sfx.buy();
          build.placing = def.id;
          pulseHand(this.world.session, HANDS[SHOP.toggleHand], 0.4, 60);
        },
      },
    );
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
    this.rigs.push({ kind, group, head: group.userData.head as Object3D | undefined, data });
    build.placing = null;
    this.hideGhost();
    sfx.placeTower();
    dropletBurst(_spot.copy(at).setY(0.3), 10, 0.9);
  }

  private hideGhost(): void {
    if (this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = undefined;
    }
    if (this.ghostRing) {
      this.ghostRing.removeFromParent();
      this.ghostRing = undefined;
    }
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

  // --- Turret bodies (your team's kit: white shells, red trim). ------------

  private buildTurretMesh(kind: TurretKindId, ghost: boolean): Group {
    const g = new Group();
    const white = ghost
      ? new MeshBasicMaterial({ color: PALETTE.water, transparent: true, opacity: 0.4, depthWrite: false })
      : glossyPlastic(PALETTE.sportWhite, 0.2);
    const red = ghost ? white : glossyPlastic(PALETTE.sportRed, 0.25);
    const smoke = ghost ? white : mattePlastic(PALETTE.sportSmoke);

    // Shared tripod base.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new Mesh(new CylinderGeometry(0.02, 0.028, 0.4, 8), white);
      leg.position.set(Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14);
      leg.rotation.z = Math.cos(a) * 0.35;
      leg.rotation.x = -Math.sin(a) * 0.35;
      g.add(leg);
    }
    const hub = new Mesh(new CylinderGeometry(0.09, 0.11, 0.1, 14), red);
    hub.position.y = 0.42;
    g.add(hub);

    if (kind === TurretKind.Sprinkler) {
      const head = new Group();
      head.position.y = 0.5;
      const dome = new Mesh(new SphereGeometry(0.11, 16, 12), white);
      head.add(dome);
      const barrel = new Mesh(new CylinderGeometry(0.028, 0.034, 0.24, 10), white);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.16);
      head.add(barrel);
      const collar = new Mesh(new TorusGeometry(0.035, 0.012, 8, 16), red);
      collar.position.set(0, 0.02, -0.28);
      head.add(collar);
      const tank = new Mesh(new SphereGeometry(0.07, 12, 10), ghost ? white : wetJuice(PALETTE.juice));
      tank.position.set(0, 0.12, 0.03);
      head.add(tank);
      g.add(head);
      g.userData.head = head;
    } else if (kind === TurretKind.Chiller) {
      const post = new Mesh(new CylinderGeometry(0.03, 0.03, 0.3, 10), white);
      post.position.y = 0.6;
      g.add(post);
      const ring = new Group();
      ring.position.y = 0.78;
      const halo = new Mesh(new TorusGeometry(0.16, 0.025, 10, 26), ghost ? white : glossyPlastic(0x9fe8f8, 0.1));
      halo.rotation.x = Math.PI / 2;
      ring.add(halo);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const fin = new Mesh(new ConeGeometry(0.03, 0.1, 6), ghost ? white : glossyPlastic(0x9fe8f8, 0.1));
        fin.position.set(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
        ring.add(fin);
      }
      g.add(ring);
      g.userData.head = ring;
      if (!ghost) {
        // The slow field painted on the floor so its reach is legible.
        const aura = new Mesh(
          new RingGeometry(TURRET.chiller.radius - 0.05, TURRET.chiller.radius, 48),
          new MeshBasicMaterial({ color: 0x9fe8f8, transparent: true, opacity: 0.35 }),
        );
        aura.rotation.x = -Math.PI / 2;
        aura.position.y = 0.015;
        g.add(aura);
      }
    } else {
      // Pump: a barrel with a bobbing piston and a red hand-wheel.
      const barrel = new Mesh(new CylinderGeometry(0.12, 0.14, 0.26, 14), white);
      barrel.position.y = 0.56;
      g.add(barrel);
      const piston = new Mesh(new CylinderGeometry(0.045, 0.045, 0.2, 10), smoke);
      piston.position.y = 0.62;
      g.add(piston);
      g.userData.head = piston;
      const wheel = new Mesh(new TorusGeometry(0.07, 0.016, 8, 18), red);
      wheel.position.set(0.14, 0.56, 0);
      wheel.rotation.y = Math.PI / 2;
      g.add(wheel);
    }
    return g;
  }

  // --- The Sprinkler's brain. ----------------------------------------------

  private updateSprinkler(rig: TurretRig, delta: number, enemies: EnemySystem | undefined): void {
    rig.data.cooldown -= delta;
    const swarm = enemies?.swarm;
    if (!swarm || !rig.head) return;

    // Nearest live machine in range, via the spatial grid.
    swarm.near(rig.group.position.x, rig.group.position.z, TURRET.sprinkler.range, _near);
    let best = -1;
    let bestD2 = TURRET.sprinkler.range * TURRET.sprinkler.range;
    for (let n = 0; n < _near.length; n++) {
      const j = _near[n];
      if (!swarm.alive[j] || swarm.arrive[j] > 0) continue;
      const dx = swarm.px[j] - rig.group.position.x;
      const dz = swarm.pz[j] - rig.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = j;
      }
    }
    if (best < 0) return;

    // Yaw the head onto the target (the -Z barrel convention).
    const dx = swarm.px[best] - rig.group.position.x;
    const dz = swarm.pz[best] - rig.group.position.z;
    rig.head.rotation.y = Math.atan2(-dx, -dz);

    if (rig.data.cooldown > 0) return;
    rig.data.cooldown = 1 / TURRET.sprinkler.rate;

    // Lob a ball with the same arc maths the machines use against you.
    rig.head.getWorldPosition(_muzzle);
    _vel.set(swarm.px[best], swarm.py[best], swarm.pz[best]).sub(_muzzle);
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
    // Lazy-attach to the left wrist once the grip space exists.
    if (!this.watchAttached) {
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[SHOP.toggleHand]]?.object3D;
      if (grip) {
        grip.add(this.watch);
        // Inner-wrist placement: behind the grip, tilted up at the face.
        this.watch.position.set(0, 0.02, 0.1);
        this.watch.rotation.set(-0.9, 0, 0);
        this.watchAttached = true;
      }
    }

    // The rolling odometer: shown chases drops.
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
    // The watch face: smoked glass with a gold droplet readout.
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
