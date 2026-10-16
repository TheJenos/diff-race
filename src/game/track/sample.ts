import type { TrackData, Vec3 } from './types';

/*
 * The track between samples: position and frame at any distance `s` along the loop, by linear
 * interpolation of the two samples around it. Pure.
 */

export interface TrackFrame {
  pos: Vec3;
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  halfWidth: number;
  /** Racing line offset (m right of centre) */
  line: number;
  /** The sample just before s, and how far toward the next (0..1) */
  i: number;
  f: number;
}

export const newFrame = (): TrackFrame => ({
  pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 },
  halfWidth: 0, line: 0, i: 0, f: 0,
});

/** `s` wrapped into 0..lapLength */
export const wrapS = (t: TrackData, s: number): number => s - Math.floor(s / t.lapLength) * t.lapLength;

export function frameAt(t: TrackData, s: number, out: TrackFrame): TrackFrame {
  const x = wrapS(t, s) / t.ds;
  const i = Math.floor(x) % t.n;
  const j = (i + 1) % t.n;
  const f = x - Math.floor(x);
  const mix = (a: Float32Array, k: number) => (a[i * 3 + k] as number) * (1 - f) + (a[j * 3 + k] as number) * f;
  out.pos.x = mix(t.pos, 0); out.pos.y = mix(t.pos, 1); out.pos.z = mix(t.pos, 2);
  out.fwd.x = mix(t.fwd, 0); out.fwd.y = mix(t.fwd, 1); out.fwd.z = mix(t.fwd, 2);
  out.right.x = mix(t.right, 0); out.right.y = mix(t.right, 1); out.right.z = mix(t.right, 2);
  out.up.x = mix(t.up, 0); out.up.y = mix(t.up, 1); out.up.z = mix(t.up, 2);
  normalizeInPlace(out.fwd);
  normalizeInPlace(out.right);
  normalizeInPlace(out.up);
  out.halfWidth = (t.halfWidth[i] as number) * (1 - f) + (t.halfWidth[j] as number) * f;
  out.line = (t.line[i] as number) * (1 - f) + (t.line[j] as number) * f;
  out.i = i;
  out.f = f;
  return out;
}

/** The road-surface point `u` metres right of the centre line at distance `s` */
export function pointAt(t: TrackData, s: number, u: number, frame: TrackFrame, out: Vec3): Vec3 {
  frameAt(t, s, frame);
  out.x = frame.pos.x + frame.right.x * u;
  out.y = frame.pos.y + frame.right.y * u;
  out.z = frame.pos.z + frame.right.z * u;
  return out;
}

function normalizeInPlace(v: Vec3): void {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  v.x /= l;
  v.y /= l;
  v.z /= l;
}
