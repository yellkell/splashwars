/**
 * THE FIELD — the tower-defense board: one grid, the walls on it, the
 * portal the enemies pour from, and the FLOW FIELDS that steer them.
 *
 * A square cell grid centres on the tower the moment it's planted. Bought
 * WALL pieces occupy cells; two Dijkstra passes over the open cells give
 * every cell a direction:
 *  - the ATTACK field descends toward the tower — every machine simply
 *    follows the arrow under its feet, which routes the whole swarm around
 *    any maze you build with zero per-enemy pathfinding;
 *  - the FLEE field descends toward the portal — a Sipper that lands its
 *    drink runs the maze BACK to the door it came from.
 *
 * The fields recompute only when the board changes (a wall placed, the
 * tower planted) — never per frame, never per enemy. `canPlaceWall` refuses
 * any placement that would disconnect portal from tower: you may funnel THE
 * THIRST, you may not brick it out (it's a maze, not a moat).
 *
 * Plain module singleton, same pattern as tower/shop: EnemySystem steers by
 * it, TurretSystem builds on it, JuiceSystem splats balls against it.
 */

import { Vector3 } from 'three';
import { FIELD, PORTAL } from '../config.js';

export const CELL = FIELD.cell;
const HALF = FIELD.half;
const SIZE = HALF * 2 + 1;
const CELLS = SIZE * SIZE;
const UNREACHED = 1e9;

/** Where the enemies come from. Valid once `setup` has run. */
export const portal = new Vector3(0, PORTAL.height, -6);

const origin = new Vector3(); // tower position — the grid's centre
let ready = false;

const walls = new Uint8Array(CELLS);
let wallCountLive = 0;

// Attack field (descend → tower) and flee field (descend → portal).
const dist = new Float64Array(CELLS);
const flowX = new Float32Array(CELLS);
const flowZ = new Float32Array(CELLS);
const fleeDist = new Float64Array(CELLS);
const fleeX = new Float32Array(CELLS);
const fleeZ = new Float32Array(CELLS);
// Scratch for trial placements, so live steering fields never see them.
const scratch = new Float64Array(CELLS);

// 8-neighbour offsets with their step costs (diagonals √2).
const NBR: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const idx = (ix: number, iz: number): number => ix * SIZE + iz;
const inBounds = (ix: number, iz: number): boolean => ix >= 0 && ix < SIZE && iz >= 0 && iz < SIZE;

export function cellOf(x: number, z: number): { ix: number; iz: number } {
  return {
    ix: Math.round((x - origin.x) / CELL) + HALF,
    iz: Math.round((z - origin.z) / CELL) + HALF,
  };
}

/** World-space centre of a cell. */
export function cellCentre(ix: number, iz: number, out: Vector3): Vector3 {
  return out.set(origin.x + (ix - HALF) * CELL, 0, origin.z + (iz - HALF) * CELL);
}

export function wallCount(): number {
  return wallCountLive;
}

/** Is this world point inside a wall cell? (Balls burst, enemies slide.) */
export function wallAt(x: number, z: number): boolean {
  if (!ready) return false;
  const { ix, iz } = cellOf(x, z);
  return inBounds(ix, iz) && walls[idx(ix, iz)] === 1;
}

/**
 * Plant the board: called when the tower is placed (and again on AGAIN).
 * The portal opens PAST the tower along the line you were standing on, so
 * the lane runs portal → maze → tower with you behind it.
 */
export function setupField(towerPos: Vector3, headPos: Vector3): void {
  origin.copy(towerPos);
  const dx = towerPos.x - headPos.x;
  const dz = towerPos.z - headPos.z;
  const d = Math.hypot(dx, dz) || 1;
  portal.set(
    towerPos.x + (dx / d) * PORTAL.distance,
    PORTAL.height,
    towerPos.z + (dz / d) * PORTAL.distance,
  );
  ready = true;
  recompute();
}

export function clearWalls(): void {
  walls.fill(0);
  wallCountLive = 0;
  if (ready) recompute();
}

/**
 * May a wall go on this cell? No stacking, keep clear of the tower's feet
 * and the portal mouth — and NEVER seal the only way through.
 */
export function canPlaceWall(ix: number, iz: number): boolean {
  if (!ready || !inBounds(ix, iz) || walls[idx(ix, iz)] === 1) return false;
  const cx = origin.x + (ix - HALF) * CELL;
  const cz = origin.z + (iz - HALF) * CELL;
  if (Math.hypot(cx - origin.x, cz - origin.z) < 0.65) return false;
  if (Math.hypot(cx - portal.x, cz - portal.z) < 0.95) return false;
  // Trial-place, test connectivity, revert. Dijkstra on ~840 cells is far
  // below frame budget and only runs while a ghost is out.
  walls[idx(ix, iz)] = 1;
  const open = pathExists();
  walls[idx(ix, iz)] = 0;
  return open;
}

/** Commit a wall and re-route everyone. Assumes canPlaceWall said yes. */
export function addWall(ix: number, iz: number): void {
  walls[idx(ix, iz)] = 1;
  wallCountLive++;
  recompute();
}

/**
 * The arrow under a world point in the ATTACK field (toward the tower).
 * False = off the board or unreachable; caller falls back to a straight
 * line (also what THE GULP always does — it's too big to respect a maze).
 */
export function flowAt(x: number, z: number, out: Vector3): boolean {
  if (!ready) return false;
  const { ix, iz } = cellOf(x, z);
  if (!inBounds(ix, iz)) return false;
  const i = idx(ix, iz);
  if (dist[i] >= UNREACHED) return false;
  out.set(flowX[i], 0, flowZ[i]);
  return out.lengthSq() > 1e-6;
}

/** Same, for the FLEE field (toward the portal). */
export function fleeAt(x: number, z: number, out: Vector3): boolean {
  if (!ready) return false;
  const { ix, iz } = cellOf(x, z);
  if (!inBounds(ix, iz)) return false;
  const i = idx(ix, iz);
  if (fleeDist[i] >= UNREACHED) return false;
  out.set(fleeX[i], 0, fleeZ[i]);
  return out.lengthSq() > 1e-6;
}

// ---------------------------------------------------------------------------
// Internals: Dijkstra over the open cells.
// ---------------------------------------------------------------------------

/** Corner rule: a diagonal step needs both flanking orthogonals open. */
function stepOpen(ix: number, iz: number, dx: number, dz: number): boolean {
  const nx = ix + dx;
  const nz = iz + dz;
  if (!inBounds(nx, nz) || walls[idx(nx, nz)] === 1) return false;
  if (dx !== 0 && dz !== 0) {
    if (walls[idx(ix + dx, iz)] === 1 || walls[idx(ix, iz + dz)] === 1) return false;
  }
  return true;
}

/** Distances from one seed cell across the open board (into `d`). */
function sweep(seedIx: number, seedIz: number, d: Float64Array): void {
  d.fill(UNREACHED);
  if (!inBounds(seedIx, seedIz)) return;
  d[idx(seedIx, seedIz)] = 0;
  // Small board: an array-scan Dijkstra is simpler than a heap and still
  // ~sub-millisecond at 29×29. Runs only when the board changes.
  const done = new Uint8Array(CELLS);
  for (;;) {
    let best = -1;
    let bestD = UNREACHED;
    for (let i = 0; i < CELLS; i++) {
      if (!done[i] && d[i] < bestD) {
        bestD = d[i];
        best = i;
      }
    }
    if (best < 0) break;
    done[best] = 1;
    const ix = (best / SIZE) | 0;
    const iz = best % SIZE;
    for (const [dx, dz, cost] of NBR) {
      if (!stepOpen(ix, iz, dx, dz)) continue;
      const ni = idx(ix + dx, iz + dz);
      const nd = bestD + cost;
      if (nd < d[ni]) d[ni] = nd;
    }
  }
}

/** Turn a distance field into per-cell unit arrows (descend the field). */
function toArrows(d: Float64Array, ax: Float32Array, az: Float32Array): void {
  for (let ix = 0; ix < SIZE; ix++) {
    for (let iz = 0; iz < SIZE; iz++) {
      const i = idx(ix, iz);
      ax[i] = 0;
      az[i] = 0;
      if (d[i] >= UNREACHED || walls[i] === 1) continue;
      let bestD = d[i];
      let bx = 0;
      let bz = 0;
      for (const [dx, dz] of NBR) {
        if (!stepOpen(ix, iz, dx, dz)) continue;
        const nd = d[idx(ix + dx, iz + dz)];
        if (nd < bestD) {
          bestD = nd;
          bx = dx;
          bz = dz;
        }
      }
      const len = Math.hypot(bx, bz);
      if (len > 0) {
        ax[i] = bx / len;
        az[i] = bz / len;
      }
    }
  }
}

/** Is the portal still connected to the tower? (Walls as currently set.) */
function pathExists(): boolean {
  const t = cellOf(origin.x, origin.z);
  const p = cellOf(portal.x, portal.z);
  sweep(t.ix, t.iz, scratch); // scratch — the live fields stay untouched
  return inBounds(p.ix, p.iz) && scratch[idx(p.ix, p.iz)] < UNREACHED;
}

function recompute(): void {
  const t = cellOf(origin.x, origin.z);
  const p = cellOf(portal.x, portal.z);
  sweep(t.ix, t.iz, dist);
  toArrows(dist, flowX, flowZ);
  sweep(p.ix, p.iz, fleeDist);
  toArrows(fleeDist, fleeX, fleeZ);
}
