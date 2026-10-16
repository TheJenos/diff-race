import { clamp } from './dmath';

/*
 * The racing line for the bots: how far right of centre to drive at each sample. An elastic band
 * pulled tight round the loop (each point moved toward the midpoint of its neighbours, across the
 * road only) settles on the shortest, least-curved path the road's width allows. Pure.
 */

/** Kept this far from the road edge (m): a car is about 2 m wide */
const EDGE_MARGIN = 2.4;
const ITERATIONS = 220;
/** Neighbours this many samples away pull each point */
const REACH = 4;

export function racingLine(pos: ArrayLike<number>, right: ArrayLike<number>, halfWidth: ArrayLike<number>, n: number): number[] {
  const u = new Array<number>(n).fill(0);
  const px = (i: number) => (pos[i * 3] as number) + (right[i * 3] as number) * (u[i] as number);
  const pz = (i: number) => (pos[i * 3 + 2] as number) + (right[i * 3 + 2] as number) * (u[i] as number);
  for (let it = 0; it < ITERATIONS; it++) {
    for (let i = 0; i < n; i++) {
      const a = (i - REACH + n) % n;
      const b = (i + REACH) % n;
      const mx = (px(a) + px(b)) / 2;
      const mz = (pz(a) + pz(b)) / 2;
      const dx = mx - px(i);
      const dz = mz - pz(i);
      const along = dx * (right[i * 3] as number) + dz * (right[i * 3 + 2] as number);
      const lim = (halfWidth[i] as number) - EDGE_MARGIN;
      u[i] = clamp((u[i] as number) + along * 0.5, -lim, lim);
    }
  }
  return u;
}
