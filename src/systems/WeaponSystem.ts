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
import { Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { PistolState, WaterPistol } from '../components/WaterPistol.js';
import { EnemySystem } from './EnemySystem.js';
import { createWaterPistol, type WaterPistolRig } from '../weapons/waterPistol.js';
import { requestBlast, squirtBlob, type BlobProfile } from '../combat/juiceBus.js';
import { ballTargets } from '../combat/targets.js';
import { dropletBurst, stampSplat } from '../fx/juice.js';
import { pulseHand } from '../input/haptics.js';
import { heldAimQuat } from '../input/aim.js';
import { claimTank } from '../game/duel.js';
import { activeBoards, menuClick } from '../ui/cardBoard.js';
import { ballDamage, run, UpgradeId } from '../game/run.js';
import { app } from '../game/appState.js';
import { build, sinks } from '../game/shop.js';
import * as sfx from '../audio/sfx.js';
import { AOE, AUTO, HOLSTER, PISTOL, SINK_TANK_BALLS_PER_LEVEL } from '../config.js';
import {
  LOADOUT_SLOT_COUNT,
  LOADOUT_SLOT_POSITIONS,
  ToolId,
  loadout,
  toolById,
  toolByIndex,
  toolIndex,
  type ToolDefinition,
} from '../game/loadout.js';

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
const _curve = new Vector3();
const _aim = new Vector3();
const _worldScale = new Vector3();
const _worldPos = new Vector3();
const _targetPoint = new Vector3();
const _quat = new Quaternion();
const _head = new Vector3();
const _anchor = new Vector3();
const _gripPos = new Vector3();
const _e = new Vector3(); // scratch forward/ground vector
const _near: number[] = [];
const _minusZ = new Vector3(0, 0, -1);
const _blobProfile: BlobProfile = {
  radius: PISTOL.blobRadius,
  gravity: PISTOL.gravity,
  lifetime: PISTOL.lifetime,
  damageScale: 1,
  curve: _curve,
};

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

interface GrenadeState {
  armed: boolean;
  fuse: number;
}

export class WeaponSystem extends createSystem({
  pistols: { required: [WaterPistol] },
}) {
  private rigs = new Map<Entity, WaterPistolRig>();
  private motions = new Map<Entity, HandMotion>();
  private throws = new Map<Entity, ThrowState>();
  private grenadeStates = new Map<Entity, GrenadeState>();
  private shotCooldowns = new Map<Entity, number>();
  /** 1 at the instant of a shot, decayed fast — drives the visual kick. */
  private recoils = new Map<Entity, number>();
  private platformEntities = new Set<Entity>();
  private bossLoadoutActive = false;
  private stationHomes = Array.from({ length: LOADOUT_SLOT_COUNT }, () => new Vector3());
  private stationRotations = Array.from({ length: LOADOUT_SLOT_COUNT }, () => new Quaternion());
  private stationMarkers = new Group();
  private stationRings: Mesh[] = [];
  private squeezeWas: [boolean, boolean] = [false, false];
  /** This frame's squeeze edges, sampled once for BOTH hands up front —
   * the catch check needs the hand a pistol does NOT belong to. */
  private squeezeDownNow: [boolean, boolean] = [false, false];
  /** Which physical hands are holding a pistol this frame. */
  private heldNow: [boolean, boolean] = [false, false];
  /** Trigger edge tracker, so a pull fires on the very same frame. */
  private firingWas: [boolean, boolean] = [false, false];
  private squirting: [boolean, boolean] = [false, false];
  private clicked: [boolean, boolean] = [false, false];
  private time = 0;

  init(): void {
    const raptor = toolById(ToolId.Raptor);
    for (const hand of [0, 1] as const) {
      const rig = createWaterPistol(raptor);
      const e = this.world.createTransformEntity(rig.group, { persistent: true });
      e.addComponent(WaterPistol, {
        hand,
        homeHand: hand,
        tool: toolIndex(raptor.id),
        station: -1,
        state: PistolState.Holstered,
      });
      // Park at a plausible hip until the first head pose arrives.
      rig.group.position.set(hand === 0 ? -HOLSTER.lateral : HOLSTER.lateral, HOLSTER.height, 0);
      this.rigs.set(e, rig);
      this.motions.set(e, new HandMotion());
      this.throws.set(e, new ThrowState());
      this.shotCooldowns.set(e, 0);
    }

    // Six glowing pucks wait just outside the boss octagon. Their colours
    // are updated from the saved spatial loadout whenever a boss starts.
    for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
      const ring = new Mesh(
        new RingGeometry(0.085, 0.135, 24),
        new MeshBasicMaterial({ color: 0x5edbe6, transparent: true, opacity: 0.82, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.018;
      this.stationMarkers.add(ring);
      this.stationRings.push(ring);
    }
    this.stationMarkers.visible = false;
    this.world.scene.add(this.stationMarkers);
  }

  update(delta: number): void {
    this.time += delta;

    // Sample both hands once: squeeze edges and who's holding what. The
    // catch check below wants the OTHER hand's state too.
    for (const h of [0, 1] as const) {
      const hgp = this.input.xr.gamepads[HANDS[h]];
      const sq = hgp?.getButtonPressed(InputComponent.Squeeze) ?? false;
      this.squeezeDownNow[h] = sq && !this.squeezeWas[h];
      this.squeezeWas[h] = sq;
      this.heldNow[h] = false;
    }
    for (const e of this.queries.pistols.entities) {
      if ((e.getValue(WaterPistol, 'state') ?? 0) === PistolState.Held) {
        const heldHand = e.getValue(WaterPistol, 'hand') ?? -1;
        if (heldHand === 0 || heldHand === 1) this.heldNow[heldHand] = true;
      }
    }

    for (const e of this.queries.pistols.entities) {
      const rig = this.rigs.get(e);
      if (!rig) continue;
      const station = e.getValue(WaterPistol, 'station') ?? -1;
      const platformTool = station >= 0;
      if (this.bossLoadoutActive && !platformTool) {
        rig.group.visible = false;
        continue;
      }
      const handValue = e.getValue(WaterPistol, 'hand') ?? -1;
      const hand = (handValue === 1 ? 1 : 0) as Hand;
      const state = e.getValue(WaterPistol, 'state') ?? PistolState.Holstered;
      const def = toolByIndex(e.getValue(WaterPistol, 'tool') ?? 0);

      this.shotCooldowns.set(e, Math.max(0, (this.shotCooldowns.get(e) ?? 0) - delta));
      const grenade = this.grenadeStates.get(e);
      if (grenade?.armed && app.phase === 'playing') {
        grenade.fuse -= delta;
        if (grenade.fuse <= 0) {
          this.detonateGrenade(e, rig, def);
          continue;
        }
      }

      // --- Motion: the tank is what sloshes, so track ITS world point. ---
      rig.tankMarker.getWorldPosition(_tank);
      const motion = this.motions.get(e) ?? new HandMotion();
      this.motions.set(e, motion);
      motion.update(_tank, delta);

      const grip = handValue === 0 || handValue === 1
        ? this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D
        : undefined;
      const gp = handValue === 0 || handValue === 1 ? this.input.xr.gamepads[HANDS[hand]] : undefined;
      const squeezing = handValue === 0 || handValue === 1 ? this.squeezeWas[hand] : false;
      const squeezeDown = handValue === 0 || handValue === 1 ? this.squeezeDownNow[hand] : false;

      switch (state) {
        case PistolState.Holstered: {
          this.holsterPose(rig, hand);
          // Draw: squeeze the grip with your hand at the holster.
          if (squeezeDown && grip) {
            grip.getWorldPosition(_gripPos);
            if (_gripPos.distanceTo(rig.group.position) <= HOLSTER.drawRadius) {
              grip.add(rig.group);
              rig.group.position.set(0, 0, 0);
              // Point the barrel along the platform's AIM axis, not the
              // controller handle — see input/aim.ts.
              heldAimQuat(this.world, hand, rig.group.quaternion);
              e.setValue(WaterPistol, 'state', PistolState.Held);
              sfx.draw();
              pulseHand(this.world.session, HANDS[hand], 0.5, 50);
            }
          }
          break;
        }

        case PistolState.Docked: {
          this.dockPose(rig, station);
          for (const h of [0, 1] as const) {
            if (!this.squeezeDownNow[h] || this.heldNow[h]) continue;
            const dockGrip = this.world.playerSpaceEntities.gripSpaces[HANDS[h]]?.object3D;
            if (!dockGrip) continue;
            dockGrip.getWorldPosition(_gripPos);
            if (_gripPos.distanceTo(rig.group.position) > HOLSTER.drawRadius) continue;
            dockGrip.add(rig.group);
            rig.group.position.set(0, 0, 0);
            heldAimQuat(this.world, h, rig.group.quaternion);
            e.setValue(WaterPistol, 'hand', h);
            e.setValue(WaterPistol, 'state', PistolState.Held);
            this.heldNow[h] = true;
            sfx.draw();
            pulseHand(this.world.session, HANDS[h], 0.55, 55);
            break;
          }
          break;
        }

        case PistolState.Held: {
          if (!squeezing || !grip) {
            this.throwGun(e, rig, hand, motion);
            break;
          }
          this.updateHeld(e, rig, hand, gp, motion, def, delta);
          break;
        }

        case PistolState.Flying: {
          const t = this.throws.get(e) ?? new ThrowState();
          this.throws.set(e, t);
          t.vel.y -= HOLSTER.throwGravity * delta;
          rig.group.position.addScaledVector(t.vel, delta);
          rig.group.rotateOnAxis(t.spinAxis, t.spin * delta);

          if (def.kind === 'grenade' && rig.group.position.y <= 0.085) {
            rig.group.position.y = 0.085;
            if (Math.abs(t.vel.y) > 0.7) sfx.splat(0.45);
            t.vel.y = Math.abs(t.vel.y) * 0.42;
            t.vel.x *= 0.78;
            t.vel.z *= 0.78;
            t.spin *= 0.84;
          }

          // THE CATCH: squeeze any EMPTY hand near a flying gun and it
          // snaps into that palm, ammo intact — snatch your own throw back
          // OR toss a pistol across your body to the other hand. On a
          // cross-catch the two guns trade owners (the spare shifts hips),
          // so each side always has exactly one.
          let caught = false;
          for (const h2 of [0, 1] as const) {
            if (!this.squeezeDownNow[h2] || this.heldNow[h2]) continue;
            const grip2 = this.world.playerSpaceEntities.gripSpaces[HANDS[h2]]?.object3D;
            if (!grip2) continue;
            grip2.getWorldPosition(_gripPos);
            if (_gripPos.distanceTo(rig.group.position) > HOLSTER.catchRadius) continue;
            if (!platformTool && h2 !== hand) this.swapHands(e, hand, h2);
            grip2.add(rig.group);
            rig.group.position.set(0, 0, 0);
            heldAimQuat(this.world, h2, rig.group.quaternion);
            e.setValue(WaterPistol, 'state', PistolState.Held);
            this.heldNow[h2] = true;
            sfx.draw();
            pulseHand(this.world.session, HANDS[h2], 0.7, 70);
            caught = true;
            break;
          }
          if (!caught && def.kind === 'gun') this.checkThrowImpact(e, rig, def);
          break;
        }

        case PistolState.Respawning: {
          const timer = (e.getValue(WaterPistol, 'timer') ?? 0) - delta;
          e.setValue(WaterPistol, 'timer', timer);
          if (timer <= 0) {
            // In a duel a fresh gun fills from your bought RESERVE — out of
            // tanks it arrives with dregs. Elsewhere: always full.
            e.setValue(WaterPistol, 'ammo', platformTool ? 1 : claimTank());
            e.setValue(WaterPistol, 'hand', platformTool ? -1 : e.getValue(WaterPistol, 'homeHand') ?? hand);
            e.setValue(WaterPistol, 'state', platformTool ? PistolState.Docked : PistolState.Holstered);
            const grenadeState = this.grenadeStates.get(e);
            if (grenadeState) {
              grenadeState.armed = false;
              grenadeState.fuse = 0;
            }
            rig.liquid.slosh.reset();
            if (platformTool) this.dockPose(rig, station, true);
            else this.holsterPose(rig, hand, true); // snap — no lerp from the burst site
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
        rig.tankMarker.getWorldScale(_worldScale);
        _axis.set(0, 0, 1).applyQuaternion(_quat);
        const visualScale = Math.max(_worldScale.x, _worldScale.y, _worldScale.z);
        const worldHeight =
          (rig.tankInnerRadius * 2 +
            (rig.tankInnerLength - rig.tankInnerRadius * 2) * Math.abs(_axis.y)) * visualScale;
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
    def: ToolDefinition,
    delta: number,
  ): void {
    // Re-seat the barrel on the aim axis every frame: with hand tracking
    // the grip→ray offset moves with your fingers, and on controllers the
    // ray pose can arrive a frame or two after the draw.
    heldAimQuat(this.world, hand, rig.group.quaternion);

    // RECOIL: the barrel snaps up and the gun tucks into your palm, then
    // eases back over ~0.15 s. Layered on top of the aim re-seat so the
    // kick never fights the aim — it decorates it.
    const recoil = this.recoils.get(e) ?? 0;
    if (recoil > 0.002) {
      rig.group.quaternion.multiply(_quat.setFromAxisAngle(_e.set(1, 0, 0), recoil * def.kick));
      rig.group.position.set(0, 0, recoil * 0.028 * (0.5 + def.kick * 3));
      this.recoils.set(e, recoil * Math.exp(-delta * 11));
    } else if (recoil !== 0) {
      rig.group.position.set(0, 0, 0);
      this.recoils.set(e, 0);
    }

    const pull = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
    const pressed = gp?.getButtonPressed(InputComponent.Trigger) ?? false;
    const firing = pressed || pull > 0.25;
    const firingDown = firing && !this.firingWas[hand];
    this.firingWas[hand] = firing;
    rig.setTriggerPull(Math.max(pull, pressed ? 1 : 0));

    // While a menu is up the trigger CLICKS, and while a ghost is out it
    // PLACES — either way it must not also squirt juice. The click guard
    // covers the frames right after a menu resolves.
    if (app.phase === 'placing' || build.placing || activeBoards.size > 0 || menuClick.cooldown > 0) {
      return;
    }

    if (def.kind === 'grenade') {
      const grenade = this.grenadeStates.get(e) ?? { armed: false, fuse: 0 };
      this.grenadeStates.set(e, grenade);
      if (firingDown && !grenade.armed) {
        grenade.armed = true;
        grenade.fuse = def.fuse ?? 1.7;
        rig.setTriggerPull(1);
        sfx.gooCharge(Math.min(0.8, grenade.fuse));
        pulseHand(this.world.session, HANDS[hand], def.haptic, 80);
      }
      return;
    }

    let ammo = e.getValue(WaterPistol, 'ammo') ?? 1;
    // BIG TANKS levels stretch every tank without touching the visuals —
    // the same full reservoir just holds more shots.
    const drain = 1 / (def.shots + sinks.tanks * SINK_TANK_BALLS_PER_LEVEL);
    // Anything under half a swig is empty: float dust in the tank must not
    // buy a token last squirt that reads as a second, feeble shot.
    const hasShot = ammo >= drain * 0.5;
    const autoStacks = run.stacks[UpgradeId.AutoFire];

    // --- SEMI-AUTO: exactly one ball per trigger press, instantly. ---
    if (firingDown && (this.shotCooldowns.get(e) ?? 0) <= 0) {
      if (hasShot) {
        ammo = Math.max(0, ammo - drain);
        this.fireBlob(e, rig, hand, Math.max(pull, 0.5), motion.vel, def, 1);
        this.shotCooldowns.set(e, 1 / Math.max(0.1, def.fireRate));
        this.shotSound(def);
        this.clicked[hand] = false;
      } else if (!this.clicked[hand]) {
        // DRY: nothing comes out. No dribbled ball, barely any haptic — a
        // spent gun should feel like empty plastic, not a weak shot. NO
        // auto-refill: throwing it and drawing fresh IS the reload.
        ammo = 0;
        sfx.emptyClick();
        pulseHand(this.world.session, HANDS[hand], PISTOL.dryHaptic, PISTOL.dryHapticMs);
        this.clicked[hand] = true;
      }
      e.setValue(WaterPistol, 'emit', 0);
    } else if (firing && (def.automatic || autoStacks > 0) && hasShot) {
      // Wildcat is intrinsically automatic. AUTO SOAKER extends the same
      // hold-to-fire grammar to the other guns without erasing their cadence.
      const baseRate = def.automatic ? def.fireRate : Math.min(def.fireRate, AUTO.rate);
      const rateStacks = def.automatic ? autoStacks : Math.max(0, autoStacks - 1);
      const rate = baseRate * Math.pow(AUTO.ratePerStack, rateStacks);
      let emit = (e.getValue(WaterPistol, 'emit') ?? 0) + rate * delta;
      while (emit >= 1 && ammo >= drain * 0.5) {
        emit -= 1;
        ammo = Math.max(0, ammo - drain);
        this.fireBlob(e, rig, hand, Math.max(pull, 0.5), motion.vel, def, 1);
        // Every auto ball gets its own pitch-wandering voice — the stream
        // BURBLES over the low pump bed instead of hissing.
        this.shotSound(def);
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
    if (!(firing && (def.automatic || autoStacks > 0) && ammo >= drain * 0.5)) this.stopSquirt(hand);

    e.setValue(WaterPistol, 'ammo', ammo);
  }

  /**
   * A cross-catch trades the two pistols' owners: the caught gun joins the
   * catching hand, and the spare (holstered, flying or respawning — never
   * held, or the hand couldn't catch) is re-tagged to the vacated hand, so
   * its next holster pose lands on that hip. Motion is tracked per tool, so
   * a platform hand may throw one weapon and immediately reach for another.
   */
  private swapHands(flying: Entity, from: Hand, to: Hand): void {
    for (const other of this.queries.pistols.entities) {
      if (other === flying) continue;
      if (((other.getValue(WaterPistol, 'hand') ?? 0) as Hand) !== to) continue;
      other.setValue(WaterPistol, 'hand', from);
      other.setValue(WaterPistol, 'homeHand', from);
      break;
    }
    flying.setValue(WaterPistol, 'hand', to);
    flying.setValue(WaterPistol, 'homeHand', to);
  }

  // --- Throw / impact / respawn. ------------------------------------------

  private throwGun(e: Entity, rig: WaterPistolRig, hand: Hand, motion: HandMotion): void {
    // Detach keeping the world pose, then hand it its launch velocity.
    this.world.scene.attach(rig.group);
    const t = this.throws.get(e) ?? new ThrowState();
    this.throws.set(e, t);
    t.vel.copy(motion.vel).multiplyScalar(HOLSTER.throwBoost);
    if (t.vel.length() < HOLSTER.minThrowSpeed) {
      // A limp release still tumbles clear rather than hovering mid-air.
      t.vel.setLength(Math.max(t.vel.length(), 0.4));
      t.vel.y -= 0.5;
    }
    t.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    t.spin = HOLSTER.throwSpin * (0.6 + Math.random() * 0.8);
    e.setValue(WaterPistol, 'state', PistolState.Flying);
    const def = toolByIndex(e.getValue(WaterPistol, 'tool') ?? 0);
    if (def.kind === 'grenade') {
      const grenade = this.grenadeStates.get(e) ?? { armed: false, fuse: 0 };
      if (!grenade.armed) {
        grenade.armed = true;
        grenade.fuse = def.fuse ?? 1.7;
      }
      this.grenadeStates.set(e, grenade);
    }
    rig.setTriggerPull(0);
    this.firingWas[hand] = false;
    this.stopSquirt(hand);
    sfx.throwWhoosh();
    pulseHand(this.world.session, HANDS[hand], 0.6, 60);
  }

  /** Floor or enemy contact for a flying gun. Returns true if it burst. */
  private checkThrowImpact(e: Entity, rig: WaterPistolRig, def: ToolDefinition): boolean {
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
          this.burst(e, rig, pos, ammo, 1.6, def);
          return true;
        }
      }
    }

    // Non-swarm combatants use the shared target registry: most importantly
    // GOOPLIATH, so Splash's signature throw-the-magazine reload remains a
    // real offensive choice in boss fights instead of passing through him.
    for (const target of ballTargets) {
      if (target.hitByHostile || !target.alive()) continue;
      const r = target.radius + HOLSTER.hitRadius;
      if (pos.distanceToSquared(target.pos) > r * r) continue;
      if (!target.onHit(HOLSTER.throwDamage * (0.5 + ammo), pos)) continue;
      this.burst(e, rig, pos, ammo, 1.8, def);
      return true;
    }

    // The floor — the gun shatters into juice the moment it lands.
    if (pos.y <= 0.05) {
      _e.set(pos.x, 0, pos.z);
      stampSplat(_e, 0.22 + ammo * 0.18);
      this.burst(e, rig, pos, ammo, 1.1, def);
      return true;
    }
    return false;
  }

  /** The gun disappears in a juice burst; a fresh one is due on the hip. */
  private burst(
    e: Entity,
    rig: WaterPistolRig,
    pos: Vector3,
    ammo: number,
    punch: number,
    def: ToolDefinition,
  ): void {
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
    e.setValue(WaterPistol, 'timer', (e.getValue(WaterPistol, 'station') ?? -1) >= 0 ? def.respawn : HOLSTER.respawnDelay);
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

  /** Place one saved tool back in its exact octagon socket. */
  private dockPose(rig: WaterPistolRig, station: number, snap = false): void {
    const home = this.stationHomes[station];
    const rotation = this.stationRotations[station];
    if (!home || !rotation) return;
    if (snap) {
      rig.group.position.copy(home);
      rig.group.quaternion.copy(rotation);
    } else {
      rig.group.position.lerp(home, 0.28);
      rig.group.quaternion.slerp(rotation, 0.24);
    }
  }

  /**
   * Swap the two hip Raptors for the player's six spatial loadout tools.
   * CampaignSystem supplies the arena basis so the sockets rotate with the
   * room and stay on the same six sides shown in the editor.
   */
  activateBossLoadout(center: Vector3, forward: Vector3, right: Vector3, padRadius: number): void {
    this.deactivateBossLoadout();
    this.bossLoadoutActive = true;

    // Put both ordinary pistols away even if one was still being held when
    // the previous encounter ended.
    for (const e of this.queries.pistols.entities) {
      if ((e.getValue(WaterPistol, 'station') ?? -1) >= 0) continue;
      const rig = this.rigs.get(e);
      if (!rig) continue;
      this.world.scene.attach(rig.group);
      const homeHand = (e.getValue(WaterPistol, 'homeHand') ?? 0) as Hand;
      e.setValue(WaterPistol, 'hand', homeHand);
      e.setValue(WaterPistol, 'state', PistolState.Holstered);
      rig.group.visible = false;
    }

    for (let slot = 0; slot < LOADOUT_SLOT_COUNT; slot++) {
      const [sx, sz] = LOADOUT_SLOT_POSITIONS[slot];
      const home = this.stationHomes[slot];
      home.copy(center)
        .addScaledVector(right, sx * (padRadius + 0.11))
        .addScaledVector(forward, sz * padRadius)
        .setY(0.78);
      _dir.copy(center).sub(home).setY(0);
      if (_dir.lengthSq() < 1e-4) _dir.copy(forward);
      _dir.normalize();
      this.stationRotations[slot].setFromUnitVectors(_minusZ, _dir);

      const marker = this.stationRings[slot];
      marker.position.set(home.x, 0.018, home.z);
      const def = toolById(loadout.slots[slot]);
      (marker.material as MeshBasicMaterial).color.set(def.color);

      const rig = createWaterPistol(def);
      const e = this.world.createTransformEntity(rig.group, { persistent: true });
      e.addComponent(WaterPistol, {
        hand: -1,
        homeHand: -1,
        tool: toolIndex(def.id),
        station: slot,
        state: PistolState.Docked,
        ammo: 1,
      });
      this.rigs.set(e, rig);
      this.motions.set(e, new HandMotion());
      this.throws.set(e, new ThrowState());
      this.shotCooldowns.set(e, 0);
      if (def.kind === 'grenade') this.grenadeStates.set(e, { armed: false, fuse: 0 });
      this.platformEntities.add(e);
      this.dockPose(rig, slot, true);
    }
    this.stationMarkers.visible = true;
  }

  /** Tear down boss sockets and restore the ordinary left/right hip loop. */
  deactivateBossLoadout(): void {
    const wasActive = this.bossLoadoutActive || this.platformEntities.size > 0;
    this.bossLoadoutActive = false;
    this.stationMarkers.visible = false;

    for (const e of this.platformEntities) {
      const rig = this.rigs.get(e);
      if (rig) this.world.scene.attach(rig.group);
      e.dispose();
      this.rigs.delete(e);
      this.motions.delete(e);
      this.throws.delete(e);
      this.grenadeStates.delete(e);
      this.shotCooldowns.delete(e);
    }
    this.platformEntities.clear();
    if (!wasActive) return;

    for (const e of this.queries.pistols.entities) {
      if ((e.getValue(WaterPistol, 'station') ?? -1) >= 0) continue;
      const rig = this.rigs.get(e);
      if (!rig) continue;
      this.world.scene.attach(rig.group);
      const homeHand = (e.getValue(WaterPistol, 'homeHand') ?? 0) as Hand;
      e.setValue(WaterPistol, 'hand', homeHand);
      e.setValue(WaterPistol, 'state', PistolState.Holstered);
      e.setValue(WaterPistol, 'ammo', 1);
      rig.group.visible = true;
      this.holsterPose(rig, homeHand, true);
    }
  }

  private detonateGrenade(e: Entity, rig: WaterPistolRig, def: ToolDefinition): void {
    rig.group.getWorldPosition(_worldPos);
    this.world.scene.attach(rig.group);
    const radius = def.blastRadius ?? 0.8;
    const damage = ballDamage() * (def.blastDamageScale ?? 2);
    requestBlast(_worldPos, radius, damage, true);

    // Area requests are swarm-owned; the boss and duel hardware live in the
    // shared target registry, so resolve those here at the same blast point.
    for (const target of ballTargets) {
      if (target.hitByHostile || !target.alive()) continue;
      const r = radius + target.radius;
      if (_worldPos.distanceToSquared(target.pos) > r * r) continue;
      _targetPoint.copy(target.pos);
      target.onHit(damage, _targetPoint);
    }

    if (def.id === ToolId.ClusterGrenade) {
      const wildcat = toolById(ToolId.Wildcat);
      const count = def.clusterPellets ?? 16;
      _blobProfile.radius = wildcat.radius;
      _blobProfile.gravity = wildcat.gravity;
      _blobProfile.lifetime = wildcat.lifetime;
      _blobProfile.damageScale = wildcat.damageScale * 1.2;
      _curve.set(0, 0, 0);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (i % 2) * 0.12;
        const speed = 4.6 + (i % 3) * 0.55;
        _spawnVel.set(Math.cos(a) * speed, 0.75 + (i % 4) * 0.34, Math.sin(a) * speed);
        squirtBlob(_worldPos, _spawnVel, _blobProfile);
      }
    }

    stampSplat(_e.set(_worldPos.x, 0, _worldPos.z), radius * 0.62);
    dropletBurst(_worldPos, def.id === ToolId.ClusterGrenade ? 52 : 64, 2.7);
    sfx.juiceBomb();
    const grenade = this.grenadeStates.get(e);
    if (grenade) {
      grenade.armed = false;
      grenade.fuse = 0;
    }
    const handValue = e.getValue(WaterPistol, 'hand') ?? -1;
    if (handValue === 0 || handValue === 1) {
      this.firingWas[handValue] = false;
      this.stopSquirt(handValue);
    }
    rig.group.visible = false;
    e.setValue(WaterPistol, 'state', PistolState.Respawning);
    e.setValue(WaterPistol, 'timer', def.respawn);
  }

  // --- One juice ball. -----------------------------------------------------

  /** Squirt one ball from the nozzle. `power` scales speed (sputter < 1). */
  private fireBlob(
    e: Entity,
    rig: WaterPistolRig,
    hand: Hand,
    pull: number,
    handVel: Vector3,
    def: ToolDefinition,
    power: number,
  ): void {
    rig.nozzle.getWorldPosition(_nozzle);
    rig.nozzle.getWorldDirection(_aim);
    _aim.negate(); // getWorldDirection returns +Z; the muzzle faces -Z

    // The whole cone shares ONE curve, taken from the barrel's true axis —
    // so an Ellipse shotgun banks as a single flock, not a fan of strays.
    _curve.copy(handVel).addScaledVector(_aim, -handVel.dot(_aim));
    if (_curve.length() > 3.2) _curve.setLength(3.2);
    _curve.multiplyScalar(def.curveStrength);
    _blobProfile.radius = def.radius;
    _blobProfile.gravity = def.gravity;
    _blobProfile.lifetime = def.lifetime;
    _blobProfile.damageScale = def.damageScale;

    const pellets = def.pellets ?? 1;
    for (let n = 0; n < pellets; n++) {
      _dir.copy(_aim);
      // Cone spread — a lob, not a laser. Shotgun pellets take the same
      // treatment, just far wider, so the cone opens with distance.
      _dir.x += (Math.random() - 0.5) * 2 * def.spread;
      _dir.y += (Math.random() - 0.5) * 2 * def.spread;
      _dir.z += (Math.random() - 0.5) * 2 * def.spread;
      _dir.normalize();
      // Pellets leave at slightly different speeds so the cloud stretches
      // as it flies instead of travelling as one rigid disc.
      const jitter = pellets > 1 ? 0.88 + Math.random() * 0.24 : 1;
      const speed = def.muzzleSpeed * (0.78 + 0.22 * pull) * power * jitter;
      _spawnVel.copy(_dir).multiplyScalar(speed).addScaledVector(handVel, PISTOL.inheritVel);
      squirtBlob(_nozzle, _spawnVel, _blobProfile);
    }

    // An Ellipse round that actually caught your swing gets its whistle,
    // scaled by how hard it is bending. A straight pull stays silent.
    if (def.curveStrength > 0) sfx.ellipseBend(_curve.length() / 12);

    // The gun kicks: muzzle rise + a pull into the palm, decayed in
    // updateHeld. What makes each trigger pull read as a PROPER shot.
    this.recoils.set(e, 1);

    const ticks = (e.getValue(WaterPistol, 'ticks') ?? 0) + 1;
    if (ticks >= PISTOL.hapticEvery) {
      e.setValue(WaterPistol, 'ticks', 0);
      // A fat ball leaving the barrel should PUNCH — the contrast with the
      // near-silent dry press is what sells "loaded" versus "spent". Bigger
      // tools thump both harder AND longer.
      pulseHand(
        this.world.session,
        HANDS[hand],
        def.haptic * (0.8 + 0.2 * pull),
        Math.round(26 + 38 * def.haptic),
      );
    } else {
      e.setValue(WaterPistol, 'ticks', ticks);
    }
  }

  /** Each family speaks with its own voice — cadence alone isn't identity. */
  private shotSound(def: ToolDefinition): void {
    switch (def.family) {
      case 'wildcat':
        sfx.wildcatShot();
        break;
      case 'viper':
        sfx.viperShot();
        break;
      case 'shotgun':
        sfx.shotgunShot();
        break;
      default:
        sfx.squirtShot();
        break;
    }
  }

  /** Top up every pistol (both hips/hands) — the duel's JUICE purchase. */
  refillAll(fraction = 1): void {
    for (const e of this.queries.pistols.entities) {
      const state = e.getValue(WaterPistol, 'state');
      if (state === PistolState.Flying || state === PistolState.Respawning) continue;
      e.setValue(WaterPistol, 'ammo', Math.max(e.getValue(WaterPistol, 'ammo') ?? 0, fraction));
    }
  }

  private stopSquirt(hand: Hand): void {
    if (this.squirting[hand]) {
      sfx.squirtStop(hand);
      this.squirting[hand] = false;
    }
  }
}
