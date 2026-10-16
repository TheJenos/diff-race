import type { TrackData, Vec3 } from './types';

/*
 * Where a point is on the track: the nearest centre-line segment, the distance along the loop
 * (s) and how far right of the centre (u). Searching starts from a hint (where the same thing
 * was last step), so it's a few dozen distance checks; only when that fails does it scan the
 * whole loop. Pure.
 */

export interface TrackLocation {
  /** Sample at the start of the nearest segment */
  i: number;
  /** Metres along the loop (0..lapLength) */
  s: number;
  /** Metres right of the centre line (negative: left) */
  u: number;
  /** Height above the road surface along its up (m) */
  h: number;
  /** Distance from the centre-line point (m) */
  dist: number;
}

export const newLocation = (): TrackLocation => ({ i: 0, s: 0, u: 0, h: 0, dist: 0 });

/** Samples searched each side of the hint */
const WINDOW = 20;
/** Height counts this much more than across distance when picking the nearest segment (bridges, hills) */
const HEIGHT_WEIGHT = 4;

function segmentScore(t: TrackData, i: number, p: Vec3): number {
  const a = i * 3;
  const dx = p.x - (t.pos[a] as number);
  const dy = p.y - (t.pos[a + 1] as number);
  const dz = p.z - (t.pos[a + 2] as number);
  return dx * dx + dz * dz + dy * dy * HEIGHT_WEIGHT;
}

/** Where `p` is on track `t`. `hint`: the sample it was near last time (-1: no idea). */
export function locate(t: TrackData, p: Vec3, hint: number, out: TrackLocation): TrackLocation {
  const n = t.n;
  let best = -1;
  let bestScore = Infinity;
  if (hint >= 0) {
    for (let k = -WINDOW; k <= WINDOW; k++) {
      const i = (((hint + k) % n) + n) % n;
      const sc = segmentScore(t, i, p);
      if (sc < bestScore) { bestScore = sc; best = i; }
    }
    const reach = (t.halfWidth[best] as number) + t.verge + 12;
    if (bestScore > reach * reach) best = -1;
  }
  if (best < 0) {
    bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      const sc = segmentScore(t, i, p);
      if (sc < bestScore) { bestScore = sc; best = i; }
    }
  }
  // Project onto whichever neighbouring segment the point lies along.
  const prev = (best - 1 + n) % n;
  const i = projectAlong(t, best, p) >= 0 ? best : prev;
  const along = Math.min(Math.max(projectAlong(t, i, p), 0), 1);
  const j = (i + 1) % n;
  const a = i * 3;
  const b = j * 3;
  const cx = (t.pos[a] as number) + ((t.pos[b] as number) - (t.pos[a] as number)) * along;
  const cy = (t.pos[a + 1] as number) + ((t.pos[b + 1] as number) - (t.pos[a + 1] as number)) * along;
  const cz = (t.pos[a + 2] as number) + ((t.pos[b + 2] as number) - (t.pos[a + 2] as number)) * along;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;
  out.i = i;
  out.s = (i + along) * t.ds;
  out.u = dx * (t.right[a] as number) + dy * (t.right[a + 1] as number) + dz * (t.right[a + 2] as number);
  out.h = dx * (t.up[a] as number) + dy * (t.up[a + 1] as number) + dz * (t.up[a + 2] as number);
  out.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return out;
}

/** How far along segment i → i+1 the point projects (0..1 inside; negative: before it) */
function projectAlong(t: TrackData, i: number, p: Vec3): number {
  const j = (i + 1) % t.n;
  const a = i * 3;
  const b = j * 3;
  const ex = (t.pos[b] as number) - (t.pos[a] as number);
  const ey = (t.pos[b + 1] as number) - (t.pos[a + 1] as number);
  const ez = (t.pos[b + 2] as number) - (t.pos[a + 2] as number);
  const l2 = ex * ex + ey * ey + ez * ez || 1;
  return ((p.x - (t.pos[a] as number)) * ex + (p.y - (t.pos[a + 1] as number)) * ey + (p.z - (t.pos[a + 2] as number)) * ez) / l2;
}
