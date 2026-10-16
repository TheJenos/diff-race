import type { TrackData } from './types';
import type { TrackLocation } from './locate';

/*
 * What a wheel is on, from where it is on the track: road between the edges, verge out to the
 * barriers, and beyond that the open ground (driven like verge). Pure.
 */

export type TrackSurface = 'road' | 'verge';

export function surfaceAt(t: TrackData, loc: TrackLocation): TrackSurface {
  const hw = t.halfWidth[loc.i] as number;
  return Math.abs(loc.u) <= hw + 0.15 ? 'road' : 'verge';
}

/** Off the track altogether: past the barriers by a margin (a car out here respawns) */
export function outOfBounds(t: TrackData, loc: TrackLocation): boolean {
  const hw = t.halfWidth[loc.i] as number;
  return Math.abs(loc.u) > hw + t.verge + 4 || loc.h < -6;
}
