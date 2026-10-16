import { GRID_DEPTH } from './grid';
import { START_STRAIGHT, STRAIGHT_KAPPA } from './params';

/*
 * Where the start line goes: on the loop's straightest stretch long enough for the grid behind
 * the line and a run to the first bend. Returns the sample to become sample 0, or -1. Pure.
 */

export function pickStart(kappa: readonly number[], ds: number): number {
  const n = kappa.length;
  const behind = Math.ceil((GRID_DEPTH + 8) / ds);
  const ahead = Math.ceil(Math.max(0, START_STRAIGHT - GRID_DEPTH - 8) / ds);
  let best = -1;
  let bestMax = Infinity;
  for (let c = 0; c < n; c++) {
    let worst = 0;
    for (let k = -behind; k <= ahead; k++) {
      const v = Math.abs(kappa[(((c + k) % n) + n) % n] as number);
      if (v > worst) worst = v;
      if (worst >= bestMax) break;
    }
    if (worst < bestMax) {
      bestMax = worst;
      best = c;
    }
  }
  return bestMax < STRAIGHT_KAPPA ? best : -1;
}

/** `a` rotated so element `start` (each item `stride` numbers wide) comes first */
export function rotate(a: readonly number[], start: number, stride: number): number[] {
  const n = a.length / stride;
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    for (let j = 0; j < stride; j++) out.push(a[i * stride + j] as number);
  }
  return out;
}

/** Box-filtered copy of a loop of numbers (radius `r` samples each side) */
export function smoothLoop(a: readonly number[], r: number): number[] {
  const n = a.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += a[(((i + k) % n) + n) % n] as number;
    out.push(sum / (2 * r + 1));
  }
  return out;
}
