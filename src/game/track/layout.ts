import { sinCosTurns } from './dmath';
import type { Rng } from './rng';

/*
 * The circuit's rough shape: a star-shaped polygon round the origin. Control points sit at
 * strictly increasing angles, so the polygon can never cross itself; only the spline through it
 * (and how close its arms come) needs checking later. On that frame, the bends:
 *   - radii vary a lot from point to point, so the road swings in and out;
 *   - hairpins: a point pulled deep toward the middle (one, sometimes two);
 *   - chicanes: an S of two extra points between neighbours, one pushed out and one pulled in
 *     (an angle between theirs, so the polygon stays star-shaped);
 *   - a straight or two: a point moved onto the line between its neighbours (the start needs one);
 * and the whole thing may be stretched.
 */

export interface Layout {
  /** Control points, x and z interleaved, in order round the loop */
  points: number[];
}

/** The knobs (fractions of the layout's unit radius) */
const LAYOUT = {
  radius: [0.5, 1.3] as const,
  /** How much a point's radius is pulled toward its neighbours' (0 none, 1 all the way) */
  smooth: 0.35,
  hairpin: { chance: 0.5, again: 0.35, depth: [0.32, 0.45] as const },
  /** Notches: points pulled part way in, each a pair of corners; one or two, and another on a bigger layout */
  notch: { depth: [0.55, 0.75] as const },
  /**
   * Chicanes per this many control points, and how far each side of the S swings out, as a share
   * of the gap it's in (so a chicane is the same shape however close its neighbours are)
   */
  chicaneEvery: 9,
  chicaneSwing: [0.15, 0.24] as const,
  backStraight: 0.45,
};

export function layout(rng: Rng, count: number): Layout {
  const angles: number[] = [];
  const radii: number[] = [];
  for (let i = 0; i < count; i++) {
    // Jitter under half a slot keeps the angles strictly increasing.
    angles.push((i + rng.range(-0.25, 0.25)) / count);
    radii.push(rng.range(LAYOUT.radius[0], LAYOUT.radius[1]));
  }
  // Soften neighbouring radii a little, so the outline isn't all spikes.
  let r = radii.map((v, i) => {
    const a = radii[(i - 1 + count) % count] as number;
    const b = radii[(i + 1) % count] as number;
    return v + ((a + b) / 2 - v) * LAYOUT.smooth;
  });
  // Hairpins: a point pulled deep toward the middle; on a bigger layout, maybe a second, apart from the first.
  const pins: number[] = [];
  if (rng.chance(LAYOUT.hairpin.chance)) pins.push(rng.int(0, count - 1));
  if (pins.length && count >= 14 && rng.chance(LAYOUT.hairpin.again)) pins.push(((pins[0] as number) + Math.floor(count / 2) + rng.int(-1, 1)) % count);
  for (const k of pins) r[k] = (r[k] as number) * rng.range(LAYOUT.hairpin.depth[0], LAYOUT.hairpin.depth[1]);
  // Notches, kept off the hairpins and each other (two pulled-in points side by side make one wide dent).
  const taken = (k: number) => [...pins, ...notches].some((p) => p === k || p === (k + 1) % count || (p + 1) % count === k);
  const notches: number[] = [];
  const notchCount = rng.int(1, 2) + (count >= 16 ? 1 : 0);
  for (let c = 0; c < notchCount; c++) {
    const k = rng.int(0, count - 1);
    if (taken(k)) continue;
    notches.push(k);
    r[k] = (r[k] as number) * rng.range(LAYOUT.notch.depth[0], LAYOUT.notch.depth[1]);
  }

  // Chicanes: two points a third and two thirds of the way between neighbours, one out, one in.
  const chicanes = new Set<number>();
  const wanted = Math.floor(count / LAYOUT.chicaneEvery) + (rng.chance(0.5) ? 1 : 0);
  for (let c = 0; c < wanted; c++) {
    const k = rng.int(0, count - 1);
    // Not next to a hairpin (the two would knot), nor where there's one already.
    if (pins.some((p) => p === k || p === (k + 1) % count) || chicanes.has(k)) continue;
    chicanes.add(k);
  }
  const outAngles: number[] = [];
  const outRadii: number[] = [];
  for (let i = 0; i < count; i++) {
    outAngles.push(angles[i] as number);
    outRadii.push(r[i] as number);
    if (!chicanes.has(i)) continue;
    const a0 = angles[i] as number;
    const a1 = i + 1 < count ? (angles[i + 1] as number) : (angles[0] as number) + 1;
    const r0 = r[i] as number;
    const r1 = r[(i + 1) % count] as number;
    // The gap's length round the loop, in unit radii (2π × its share of a turn).
    const gap = (a1 - a0) * 6.283185307179586;
    const swing = rng.range(LAYOUT.chicaneSwing[0], LAYOUT.chicaneSwing[1]) * gap * (rng.chance(0.5) ? 1 : -1);
    for (const [t, side] of [[1 / 3, 1], [2 / 3, -1]] as const) {
      outAngles.push(a0 + (a1 - a0) * t);
      outRadii.push((r0 + (r1 - r0) * t) * (1 + swing * side));
    }
  }
  r = outRadii;
  const total = outAngles.length;

  const sc = { s: 0, c: 0 };
  const pts: number[] = [];
  for (let i = 0; i < total; i++) {
    sinCosTurns(outAngles[i] as number, sc);
    pts.push(sc.c * (r[i] as number), sc.s * (r[i] as number));
  }
  // Straights: points moved onto the line between the points either side (each angle stays
  // between its neighbours'). The spline is only truly straight between the inner points of a
  // line, so: always one over four gaps (two of them dead straight), for the start; sometimes a
  // back straight over two gaps, across the loop from it.
  const line = (k: number, span: number) => {
    const a = (k - 1 + total) % total;
    const b = (k + span) % total;
    for (let j = 0; j < span; j++) {
      const m = (k + j) % total;
      const t = (j + 1) / (span + 1);
      pts[m * 2] = (pts[a * 2] as number) + ((pts[b * 2] as number) - (pts[a * 2] as number)) * t;
      pts[m * 2 + 1] = (pts[a * 2 + 1] as number) + ((pts[b * 2 + 1] as number) - (pts[a * 2 + 1] as number)) * t;
    }
  };
  const start = rng.int(0, total - 1);
  line(start, 3);
  if (rng.chance(LAYOUT.backStraight)) line((start + Math.floor(total / 2)) % total, 1);
  // Stretch: a positive scale per axis keeps the polygon star-shaped.
  const sx = rng.range(0.8, 1.3);
  for (let i = 0; i < total; i++) pts[i * 2] = (pts[i * 2] as number) * sx;
  // Half the tracks run the other way round.
  if (rng.chance(0.5)) {
    const rev: number[] = [];
    for (let i = total - 1; i >= 0; i--) rev.push(pts[i * 2] as number, pts[i * 2 + 1] as number);
    return { points: rev };
  }
  return { points: pts };
}
