/**
 * Deterministic maths for the track generator. Every client must build bit-identical tracks from
 * the same seed, so the generator only uses + - * /, Math.sqrt (correctly rounded everywhere),
 * floor/round/min/max/abs/sign/imul. Banned in src/game/track (scripts/check-tracks.ts fails on
 * them): Math.hypot, sin, cos, tan, the inverse and hyperbolic functions, exp, log, pow, cbrt,
 * `**` and Math.random, whose results may differ in the last bits between engines.
 *
 * The trig the generator needs comes from `sinCosTurns`, a fixed polynomial: JavaScript never
 * fuses a multiply and an add, so the same sequence of + and * gives the same bits everywhere.
 */

export const TAU = 6.283185307179586;

/** Length of (dx, dz) */
export const len = (dx: number, dz: number): number => Math.sqrt(dx * dx + dz * dz);

/** Length of (x, y, z) */
export const len3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

export const dist = (ax: number, az: number, bx: number, bz: number): number => len(bx - ax, bz - az);

/** Round to the centimetre: every coordinate the generator outputs goes through this. */
export const q = (n: number): number => Math.round(n * 100) / 100;

/** Round to 1/10000: unit vectors and other small numbers the generator outputs */
export const q4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 below e0, 1 above e1, smooth in between */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** `i` wrapped into 0..n-1 (for indices round a closed loop) */
export const wrapIndex = (i: number, n: number): number => ((i % n) + n) % n;

/** A distance along a loop of length `l`, wrapped into (-l/2, l/2] */
export function wrapHalf(d: number, l: number): number {
  let x = d - Math.floor(d / l) * l;
  if (x > l / 2) x -= l;
  return x;
}

/** Sine and cosine of `t` turns (1 turn = 360°), written into `out`. Error below 1e-14. */
export function sinCosTurns(t: number, out: { s: number; c: number }): { s: number; c: number } {
  // Reduce to the nearest quarter turn, leaving |x| <= pi/4 where the series converges fast.
  const r = t - Math.floor(t);
  const k = Math.round(r * 4);
  const x = (r - k / 4) * TAU;
  const x2 = x * x;
  const s = x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
  const c = 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200)))))));
  switch (k & 3) {
    case 0: out.s = s; out.c = c; break;
    case 1: out.s = c; out.c = -s; break;
    case 2: out.s = -s; out.c = -c; break;
    default: out.s = -c; out.c = s; break;
  }
  return out;
}

/** Distance from (px, pz) to the segment a–b, and how far along it the closest point is (0..1). */
export function segDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): { d: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return { d: dist(px, pz, ax + dx * t, az + dz * t), t };
}

/** Whether segments a–b and c–d cross (touching ends don't count). */
export function segIntersect(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz);
  const d2 = o(ax, az, bx, bz, dx, dz);
  const d3 = o(cx, cz, dx, dz, ax, az);
  const d4 = o(cx, cz, dx, dz, bx, bz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
