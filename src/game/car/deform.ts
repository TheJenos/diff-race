import type { DamageSource } from './damage';

/*
 * Crash damage you can see: the car's panels pushed in where it was hit. Pure (typed arrays in,
 * changed in place), so the same maths dents the body, the glass and the trim alike and the parts
 * stay together.
 *
 * A dent is where a blow met the car (car space), the way it pushed (into the car) and how deep
 * and wide it is (m): each vertex within reach moves along the blow, most at the middle and none at
 * the edge, crumpled a little (by a smooth fixed noise of where the vertex started), and never further
 * from where it started than MAX_SAG however often it's hit. A hard ram caves a panel in, a blast
 * leaves a wide crater, bullets pit the paint.
 */

export interface Dent {
  x: number; y: number; z: number;
  /** The blow's direction, into the car (unit) */
  dx: number; dy: number; dz: number;
  depth: number;
  radius: number;
}

/** Furthest any vertex is pushed from where it started (m): a car caves in, it doesn't fold flat */
export const MAX_SAG = 0.32;

/** How big a dent a hit makes, by what did it and how much it hurt; null for none (fire, falls) */
export function dentSize(source: DamageSource, amount: number): { depth: number; radius: number } | null {
  if (!(amount > 0)) return null;
  switch (source) {
    case 'gun':
      // A pock mark per round.
      return { depth: 0.022 + Math.min(0.012, amount * 0.004), radius: 0.2 };
    case 'ram':
    case 'barrier':
      if (amount < 1) return null;
      return { depth: Math.min(0.26, amount * 0.0065), radius: 0.4 + Math.min(0.6, amount * 0.014) };
    case 'missile':
    case 'mine':
      return { depth: Math.min(0.2, amount * 0.006), radius: 0.7 + Math.min(0.5, amount * 0.015) };
    default:
      return null;
  }
}

/**
 * A smooth, fixed 0..1 noise of a position, in folds about 0.4 m apart: the same place crumples
 * the same way, and neighbouring vertices together (metal folds; it doesn't shred).
 */
function crumple(x: number, y: number, z: number): number {
  const a = Math.sin(x * 11.3 + y * 4.1 + 1.7) * Math.sin(z * 9.7 + x * 3.3 + 0.4);
  const b = Math.sin(y * 13.1 + z * 7.9 + 2.2) * Math.sin(x * 8.3 - z * 5.2 + 1.1);
  return 0.5 + 0.25 * (a + b);
}

/**
 * Push the vertices of one mesh (`pos`, xyz per vertex; `rest`, where they started) in for `d`.
 * Each one moved is flagged in `moved`; returns whether any were.
 */
export function dentVertices(pos: Float32Array, rest: ArrayLike<number>, d: Dent, moved: Uint8Array): boolean {
  const r2 = d.radius * d.radius;
  let any = false;
  for (let i = 0, n = pos.length / 3; i < n; i++) {
    const o = i * 3;
    const rx = rest[o] as number;
    const ry = rest[o + 1] as number;
    const rz = rest[o + 2] as number;
    // Reach is measured from where the vertex started, so a dent stays round however deep it gets.
    const ex = rx - d.x;
    const ey = ry - d.y;
    const ez = rz - d.z;
    const q = (ex * ex + ey * ey + ez * ez) / r2;
    if (q >= 1) continue;
    const w = (1 - q) * (1 - q) * d.depth * (0.7 + 0.6 * crumple(rx, ry, rz));
    let ox = (pos[o] as number) + d.dx * w - rx;
    let oy = (pos[o + 1] as number) + d.dy * w - ry;
    let oz = (pos[o + 2] as number) + d.dz * w - rz;
    const l = Math.hypot(ox, oy, oz);
    if (l > MAX_SAG) {
      const k = MAX_SAG / l;
      ox *= k;
      oy *= k;
      oz *= k;
    }
    pos[o] = rx + ox;
    pos[o + 1] = ry + oy;
    pos[o + 2] = rz + oz;
    moved[i] = 1;
    any = true;
  }
  return any;
}

/**
 * Fresh normals for the vertices flagged in `moved`, from the faces around them (area-weighted);
 * the rest keep the ones they were made with, so a dent doesn't redo the whole car's shading.
 */
export function renormal(pos: ArrayLike<number>, normal: Float32Array, index: ArrayLike<number> | null, moved: Uint8Array): void {
  const count = index ? index.length : pos.length / 3;
  const acc = new Float32Array(normal.length);
  for (let t = 0; t + 2 < count; t += 3) {
    const a = index ? (index[t] as number) : t;
    const b = index ? (index[t + 1] as number) : t + 1;
    const c = index ? (index[t + 2] as number) : t + 2;
    if (!moved[a] && !moved[b] && !moved[c]) continue;
    const ux = (pos[b * 3] as number) - (pos[a * 3] as number);
    const uy = (pos[b * 3 + 1] as number) - (pos[a * 3 + 1] as number);
    const uz = (pos[b * 3 + 2] as number) - (pos[a * 3 + 2] as number);
    const vx = (pos[c * 3] as number) - (pos[a * 3] as number);
    const vy = (pos[c * 3 + 1] as number) - (pos[a * 3 + 1] as number);
    const vz = (pos[c * 3 + 2] as number) - (pos[a * 3 + 2] as number);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      acc[v * 3] = (acc[v * 3] as number) + nx;
      acc[v * 3 + 1] = (acc[v * 3 + 1] as number) + ny;
      acc[v * 3 + 2] = (acc[v * 3 + 2] as number) + nz;
    }
  }
  for (let i = 0, n = moved.length; i < n; i++) {
    if (!moved[i]) continue;
    const o = i * 3;
    const l = Math.hypot(acc[o] as number, acc[o + 1] as number, acc[o + 2] as number);
    if (l < 1e-12) continue;
    normal[o] = (acc[o] as number) / l;
    normal[o + 1] = (acc[o + 1] as number) / l;
    normal[o + 2] = (acc[o + 2] as number) / l;
  }
}

export interface Bounds { min: [number, number, number]; max: [number, number, number] }

/**
 * Where a blow coming from (px, py, pz) along (dx, dy, dz) first meets the car's box (car space).
 * One that misses it (a blast to one side) lands where that direction leaves the box from its
 * middle, the side facing the blow.
 */
export function landing(px: number, py: number, pz: number, dx: number, dy: number, dz: number, b: Bounds): [number, number, number] {
  const p = [px, py, pz];
  const d = [dx, dy, dz];
  const lo = b.min;
  const hi = b.max;
  let near = -Infinity;
  let far = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = d[k]!;
    const pk = p[k]!;
    if (Math.abs(dk) < 1e-9) {
      if (pk < lo[k]! || pk > hi[k]!) {
        near = Infinity;
        break;
      }
      continue;
    }
    const t1 = (lo[k]! - pk) / dk;
    const t2 = (hi[k]! - pk) / dk;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (near <= far && far >= 0) {
    const t = Math.max(0, near);
    return [px + dx * t, py + dy * t, pz + dz * t];
  }
  // Missed: from the box's middle back toward where the blow came from, to the box's face.
  const c = [0, 1, 2].map((k) => (lo[k]! + hi[k]!) / 2);
  let t = Infinity;
  for (let k = 0; k < 3; k++) {
    const dk = -d[k]!;
    if (Math.abs(dk) < 1e-9) continue;
    t = Math.min(t, ((dk > 0 ? hi[k]! : lo[k]!) - c[k]!) / dk);
  }
  if (!Number.isFinite(t)) t = 0;
  return [c[0]! - dx * t, c[1]! - dy * t, c[2]! - dz * t];
}
