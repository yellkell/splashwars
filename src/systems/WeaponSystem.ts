/**
 * The water pistols — one per hand, and one unified liquid system:
 *
 *  - squeeze the trigger (it's analog — a light squeeze dribbles, a full
 *    pull hoses) and paint blobs stream from the nozzle;
 *  - every blob fired drains the tank, and the tank's visible liquid level
 *    IS the ammo value — no separate gauge anywhere;
 *  - swing the gun and the SloshSim tips the liquid surface, so the paint
 *    surges around the tank exactly as your hand moves (Alyx-style);
 *  - run dry and you get a sad dribble sputter, then plastic clicks;
 *  - ease off for a beat and the tank glugs itself full again.
 *
 * The pistols lazy-attach to the XR grip spaces (they may not exist on the
 * very first frames) and everything else — slosh acceleration, muzzle pose,
 * hand velocity inheritance — is measured in world space from the rig.
 */

import { createSystem, InputComponent, Quaternion, Vector3, type Entity } from '@iwsdk/core';
import { WaterPistol } from '../components/WaterPistol.js';
import { createWaterPistol, type WaterPistolRig } from '../weapons/waterPistol.js';
import { squirtBlob } from '../combat/paintBus.js';
import { pulseHand } from '../input/haptics.js';
import * as sfx from '../audio/sfx.js';
import { PALETTE, PISTOL } from '../config.js';

const HANDS = ['left', 'right'] as const;
type Hand = 0 | 1;

const _tank = new Vector3();
const _nozzle = new Vector3();
const _dir = new Vector3();
const _vel = new Vector3();
const _axis = new Vector3();
const _spawnVel = new Vector3();
const _quat = new Quaternion();

/** Per-hand world-space motion tracking for slosh + throw inheritance. */
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

export class WeaponSystem extends createSystem({
  pistols: { required: [WaterPistol] },
}) {
  private rigs = new Map<Entity, WaterPistolRig>();
  private motion: [HandMotion, HandMotion] = [new HandMotion(), new HandMotion()];
  private attached: [boolean, boolean] = [false, false];
  private squirting: [boolean, boolean] = [false, false];
  private clicked: [boolean, boolean] = [false, false];
  private time = 0;

  init(): void {
    for (const hand of [0, 1] as const) {
      // Mirrored liveries so the pair reads as a set, not a copy-paste.
      const rig = hand === 0
        ? createWaterPistol(PALETTE.toyTeal, PALETTE.toyOrange)
        : createWaterPistol(PALETTE.toyOrange, PALETTE.toyTeal);
      const e = this.world.createTransformEntity(rig.group, { persistent: true });
      e.addComponent(WaterPistol, { hand });
      rig.group.visible = false;
      this.rigs.set(e, rig);
    }
  }

  update(delta: number): void {
    this.time += delta;

    for (const e of this.queries.pistols.entities) {
      const rig = this.rigs.get(e);
      if (!rig) continue;
      const hand = (e.getValue(WaterPistol, 'hand') ?? 0) as Hand;

      // Lazy-attach: parent the pistol under the grip space once it exists.
      const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
      if (!grip) continue;
      if (!this.attached[hand]) {
        grip.add(rig.group);
        rig.group.visible = true;
        this.attached[hand] = true;
      }

      // --- Motion: the tank is what sloshes, so track ITS world point. ---
      rig.tankMarker.getWorldPosition(_tank);
      const motion = this.motion[hand];
      motion.update(_tank, delta);

      // --- Trigger → stream. ---
      const gp = this.input.xr.gamepads[HANDS[hand]];
      const pull = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
      const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
      const firing = pressed || pull > 0.25;
      rig.setTriggerPull(Math.max(pull, pressed ? 1 : 0));

      let ammo = e.getValue(WaterPistol, 'ammo') ?? 1;
      let idle = (e.getValue(WaterPistol, 'idle') ?? 999) + delta;

      if (firing && ammo > 0) {
        idle = 0;
        // Pressure-sensitive cadence: a soft squeeze drips, a crush hoses.
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
        if (this.squirting[hand]) {
          sfx.squirtStop(hand);
          this.squirting[hand] = false;
        }

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

      // --- Drive the liquid: fill level + slosh, all from real motion. ---
      rig.tankMarker.getWorldQuaternion(_quat);
      _axis.set(0, 0, 1).applyQuaternion(_quat);
      const worldHeight =
        rig.tankInnerRadius * 2 +
        (rig.tankInnerLength - rig.tankInnerRadius * 2) * Math.abs(_axis.y);
      rig.liquid.update(this.time, delta, ammo, _tank, worldHeight, motion.accel);
    }
  }

  /** Squirt one blob from the nozzle. `power` scales speed (sputter < 1). */
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

    // Cone spread — a hose, not a laser.
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
      pulseHand(this.world.session, HANDS[hand], 0.25 + 0.2 * pull, 24);
    } else {
      e.setValue(WaterPistol, 'ticks', ticks);
    }
  }
}
