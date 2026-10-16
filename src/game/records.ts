import { specKey, type TrackSpec } from './track/spec';

/*
 * The player's best times per track, in this browser. (The global per-track records arrive with
 * the multiplayer phase, in Firebase.)
 */

export interface TrackRecord {
  /** Best lap (s) */
  lap: number | null;
  /** Best race total (s) and for how many laps */
  total: number | null;
  laps: number | null;
}

const KEY = 'diffrace-best';

function load(): Record<string, TrackRecord> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, TrackRecord>) : {};
  } catch {
    return {};
  }
}

export function bestFor(spec: TrackSpec): TrackRecord {
  return load()[specKey(spec)] ?? { lap: null, total: null, laps: null };
}

/** Record a lap and (when finished) a total; returns which were new bests */
export function saveTimes(spec: TrackSpec, lap: number | null, total: number | null, laps: number): { lap: boolean; total: boolean } {
  const all = load();
  const key = specKey(spec);
  const cur = all[key] ?? { lap: null, total: null, laps: null };
  const newLap = lap !== null && (cur.lap === null || lap < cur.lap);
  const newTotal = total !== null && (cur.total === null || cur.laps !== laps || total < cur.total);
  if (newLap) cur.lap = lap;
  if (newTotal) {
    cur.total = total;
    cur.laps = laps;
  }
  if (newLap || newTotal) {
    all[key] = cur;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch { /* storage unavailable */ }
  }
  return { lap: newLap, total: newTotal };
}
