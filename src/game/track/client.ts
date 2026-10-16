/**
 * Tracks built in a worker, so the page doesn't stall while the lobby previews a seed or the game
 * gets the next race's track ready. Falls back to building on the page if workers aren't allowed.
 * (The same pattern as Arena FPS's map client.)
 */

import { cachedTrack, generateTrack, remember } from './index';
import { specKey, type TrackSpec } from './spec';
import type { TrackData } from './types';

type Reply = { id: number; track?: TrackData; error?: string };

/** undefined: not started yet; null: unavailable (build on the page) */
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, { spec: TrackSpec; resolve(t: TrackData): void; reject(err: Error): void }>();
const inFlight = new Map<string, Promise<TrackData>>();

/** Build on the page, after letting the current frame finish. */
const onPage = (spec: TrackSpec) => new Promise<TrackData>((resolve, reject) => {
  setTimeout(() => {
    try {
      resolve(generateTrack(spec));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }, 0);
});

function startWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Reply>) => {
      const job = waiting.get(e.data.id);
      if (!job) return;
      waiting.delete(e.data.id);
      if (e.data.track) {
        remember(e.data.track);
        job.resolve(e.data.track);
      } else {
        job.reject(new Error(e.data.error ?? 'Track generation failed'));
      }
    };
    w.onerror = (e) => {
      // The worker couldn't load (blocked by the page's policy, say): build everything on the page.
      e.preventDefault();
      console.warn('Track worker unavailable, building tracks on the page', e.message);
      worker = null;
      w.terminate();
      for (const job of waiting.values()) onPage(job.spec).then(job.resolve, job.reject);
      waiting.clear();
    };
    worker = w;
  } catch (err) {
    console.warn('Track worker unavailable, building tracks on the page', err);
    worker = null;
  }
  return worker;
}

/** The track for `spec`, from the cache or built in the worker. */
export function requestTrack(spec: TrackSpec): Promise<TrackData> {
  const hit = cachedTrack(spec);
  if (hit) return Promise.resolve(hit);
  const key = specKey(spec);
  let job = inFlight.get(key);
  if (!job) {
    const w = startWorker();
    job = w
      ? new Promise<TrackData>((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { spec, resolve, reject });
        w.postMessage({ id, spec });
      })
      : onPage(spec);
    const done = job;
    inFlight.set(key, done);
    done.finally(() => { if (inFlight.get(key) === done) inFlight.delete(key); }).catch(() => {});
  }
  return job;
}

/** Start building a track we'll want soon (the next race's), ignoring failures. */
export function prefetchTrack(spec: TrackSpec): void {
  requestTrack(spec).catch(() => {});
}
