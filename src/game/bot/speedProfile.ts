import type { TrackData } from '../track/types';
import { driveForce } from '../car/drivetrain';
import type { CarParams } from '../car/params';

/*
 * How fast a bot can take each part of the racing line: as fast as its curvature allows sideways
 * grip (v = sqrt(a / κ)), then braked early enough for what's coming (a backward pass) and only
 * as fast as it can accelerate out (a forward pass), round the loop twice so the wrap settles.
 * Pure. Computed from the car's own numbers at runtime, so retuning the car doesn't change tracks.
 */

export interface ProfileParams {
  /** Sideways grip it dares use (m/s²), braking (m/s²), top speed (m/s) */
  lateral: number;
  braking: number;
  top: number;
  /** Acceleration (m/s²) available at a speed: strong low down, fading toward top speed */
  accel: (v: number) => number;
}

/** Racing-line points (x, z per sample) */
export function linePoints(t: TrackData): Float64Array {
  const out = new Float64Array(t.n * 2);
  for (let i = 0; i < t.n; i++) {
    const u = t.line[i] as number;
    out[i * 2] = (t.pos[i * 3] as number) + (t.right[i * 3] as number) * u;
    out[i * 2 + 1] = (t.pos[i * 3 + 2] as number) + (t.right[i * 3 + 2] as number) * u;
  }
  return out;
}

/** Target speed (m/s) at each sample */
export function speedProfile(t: TrackData, p: ProfileParams): Float32Array {
  const n = t.n;
  const pts = linePoints(t);
  const x = (i: number) => pts[(((i % n) + n) % n) * 2] as number;
  const z = (i: number) => pts[(((i % n) + n) % n) * 2 + 1] as number;
  const v = new Float32Array(n);
  const K = 4;
  for (let i = 0; i < n; i++) {
    // Menger curvature through three line points K samples apart.
    const ax = x(i - K), az = z(i - K);
    const bx = x(i), bz = z(i);
    const cx = x(i + K), cz = z(i + K);
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    const ab = Math.hypot(bx - ax, bz - az);
    const bc = Math.hypot(cx - bx, cz - bz);
    const ca = Math.hypot(ax - cx, az - cz);
    const kappa = ab * bc * ca > 0 ? (2 * area2) / (ab * bc * ca) : 0;
    v[i] = kappa > 1e-5 ? Math.min(p.top, Math.sqrt(p.lateral / kappa)) : p.top;
  }
  const ds = t.ds;
  for (let pass = 0; pass < 2; pass++) {
    // Backward: brake in time.
    for (let k = 2 * n - 1; k >= 0; k--) {
      const i = k % n;
      const next = v[(i + 1) % n] as number;
      v[i] = Math.min(v[i] as number, Math.sqrt(next * next + 2 * p.braking * ds));
    }
    // Forward: can't be faster than accelerating out of the last slow bit allows.
    for (let k = 0; k < 2 * n; k++) {
      const i = k % n;
      const prev = v[(i - 1 + n) % n] as number;
      v[i] = Math.min(v[i] as number, Math.sqrt(prev * prev + 2 * Math.max(0.2, p.accel(prev)) * ds));
    }
  }
  return v;
}

/** The profile for a car with these numbers: `grip` is the share of its cornering grip a bot dares use */
export function carProfile(t: TrackData, car: CarParams, grip = 0.72): Float32Array {
  return speedProfile(t, {
    lateral: car.grip * 16 * grip,
    braking: 13,
    top: car.topSpeed,
    accel: (v) => (driveForce(1, 0, v, false, car) - car.drag * v * v - car.rolling * 4) / car.mass,
  });
}
