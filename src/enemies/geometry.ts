/**
 * THE THIRST — the rival team's drinking machines.
 *
 * Art direction: the enemies live in the SAME design language as the
 * player's pistols — competition-white glossy shells, sharp team-colour
 * accents, smoked dark intakes — because SPLASH WARS is a sport and these
 * are the other side's hardware. Their team colour is the violet of their
 * shots. Every machine is built around one BIG GLOWING LENS EYE (menace
 * without cuteness) and a DRINKING apparatus — straws, spouts, intake
 * grilles — because what they do is drink your tower dry.
 *
 * What makes them read as finished rather than programmer art:
 *  - smooth-shaded sleek shells (the pistols' vocabulary), not bare solids;
 *  - a dark socket ring around every lens so the eye has depth;
 *  - per-part SHADER ANIMATION via the `aPart` attribute — rotor rings
 *    spin, fins and antennas bob, cores pulse — so every machine is alive
 *    even before the AI moves it;
 *  - fresnel rim light and two-tone ramp shading in the swarm shader.
 *
 * Vertex attributes:
 *   aRole: 0 body (white shell, takes juice coverage) · 1 accent (team
 *          violet) · 2 glow (lens/core, emissive) · 3 dark (smoked intakes)
 *   aPart: 0 static · 1 rotor (spins about the machine's Y axis) ·
 *          2 bobber (floats up/down) · 3 pulser (breathes radially)
 *
 * Modelled in unit space where "1" ≈ collision radius; -Z is the face.
 */

import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Matrix4,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EnemyKind, type EnemyKindId } from '../config.js';

export const Role = { Body: 0, Accent: 1, Glow: 2, Dark: 3 } as const;
export const Part = { Static: 0, Rotor: 1, Bobber: 2, Pulser: 3 } as const;

/** Stamp role + part attributes and bake a transform. */
function part(geo: BufferGeometry, role: number, motion: number, transform?: Matrix4): BufferGeometry {
  if (transform) geo.applyMatrix4(transform);
  const count = geo.attributes.position.count;
  geo.setAttribute('aRole', new Float32BufferAttribute(new Float32Array(count).fill(role), 1));
  geo.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(count).fill(motion), 1));
  return geo;
}

function place(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

/**
 * The signature lens eye: a glowing core recessed in a dark socket ring.
 * The ring gives the eye depth; the pulser motion makes it feel awake.
 */
function lens(x: number, y: number, z: number, r: number): BufferGeometry[] {
  return [
    part(new TorusGeometry(r, r * 0.32, 10, 24), Role.Dark, Part.Static, place(x, y, z, 1, 1, 0.9)),
    part(new SphereGeometry(r * 0.82, 16, 12), Role.Glow, Part.Pulser, place(x, y, z + r * 0.1, 1, 1, 0.55)),
  ];
}

/** A slim drinking straw angled down-forward, with an accent tip. */
function straw(x: number, z: number, len: number, tilt: number, yTop: number): BufferGeometry[] {
  const dz = -Math.sin(tilt) * len * 0.5;
  const dy = -Math.cos(tilt) * len * 0.5;
  return [
    part(new CylinderGeometry(0.045, 0.06, len, 10), Role.Dark, Part.Static, place(x, yTop + dy, z + dz, 1, 1, 1, tilt, 0, 0)),
    part(new CylinderGeometry(0.075, 0.075, 0.09, 10), Role.Accent, Part.Static, place(x, yTop + dy * 2 + 0.04, z + dz * 2, 1, 1, 1, tilt, 0, 0)),
  ];
}

/** Sipper — the crowd: a rounded drinker drone. Steals juice and RUNS. */
function sipper(): BufferGeometry {
  return mergeGeometries([
    // Teardrop hull: main dome + tapered tail swept up behind.
    part(new SphereGeometry(0.82, 24, 18), Role.Body, Part.Static, place(0, 0.05, 0.05, 1, 0.92, 1.05)),
    part(new ConeGeometry(0.42, 0.9, 14), Role.Body, Part.Static, place(0, 0.35, 0.72, 1, 1, 1, 2.4, 0, 0)),
    // Team stripe cap + waist rotor ring.
    part(new SphereGeometry(0.83, 24, 6, 0, Math.PI * 2, 0, 0.5), Role.Accent, Part.Static, place(0, 0.07, 0.05, 1, 0.92, 1.05)),
    part(new TorusGeometry(0.88, 0.055, 10, 28), Role.Accent, Part.Rotor, place(0, -0.18, 0.03, 1, 1, 1, Math.PI / 2, 0, 0)),
    // The big lens, the straw it drinks with, bobbing stabilizer fins.
    ...lens(0, 0.12, -0.78, 0.3),
    ...straw(0, -0.55, 0.85, 0.5, -0.3),
    part(new SphereGeometry(0.16, 10, 8), Role.Accent, Part.Bobber, place(-0.78, 0.3, 0.25, 0.45, 1.4, 0.8)),
    part(new SphereGeometry(0.16, 10, 8), Role.Accent, Part.Bobber, place(0.78, 0.3, 0.25, 0.45, 1.4, 0.8)),
  ])!;
}

/** Zipper — fast interceptor: a slim dart with swept wings. */
function zipper(): BufferGeometry {
  return mergeGeometries([
    // Needle fuselage.
    part(new SphereGeometry(0.5, 20, 14), Role.Body, Part.Static, place(0, 0, 0.1, 0.55, 0.55, 1.5)),
    part(new ConeGeometry(0.26, 0.7, 12), Role.Accent, Part.Static, place(0, 0, -0.85, 1, 1, 1, -Math.PI / 2, 0, 0)),
    // Swept wings that flutter, and a small tail fin.
    part(new SphereGeometry(0.4, 12, 8), Role.Accent, Part.Bobber, place(-0.62, 0, 0.42, 1.2, 0.08, 0.5, 0, 0.5, 0)),
    part(new SphereGeometry(0.4, 12, 8), Role.Accent, Part.Bobber, place(0.62, 0, 0.42, 1.2, 0.08, 0.5, 0, -0.5, 0)),
    part(new SphereGeometry(0.3, 10, 8), Role.Body, Part.Static, place(0, 0.32, 0.6, 0.08, 1, 0.6)),
    ...lens(0, 0.05, -0.52, 0.2),
  ])!;
}

/** Spout — the ranged one: a squat mortar with a tipping tank turret. */
function spout(): BufferGeometry {
  return mergeGeometries([
    // Squat hull with a rotor skirt.
    part(new CylinderGeometry(0.68, 0.82, 0.6, 20), Role.Body, Part.Static, place(0, -0.25, 0)),
    part(new TorusGeometry(0.86, 0.07, 10, 26), Role.Accent, Part.Rotor, place(0, -0.5, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    // The lob tank: a dome reservoir with a stubby spout aimed up-forward.
    part(new SphereGeometry(0.55, 20, 14), Role.Accent, Part.Pulser, place(0, 0.42, 0.1, 1, 0.85, 1)),
    part(new CylinderGeometry(0.13, 0.18, 0.62, 12), Role.Dark, Part.Static, place(0, 0.78, -0.35, 1, 1, 1, 0.7, 0, 0)),
    part(new TorusGeometry(0.15, 0.045, 8, 16), Role.Accent, Part.Static, place(0, 0.98, -0.58, 1, 1, 1, 0.7, 0, 0)),
    ...lens(0, 0.02, -0.72, 0.24),
  ])!;
}

/** Chugger — the tank: a heavy twin-plated barrel that will not stop. */
function chugger(): BufferGeometry {
  return mergeGeometries([
    // Barrel hull, dome cap, chin intake grille.
    part(new CylinderGeometry(0.85, 0.95, 1.1, 22), Role.Body, Part.Static, place(0, -0.05, 0)),
    part(new SphereGeometry(0.86, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), Role.Body, Part.Static, place(0, 0.5, 0)),
    part(new CylinderGeometry(0.5, 0.55, 0.28, 16), Role.Dark, Part.Static, place(0, -0.45, -0.62, 1, 1, 1, 0.5, 0, 0)),
    // Armour side plates + heavy slow rotor at the base.
    part(new SphereGeometry(0.5, 14, 10), Role.Accent, Part.Static, place(-0.85, 0.1, 0, 0.25, 1.3, 1.1)),
    part(new SphereGeometry(0.5, 14, 10), Role.Accent, Part.Static, place(0.85, 0.1, 0, 0.25, 1.3, 1.1)),
    part(new TorusGeometry(1.0, 0.09, 10, 28), Role.Accent, Part.Rotor, place(0, -0.62, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    // A wide lens VISOR instead of an eye — it doesn't look, it advances.
    part(new SphereGeometry(0.42, 16, 10), Role.Dark, Part.Static, place(0, 0.42, -0.72, 1.5, 0.5, 0.6)),
    part(new SphereGeometry(0.34, 16, 10), Role.Glow, Part.Pulser, place(0, 0.42, -0.76, 1.45, 0.32, 0.4)),
  ])!;
}

/** Pod — the splitter: a carrier shell of three lobes, straining to open. */
function pod(): BufferGeometry {
  const lobes: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    lobes.push(
      part(
        new SphereGeometry(0.62, 18, 14),
        Role.Body,
        Part.Pulser,
        place(Math.cos(a) * 0.42, Math.sin(a * 2) * 0.1, Math.sin(a) * 0.42, 1, 1.1, 1),
      ),
    );
  }
  return mergeGeometries([
    ...lobes,
    // Seam bands holding the lobes together — the thing you're breaking.
    part(new TorusGeometry(0.85, 0.06, 10, 26), Role.Accent, Part.Rotor, place(0, 0.15, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    part(new TorusGeometry(0.8, 0.06, 10, 26), Role.Accent, Part.Static, place(0, -0.25, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    ...lens(0, 0.1, -0.9, 0.22),
  ])!;
}

/** THE GULP — the boss: an industrial drinker with a crown of straws. */
function gulp(): BufferGeometry {
  const straws: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    straws.push(...straw(Math.cos(a) * 0.5, Math.sin(a) * 0.5 + 0.1, 0.9, 0.55 + (i % 2) * 0.2, -0.5));
  }
  return mergeGeometries([
    // Massive dome hull with a team-stripe crown and a big slow rotor.
    part(new SphereGeometry(0.95, 28, 20), Role.Body, Part.Static, place(0, 0.1, 0, 1, 0.95, 1)),
    part(new SphereGeometry(0.96, 28, 8, 0, Math.PI * 2, 0, 0.6), Role.Accent, Part.Static, place(0, 0.12, 0, 1, 0.95, 1)),
    part(new TorusGeometry(1.05, 0.09, 12, 32), Role.Accent, Part.Rotor, place(0, -0.3, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    part(new TorusGeometry(0.55, 0.06, 10, 24), Role.Dark, Part.Rotor, place(0, 0.98, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    ...straws,
    // One enormous lens. It is looking at your tower.
    ...lens(0, 0.22, -0.88, 0.42),
  ])!;
}

let cache: Record<number, BufferGeometry> | undefined;

/** The per-kind body geometry, built once and shared by every instance. */
export function enemyGeometry(kind: EnemyKindId): BufferGeometry {
  if (!cache) {
    cache = {
      [EnemyKind.Drifter]: sipper(),
      [EnemyKind.Scurrier]: zipper(),
      [EnemyKind.Lobber]: spout(),
      [EnemyKind.Brute]: chugger(),
      [EnemyKind.Splitter]: pod(),
      [EnemyKind.Boss]: gulp(),
    };
  }
  return cache[kind];
}
