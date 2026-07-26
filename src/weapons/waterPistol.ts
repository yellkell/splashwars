/**
 * The plastic water pistol — SPLASH WARS' first weapon, built entirely from
 * primitives so it ships with zero assets. Chunky super-soaker proportions at
 * pistol scale: a glossy moulded body, a squeezable trigger on a pivot, a
 * decorative pump under the barrel, and the hero piece — a clear blow-moulded
 * tank on top with the paint VISIBLY sloshing inside (materials/liquid.ts).
 *
 * Local frame matches the XR grip space: -Z is forward, origin sits inside
 * the handle, so parenting the group straight under a grip entity puts the
 * gun in your hand pointing where you point.
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
  type ColorRepresentation,
} from 'three';
import { PALETTE } from '../config.js';
import { clearPlastic, glossyPlastic, mattePlastic } from '../materials/plastic.js';
import { createLiquid, type LiquidVisual } from '../materials/liquid.js';

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

export function createWaterPistol(
  bodyColor: ColorRepresentation = PALETTE.toyOrange,
  gripColor: ColorRepresentation = PALETTE.toyTeal,
): WaterPistolRig {
  const group = new Group();
  group.name = 'water-pistol';

  const bodyMat = glossyPlastic(bodyColor, 0.24);
  const gripMat = glossyPlastic(gripColor, 0.3);
  const detailMat = glossyPlastic(PALETTE.toyYellow, 0.32);
  const darkMat = mattePlastic(0x35444d);

  // --- Handle: a fat moulded grip, raked back like a real squirt gun. ---
  const grip = new Mesh(new BoxGeometry(0.034, 0.1, 0.048), gripMat);
  grip.position.set(0, -0.012, 0.012);
  grip.rotation.x = -0.32;
  group.add(grip);
  const gripHeel = new Mesh(new SphereGeometry(0.024, 14, 12), gripMat);
  gripHeel.scale.set(0.75, 0.55, 1);
  gripHeel.position.set(0, -0.06, 0.028);
  group.add(gripHeel);

  // --- Body: the main receiver block over the hand. ---
  const body = new Mesh(new BoxGeometry(0.05, 0.07, 0.17), bodyMat);
  body.position.set(0, 0.052, -0.05);
  group.add(body);
  // Rounded nose and tail so the box reads moulded, not machined.
  const nose = new Mesh(new SphereGeometry(0.034, 16, 12), bodyMat);
  nose.scale.set(0.72, 1, 1);
  nose.position.set(0, 0.052, -0.135);
  group.add(nose);
  const tail = new Mesh(new SphereGeometry(0.035, 16, 12), bodyMat);
  tail.scale.set(0.71, 1, 0.8);
  tail.position.set(0, 0.052, 0.035);
  group.add(tail);
  // A little sight fin on top, very toy.
  const fin = new Mesh(new BoxGeometry(0.008, 0.02, 0.05), detailMat);
  fin.position.set(0, 0.095, -0.115);
  group.add(fin);

  // --- Barrel + nozzle. ---
  const barrel = new Mesh(zCyl(0.017, 0.02, 0.11), bodyMat);
  barrel.position.set(0, 0.058, -0.19);
  group.add(barrel);
  const muzzleRing = new Mesh(new TorusGeometry(0.019, 0.006, 12, 20), detailMat);
  muzzleRing.position.set(0, 0.058, -0.243);
  group.add(muzzleRing);
  const nozzleTip = new Mesh(new ConeGeometry(0.014, 0.03, 16), darkMat);
  nozzleTip.rotation.x = -Math.PI / 2;
  nozzleTip.position.set(0, 0.058, -0.255);
  group.add(nozzleTip);

  // The muzzle anchor blobs spawn from, -Z pointing down-range.
  const nozzle = new Object3D();
  nozzle.position.set(0, 0.058, -0.272);
  group.add(nozzle);

  // --- Pump: decorative slider under the barrel (a later weapon earns it). ---
  const pumpRail = new Mesh(zCyl(0.008, 0.008, 0.09, 12), darkMat);
  pumpRail.position.set(0, 0.018, -0.17);
  group.add(pumpRail);
  const pumpGrip = new Mesh(new BoxGeometry(0.03, 0.018, 0.04), detailMat);
  pumpGrip.position.set(0, 0.014, -0.2);
  group.add(pumpGrip);

  // --- Trigger on a pivot, inside a rounded guard. ---
  const triggerPivot = new Object3D();
  triggerPivot.position.set(0, 0.03, -0.065);
  group.add(triggerPivot);
  const trigger = new Mesh(new BoxGeometry(0.014, 0.042, 0.012), darkMat);
  trigger.position.set(0, -0.026, 0.004);
  trigger.rotation.x = 0.18;
  triggerPivot.add(trigger);
  const guard = new Mesh(new TorusGeometry(0.028, 0.005, 10, 22, Math.PI), gripMat);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, 0.008, -0.06);
  group.add(guard);

  // --- THE TANK: clear shell on top, paint sloshing inside. ---
  const tankR = 0.037;
  const tankLen = 0.1;
  const innerR = 0.033;
  const innerLen = 0.096;
  const tankGroup = new Group();
  tankGroup.position.set(0, 0.128, -0.055);
  group.add(tankGroup);

  // The paint: a shrunk interior capsule wearing the clipped-liquid shader.
  const interior = new CapsuleGeometry(innerR, innerLen, 6, 18);
  interior.rotateX(Math.PI / 2);
  const liquid = createLiquid(interior, PALETTE.paint, PALETTE.paintDeep, PALETTE.paintFoam);
  tankGroup.add(liquid.mesh);

  // The clear blow-moulded shell over it.
  const shellGeo = new CapsuleGeometry(tankR, tankLen, 6, 20);
  shellGeo.rotateX(Math.PI / 2);
  const shell = new Mesh(shellGeo, clearPlastic());
  shell.renderOrder = 2;
  tankGroup.add(shell);

  // Moulding bands + filler cap so the tank reads as a separate bottle.
  for (const z of [-tankLen / 2, tankLen / 2]) {
    const band = new Mesh(new TorusGeometry(tankR + 0.002, 0.0045, 10, 22), bodyMat);
    band.position.z = z;
    tankGroup.add(band);
  }
  const cap = new Mesh(new CylinderGeometry(0.014, 0.016, 0.016, 14), detailMat);
  cap.position.set(0, tankR + 0.004, tankLen / 2 - 0.005);
  tankGroup.add(cap);

  const tankMarker = new Object3D();
  tankGroup.add(tankMarker);

  return {
    group,
    liquid,
    tankMarker,
    tankInnerRadius: innerR,
    tankInnerLength: innerLen + innerR * 2,
    nozzle,
    setTriggerPull(v: number): void {
      triggerPivot.rotation.x = v * 0.5;
    },
    dispose(): void {
      liquid.dispose();
      group.removeFromParent();
    },
  };
}
