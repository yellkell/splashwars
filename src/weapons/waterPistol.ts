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

/**
 * Per-family proportions. These numbers ARE the silhouette work: every
 * family gets its own receiver mass, barrel length and tank shape, so you
 * can name the tool from across the pad by outline alone — colour is the
 * last cue, not the only one.
 */
interface Chassis {
  /** Receiver box: width, height, length. */
  body: [number, number, number];
  bodyZ: number;
  barrelR: [number, number];
  barrelLen: number;
  /** Tank capsule: radius, straight length, and whether it lies crosswise. */
  tankR: number;
  tankLen: number;
  tankCross: boolean;
  tankY: number;
  /** Number of muzzles across the face (Wildcat/shotgun spread them). */
  muzzles: number;
  muzzleSpan: number;
}

function chassisFor(def: ToolDefinition): Chassis {
  switch (def.family) {
    case 'wildcat':
      // STUBBY SPRAYER: wide squat body, drum tank lying CROSSWISE like a
      // Tommy gun magazine, twin stub muzzles. Small, busy, unmistakable.
      return {
        body: [0.062, 0.052, 0.115], bodyZ: -0.04,
        barrelR: [0.011, 0.013], barrelLen: 0.06,
        tankR: 0.042, tankLen: 0.052, tankCross: true, tankY: 0.108,
        muzzles: 2, muzzleSpan: 0.019,
      };
    case 'viper':
      // MARKSMAN RIFLE: long, lean, low. A slim inline tank and a barrel
      // that runs on forever — the one you spot at a glance by LENGTH.
      return {
        body: [0.034, 0.05, 0.19], bodyZ: -0.07,
        barrelR: [0.0085, 0.011], barrelLen: 0.25,
        tankR: 0.026, tankLen: 0.14, tankCross: false, tankY: 0.098,
        muzzles: 1, muzzleSpan: 0,
      };
    case 'shotgun':
      // BREACHER: broad flat receiver, fat short barrel, four muzzle ports
      // in a square, twin tanks slung side by side. Reads as MASS.
      return {
        body: [0.072, 0.058, 0.155], bodyZ: -0.055,
        barrelR: [0.026, 0.024], barrelLen: 0.115,
        tankR: 0.03, tankLen: 0.088, tankCross: false, tankY: 0.106,
        muzzles: 4, muzzleSpan: 0.03,
      };
    default:
      // RAPTOR: the original service pistol, the baseline everything else
      // is read against.
      return {
        body: [0.042, 0.06, 0.16], bodyZ: -0.05,
        barrelR: [0.013, 0.017], barrelLen: 0.13,
        tankR: 0.034, tankLen: 0.1, tankCross: false, tankY: 0.118,
        muzzles: 1, muzzleSpan: 0,
      };
  }
}

export function createWaterPistol(def: ToolDefinition = toolById(ToolId.Raptor)): WaterPistolRig {
  if (def.kind === 'grenade') return createPaintGrenade(def);

  const group = new Group();
  group.name = `tool-${def.id}`;
  const c = chassisFor(def);

  const shellMat = glossyPlastic(PALETTE.sportWhite, 0.16); // slick, near-wet
  const accentMat = glossyPlastic(def.color, 0.22);
  const smokeMat = mattePlastic(PALETTE.sportSmoke);
  const bodyEnd = c.bodyZ - c.body[2] / 2;
  const barrelZ = bodyEnd - c.barrelLen / 2 + 0.01;
  const muzzleZ = bodyEnd - c.barrelLen - 0.012;
  const barrelY = c.body[1] * 0.9;

  // --- Handle: slim raked grip, white shell with a smoked palm inlay. ---
  const grip = new Mesh(new BoxGeometry(c.body[0] * 0.72, 0.1, 0.044), shellMat);
  grip.position.set(0, -0.012, 0.012);
  grip.rotation.x = -0.34;
  group.add(grip);
  const gripInlay = new Mesh(new BoxGeometry(c.body[0] * 0.76, 0.06, 0.024), smokeMat);
  gripInlay.position.set(0, -0.02, 0.018);
  gripInlay.rotation.x = -0.34;
  group.add(gripInlay);
  const gripHeel = new Mesh(new SphereGeometry(0.022, 14, 12), accentMat);
  gripHeel.scale.set(0.7, 0.5, 1);
  gripHeel.position.set(0, -0.062, 0.03);
  group.add(gripHeel);

  // --- Body: the receiver, sized per family. ---
  const body = new Mesh(new BoxGeometry(...c.body), shellMat);
  body.position.set(0, barrelY, c.bodyZ);
  group.add(body);
  const nose = new Mesh(new SphereGeometry(c.body[0] * 0.69, 16, 12), shellMat);
  nose.scale.set(0.72, c.body[1] / c.body[0] * 0.72, 1.15);
  nose.position.set(0, barrelY, bodyEnd + 0.01);
  group.add(nose);
  const tail = new Mesh(new SphereGeometry(c.body[0] * 0.71, 16, 12), shellMat);
  tail.scale.set(0.7, c.body[1] / c.body[0] * 0.7, 0.75);
  tail.position.set(0, barrelY, c.bodyZ + c.body[2] / 2 + 0.005);
  group.add(tail);

  // Racing stripes down both flanks — the sports livery in one stroke.
  for (const side of [-1, 1]) {
    const stripe = new Mesh(new BoxGeometry(0.0022, 0.016, c.body[2] * 0.97), accentMat);
    stripe.position.set(side * (c.body[0] / 2 + 0.0005), barrelY + 0.008, c.bodyZ);
    group.add(stripe);
  }

  // --- Barrel(s) + muzzle. One fat pipe, or a cluster of ports. ---
  const nozzle = new Object3D();
  nozzle.position.set(0, barrelY, muzzleZ - 0.016);
  group.add(nozzle);

  if (c.muzzles === 1) {
    const barrel = new Mesh(zCyl(c.barrelR[0], c.barrelR[1], c.barrelLen), shellMat);
    barrel.position.set(0, barrelY, barrelZ);
    group.add(barrel);
    const collar = new Mesh(new TorusGeometry(c.barrelR[0] + 0.002, 0.005, 12, 20), accentMat);
    collar.position.set(0, barrelY, muzzleZ);
    group.add(collar);
    const tip = new Mesh(new ConeGeometry(c.barrelR[0] * 0.85, 0.028, 16), smokeMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, barrelY, muzzleZ - 0.011);
    group.add(tip);
  } else {
    // A shroud with several ports punched through it — the spread guns
    // announce their cone before they ever fire.
    const shroud = new Mesh(zCyl(c.barrelR[0], c.barrelR[1], c.barrelLen, 16), shellMat);
    shroud.position.set(0, barrelY, barrelZ);
    group.add(shroud);
    const ring = new Mesh(new TorusGeometry(c.barrelR[0] + 0.003, 0.006, 12, 24), accentMat);
    ring.position.set(0, barrelY, muzzleZ);
    group.add(ring);
    const half = c.muzzleSpan / 2;
    const offsets: Array<[number, number]> =
      c.muzzles === 2
        ? [[-half, 0], [half, 0]]
        : [[-half, half], [half, half], [-half, -half], [half, -half]];
    for (const [ox, oy] of offsets) {
      const port = new Mesh(zCyl(0.0075, 0.0075, 0.03, 12), smokeMat);
      port.position.set(ox, barrelY + oy, muzzleZ - 0.006);
      group.add(port);
    }
  }

  // Shotguns get a pump grip under the barrel — the read is unmistakable.
  if (def.family === 'shotgun') {
    const pump = new Mesh(new BoxGeometry(0.048, 0.03, 0.062), smokeMat);
    pump.position.set(0, barrelY - 0.038, barrelZ - 0.01);
    group.add(pump);
    for (const side of [-1, 1]) {
      const strap = new Mesh(new BoxGeometry(0.006, 0.032, 0.062), accentMat);
      strap.position.set(side * 0.026, barrelY - 0.038, barrelZ - 0.01);
      group.add(strap);
    }
  }

  // Viper wears a long scope — the marksman silhouette in one part.
  if (def.family === 'viper') {
    const scope = new Mesh(zCyl(0.016, 0.016, 0.1, 14), smokeMat);
    scope.position.set(0, barrelY + 0.052, c.bodyZ - 0.03);
    group.add(scope);
    for (const z of [-0.045, 0.045]) {
      const mount = new Mesh(new BoxGeometry(0.012, 0.03, 0.01), accentMat);
      mount.position.set(0, barrelY + 0.03, c.bodyZ - 0.03 + z);
      group.add(mount);
    }
  }

  // --- Underslung rail: a slim smoked chin line, keeps the profile sporty. ---
  if (def.family !== 'shotgun') {
    const rail = new Mesh(zCyl(0.006, 0.006, c.barrelLen * 0.7, 12), smokeMat);
    rail.position.set(0, barrelY - 0.038, barrelZ);
    group.add(rail);
  }

  // --- Trigger on a pivot, coloured, inside a slim guard. ---
  const triggerPivot = new Object3D();
  triggerPivot.position.set(0, 0.028, -0.062);
  group.add(triggerPivot);
  const trigger = new Mesh(new BoxGeometry(0.012, 0.04, 0.01), accentMat);
  trigger.position.set(0, -0.023, 0.004);
  trigger.rotation.x = 0.18;
  triggerPivot.add(trigger);
  // The guard's half-ring is sized so BOTH ends bury into the receiver's
  // underside — a smaller ring left its ends hanging in mid-air.
  const guard = new Mesh(new TorusGeometry(0.042, 0.0042, 10, 22, Math.PI), accentMat);
  guard.rotation.y = Math.PI / 2;
  guard.rotation.z = Math.PI;
  guard.position.set(0, 0.022, -0.058);
  group.add(guard);

  // --- THE TANK: clear shell, juice sloshing inside. One barrel-shaped
  // bottle, a crosswise drum, or a pair slung side by side. ---
  const tankR = c.tankR;
  const tankLen = c.tankLen;
  const innerR = tankR - 0.003;
  const innerLen = tankLen - 0.004;
  const tankGroup = new Group();
  tankGroup.position.set(0, c.tankY, c.bodyZ);
  if (c.tankCross) tankGroup.rotation.y = Math.PI / 2;
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

  // Slim mounting bands + filler cap — the bottle reads swappable.
  for (const z of [-tankLen / 2, tankLen / 2]) {
    const band = new Mesh(new TorusGeometry(tankR + 0.0015, 0.0035, 10, 22), accentMat);
    band.position.z = z;
    tankGroup.add(band);
  }
  const cap = new Mesh(new CylinderGeometry(0.012, 0.014, 0.014, 14), accentMat);
  cap.position.set(0, tankR + 0.003, tankLen / 2 - 0.005);
  tankGroup.add(cap);

  // The shotgun's SECOND bottle: dead weight visually, but it's the part
  // that makes the profile read double-barrelled and heavy.
  if (def.family === 'shotgun') {
    const spare = new Mesh(shellGeo.clone(), clearPlastic());
    spare.position.set(0, -0.052, 0);
    spare.renderOrder = 2;
    tankGroup.add(spare);
    for (const z of [-tankLen / 2, tankLen / 2]) {
      const band = new Mesh(new TorusGeometry(tankR + 0.0015, 0.0035, 10, 22), accentMat);
      band.position.set(0, -0.052, z);
      tankGroup.add(band);
    }
  }

  const tankMarker = new Object3D();
  tankGroup.add(tankMarker);

  // ELLIPSE tools wear a big banana fin over the receiver plus curved side
  // rails — the bend made physical, readable across the whole pad.
  if (def.curveStrength > 0) {
    // A curved SPINE arcing over the tank, its ends dipping down to the
    // receiver so it reads as bolted on rather than floating. Built by
    // rotating the geometry (deterministic) instead of the mesh.
    const finGeo = new TorusGeometry(0.085, 0.0065, 10, 30, Math.PI * 0.5);
    finGeo.rotateZ(Math.PI / 2 - Math.PI * 0.25); // centre the arc on +Y
    finGeo.rotateY(Math.PI / 2); // lay it along the barrel's length
    const fin = new Mesh(finGeo, accentMat);
    fin.position.set(0, c.tankY - 0.02, c.bodyZ);
    group.add(fin);
    // Two struts tie the spine's ends into the receiver.
    for (const z of [-0.06, 0.06]) {
      const strut = new Mesh(new BoxGeometry(0.007, 0.05, 0.007), accentMat);
      strut.position.set(0, c.tankY + 0.015, c.bodyZ + z);
      group.add(strut);
    }
    // Flank rails hugging the body, curving the same way.
    for (const side of [-1, 1]) {
      const arc = new Mesh(new TorusGeometry(0.055, 0.005, 10, 24, Math.PI * 0.9), accentMat);
      arc.rotation.set(0, (side * Math.PI) / 2, -0.5);
      arc.position.set(side * (c.body[0] / 2 + 0.004), barrelY + 0.012, c.bodyZ - 0.02);
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
