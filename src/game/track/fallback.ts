import { assembleTrack } from './assemble';
import { sinCosTurns, TAU } from './dmath';
import { checkpointsFor, gridSlots } from './grid';
import type { ThemeId, TrackLength, TrackSpec } from './spec';
import type { TrackData, TrackKerb } from './types';

/*
 * The guaranteed track: a stadium oval (two straights joined by half circles). The generator falls
 * back to it if every attempt at a seed fails validation, and it's the test track before the
 * generator exists. Always valid, whatever the size.
 */

/** Straight length and bend radius (m) per track length */
const SIZES: Record<TrackLength, { straight: number; radius: number }> = {
  s: { straight: 420, radius: 70 },
  m: { straight: 600, radius: 95 },
  l: { straight: 900, radius: 140 },
};

export const STADIUM_HALF_WIDTH = 9;
export const STADIUM_VERGE = 6;
/** Where the start line sits along the first straight (0..1), so the grid behind it is on the straight too */
const START_AT = 0.7;

export function stadiumTrack(spec: TrackSpec, theme: ThemeId = spec.theme ?? 'docks'): TrackData {
  const { straight: ls, radius: r } = SIZES[spec.length];
  const arc = (TAU / 2) * r;
  const total = 2 * ls + 2 * arc;
  const n = Math.round(total / 2);
  const ds = total / n;
  const pos = new Float64Array(n * 3);
  const sc = { s: 0, c: 0 };
  const offset = START_AT * ls;
  const arcSamples: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = (i * ds + offset) % total;
    let x: number;
    let z: number;
    if (d < ls) {
      // Bottom straight, heading +x
      x = -ls / 2 + d;
      z = r;
    } else if ((d -= ls) < arc) {
      // Right bend, round (ls/2, 0) from a quarter turn down to minus a quarter
      sinCosTurns(0.25 - (d / arc) * 0.5, sc);
      x = ls / 2 + sc.c * r;
      z = sc.s * r;
      arcSamples.push(i);
    } else if ((d -= arc) < ls) {
      // Top straight, heading -x
      x = ls / 2 - d;
      z = -r;
    } else {
      d -= ls;
      sinCosTurns(-0.25 - (d / arc) * 0.5, sc);
      x = -ls / 2 + sc.c * r;
      z = sc.s * r;
      arcSamples.push(i);
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = z;
  }
  const halfWidth = new Float64Array(n).fill(STADIUM_HALF_WIDTH);
  return assembleTrack({
    spec,
    name: 'Proving Ground',
    theme,
    pos,
    ds,
    halfWidth,
    verge: STADIUM_VERGE,
    bank: 0.6,
    grid: gridSlots(),
    checkpoints: checkpointsFor(total),
    kerbs: kerbRuns(arcSamples, n),
    fallback: true,
  });
}

/** Kerbs on the inside of each bend (the left: the oval turns left), as contiguous runs of bend samples. */
function kerbRuns(samples: readonly number[], n: number): TrackKerb[] {
  const runs: TrackKerb[] = [];
  let start = -1;
  let prev = -2;
  for (const i of samples) {
    if (i !== prev + 1) {
      if (start >= 0) runs.push({ i0: start, i1: prev, side: -1 });
      start = i;
    }
    prev = i;
  }
  if (start >= 0) runs.push({ i0: start, i1: prev % n, side: -1 });
  return runs;
}
