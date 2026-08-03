/**
 * The water pistol — SPLASH WARS' first weapon, built entirely from
 * primitives so it ships with zero assets. The look is SLEEK SPORTS KIT:
 * competition-white moulded shell with racing-red accents — red stripes down
 * the flanks, red trigger and guard, red nozzle collar — and smoked details,
 * like juiceball gear designed by a running-shoe brand. The hero piece is
 * still the clear blow-moulded tank on top with the juice VISIBLY sloshing
 * inside (materials/liquid.ts).
 *
 * Local frame matches the XR grip space: -Z is forward, origin sits inside
 * the handle, so parenting the group straight under a grip entity puts the
 * gun in your hand pointing where you point. When holstered or thrown the
 * same group just lives under the scene instead.
 */

import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
} from 'three';
import { PALETTE } from '../config.js';
import { clearPlastic, glossyPlastic, mattePlastic } from '../materials/plastic.js';
import { createLiquid, type LiquidVisual } from '../materials/liquid.js';
import { ToolId, toolById, type ToolDefinition } from '../game/loadout.js';

export interface WaterPistolRig {
  group: Group;
  liquid: LiquidVisual;
  /** Sits at the tank's centre — read its world position every frame. */
  tankMarker: Object3D;
  /** Interior capsule dimensions, for the world-height estimate. */
  tankInnerRadius: number;
  tankInnerLength: number;
  /** Sits at the muzzle, -Z pointing out of the nozzle. */
  nozzle: Object3D;
  /** Animate the squeeze: 0 = relaxed, 1 = fully pulled. */
  setTriggerPull(v: number): void;
  dispose(): void;
}

/** Z-axis cylinder helper (three's cylinders run along Y). */
function zCyl(rTop: number, rBottom: number, len: number, seg = 20): CylinderGeometry {
  const geo = new CylinderGeometry(rTop, rBottom, len, seg);
  geo.rotateX(Math.PI / 2);
  return geo;
}

export function createWaterPistol(def: ToolDefinition = toolById(ToolId.Raptor)): WaterPistolRig {
  if (def.kind === 'grenade') return createPaintGrenade(def);

  const group = new Group();
  group.name = `tool-${def.id}`;

  const shellMat = glossyPlastic(PALETTE.sportWhite, 0.16); // slick, near-wet
  const accentMat = glossyPlastic(def.color, 0.22);
  const smokeMat = mattePlastic(PALETTE.sportSmoke);

  // --- Handle: slim raked grip, white shell with a smoked palm inlay. ---
  const grip = new Mesh(new BoxGeometry(0.03, 0.1, 0.044), shellMat);
  grip.position.set(0, -0.012, 0.012);
  grip.rotation.x = -0.34;
  group.add(grip);
  const gripInlay = new Mesh(new BoxGeometry(0.032, 0.06, 0.024), smokeMat);
  gripInlay.position.set(0, -0.02, 0.018);
  gripInlay.rotation.x = -0.34;
  group.add(gripInlay);
  const gripHeel = new Mesh(new SphereGeometry(0.022, 14, 12), accentMat);
  gripHeel.scale.set(0.7, 0.5, 1);
  gripHeel.position.set(0, -0.062, 0.03);
  group.add(gripHeel);

  // --- Body: a slim streamlined receiver, capsule-nosed. ---
  const body = new Mesh(new BoxGeometry(0.042, 0.06, 0.16), shellMat);
  body.position.set(0, 0.05, -0.05);
  group.add(body);
  const nose = new Mesh(new SphereGeometry(0.029, 16, 12), shellMat);
  nose.scale.set(0.72, 1.02, 1.15);
  nose.position.set(0, 0.05, -0.13);
  group.add(nose);
  const tail = new Mesh(new SphereGeometry(0.03, 16, 12), shellMat);
  tail.scale.set(0.7, 1, 0.75);
  tail.position.set(0, 0.05, 0.03);
  group.add(tail);

  // Racing stripes down both flanks — the sports livery in one stroke.
  for (const side of [-1, 1]) {
    const stripe = new Mesh(new BoxGeometry(0.0022, 0.016, 0.155), accentMat);
    stripe.position.set(side * 0.0215, 0.058, -0.05);
    group.add(stripe);
  }
  // --- Barrel + nozzle: long, tapered, red collar at the muzzle. ---
  const barrel = new Mesh(zCyl(0.013, 0.017, 0.13), shellMat);
  barrel.position.set(0, 0.054, -0.195);
  group.add(barrel);
  const collar = new Mesh(new TorusGeometry(0.015, 0.005, 12, 20), accentMat);
  collar.position.set(0, 0.054, -0.255);
  group.add(collar);
  const nozzleTip = new Mesh(new ConeGeometry(0.011, 0.028, 16), smokeMat);
  nozzleTip.rotation.x = -Math.PI / 2;
  nozzleTip.position.set(0, 0.054, -0.266);
  group.add(nozzleTip);

  // The muzzle anchor balls spawn from, -Z pointing down-range.
  const nozzle = new Object3D();
  nozzle.position.set(0, 0.054, -0.282);
  group.add(nozzle);

  // --- Underslung rail: a slim smoked chin line, keeps the profile sporty. ---
  const rail = new Mesh(zCyl(0.006, 0.006, 0.1, 12), smokeMat);
  rail.position.set(0, 0.016, -0.16);
  group.add(rail);

  // --- Trigger on a pivot, red, inside a slim red guard. ---
  const triggerPivot = new Object3D();
  triggerPivot.position.set(0, 0.028, -0.062);
  group.add(triggerPivot);
  const trigger = new Mesh(new BoxGeometry(0.012, 0.04, 0.01), accentMat);
  trigger.position.set(0, -0.023, 0.004);
  trigger.rotation.x = 0.18;
  triggerPivot.add(trigger);
  // The guard's half-ring is sized so BOTH ends bury into the receiver's
  // underside (body bottom is y 0.02) — a smaller ring left its ends
  // hanging in mid-air below the gun.
  const guard = new Mesh(new TorusGeometry(0.042, 0.0042, 10, 22, Math.PI), accentMat);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, 0.022, -0.058);
  group.add(guard);

  // --- THE TANK: clear shell on top, juice sloshing inside. ---
  const tankR = 0.034;
  const tankLen = 0.1;
  const innerR = 0.031;
  const innerLen = 0.096;
  const tankGroup = new Group();
  tankGroup.position.set(0, 0.118, -0.05);
  group.add(tankGroup);

  // The juice: a shrunk interior capsule wearing the clipped-liquid shader.
  const interior = new CapsuleGeometry(innerR, innerLen, 6, 18);
  interior.rotateX(Math.PI / 2);
  const liquid = createLiquid(interior, PALETTE.juice, PALETTE.juiceDeep, PALETTE.juiceFoam);
  tankGroup.add(liquid.mesh);

  // The clear blow-moulded shell over it.
  const shellGeo = new CapsuleGeometry(tankR, tankLen, 6, 20);
  shellGeo.rotateX(Math.PI / 2);
  const shell = new Mesh(shellGeo, clearPlastic());
  shell.renderOrder = 2;
  tankGroup.add(shell);

  // Slim red mounting bands + filler cap — the bottle reads swappable.
  for (const z of [-tankLen / 2, tankLen / 2]) {
    const band = new Mesh(new TorusGeometry(tankR + 0.0015, 0.0035, 10, 22), accentMat);
    band.position.z = z;
    tankGroup.add(band);
  }
  const cap = new Mesh(new CylinderGeometry(0.012, 0.014, 0.014, 14), accentMat);
  cap.position.set(0, tankR + 0.003, tankLen / 2 - 0.005);
  tankGroup.add(cap);

  const tankMarker = new Object3D();
  tankGroup.add(tankMarker);

  // Ellipse tools wear a literal curved rail, readable both on the loadout
  // board and when the gun is waiting at the edge of the platform.
  if (def.curveStrength > 0) {
    for (const side of [-1, 1]) {
      const arc = new Mesh(new TorusGeometry(0.064, 0.0045, 10, 26, Math.PI * 1.2), accentMat);
      arc.rotation.set(0, side * Math.PI / 2, -0.42);
      arc.position.set(side * 0.026, 0.083, -0.09);
      group.add(arc);
    }
  }

  group.scale.set(...def.visualScale);

  return {
    group,
    liquid,
    tankMarker,
    tankInnerRadius: innerR,
    tankInnerLength: innerLen + innerR * 2,
    nozzle,
    setTriggerPull(v: number): void {
      // NEGATIVE x-rotation swings the trigger's blade (which hangs BELOW
      // the pivot) backward toward the shooter — i.e. it gets squeezed in.
      // A positive angle pushed it away down-range, which read as the
      // trigger un-pulling itself.
      triggerPivot.rotation.x = -v * 0.5;
    },
    dispose(): void {
      liquid.dispose();
      group.removeFromParent();
    },
  };
}

/** A clear, throwable juice capsule with a trigger lever and visible fuse. */
function createPaintGrenade(def: ToolDefinition): WaterPistolRig {
  const group = new Group();
  group.name = `tool-${def.id}`;
  const accentMat = glossyPlastic(def.color, 0.18);
  const smokeMat = mattePlastic(PALETTE.sportSmoke);

  const tankGroup = new Group();
  tankGroup.position.set(0, 0.025, -0.035);
  group.add(tankGroup);

  const innerR = 0.048;
  const liquid = createLiquid(
    new SphereGeometry(innerR, 20, 16),
    PALETTE.juice,
    PALETTE.juiceDeep,
    PALETTE.juiceFoam,
  );
  tankGroup.add(liquid.mesh);
  const shell = new Mesh(new SphereGeometry(0.052, 22, 18), clearPlastic());
  shell.renderOrder = 2;
  tankGroup.add(shell);

  // Protective coloured ribs make the two bomb colours unmistakable.
  for (let i = 0; i < 3; i++) {
    const rib = new Mesh(new TorusGeometry(0.055, 0.004, 9, 22), accentMat);
    rib.rotation.set(i === 0 ? Math.PI / 2 : 0, i === 2 ? Math.PI / 2 : 0, 0);
    tankGroup.add(rib);
  }

  const cap = new Mesh(new CylinderGeometry(0.024, 0.029, 0.04, 14), accentMat);
  cap.position.set(0, 0.089, -0.035);
  group.add(cap);
  const leverPivot = new Object3D();
  leverPivot.position.set(0, 0.112, -0.035);
  group.add(leverPivot);
  const lever = new Mesh(new BoxGeometry(0.025, 0.012, 0.085), smokeMat);
  lever.position.z = 0.025;
  leverPivot.add(lever);
  const fuse = new Mesh(new TorusGeometry(0.026, 0.0045, 9, 18, Math.PI * 1.65), accentMat);
  fuse.rotation.x = Math.PI / 2;
  fuse.position.set(0.026, 0.12, -0.005);
  group.add(fuse);

  const tankMarker = new Object3D();
  tankGroup.add(tankMarker);
  const nozzle = new Object3D();
  nozzle.position.copy(tankGroup.position);
  group.add(nozzle);
  group.scale.set(...def.visualScale);

  return {
    group,
    liquid,
    tankMarker,
    tankInnerRadius: innerR,
    tankInnerLength: innerR * 2,
    nozzle,
    setTriggerPull(v: number): void {
      leverPivot.rotation.x = -v * 0.55;
    },
    dispose(): void {
      liquid.dispose();
      group.removeFromParent();
    },
  };
}
