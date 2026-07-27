/**
 * The enemy roster's bodies — POOL TOYS, not blobs.
 *
 * Creative direction: everything that attacks you escaped from a pool
 * inflatables crate. Beach balls with googly eyes, squirt droplets, knotted
 * water balloons, a big inflatable duck, a clump of foam bubbles, and a
 * giant crowned duck for the boss. It keeps the plastic-and-water theme,
 * gives every type a silhouette you can read across the room, and — because
 * each kind is ONE merged geometry rendered as ONE InstancedMesh — a
 * thousand of them still cost six draw calls.
 *
 * Each merged geometry carries an `aRole` vertex attribute telling the
 * swarm shader what a vertex is:
 *   0 = body      (per-instance tint; striped on beach balls)
 *   1 = accent    (per-kind accent colour: beaks, knots, fins, crown)
 *   2 = eye white
 *   3 = pupil
 * so eyes and trims are real geometry with fixed colours, not textures.
 *
 * All bodies are modelled in a unit space where "1" ≈ the kind's collision
 * radius; the swarm scales instances by their actual radius. -Z is the face:
 * the instance matrix yaws each toy to look at you.
 */

import {
  BufferGeometry,
  ConeGeometry,
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

export const Role = { Body: 0, Accent: 1, EyeWhite: 2, Pupil: 3 } as const;

/** Stamp a role attribute onto a geometry and bake a transform. */
function part(geo: BufferGeometry, role: number, transform?: Matrix4): BufferGeometry {
  if (transform) geo.applyMatrix4(transform);
  const count = geo.attributes.position.count;
  geo.setAttribute('aRole', new Float32BufferAttribute(new Float32Array(count).fill(role), 1));
  return geo;
}

function place(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

/** Googly eyes on the face (-Z), spaced and sized per toy. */
function eyes(cx: number, cy: number, cz: number, r: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(part(new SphereGeometry(r, 10, 8), Role.EyeWhite, place(side * cx, cy, cz)));
    parts.push(part(new SphereGeometry(r * 0.48, 8, 6), Role.Pupil, place(side * cx, cy, cz - r * 0.72)));
  }
  return parts;
}

/** Bobber — a striped beach ball with googly eyes and a little valve nub. */
function beachBall(): BufferGeometry {
  return mergeGeometries([
    part(new SphereGeometry(1, 20, 14), Role.Body), // stripes come from the shader
    part(new SphereGeometry(0.12, 8, 6), Role.Accent, place(0, 1.0, 0, 1, 0.55, 1)),
    ...eyes(0.34, 0.22, -0.9, 0.2),
  ])!;
}

/** Squirt — a water droplet with a swept-back tip and tiny side fins. */
function droplet(): BufferGeometry {
  return mergeGeometries([
    part(new SphereGeometry(0.88, 16, 12), Role.Body, place(0, -0.12, 0)),
    part(new ConeGeometry(0.52, 1.15, 12), Role.Body, place(0, 0.62, 0.18, 1, 1, 1, 0.35, 0, 0)),
    part(new SphereGeometry(0.2, 8, 6), Role.Accent, place(-0.85, -0.1, 0.2, 0.4, 1, 1.4)),
    part(new SphereGeometry(0.2, 8, 6), Role.Accent, place(0.85, -0.1, 0.2, 0.4, 1, 1.4)),
    ...eyes(0.3, 0.05, -0.82, 0.19),
  ])!;
}

/** Slinger — a knotted water balloon, top-heavy and wobbly. */
function balloon(): BufferGeometry {
  return mergeGeometries([
    part(new SphereGeometry(1, 18, 14), Role.Body, place(0, -0.08, 0, 1, 0.92, 1)),
    // The pinched neck and knot.
    part(new ConeGeometry(0.3, 0.5, 10), Role.Body, place(0, 0.82, 0, 1, 1, 1, Math.PI, 0, 0)),
    part(new TorusGeometry(0.16, 0.09, 8, 14), Role.Accent, place(0, 1.02, 0, 1, 1, 1, Math.PI / 2, 0, 0)),
    part(new SphereGeometry(0.14, 8, 6), Role.Accent, place(0, 1.16, 0)),
    ...eyes(0.32, 0.1, -0.88, 0.2),
  ])!;
}

/** Big Duck — the inflatable pool duck. The tank of the roster. */
function duck(): BufferGeometry {
  return mergeGeometries([
    // Hull with a puffed chest, swim-ring seam, and a perky tail.
    part(new SphereGeometry(1, 18, 14), Role.Body, place(0, -0.2, 0.05, 1.02, 0.72, 1.18)),
    part(new TorusGeometry(0.98, 0.13, 10, 22), Role.Accent, place(0, -0.55, 0.05, 1, 1, 1.15, Math.PI / 2, 0, 0)),
    part(new ConeGeometry(0.32, 0.6, 10), Role.Body, place(0, 0.05, 1.0, 1, 1, 1, -1.0, 0, 0)),
    // Head, beak, eyes.
    part(new SphereGeometry(0.52, 16, 12), Role.Body, place(0, 0.62, -0.62)),
    part(new ConeGeometry(0.22, 0.42, 12), Role.Accent, place(0, 0.55, -1.18, 1, 0.75, 1, -Math.PI / 2, 0, 0)),
    ...eyes(0.24, 0.78, -0.98, 0.13),
  ])!;
}

/** Foamer — a clinging clump of soap bubbles that splits when popped. */
function bubbles(): BufferGeometry {
  const sats: BufferGeometry[] = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.4;
    sats.push(
      part(
        new SphereGeometry(0.42 + (i % 2) * 0.1, 12, 9),
        Role.Body,
        place(Math.cos(a) * 0.62, Math.sin(a * 1.7) * 0.35, Math.sin(a) * 0.62),
      ),
    );
  }
  return mergeGeometries([
    part(new SphereGeometry(0.78, 16, 12), Role.Body),
    ...sats,
    ...eyes(0.28, 0.18, -0.74, 0.18),
  ])!;
}

/** THE BIG ONE — the boss: a colossal crowned duck. */
function bossDuck(): BufferGeometry {
  const crown: BufferGeometry[] = [
    part(new TorusGeometry(0.3, 0.06, 8, 16), Role.Accent, place(0, 0.98, -0.62, 1, 1, 1, Math.PI / 2, 0, 0)),
  ];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    crown.push(
      part(new ConeGeometry(0.07, 0.24, 6), Role.Accent, place(Math.cos(a) * 0.28, 1.12, -0.62 + Math.sin(a) * 0.28)),
    );
  }
  return mergeGeometries([duck(), ...crown])!;
}

let cache: Record<number, BufferGeometry> | undefined;

/** The per-kind body geometry, built once and shared by every instance. */
export function enemyGeometry(kind: EnemyKindId): BufferGeometry {
  if (!cache) {
    cache = {
      [EnemyKind.Drifter]: beachBall(),
      [EnemyKind.Scurrier]: droplet(),
      [EnemyKind.Lobber]: balloon(),
      [EnemyKind.Brute]: duck(),
      [EnemyKind.Splitter]: bubbles(),
      [EnemyKind.Boss]: bossDuck(),
    };
  }
  return cache[kind];
}
