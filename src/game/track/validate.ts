import { len } from './dmath';
import { BOUNDS, MIN_RADIUS } from './params';
import { BARRIER_THICK } from './constants';

/*
 * Whether a generated track can be raced: arms of the loop far enough apart that their barriers
 * don't touch, no bend tighter than MIN_RADIUS, slopes and crests within limits, a closed loop
 * inside the bounds. Returns why not (for check-tracks' report), or null. Pure.
 */

export interface Candidate {
  /** 3 per sample */
  pos: ArrayLike<number>;
  n: number;
  ds: number;
  halfWidth: ArrayLike<number>;
  verge: number;
  curvature: ArrayLike<number>;
}

/** Clear ground required between two arms' barriers (m) */
const ARM_GAP = 8;
/**
 * Sharpest crest or dip: change of slope per metre. At 50 m/s a crest of 0.007 pulls up at
 * v²κ ≈ 17 m/s², about gravity: cars go light over the top but stay on the road.
 */
const MAX_CREST = 0.007;
/** Crests are measured over this many samples each side, so centimetre rounding doesn't count */
const CREST_SPAN = 5;

export function validate(c: Candidate): string | null {
  const { n, ds, pos, halfWidth, verge, curvature } = c;
  const x = (i: number) => pos[i * 3] as number;
  const y = (i: number) => pos[i * 3 + 1] as number;
  const z = (i: number) => pos[i * 3 + 2] as number;

  for (let i = 0; i < n; i++) {
    if (Math.abs(x(i)) > BOUNDS || Math.abs(z(i)) > BOUNDS) return 'out-of-bounds';
    if (Math.abs(curvature[i] as number) > 1 / MIN_RADIUS) return 'too-tight';
  }
  // Crests: the second difference of height, per metre squared.
  const span = CREST_SPAN * ds;
  for (let i = 0; i < n; i++) {
    const a = y((i - CREST_SPAN + n) % n);
    const b = y(i);
    const d = y((i + CREST_SPAN) % n);
    if (Math.abs(a - 2 * b + d) / (span * span) > MAX_CREST) return 'crest';
  }

  // Clearance between distant parts of the loop, with a spatial grid of samples.
  let maxHw = 0;
  for (let i = 0; i < n; i++) maxHw = Math.max(maxHw, halfWidth[i] as number);
  const need = (i: number, j: number) => (halfWidth[i] as number) + (halfWidth[j] as number) + 2 * (verge + BARRIER_THICK) + ARM_GAP;
  const cell = 2 * maxHw + 2 * (verge + BARRIER_THICK) + ARM_GAP;
  const grid = new Map<number, number[]>();
  const key = (gx: number, gz: number) => (gx + 4096) * 8192 + (gz + 4096);
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(x(i) / cell), Math.floor(z(i) / cell));
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  // Samples closer than this along the loop are the same arm, not a neighbour.
  const sameArm = Math.ceil((cell * 1.6) / ds);
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(x(i) / cell);
    const gz = Math.floor(z(i) / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = grid.get(key(gx + ox, gz + oz));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const gap = Math.min(j - i, n - (j - i));
          if (gap <= sameArm) continue;
          if (len(x(j) - x(i), z(j) - z(i)) < need(i, j)) return 'arms-too-close';
        }
      }
    }
  }
  // Closure: the last sample leads back to the first.
  if (len(x(0) - x(n - 1), z(0) - z(n - 1)) > ds * 1.6) return 'not-closed';
  return null;
}
