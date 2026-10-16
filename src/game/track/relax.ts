import { planarCurvature } from './resample';

/*
 * Easing bends that are too tight: wherever the curvature is over the limit, nudge the point
 * toward the midpoint of its neighbours (and its neighbours a little), and repeat. Only the tight
 * spots move, so the circuit keeps its character. The tighter a spot, the more road either side
 * shares the fix, so a kink opens into a bend in tens of passes rather than hundreds. Pure
 * (+ - * / sqrt only).
 */

const PASSES = 300;
/** Samples each side a fix is spread over: this many, plus SPREAD_PER for each limit's worth over */
const SPREAD = 3;
const SPREAD_PER = 2;
const SPREAD_MAX = 12;

/** Relax an even closed loop (x, z interleaved) in place until no curvature exceeds `limit`. Returns whether it got there. */
export function relaxTight(xz: number[], ds: number, limit: number): boolean {
  const n = xz.length / 2;
  for (let pass = 0; pass < PASSES; pass++) {
    const kappa = planarCurvature(xz, ds);
    let worst = 0;
    for (const v of kappa) worst = Math.max(worst, Math.abs(v));
    if (worst <= limit) return true;
    for (let i = 0; i < n; i++) {
      const over = Math.abs(kappa[i] as number) / limit;
      if (over <= 0.8) continue;
      // Spread the fix over samples each side so the bend opens out evenly.
      const spread = Math.min(SPREAD_MAX, SPREAD + Math.floor(over * SPREAD_PER));
      for (let k = -spread; k <= spread; k++) {
        const j = (((i + k) % n) + n) % n;
        const a = (j - 1 + n) % n;
        const b = (j + 1) % n;
        const w = 0.35 * (1 - Math.abs(k) / (spread + 1));
        const mx = ((xz[a * 2] as number) + (xz[b * 2] as number)) / 2;
        const mz = ((xz[a * 2 + 1] as number) + (xz[b * 2 + 1] as number)) / 2;
        xz[j * 2] = (xz[j * 2] as number) + (mx - (xz[j * 2] as number)) * w;
        xz[j * 2 + 1] = (xz[j * 2 + 1] as number) + (mz - (xz[j * 2 + 1] as number)) * w;
      }
    }
  }
  return false;
}
