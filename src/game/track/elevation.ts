import { clamp, smoothstep } from './dmath';
import { loopNoise } from './noise1d';
import { MAX_SLOPE } from './params';
import type { Rng } from './rng';
import { smoothLoop } from './start';

/*
 * Hills: long smooth noise round the loop, faded out through the start (the grid must be level
 * and the line visible), clipped so no stretch is steeper than MAX_SLOPE, then smoothed again so
 * the clipping leaves no kinks (a kink is a crest that throws cars in the air). Pure.
 */

/** Metres between noise knots: rolling hills, not bumps */
const KNOT_SPACING = 130;
/** Metres over which the start's level ground fades into the hills */
const FADE = 110;

/**
 * Heights (m) for `n` samples `ds` apart. Sample 0 is the start line; `flatBehind` and
 * `flatAhead` metres around it stay level.
 */
export function elevation(rng: Rng, n: number, ds: number, amp: number, flatBehind: number, flatAhead: number): number[] {
  const raw = loopNoise(rng, n, KNOT_SPACING / ds, amp);
  const base = raw[0] as number;
  let h = raw.map((v, i) => {
    // Distance from the start line, signed (behind is negative).
    const s = i * ds;
    const d = s > (n * ds) / 2 ? s - n * ds : s;
    const w = d < 0 ? smoothstep(flatBehind, flatBehind + FADE, -d) : smoothstep(flatAhead, flatAhead + FADE, d);
    return base + (v - base) * w;
  });
  const radius = Math.max(2, Math.round(12 / ds));
  for (let k = 0; k < 2; k++) h = smoothLoop(h, radius);
  // Slope limit, forward then backward round the loop (twice, so the wrap settles too).
  const step = MAX_SLOPE * ds;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i <= n; i++) {
      const a = h[(i - 1) % n] as number;
      h[i % n] = clamp(h[i % n] as number, a - step, a + step);
    }
    for (let i = n - 1; i >= 0; i--) {
      const a = h[(i + 1) % n] as number;
      h[i] = clamp(h[i] as number, a - step, a + step);
    }
  }
  for (let k = 0; k < 3; k++) h = smoothLoop(h, radius);
  // Level the start line at 0.
  const zero = h[0] as number;
  return h.map((v) => v - zero);
}
