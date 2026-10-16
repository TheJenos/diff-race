import { assembleTrack } from './assemble';
import { TRACK_CHUNK } from './constants';
import { clamp, q } from './dmath';
import { stadiumTrack } from './fallback';
import { placeKerbs, placePads, placeRamps, placeSkulls } from './features';
import { computeFrames } from './frames';
import { elevation } from './elevation';
import { checkpointsFor, GRID_DEPTH, gridSlots } from './grid';
import { layout } from './layout';
import { loopNoise } from './noise1d';
import { trackName } from './names';
import {
  ATTEMPTS, GRID_HALF_WIDTH, HAIRPIN_WIDEN, HALF_WIDTH, HALF_WIDTH_VARY, LENGTH_PARAMS, MIN_RADIUS, SAMPLE_STEP, THEME_HILLS, VERGE,
} from './params';
import { racingLine } from './racingLine';
import { relaxTight } from './relax';
import { planarCurvature, resample } from './resample';
import { Rng } from './rng';
import { placeScenery } from './scenery';
import { closedSpline, loopLength } from './spline';
import { THEME_IDS, type ThemeId, type TrackSpec } from './spec';
import { pickStart, rotate, smoothLoop } from './start';
import type { TrackData } from './types';
import { validate } from './validate';

/*
 * A track from a spec: deterministic, so every client builds the same one (track/hash.ts checks).
 *
 *   layout → spline → scale to length → even samples → start straight → hills → widths → frames
 *   → validate → racing line → ramps, pads, kerbs → scenery → name → assemble
 *
 * Each stage draws from its own forked random stream, so a stage using more or fewer numbers never
 * reshuffles another. An attempt that fails validation tries again with the next stream ("roll");
 * after ATTEMPTS failures the stadium fallback is used, which is always valid.
 */

export interface GenerateReport {
  track: TrackData;
  /** Rolls used (ATTEMPTS when the fallback was used) */
  attempts: number;
  /** Why each failed roll failed */
  reasons: string[];
}

export function generateWithReport(spec: TrackSpec): GenerateReport {
  const base = new Rng(spec.seed);
  const theme = spec.theme ?? base.fork('theme').pick(THEME_IDS);
  const reasons: string[] = [];
  for (let a = 0; a < ATTEMPTS; a++) {
    const result = attempt(base.fork(`roll:${a}`), spec, theme);
    if (typeof result === 'string') {
      reasons.push(result);
      continue;
    }
    return { track: result, attempts: a + 1, reasons };
  }
  return { track: stadiumTrack(spec, theme), attempts: ATTEMPTS, reasons };
}

export const generate = (spec: TrackSpec): TrackData => generateWithReport(spec).track;

/** Rounds of relaxing and respacing before a layout's bends count as too tight to fix */
const RELAX_ROUNDS = 4;

function attempt(rng: Rng, spec: TrackSpec, theme: ThemeId): TrackData | string {
  const lp = LENGTH_PARAMS[spec.length];
  const count = rng.fork('count').int(lp.points[0], lp.points[1]);
  const shape = layout(rng.fork('layout'), count);
  const dense = closedSpline(shape.points, 24);
  const target = rng.fork('length').range(lp.min, lp.max);
  const k = target / loopLength(dense);
  for (let i = 0; i < dense.length; i++) dense[i] = (dense[i] as number) * k;
  // Open out any bend tighter than the limit (with a margin for banking and smoothing), then
  // space the samples evenly again. Relaxing bunches samples up, which hides a little curvature
  // until they're spaced out again: so relax and respace, a few rounds if need be.
  let loop = resample(dense, SAMPLE_STEP);
  let flatKappa: number[] | null = null;
  for (let round = 0; round < RELAX_ROUNDS && !flatKappa; round++) {
    if (!relaxTight(loop.xz, loop.ds, 0.75 / MIN_RADIUS)) return 'too-tight';
    loop = resample(loop.xz, SAMPLE_STEP);
    const kappa = smoothLoop(planarCurvature(loop.xz, loop.ds), 3);
    if (kappa.every((v) => Math.abs(v) <= 1 / MIN_RADIUS)) flatKappa = kappa;
  }
  if (!flatKappa) return 'too-tight';
  // Relaxing cuts corners, so the lap comes out short: scale it back up to the length it was
  // meant to be (which only opens the bends further).
  const short = target / ((loop.xz.length / 2) * loop.ds);
  if (short > 1) {
    for (let i = 0; i < loop.xz.length; i++) loop.xz[i] = (loop.xz[i] as number) * short;
    loop = resample(loop.xz, SAMPLE_STEP);
    flatKappa = smoothLoop(planarCurvature(loop.xz, loop.ds), 3);
  }
  const { xz: raw, ds } = loop;
  const n = raw.length / 2;
  const start = pickStart(flatKappa, ds);
  if (start < 0) return 'no-start-straight';
  const xz = rotate(raw, start, 2);
  const kappa = rotate(flatKappa, start, 1);

  const y = elevation(rng.fork('hills'), n, ds, lp.hills * THEME_HILLS[theme], GRID_DEPTH + 15, 40);
  const pos: number[] = [];
  for (let i = 0; i < n; i++) pos.push(q(xz[i * 2] as number), q(y[i] as number), q(xz[i * 2 + 1] as number));

  // Widths: wandering a little, wider through hairpins and on the grid.
  const wander = loopNoise(rng.fork('width'), n, 140 / ds, HALF_WIDTH_VARY);
  const lap = n * ds;
  const raw0 = wander.map((w, i) => {
    const s = i * ds;
    const inGrid = s < 40 || s > lap - GRID_DEPTH - 15;
    if (inGrid) return GRID_HALF_WIDTH;
    const tight = clamp((Math.abs(kappa[i] as number) - 1 / 60) / (1 / 40 - 1 / 60), 0, 1);
    return HALF_WIDTH + w + HAIRPIN_WIDEN * tight;
  });
  const halfWidth = smoothLoop(raw0, 6).map(q);

  const frames = computeFrames(pos, n, ds, 1);
  const why = validate({ pos, n, ds, halfWidth, verge: VERGE, curvature: frames.curvature });
  if (why) return why;

  const line = racingLine(pos, frames.right, halfWidth, n).map(q);
  const fi = { n, ds, curvature: frames.curvature, halfWidth, line, y };
  const ramps = placeRamps(rng.fork('ramps'), fi);
  const weaponPads = placePads(rng.fork('pads'), fi, ramps);
  const pads = [...weaponPads, ...placeSkulls(rng.fork('skulls'), fi, weaponPads, ramps)].sort((a, b) => a.s - b.s || a.u - b.u);
  const kerbs = placeKerbs(fi);
  let minY = Infinity;
  for (const v of y) minY = Math.min(minY, q(v));
  const scenery = placeScenery(rng.fork('scenery'), {
    n, ds, pos, right: frames.right, fwd: frames.fwd, halfWidth, curvature: frames.curvature, verge: VERGE,
    ground: q(minY - 0.5), theme, chunk: TRACK_CHUNK,
  });
  return assembleTrack({
    spec,
    name: trackName(rng.fork('name'), theme),
    theme,
    pos,
    ds,
    halfWidth,
    line,
    verge: VERGE,
    bank: 1,
    grid: gridSlots(),
    checkpoints: checkpointsFor(lap),
    pads,
    ramps,
    kerbs,
    scenery,
    fallback: false,
  });
}
