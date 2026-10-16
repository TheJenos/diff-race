import type { CarSnapshot } from '../../net/carCodec';

/*
 * A remote car, shown where it is now rather than where it was: each snapshot (stamped with the
 * sender's server time) is carried forward by its velocity and spin to the present. When a new
 * snapshot arrives, the shown pose glides from the old prediction onto the new one over BLEND_MS,
 * so corrections are smooth instead of jumps. A big disagreement (a respawn, a teleport) snaps.
 * Pure.
 *
 * Arena FPS draws remote players 120 ms in the past, interpolating between snapshots. At racing
 * speeds that's metres behind, which would make aiming and ramming unfair; prediction keeps every
 * car near its true present position, and the send policy (net/sendPolicy.ts) sends whenever the
 * prediction would drift.
 */

export const BLEND_MS = 100;
/** Predict at most this far past the last snapshot (ms); beyond, the car holds */
export const PREDICT_MAX = 300;
/** Further than this from the prediction (m): snap, don't glide */
const SNAP_DISTANCE = 8;

export interface Pose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
}

export const newPose = (): Pose => ({ x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0 });

/** Where a snapshot taken at server time `t` puts the car at `now` */
export function predict(s: CarSnapshot, t: number, now: number, out: Pose): Pose {
  const dt = Math.max(0, Math.min(PREDICT_MAX, now - t)) / 1000;
  out.x = s.x + s.vx * dt;
  out.y = s.y + s.vy * dt;
  out.z = s.z + s.vz * dt;
  out.vx = s.vx;
  out.vy = s.vy;
  out.vz = s.vz;
  // q' = q + ½ ω q dt (ω as a pure quaternion), renormalised: fine for a few tenths of a second.
  const { qx, qy, qz, qw, wx, wy, wz } = s;
  const h = dt / 2;
  let x = qx + h * (wx * qw + wy * qz - wz * qy);
  let y = qy + h * (wy * qw + wz * qx - wx * qz);
  let z = qz + h * (wz * qw + wx * qy - wy * qx);
  let w = qw - h * (wx * qx + wy * qy + wz * qz);
  const l = Math.hypot(x, y, z, w) || 1;
  x /= l; y /= l; z /= l; w /= l;
  out.qx = x; out.qy = y; out.qz = z; out.qw = w;
  return out;
}

export class CarTrack {
  last: CarSnapshot | null = null;
  lastT = -Infinity;
  private prev: CarSnapshot | null = null;
  private prevT = 0;
  /** Server time the latest snapshot arrived (for the blend) */
  private arrived = 0;
  private readonly a = newPose();
  private readonly b = newPose();

  /** A snapshot taken at server time `t`, arriving at server time `now`. Out-of-order ones are dropped. */
  push(s: CarSnapshot, t: number, now: number): void {
    if (t <= this.lastT) return;
    if (this.last) {
      predict(this.last, this.lastT, now, this.a);
      predict(s, t, now, this.b);
      const jump = Math.hypot(this.a.x - this.b.x, this.a.y - this.b.y, this.a.z - this.b.z);
      // Respawned or teleported: no glide from the old place.
      this.prev = jump > SNAP_DISTANCE || (this.last.flags ^ s.flags) & 12 ? null : this.last;
      this.prevT = this.lastT;
    }
    this.last = { ...s };
    this.lastT = t;
    this.arrived = now;
  }

  /** The pose to show at server time `now`, or null before any snapshot */
  sample(now: number, out: Pose): Pose | null {
    const last = this.last;
    if (!last) return null;
    predict(last, this.lastT, now, out);
    const k = (now - this.arrived) / BLEND_MS;
    if (this.prev && k < 1) {
      const old = predict(this.prev, this.prevT, now, this.a);
      const e = k * k * (3 - 2 * k);
      out.x = old.x + (out.x - old.x) * e;
      out.y = old.y + (out.y - old.y) * e;
      out.z = old.z + (out.z - old.z) * e;
      slerp(old, out, e, out);
    }
    return out;
  }

  reset(): void {
    this.last = null;
    this.prev = null;
    this.lastT = -Infinity;
  }
}

/** Spherical blend of the rotations of a and b by t, into out's rotation */
function slerp(a: Pose, b: Pose, t: number, out: Pose): void {
  let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
  let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
  if (cos < 0) {
    cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    ka = Math.sin((1 - t) * th) / s;
    kb = Math.sin(t * th) / s;
  }
  out.qx = a.qx * ka + bx * kb;
  out.qy = a.qy * ka + by * kb;
  out.qz = a.qz * ka + bz * kb;
  out.qw = a.qw * ka + bw * kb;
  const l = Math.hypot(out.qx, out.qy, out.qz, out.qw) || 1;
  out.qx /= l; out.qy /= l; out.qz /= l; out.qw /= l;
}
