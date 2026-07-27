/**
 * The water pistols — one riding each hip, and one unified liquid system.
 *
 * The pistol lifecycle (PistolState):
 *  - HOLSTERED: the gun rides your hip (an anchor hung off the headset pose,
 *    turning with you). Reach down and SQUEEZE THE GRIP within reach of it
 *    to draw.
 *  - HELD: SEMI-AUTO — one ball per trigger press, on that very frame, no
 *    charge-up. The AUTO SOAKER upgrade turns holding the trigger into full
 *    auto, and stacks crank the cadence. Every ball drains the visible
 *    tank — the liquid IS the ammo — and there is NO auto-refill: run dry
 *    and it clicks. Throwing the spent gun and drawing the fresh one off
 *    your hip IS the reload.
 *  - FLYING: release the grip and the whole gun is THROWN — it tumbles with
 *    your hand's velocity, juice sloshing wildly (the world-space liquid
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
import { EnemySystem } from './EnemySystem.js';
import { createWaterPistol, type WaterPistolRig } from '../weapons/waterPistol.js';
import { requestBlast, squirtBlob } from '../combat/juiceBus.js';
import { dropletBurst, stampSplat } from '../fx/juice.js';
import { pulseHand } from '../input/haptics.js';
import { run, UpgradeId } from '../game/run.js';
import { app } from '../game/appState.js';
import { build, sinks } from '../game/shop.js';
import * as sfx from '../audio/sfx.js';
import { AOE, AUTO, HOLSTER, PISTOL, SINK_TANK_BALLS_PER_LEVEL } from '../config.js';

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
const _e = new Vector3(); // scratch forward/ground vector
const _near: number[] = [];

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
}) {
  private rigs = new Map<Entity, WaterPistolRig>();
  private motion: [HandMotion, HandMotion] = [new HandMotion(), new HandMotion()];
  private throws: [ThrowState, ThrowState] = [new ThrowState(), new ThrowState()];
  private squeezeWas: [boolean, boolean] = [false, false];
  /** Trigger edge tracker, so a pull fires on the very same frame. */
  private firingWas: [boolean, boolean] = [false, false];
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
              // Tip the barrel down out of the grip's nose-up handle axis so
              // the gun aims where your hand feels like it's aiming.
              rig.group.quaternion.setFromAxisAngle(_e.set(1, 0, 0), HOLSTER.heldPitch);
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

          // THE CATCH: squeeze the grip with the gun's own hand while it's
          // in reach and it snaps back into your palm, ammo intact — throw
          // it out, snatch it back, juggle it. Pure style, zero cost.
          if (squeezeDown && grip) {
            grip.getWorldPosition(_gripPos);
            if (_gripPos.distanceTo(rig.group.position) <= HOLSTER.catchRadius) {
              grip.add(rig.group);
              rig.group.position.set(0, 0, 0);
              rig.group.quaternion.setFromAxisAngle(_e.set(1, 0, 0), HOLSTER.heldPitch);
              e.setValue(WaterPistol, 'state', PistolState.Held);
              sfx.draw();
              pulseHand(this.world.session, HANDS[hand], 0.7, 70);
              break;
            }
          }
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

  // --- Held: the firing loop (trigger, drain, sputter). -------------------

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
    const firingDown = firing && !this.firingWas[hand];
    this.firingWas[hand] = firing;
    rig.setTriggerPull(Math.max(pull, pressed ? 1 : 0));

    // While the tower's or a turret's ghost is out, the trigger is the
    // PLACE button — don't also squirt juice over the spot you're choosing.
    if (app.phase === 'placing' || build.placing) return;

    let ammo = e.getValue(WaterPistol, 'ammo') ?? 1;
    // BIG TANKS levels stretch every tank without touching the visuals —
    // the same full reservoir just holds more shots.
    const drain = 1 / (PISTOL.shotsPerTank + sinks.tanks * SINK_TANK_BALLS_PER_LEVEL);
    const autoStacks = run.stacks[UpgradeId.AutoFire];

    // --- SEMI-AUTO: exactly one ball per trigger press, instantly. ---
    if (firingDown) {
      if (ammo > 0) {
        ammo = Math.max(0, ammo - drain);
        this.fireBlob(e, rig, hand, Math.max(pull, 0.5), motion.vel, 1);
        sfx.squirtShot();
        this.clicked[hand] = false;
      } else if (!this.clicked[hand]) {
        // Dry press: one sad dribble, then plastic clicks. NO auto-refill —
        // throwing the spent gun and drawing fresh IS the reload.
        this.fireBlob(e, rig, hand, 0.2, motion.vel, 0.3);
        sfx.emptyClick();
        pulseHand(this.world.session, HANDS[hand], 0.15, 30);
        this.clicked[hand] = true;
      }
      e.setValue(WaterPistol, 'emit', 0);
    } else if (firing && autoStacks > 0 && ammo > 0) {
      // --- AUTO SOAKER: hold to fire; stacks crank the cadence. ---
      const rate = AUTO.rate * Math.pow(AUTO.ratePerStack, autoStacks - 1);
      let emit = (e.getValue(WaterPistol, 'emit') ?? 0) + rate * delta;
      while (emit >= 1 && ammo > 0) {
        emit -= 1;
        ammo = Math.max(0, ammo - drain);
        this.fireBlob(e, rig, hand, Math.max(pull, 0.5), motion.vel, 1);
      }
      e.setValue(WaterPistol, 'emit', emit);
      if (!this.squirting[hand]) {
        sfx.squirtStart(hand);
        this.squirting[hand] = true;
      }
    } else {
      e.setValue(WaterPistol, 'emit', 0);
      this.stopSquirt(hand);
    }
    if (!firing) this.clicked[hand] = false;
    if (!(firing && autoStacks > 0 && ammo > 0)) this.stopSquirt(hand);

    e.setValue(WaterPistol, 'ammo', ammo);
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
    this.firingWas[hand] = false;
    this.stopSquirt(hand);
    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.6, 60);
  }

  /** Floor or enemy contact for a flying gun. Returns true if it burst. */
  private checkThrowImpact(e: Entity, rig: WaterPistolRig): boolean {
    const pos = rig.group.position;
    const ammo = e.getValue(WaterPistol, 'ammo') ?? 0;
    const enemies = this.world.getSystem(EnemySystem);
    const swarm = enemies?.swarm;

    // Enemies first — a direct hit dumps the whole remaining tank on them.
    if (swarm) {
      swarm.near(pos.x, pos.z, HOLSTER.hitRadius + 0.6, _near);
      for (let n = 0; n < _near.length; n++) {
        const j = _near[n];
        if (!swarm.alive[j]) continue;
        const dx = swarm.px[j] - pos.x;
        const dy = swarm.py[j] - pos.y;
        const dz = swarm.pz[j] - pos.z;
        const r = swarm.radius[j] + HOLSTER.hitRadius;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          enemies!.hit(j, HOLSTER.throwDamage * (0.5 + ammo), true);
          this.burst(e, rig, pos, ammo, 1.6);
          return true;
        }
      }
    }

    // The floor — the gun shatters into juice the moment it lands.
    if (pos.y <= 0.05) {
      _e.set(pos.x, 0, pos.z);
      stampSplat(_e, 0.22 + ammo * 0.18);
      this.burst(e, rig, pos, ammo, 1.1);
      return true;
    }
    return false;
  }

  /** The gun disappears in a juice burst; a fresh one is due on the hip. */
  private burst(e: Entity, rig: WaterPistolRig, pos: Vector3, ammo: number, punch: number): void {
    // JUICE BOMB: with the upgrade, a thrown gun detonates in a wave of
    // juice that guts whatever is packed around it.
    const blastStacks = run.stacks[UpgradeId.ThrowBlast];
    if (blastStacks > 0) {
      const radius = AOE.throwRadius + AOE.throwRadiusPerStack * (blastStacks - 1);
      const damage = (AOE.throwDamage + AOE.throwDamagePerStack * (blastStacks - 1)) * (0.6 + ammo * 0.4);
      requestBlast(pos, radius, damage, true);
      dropletBurst(pos, 44, 2.4);
      stampSplat(_e.set(pos.x, 0, pos.z), radius * 0.9);
      sfx.juiceBomb();
    }
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

  // --- One juice ball. -----------------------------------------------------

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
