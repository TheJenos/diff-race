import { q } from './dmath';
import { GRID_DEPTH } from './grid';
import type { Rng } from './rng';
import type { TrackKerb, TrackPad, TrackRamp } from './types';

/*
 * What's on the road: ramps on straights, weapon pads (sword arms offence, shield arms defence),
 * kerbs on the inside of bends. Everything in track coordinates. Pure.
 */

export interface FeatureInput {
  n: number;
  ds: number;
  curvature: ArrayLike<number>;
  halfWidth: ArrayLike<number>;
  line: ArrayLike<number>;
  /** Heights, for keeping ramps off crests */
  y: ArrayLike<number>;
}

/** Ramp length and how far past it must be straight and flat (m) */
const RAMP_LEN = 9;
const RAMP_LANDING = 45;
/** Start zone that stays clear of everything but the grid (m behind, ahead of the line) */
const CLEAR_BEHIND = GRID_DEPTH + 20;
const CLEAR_AHEAD = 50;

const inStartZone = (s: number, lap: number) => s < CLEAR_AHEAD || s > lap - CLEAR_BEHIND;

export function placeRamps(rng: Rng, f: FeatureInput): TrackRamp[] {
  const lap = f.n * f.ds;
  const count = rng.weighted<number>([[0, 0.3], [1, 0.45], [2, 0.25]]);
  const span = Math.ceil((RAMP_LEN + RAMP_LANDING) / f.ds);
  const candidates: number[] = [];
  for (let i = 0; i < f.n; i += 3) {
    const s = i * f.ds;
    if (inStartZone(s, lap) || inStartZone(s + RAMP_LEN + RAMP_LANDING, lap)) continue;
    let ok = true;
    for (let k = -4; k <= span && ok; k++) {
      const j = (i + k + f.n) % f.n;
      if (Math.abs(f.curvature[j] as number) > 0.006) ok = false;
      const a = f.y[j] as number;
      const b = f.y[(j + 1) % f.n] as number;
      if (Math.abs(b - a) > 0.04 * f.ds) ok = false;
    }
    if (ok) candidates.push(i);
  }
  const ramps: TrackRamp[] = [];
  for (let k = 0; k < count && candidates.length; k++) {
    const i = rng.pick(candidates);
    const s = i * f.ds;
    if (ramps.some((r) => Math.abs(r.s - s) < 150)) continue;
    const hw = f.halfWidth[i] as number;
    const full = rng.chance(0.4);
    const left = rng.chance(0.5);
    ramps.push({
      s: q(s),
      len: RAMP_LEN,
      h: q(rng.range(1.0, 1.6)),
      u0: q(full ? -hw + 0.8 : left ? -hw + 0.8 : 1),
      u1: q(full ? hw - 0.8 : left ? -1 : hw - 0.8),
    });
  }
  return ramps.sort((a, b) => a.s - b.s);
}

export function placePads(rng: Rng, f: FeatureInput, ramps: readonly TrackRamp[]): TrackPad[] {
  const lap = f.n * f.ds;
  const want: Record<'sword' | 'shield', number> = { sword: rng.int(3, 5), shield: rng.int(3, 5) };
  const pads: TrackPad[] = [];
  const groups: number[] = [];
  const candidates: number[] = [];
  for (let s = 0; s < lap; s += 6) {
    if (inStartZone(s, lap)) continue;
    if (ramps.some((r) => s > r.s - 25 && s < r.s + r.len + RAMP_LANDING)) continue;
    candidates.push(s);
  }
  let guard = 0;
  while ((want.sword > 0 || want.shield > 0) && candidates.length && guard++ < 200) {
    const s = rng.pick(candidates);
    if (groups.some((g) => Math.abs(g - s) < 70 || Math.abs(g - s) > lap - 70)) continue;
    const i = Math.floor(s / f.ds) % f.n;
    const hw = f.halfWidth[i] as number;
    const line = f.line[i] as number;
    groups.push(s);
    if (want.sword > 0 && want.shield > 0 && rng.chance(0.4)) {
      // A pair across the road: pick your weapon.
      const side = rng.chance(0.5) ? 1 : -1;
      const u = rng.range(3, hw - 2.5);
      pads.push({ s: q(s), u: q(side * u), kind: 'sword' }, { s: q(s), u: q(-side * u), kind: 'shield' });
      want.sword--;
      want.shield--;
      continue;
    }
    const kind = want.sword > 0 && (want.shield <= 0 || rng.chance(0.5)) ? 'sword' : 'shield';
    want[kind]--;
    // Half sit on the racing line, half off it: grabbing one costs you the line.
    const onLine = rng.chance(0.5);
    const u = onLine
      ? Math.max(-hw + 2, Math.min(hw - 2, line + rng.range(-1.2, 1.2)))
      : (line >= 0 ? -1 : 1) * rng.range(3, hw - 2.5);
    pads.push({ s: q(s), u: q(u), kind });
  }
  return pads.sort((a, b) => a.s - b.s || a.u - b.u);
}

/** Kerbs on the inside of every real bend */
export function placeKerbs(f: FeatureInput): TrackKerb[] {
  const runs: TrackKerb[] = [];
  const bend = (i: number) => {
    const k = f.curvature[i] as number;
    return Math.abs(k) > 1 / 70 ? (k > 0 ? 1 : -1) : 0;
  };
  // Start the scan on a sample that isn't in a bend, so no run wraps unseen.
  let start = 0;
  while (start < f.n && bend(start) !== 0) start++;
  if (start === f.n) return runs;
  let runStart = -1;
  let side = 0;
  for (let k = 1; k <= f.n; k++) {
    const i = (start + k) % f.n;
    const b = bend(i);
    if (b !== 0 && runStart < 0) {
      runStart = i;
      side = b;
    } else if (runStart >= 0 && b !== side) {
      const len = (i - runStart + f.n) % f.n;
      if (len >= 6) runs.push({ i0: (runStart - 3 + f.n) % f.n, i1: (i + 2) % f.n, side: side as 1 | -1 });
      runStart = b !== 0 ? i : -1;
      side = b;
    }
  }
  return runs;
}

/** How far past a skull pad its trap springs (m) */
export const TRAP_AHEAD = 85;

/**
 * Skull pads: one or two a lap, each where its trap (TRAP_AHEAD further on) lands on a straight
 * stretch clear of the start, and away from the other pads.
 */
export function placeSkulls(rng: Rng, f: FeatureInput, taken: readonly TrackPad[], ramps: readonly TrackRamp[]): TrackPad[] {
  const lap = f.n * f.ds;
  const want = rng.int(1, 2);
  const out: TrackPad[] = [];
  const candidates: number[] = [];
  for (let s = 0; s < lap; s += 8) {
    const trap = s + TRAP_AHEAD;
    if (inStartZone(s, lap) || inStartZone(trap % lap, lap)) continue;
    if (ramps.some((r) => Math.abs(r.s - trap) < 40 || Math.abs(r.s - s) < 30)) continue;
    if (taken.some((p) => Math.abs(p.s - s) < 50)) continue;
    // A trap in a tight bend would be a wall nobody can see coming: keep it to gentle stretches.
    const i = Math.floor((trap % lap) / f.ds) % f.n;
    if (Math.abs(f.curvature[i] as number) > 1 / 80) continue;
    candidates.push(s);
  }
  for (let k = 0; k < 40 && out.length < want && candidates.length; k++) {
    const s = rng.pick(candidates);
    if (out.some((p) => Math.abs(p.s - s) < lap / 4)) continue;
    const i = Math.floor(s / f.ds) % f.n;
    const hw = f.halfWidth[i] as number;
    out.push({ s: q(s), u: q(rng.range(-hw + 3, hw - 3)), kind: 'skull' });
  }
  return out;
}
