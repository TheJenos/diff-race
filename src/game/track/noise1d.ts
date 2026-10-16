import type { Rng } from './rng';

/*
 * Smooth random wiggles round a loop: values at evenly spaced knots, joined by a cubic
 * (Catmull-Rom) curve that wraps round, so the end meets the start. Polynomials only:
 * deterministic.
 */

/** `n` values round a loop: knots about every `spacing` samples, each in [-amp, amp] */
export function loopNoise(rng: Rng, n: number, spacing: number, amp: number): number[] {
  const k = Math.max(3, Math.round(n / spacing));
  const knots: number[] = [];
  for (let i = 0; i < k; i++) knots.push(rng.range(-amp, amp));
  const at = (i: number) => knots[((i % k) + k) % k] as number;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / n) * k;
    const j = Math.floor(x);
    const t = x - j;
    const p0 = at(j - 1), p1 = at(j), p2 = at(j + 1), p3 = at(j + 2);
    const t2 = t * t;
    const t3 = t2 * t;
    out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
  }
  return out;
}
