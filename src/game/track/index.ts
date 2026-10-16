import { generate } from './generate';
import { specKey, type TrackSpec } from './spec';
import type { TrackData } from './types';

/*
 * The track generator's front door: generate a spec's track, or return it from a small cache
 * (the lobby preview, the race and the next race's prefetch often ask for the same one).
 */

export { generate, generateWithReport } from './generate';
export type { TrackData } from './types';

const CACHE_SIZE = 6;
const cache = new Map<string, TrackData>();

/** A track already built (or handed over from the worker), if cached */
export function cachedTrack(spec: TrackSpec): TrackData | undefined {
  const key = specKey(spec);
  const t = cache.get(key);
  if (t) {
    // Most recently used goes to the back.
    cache.delete(key);
    cache.set(key, t);
  }
  return t;
}

export function remember(t: TrackData): void {
  const key = specKey(t.spec);
  cache.delete(key);
  cache.set(key, t);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

/** Build (or fetch) a spec's track on this thread */
export function generateTrack(spec: TrackSpec): TrackData {
  const hit = cachedTrack(spec);
  if (hit) return hit;
  const t = generate(spec);
  remember(t);
  return t;
}
