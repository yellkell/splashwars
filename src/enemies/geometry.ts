/**
 * THE THIRST — the enemy roster's bodies.
 *
 * Creative direction: the things attacking your tower are not toys. They are
 * DRY — parched, faceted husk-creatures, all hard angles and matte crust,
 * that have crawled out of somewhere waterless to drain your juice tower.
 * Their glowing eyes are the only bright thing on them… until your juice
 * hits: glossy vivid colour creeping over a dull cracked body is the game's
 * whole visual sentence, and every kill ends with a husk BURSTING wet.
 *
 * Bodies are low-poly geometric solids, deliberately faceted (non-indexed,
 * per-face normals) so they read as crystalline crust against everything
 * else in the game being smooth glossy plastic. Each kind is ONE merged
 * geometry rendered as ONE InstancedMesh — six draw calls at any crowd size.
 *
 * The `aRole` vertex attribute tells the swarm shader what a vertex is:
 *   0 = body   (matte per-instance tint, takes juice coverage)
 *   1 = accent (darker crust: spikes, plates, the boss's crown)
 *   2 = glow   (EYES — flat emissive, per-kind colour, unlit)
 *   3 = maw    (dark hollow: mouths, vents)
 *
 * Modelled in unit space where "1" ≈ collision radius; -Z is the face.
 */

import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  Quaternion,
  TetrahedronGeometry,
  Matrix4,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EnemyKind, type EnemyKindId } from '../config.js';

export const Role = { Body: 0, Accent: 1, Glow: 2, Maw: 3 } as const;

/** Facet a geometry (per-face normals), stamp a role, bake a transform. */
function part(geo: BufferGeometry, role: number, transform?: Matrix4): BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  if (transform) g.applyMatrix4(transform);
  const count = g.attributes.position.count;
  g.setAttribute('aRole', new Float32BufferAttribute(new Float32Array(count).fill(role), 1));
  return g;
}

function place(x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

/** A pair of angular glowing eyes on the face (-Z). */
function eyes(cx: number, cy: number, cz: number, r: number, tilt = 0.35): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    // Narrowed octahedra, tilted inward — reads angry, not googly.
    out.push(
      part(
        new OctahedronGeometry(r, 0),
        Role.Glow,
        place(side * cx, cy, cz, 1, 0.55, 0.5, 0, 0, side * tilt),
      ),
    );
  }
  return out;
}

/** Husk — the crowd: a parched crystal boulder that tumbles forward. */
function husk(): BufferGeometry {
  return mergeGeometries([
    part(new IcosahedronGeometry(1, 0), Role.Body, place(0, 0, 0, 1, 0.9, 1)),
    // A ridge of crust plates along the crown.
    part(new TetrahedronGeometry(0.34, 0), Role.Accent, place(0, 0.82, 0.1, 1, 1, 1, 0.4, 0.8, 0)),
    part(new TetrahedronGeometry(0.26, 0), Role.Accent, place(-0.35, 0.7, 0.3, 1, 1, 1, 0.2, 2.1, 0)),
    ...eyes(0.34, 0.12, -0.88, 0.2),
  ])!;
}

/** Skitter — small, spiky, fast: a shard that runs. */
function skitter(): BufferGeometry {
  return mergeGeometries([
    part(new OctahedronGeometry(1, 0), Role.Body, place(0, 0, 0, 0.75, 1.05, 0.75)),
    // Swept side-spikes, like it's permanently mid-dash.
    part(new TetrahedronGeometry(0.35, 0), Role.Accent, place(-0.6, 0.05, 0.45, 1, 1, 1, 0, 0.7, 0.4)),
    part(new TetrahedronGeometry(0.35, 0), Role.Accent, place(0.6, 0.05, 0.45, 1, 1, 1, 0, -0.7, -0.4)),
    ...eyes(0.24, 0.18, -0.62, 0.16, 0.5),
  ])!;
}

/** Spitter — the ranged one: a leaning obelisk with a glowing maw. */
function spitter(): BufferGeometry {
  return mergeGeometries([
    // Diamond pillar: two 4-sided cones base to base.
    part(new ConeGeometry(0.62, 1.1, 4), Role.Body, place(0, 0.55, 0)),
    part(new ConeGeometry(0.62, 0.9, 4), Role.Body, place(0, -0.45, 0, 1, 1, 1, Math.PI, 0, 0)),
    // The maw it lobs from: a dark socket with a glow core.
    part(new OctahedronGeometry(0.3, 0), Role.Maw, place(0, 0.35, -0.5, 1, 0.8, 0.5)),
    part(new OctahedronGeometry(0.16, 0), Role.Glow, place(0, 0.35, -0.56, 1, 0.7, 0.5)),
    ...eyes(0.3, 0.72, -0.28, 0.14, 0.6),
  ])!;
}

/** Clod — the tank: a rubble golem, slabs stacked and askew. */
function clod(): BufferGeometry {
  return mergeGeometries([
    part(new BoxGeometry(1.6, 0.75, 1.25), Role.Body, place(0, -0.4, 0, 1, 1, 1, 0, 0.08, 0.03)),
    part(new BoxGeometry(1.25, 0.7, 1.0), Role.Body, place(0.05, 0.22, 0.03, 1, 1, 1, 0, -0.12, -0.04)),
    part(new BoxGeometry(0.85, 0.55, 0.75), Role.Body, place(-0.04, 0.78, 0, 1, 1, 1, 0, 0.18, 0.05)),
    // Crust shoulder plates.
    part(new TetrahedronGeometry(0.4, 0), Role.Accent, place(-0.7, 0.55, 0.15, 1, 1, 1, 0.3, 1.2, 0)),
    part(new TetrahedronGeometry(0.4, 0), Role.Accent, place(0.7, 0.5, 0.1, 1, 1, 1, -0.2, 2.4, 0)),
    ...eyes(0.22, 0.8, -0.42, 0.13, 0.55),
  ])!;
}

/** Cluster — a shivering aggregate of shards that flies apart when it dies. */
function cluster(): BufferGeometry {
  const shards: BufferGeometry[] = [];
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.5;
    shards.push(
      part(
        new TetrahedronGeometry(0.5 + (i % 2) * 0.16, 0),
        i % 3 === 0 ? Role.Accent : Role.Body,
        place(Math.cos(a) * 0.55, Math.sin(a * 1.9) * 0.4, Math.sin(a) * 0.55, 1, 1, 1, a, a * 1.3, 0),
      ),
    );
  }
  return mergeGeometries([
    part(new OctahedronGeometry(0.72, 0), Role.Body),
    ...shards,
    ...eyes(0.26, 0.14, -0.68, 0.17, 0.5),
  ])!;
}

/** THE DROUGHT — the boss: a monolith wearing a crown of dead spires. */
function drought(): BufferGeometry {
  const crown: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    crown.push(
      part(
        new ConeGeometry(0.11, 0.5 + (i % 2) * 0.2, 4),
        Role.Accent,
        place(Math.cos(a) * 0.55, 1.05, Math.sin(a) * 0.55, 1, 1, 1, 0, 0, 0),
      ),
    );
  }
  return mergeGeometries([
    part(new IcosahedronGeometry(1, 0), Role.Body, place(0, 0, 0, 1, 1.15, 1)),
    // A fissure maw low on the face.
    part(new BoxGeometry(0.65, 0.18, 0.3), Role.Maw, place(0, -0.3, -0.88, 1, 1, 1, 0, 0, 0.08)),
    ...crown,
    ...eyes(0.36, 0.3, -0.85, 0.24, 0.45),
  ])!;
}

let cache: Record<number, BufferGeometry> | undefined;

/** The per-kind body geometry, built once and shared by every instance. */
export function enemyGeometry(kind: EnemyKindId): BufferGeometry {
  if (!cache) {
    cache = {
      [EnemyKind.Drifter]: husk(),
      [EnemyKind.Scurrier]: skitter(),
      [EnemyKind.Lobber]: spitter(),
      [EnemyKind.Brute]: clod(),
      [EnemyKind.Splitter]: cluster(),
      [EnemyKind.Boss]: drought(),
    };
  }
  return cache[kind];
}
