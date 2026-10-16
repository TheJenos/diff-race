import { len } from './dmath';

/*
 * A closed centripetal Catmull-Rom spline through the layout's control points (Barry–Goldman's
 * pyramid form). Centripetal (alpha = 0.5) never loops or cusps between points, and its knot
 * spacing is the square root of the distance: only sqrt, which is deterministic.
 */

/** Dense points along the closed spline, x and z interleaved; `per` per control segment */
export function closedSpline(ctrl: readonly number[], per: number): number[] {
  const n = ctrl.length / 2;
  const out: number[] = [];
  const px = (i: number) => ctrl[(((i % n) + n) % n) * 2] as number;
  const pz = (i: number) => ctrl[(((i % n) + n) % n) * 2 + 1] as number;
  for (let i = 0; i < n; i++) {
    const x0 = px(i - 1), z0 = pz(i - 1);
    const x1 = px(i), z1 = pz(i);
    const x2 = px(i + 1), z2 = pz(i + 1);
    const x3 = px(i + 2), z3 = pz(i + 2);
    const t0 = 0;
    const t1 = t0 + Math.sqrt(len(x1 - x0, z1 - z0)) + 1e-9;
    const t2 = t1 + Math.sqrt(len(x2 - x1, z2 - z1)) + 1e-9;
    const t3 = t2 + Math.sqrt(len(x3 - x2, z3 - z2)) + 1e-9;
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const a1x = ((t1 - t) * x0 + (t - t0) * x1) / (t1 - t0);
      const a1z = ((t1 - t) * z0 + (t - t0) * z1) / (t1 - t0);
      const a2x = ((t2 - t) * x1 + (t - t1) * x2) / (t2 - t1);
      const a2z = ((t2 - t) * z1 + (t - t1) * z2) / (t2 - t1);
      const a3x = ((t3 - t) * x2 + (t - t2) * x3) / (t3 - t2);
      const a3z = ((t3 - t) * z2 + (t - t2) * z3) / (t3 - t2);
      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);
      out.push(((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1), ((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1));
    }
  }
  return out;
}

/** Length of a closed polyline (x, z interleaved) */
export function loopLength(pts: readonly number[]): number {
  const n = pts.length / 2;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    total += len((pts[j * 2] as number) - (pts[i * 2] as number), (pts[j * 2 + 1] as number) - (pts[i * 2 + 1] as number));
  }
  return total;
}
