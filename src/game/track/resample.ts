import { len } from './dmath';

/*
 * Even spacing: a closed polyline resampled into `n` points exactly `length / n` apart along it,
 * so the loop closes on a whole number of steps.
 */

export function resample(pts: readonly number[], step: number): { xz: number[]; ds: number } {
  const m = pts.length / 2;
  const cum = [0];
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum.push((cum[i] as number) + len((pts[j * 2] as number) - (pts[i * 2] as number), (pts[j * 2 + 1] as number) - (pts[i * 2 + 1] as number)));
  }
  const total = cum[m] as number;
  const n = Math.max(8, Math.round(total / step));
  const ds = total / n;
  const xz: number[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = k * ds;
    while (seg < m - 1 && (cum[seg + 1] as number) <= d) seg++;
    const a = cum[seg] as number;
    const b = cum[seg + 1] as number;
    const f = b > a ? (d - a) / (b - a) : 0;
    const j = (seg + 1) % m;
    xz.push(
      (pts[seg * 2] as number) + ((pts[j * 2] as number) - (pts[seg * 2] as number)) * f,
      (pts[seg * 2 + 1] as number) + ((pts[j * 2 + 1] as number) - (pts[seg * 2 + 1] as number)) * f,
    );
  }
  return { xz, ds };
}

/** Planar signed curvature (1/m, positive turning right) at each point of an even closed loop */
export function planarCurvature(xz: readonly number[], ds: number): number[] {
  const n = xz.length / 2;
  const out: number[] = [];
  const x = (i: number) => xz[(((i % n) + n) % n) * 2] as number;
  const z = (i: number) => xz[(((i % n) + n) % n) * 2 + 1] as number;
  for (let i = 0; i < n; i++) {
    // Heading change between the incoming and outgoing chords, per metre. With right = (-fz, fx)
    // (frames.ts), the 2D cross product a × b is positive when b turns toward the right.
    const ax = x(i) - x(i - 1), az = z(i) - z(i - 1);
    const bx = x(i + 1) - x(i), bz = z(i + 1) - z(i);
    const la = len(ax, az) || 1;
    const lb = len(bx, bz) || 1;
    const cross = (ax * bz - az * bx) / (la * lb);
    out.push(cross / ds);
  }
  return out;
}
