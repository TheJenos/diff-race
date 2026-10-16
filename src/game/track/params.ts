import type { ThemeId, TrackLength } from './spec';

/*
 * The generator's knobs per track length and theme. Pure data.
 */

export interface LengthParams {
  /** Lap length band (m) */
  min: number;
  max: number;
  /** Control points of the layout polygon */
  points: [number, number];
  /** Hill amplitude (m) */
  hills: number;
}

export const LENGTH_PARAMS: Record<TrackLength, LengthParams> = {
  s: { min: 1200, max: 1500, points: [13, 16], hills: 4 },
  m: { min: 1800, max: 2200, points: [14, 18], hills: 7 },
  l: { min: 2600, max: 3200, points: [17, 22], hills: 10 },
};

/** How hilly each theme is (multiplies the length's hills) */
export const THEME_HILLS: Record<ThemeId, number> = { docks: 0.5, quarry: 1.3, foundry: 0.9 };

/** Road half-width (m): base, and how much it wanders either way */
export const HALF_WIDTH = 9;
export const HALF_WIDTH_VARY = 2;
/** Extra half-width through hairpins, and on the start straight */
export const HAIRPIN_WIDEN = 1;
export const GRID_HALF_WIDTH = 10;
/** Run-off verge on each side (m) */
export const VERGE = 6;
/** Distance between samples (m), roughly */
export const SAMPLE_STEP = 2;
/** Steepest slope (rise per metre) */
export const MAX_SLOPE = 0.1;
/** Tightest bend radius (m) */
export const MIN_RADIUS = 25;
/** The start straight: this long (m), and straighter than this curvature (1/m) */
export const START_STRAIGHT = 120;
export const STRAIGHT_KAPPA = 0.004;
/** Attempts before falling back to the stadium */
export const ATTEMPTS = 24;
/** Farthest any track point may be from the origin (m) */
export const BOUNDS = 900;
