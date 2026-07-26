/**
 * The water pistols — one riding each hip, and one unified liquid system.
 *
 * The pistol lifecycle (PistolState):
 *  - HOLSTERED: the gun rides your hip (an anchor hung off the headset pose,
 *    turning with you). Reach down and SQUEEZE THE GRIP within reach of it
 *    to draw.
 *  - HELD: squeeze the trigger (it's analog — a light squeeze lobs lazily, a
 *    full pull volleys) and tennis-ball paint orbs arc from the nozzle,
 *    Blaston-slow so anyone downrange could dodge them. Every ball drains
 *    the visible tank — the liquid IS the ammo. Run dry: sputter, clicks.
 *    Ease off a beat: the tank glugs itself full.
 *  - FLYING: release the grip and the whole gun is THROWN — it tumbles with
 *    your hand's velocity, paint sloshing wildly (the world-space liquid
 *    plane keeps working mid-tumble, which sells it).
 *  - The instant it hits the floor or an enemy it BURSTS — dumping its
 *    remaining tank as coverage if it hit a toy — and disappears; a fresh
 *    gun respawns on your hip a beat later (RESPAWNING).
 *
 * Slosh acceleration, muzzle pose and throw velocity are all measured in
 * world space from the tank marker, so the same code drives the liquid in
 * every state — in your hand, on your hip, or spinning through the air.
 */

import { createSystem, InputComponent, Quaternion, Vector3, type Entity } from '@iwsdk/core';
import { PistolState, WaterPistol } from '../components/WaterPistol.js';
import { Enemy } from '../components/Enemy.js';
import { createWaterPistol, type WaterPistolRig } from '../weapons/waterPistol.js';
import { squirtBlob } from '../combat/paintBus.js';
import { dropletBurst, stampSplat } from '../fx/paint.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { HOLSTER, PISTOL } from '../config.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

/** The slice of StatefulGamepad the firing loop needs. */
interface GamepadLike {
  getButtonValue(id: string): number;
  getButtonPressed(id: string): boolean;
}

const _tank = new Vector3();
const _nozzle = new Vector3();
const _dir = new Vector3();
const _vel = new Vector3();
const _axis = new Vector3();
const _spawnVel = new Vector3();
const _quat = new Quaternion();
const _head = new Vector3();
const _anchor = new Vector3();
const _gripPos = new Vector3();
const _enemyPos = new Vector3();
const _e = new Vector3(); // scratch euler-ish forward

/** Per-hand world-space motion tracking for slosh + throw velocity. */
class HandMotion {
  readonly vel = new Vector3();
  readonly accel = new Vector3();
  private readonly prevPos = new Vector3();
  private readonly prevVel = new Vector3();
  private primed = false;

  update(pos: Vector3, dt: number): void {
    if (!this.primed || dt <= 0) {
      this.prevPos.copy(pos);
      this.primed = true;
      return;
    }
    _vel.copy(pos).sub(this.prevPos).divideScalar(dt);
    // Smooth both derivatives — controller pose jitter would otherwise read
    // as constant slosh energy.
    this.vel.lerp(_vel, 0.5);
    this.accel.lerp(_vel.sub(this.prevVel).divideScalar(dt), 0.25);
    this.prevVel.copy(this.vel);
    this.prevPos.copy(pos);
  }
}

/** Constant nose-down tilt for the holstered pose. */
const HOLSTER_TILT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.35);

/** Flight state for a thrown gun (system-side; not worth component fields). */
class ThrowState {
  readonly vel = new Vector3();
  readonly spinAxis = new Vector3(1, 0, 0);
  spin = 0;
}

export class WeaponSystem extends createSystem({
  pistols: { required: [WaterPistol] },
  enemies: { required: [Enemy] },
}) {
  private rigs = new Map<Entity, WaterPistolRig>();
  private motion: [HandMotion, HandMotion] = [new HandMotion(), new HandMotion()];
  private throws: [ThrowState, ThrowState] = [new ThrowState(), new ThrowState()];
  private squeezeWas: [boolean, boolean] = [false, false];
  private squirting: [boolean, boolean] = [false, false];
  private clicked: [boolean, boolean] = [false, false];
  private time = 0;

  init(): void {
    for (const hand of [0, 1] as const) {
      const rig = createWaterPistol();
      const e = this.world.createTransformEntity(rig.group, { persistent: true });
      e.addComponent(WaterPistol, { hand, state: PistolState.Holstered });
      // Park at a plausible hip until the first head pose arrives.
      rig.group.position.set(hand === 0 ? -HOLSTER.lateral : HOLSTER.lateral, HOLSTER.height, 0);
      this.rigs.set(e, rig);
    }
  }

  update(delta: number): void {
    this.time += delta;

    for (const e of this.queries.pistols.entities) {
      const rig = this.rigs.get(e);
      if (!rig) continue;
      const hand = (e.getValue(WaterPistol, 'hand') ?? 0) as Hand;
      const state = e.getValue(WaterPistol, 'state') ?? PistolState.Holstered;

      // --- Motion: the tank is what sloshes, so track ITS world point. ---
      rig.tankMarker.getWorldPosition(_tank);
      const motion = this.motion[hand];
      motion.update(_tank, delta);

      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const squeezing = gp?.getButtonPressed(InputComponent.Squeeze) ?? false;
      const squeezeDown = squeezing && !this.squeezeWas[hand];
      this.squeezeWas[hand] = squeezing;

      switch (state) {
        case PistolState.Holstered: {
          this.holsterPose(rig, hand);
          // Draw: squeeze the grip with your hand at the holster.
          if (squeezeDown && grip) {
            grip.getWorldPosition(_gripPos);
            if (_gripPos.distanceTo(rig.group.position) <= HOLSTER.drawRadius) {
              grip.add(rig.group);
              rig.group.position.set(0, 0, 0);
              rig.group.quaternion.identity();
              e.setValue(WaterPistol, 'state', PistolState.Held);
              sfx.draw();
              pulseHand(this.world.session, HANDS[hand], 0.5, 50);
            }
          }
          break;
        }

        case PistolState.Held: {
          if (!squeezing || !grip) {
            this.throwGun(e, rig, hand, motion);
            break;
          }
          this.updateHeld(e, rig, hand, gp, motion, delta);
          break;
        }

        case PistolState.Flying: {
          const t = this.throws[hand];
          t.vel.y -= HOLSTER.throwGravity * delta;
          rig.group.position.addScaledVector(t.vel, delta);
          rig.group.rotateOnAxis(t.spinAxis, t.spin * delta);
          this.checkThrowImpact(e, rig);
          break;
        }

        case PistolState.Respawning: {
          const timer = (e.getValue(WaterPistol, 'timer') ?? 0) - delta;
          e.setValue(WaterPistol, 'timer', timer);
          if (timer <= 0) {
            e.setValue(WaterPistol, 'ammo', 1);
            e.setValue(WaterPistol, 'state', PistolState.Holstered);
            rig.liquid.slosh.reset();
            this.holsterPose(rig, hand, true); // snap — no lerp from the burst site
            rig.group.visible = true;
            sfx.draw();
          }
          break;
        }
      }

      // --- Drive the liquid in EVERY visible state — hand, hip or air. ---
      if (rig.group.visible) {
        const ammo = e.getValue(WaterPistol, 'ammo') ?? 1;
        rig.tankMarker.getWorldQuaternion(_quat);
        _axis.set(0, 0, 1).applyQuaternion(_quat);
        const worldHeight =
          rig.tankInnerRadius * 2 +
          (rig.tankInnerLength - rig.tankInnerRadius * 2) * Math.abs(_axis.y);
        rig.tankMarker.getWorldPosition(_tank);
        rig.liquid.update(this.time, delta, ammo, _tank, worldHeight, motion.accel);
      }
    }
  }

  // --- Held: the firing loop (trigger, drain, sputter, refill). -----------

  private updateHeld(
    e: Entity,
    rig: WaterPistolRig,
    hand: Hand,
    gp: GamepadLike | undefined,
    motion: HandMotion,
    delta: number,
  ): void {
    const pull = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
    const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
    const firing = pressed || pull > 0.25;
    rig.setTriggerPull(Math.max(pull, pressed ? 1 : 0));

    let ammo = e.getValue(WaterPistol, 'ammo') ?? 1;
    let idle = (e.getValue(WaterPistol, 'idle') ?? 999) + delta;

    if (firing && ammo > 0) {
      idle = 0;
      // Pressure-sensitive cadence: a soft squeeze lobs, a crush volleys.
      const rate = PISTOL.fireRate * (0.45 + 0.55 * Math.max(pull, 0.5));
      let emit = (e.getValue(WaterPistol, 'emit') ?? 0) + rate * delta;
      while (emit >= 1 && ammo > 0) {
        emit -= 1;
        ammo = Math.max(0, ammo - 1 / (PISTOL.capacity * PISTOL.fireRate));
        this.fireBlob(e, rig, hand, Math.max(pull, 0.5), motion.vel, 1);
      }
      e.setValue(WaterPistol, 'emit', emit);
      if (!this.squirting[hand]) {
        sfx.squirtStart(hand);
        this.squirting[hand] = true;
      }
      if (ammo <= 0) {
        // The tank just ran dry mid-squeeze: queue the sad dribble.
        e.setValue(WaterPistol, 'sputter', PISTOL.sputterShots);
      }
    } else {
      e.setValue(WaterPistol, 'emit', 0);
      this.stopSquirt(hand);

      if (firing && ammo <= 0) {
        // Dry trigger: a few weak dribbles, then plastic clicks.
        const sputter = e.getValue(WaterPistol, 'sputter') ?? 0;
        if (sputter > 0 && Math.random() < delta * 9) {
          e.setValue(WaterPistol, 'sputter', sputter - 1);
          this.fireBlob(e, rig, hand, 0.2, motion.vel, 0.3);
        } else if (sputter <= 0 && !this.clicked[hand]) {
          sfx.emptyClick();
          pulseHand(this.world.session, HANDS[hand], 0.15, 30);
          this.clicked[hand] = true;
        }
        idle = 0;
      }

      // --- Refill: ease off for a beat and the pump glugs it full. ---
      if (idle >= PISTOL.refillDelay && ammo < 1) {
        if ((e.getValue(WaterPistol, 'refilling') ?? 0) === 0) {
          e.setValue(WaterPistol, 'refilling', 1);
          sfx.refillGlug();
        }
        ammo = Math.min(1, ammo + PISTOL.refillRate * delta);
        // Refilling churns the tank: feed the slosh a gentle boil.
        rig.liquid.slosh.energy = Math.max(rig.liquid.slosh.energy, 0.35);
        if (ammo >= 1) e.setValue(WaterPistol, 'refilling', 0);
      }
    }
    if (!firing) this.clicked[hand] = false;

    e.setValue(WaterPistol, 'ammo', ammo);
    e.setValue(WaterPistol, 'idle', idle);
  }

  // --- Throw / impact / respawn. ------------------------------------------

  private throwGun(e: Entity, rig: WaterPistolRig, hand: Hand, motion: HandMotion): void {
    // Detach keeping the world pose, then hand it its launch velocity.
    this.world.scene.attach(rig.group);
    const t = this.throws[hand];
    t.vel.copy(motion.vel).multiplyScalar(HOLSTER.throwBoost);
    if (t.vel.length() < HOLSTER.minThrowSpeed) {
      // A limp release still tumbles clear rather than hovering mid-air.
      t.vel.setLength(Math.max(t.vel.length(), 0.4));
      t.vel.y -= 0.5;
    }
    t.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    t.spin = HOLSTER.throwSpin * (0.6 + Math.random() * 0.8);
    e.setValue(WaterPistol, 'state', PistolState.Flying);
    rig.setTriggerPull(0);
    this.stopSquirt(hand);
    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.6, 60);
  }

  /** Floor or enemy contact for a flying gun. Returns true if it burst. */
  private checkThrowImpact(e: Entity, rig: WaterPistolRig): boolean {
    const pos = rig.group.position;
    const ammo = e.getValue(WaterPistol, 'ammo') ?? 0;

    // Enemies first — a direct hit dumps the whole remaining tank.
    for (const enemy of this.queries.enemies.entities) {
      const obj = enemy.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_enemyPos);
      const r = (enemy.getValue(Enemy, 'radius') ?? 0.2) + HOLSTER.hitRadius;
      if (pos.distanceToSquared(_enemyPos) <= r * r) {
        const soak = enemy.getValue(Enemy, 'soak') ?? 1;
        const dumped = (HOLSTER.hitCoverBase + HOLSTER.hitCoverAmmo * ammo) / soak;
        enemy.setValue(Enemy, 'coverage', Math.min(1, (enemy.getValue(Enemy, 'coverage') ?? 0) + dumped));
        this.burst(e, rig, pos, ammo, 1.6);
        return true;
      }
    }

    // The floor — the gun shatters into paint the moment it lands.
    if (pos.y <= 0.05) {
      _e.set(pos.x, 0, pos.z);
      stampSplat(_e, 0.22 + ammo * 0.18);
      this.burst(e, rig, pos, ammo, 1.1);
      return true;
    }
    return false;
  }

  /** The gun disappears in a paint burst; a fresh one is due on the hip. */
  private burst(e: Entity, rig: WaterPistolRig, pos: Vector3, ammo: number, punch: number): void {
    dropletBurst(pos, Math.round(14 + ammo * 22), punch);
    sfx.gunBurst();
    rig.group.visible = false;
    this.world.scene.attach(rig.group); // make sure it's not under a grip
    e.setValue(WaterPistol, 'state', PistolState.Respawning);
    e.setValue(WaterPistol, 'timer', HOLSTER.respawnDelay);
  }

  // --- The hip anchor. -----------------------------------------------------

  /** Pose a holstered gun on its hip: follows the head, turns with you. */
  private holsterPose(rig: WaterPistolRig, hand: Hand, snap = false): void {
    const cam = this.world.camera;
    cam.getWorldPosition(_head);
    // Flatten the head's forward onto the floor for a stable body yaw.
    cam.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1);
    _dir.normalize();
    const side = hand === 0 ? -1 : 1;
    // right = forward × up (for -Z forward this lands on the correct hip).
    _anchor.set(-_dir.z, 0, _dir.x).multiplyScalar(HOLSTER.lateral * side);
    _anchor.addScaledVector(_dir, HOLSTER.forward);
    _anchor.x += _head.x;
    _anchor.z += _head.z;
    _anchor.y = HOLSTER.height;

    // Yaw with the body, nose tipped down like it's sitting in a sheath.
    _quat.setFromUnitVectors(_e.set(0, 0, -1), _dir).multiply(HOLSTER_TILT);
    if (snap) {
      rig.group.position.copy(_anchor);
      rig.group.quaternion.copy(_quat);
    } else {
      // Ease toward the anchor so the holster feels worn, not bolted on.
      rig.group.position.lerp(_anchor, 0.25);
      rig.group.quaternion.slerp(_quat, 0.2);
    }
  }

  // --- One paint ball. -----------------------------------------------------

  /** Squirt one ball from the nozzle. `power` scales speed (sputter < 1). */
  private fireBlob(
    e: Entity,
    rig: WaterPistolRig,
    hand: Hand,
    pull: number,
    handVel: Vector3,
    power: number,
  ): void {
    rig.nozzle.getWorldPosition(_nozzle);
    rig.nozzle.getWorldDirection(_dir);
    _dir.negate(); // getWorldDirection returns +Z; the muzzle faces -Z

    // Cone spread — a lob, not a laser.
    _dir.x += (Math.random() - 0.5) * 2 * PISTOL.spread;
    _dir.y += (Math.random() - 0.5) * 2 * PISTOL.spread;
    _dir.z += (Math.random() - 0.5) * 2 * PISTOL.spread;
    _dir.normalize();

    const speed = PISTOL.muzzleSpeed * (0.78 + 0.22 * pull) * power;
    _spawnVel.copy(_dir).multiplyScalar(speed).addScaledVector(handVel, PISTOL.inheritVel);
    squirtBlob(_nozzle, _spawnVel);

    const ticks = (e.getValue(WaterPistol, 'ticks') ?? 0) + 1;
    if (ticks >= PISTOL.hapticEvery) {
      e.setValue(WaterPistol, 'ticks', 0);
      pulseHand(this.world.session, HANDS[hand], 0.4 + 0.25 * pull, 32);
    } else {
      e.setValue(WaterPistol, 'ticks', ticks);
    }
  }

  private stopSquirt(hand: Hand): void {
    if (this.squirting[hand]) {
      sfx.squirtStop(hand);
      this.squirting[hand] = false;
    }
  }
}
