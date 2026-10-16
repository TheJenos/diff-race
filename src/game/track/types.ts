import type { ThemeId, TrackSpec } from './spec';

/*
 * A built track: pure data, no three.js, so the generator can run in a worker and in Node.
 *
 * The track is a closed loop sampled every `ds` metres (about 2). Per sample: the centre line's
 * position and frame (forward along the track, right across it, up out of the road surface, all
 * unit vectors), the road's half-width, the signed curvature (positive: turning right) and the
 * racing line's lateral offset. Features sit in track coordinates: `s` metres along the loop from
 * the start line, `u` metres to the right of the centre line.
 */

export type Vec3 = { x: number; y: number; z: number };

export type PadKind = 'sword' | 'shield' | 'skull';

/**
 * A pad on the road: drive over it to arm (sword: offence), defend (shield), or spring a trap on
 * whoever's ahead (skull: a wall of fire across the road further on)
 */
export interface TrackPad { s: number; u: number; kind: PadKind }

/** A ramp: rises over `len` metres from `s` to height `h`, across the road from u0 to u1 */
export interface TrackRamp { s: number; len: number; h: number; u0: number; u1: number }

/** Kerbs along one side (-1 left, 1 right) from sample i0 to i1 (inclusive, may wrap) */
export interface TrackKerb { i0: number; i1: number; side: -1 | 1 }

/**
 * One scenery prop outside the barriers, standing on the ground at (x, y, z) and facing (fx, fz)
 * (a unit vector: the generator has no trig to make an angle with). `chunk`: which track chunk
 * draws it, so it's culled with its stretch of track.
 */
export interface SceneryItem { kind: string; x: number; y: number; z: number; fx: number; fz: number; scale: number; chunk: number }

/** A starting-grid slot (s is negative: behind the line) */
export interface GridSlot { s: number; u: number }

export interface TrackBounds { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }

export interface TrackData {
  spec: TrackSpec;
  name: string;
  theme: ThemeId;
  /** trackHash of everything below: two clients with the same spec must get the same one */
  hash: number;
  /** Samples round the loop */
  n: number;
  /** Distance between samples (m) */
  ds: number;
  /** n × ds (m) */
  lapLength: number;
  /** Width of the run-off verge outside the road on each side (m) */
  verge: number;
  /** Below this height a car is lost and respawns */
  killY: number;
  bounds: TrackBounds;
  /** 3 per sample */
  pos: Float32Array;
  fwd: Float32Array;
  right: Float32Array;
  up: Float32Array;
  /** 1 per sample */
  halfWidth: Float32Array;
  curvature: Float32Array;
  line: Float32Array;
  grid: GridSlot[];
  /** Sector boundaries (s) for lap splits; the first is 0 */
  checkpoints: number[];
  pads: TrackPad[];
  ramps: TrackRamp[];
  kerbs: TrackKerb[];
  scenery: SceneryItem[];
  /** Built by the guaranteed fallback because every generated attempt failed validation */
  fallback: boolean;
}

/** The typed arrays of a TrackData, for transferring it out of a worker without copying. */
export const TRACK_ARRAYS = ['pos', 'fwd', 'right', 'up', 'halfWidth', 'curvature', 'line'] as const;

/** Sample `i` (wrapped round the loop) of a 3-per-sample array, into `out`. */
export function at3(a: Float32Array, i: number, n: number, out: Vec3): Vec3 {
  const j = (((i % n) + n) % n) * 3;
  out.x = a[j] as number;
  out.y = a[j + 1] as number;
  out.z = a[j + 2] as number;
  return out;
}

/** Sample `i` (wrapped round the loop) of a 1-per-sample array. */
export function at1(a: Float32Array, i: number, n: number): number {
  return a[((i % n) + n) % n] as number;
}

/** The point `u` metres right of the centre line at sample `i` (on the road surface). */
export function surfacePoint(t: TrackData, i: number, u: number, out: Vec3): Vec3 {
  const j = (((i % t.n) + t.n) % t.n) * 3;
  out.x = (t.pos[j] as number) + (t.right[j] as number) * u;
  out.y = (t.pos[j + 1] as number) + (t.right[j + 1] as number) * u;
  out.z = (t.pos[j + 2] as number) + (t.right[j + 2] as number) * u;
  return out;
}
