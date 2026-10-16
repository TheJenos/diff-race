import type { CarSnapshot } from './carCodec';

/*
 * When to send this client's car: receivers predict it from the last snapshot (car/carTrack.ts),
 * so a new one is only needed when that prediction would be off by enough to see, when something
 * discrete changed (fired, wrecked...), or every so often anyway. Capped at 20 a second; on a long
 * straight it's a few a second. Pure: the sender runs the same predictor on what it last sent.
 */

/** Never more often than this (ms), and never less often (ms) */
export const MIN_INTERVAL = 50;
export const MAX_INTERVAL = 220;
/** Prediction error that's worth a send: position (m), rotation (rad), turret aim (rad) */
const POS_ERROR = 0.3;
const ROT_ERROR = 0.05;
const AIM_ERROR = 0.035;

/** Where a snapshot sent `ms` ago predicts the car is now (constant velocity) */
export function predictPosition(s: CarSnapshot, ms: number, out: { x: number; y: number; z: number }): void {
  const t = Math.min(ms, 300) / 1000;
  out.x = s.x + s.vx * t;
  out.y = s.y + s.vy * t;
  out.z = s.z + s.vz * t;
}

/** Angle (rad) between two rotations */
export function rotationError(a: CarSnapshot, b: CarSnapshot): number {
  const d = Math.abs(a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw);
  return 2 * Math.acos(Math.min(1, d));
}

const _p = { x: 0, y: 0, z: 0 };

/** Whether `now` (the car's current state) should go out, `since` ms after `last` was sent */
export function shouldSend(last: CarSnapshot | null, now: CarSnapshot, since: number): boolean {
  if (since < MIN_INTERVAL) return false;
  if (!last || since >= MAX_INTERVAL) return true;
  if (last.flags !== now.flags || last.armour !== now.armour) return true;
  predictPosition(last, since, _p);
  if (Math.hypot(_p.x - now.x, _p.y - now.y, _p.z - now.z) > POS_ERROR) return true;
  // Rotation predicted by the angular velocity is close enough at these intervals: compare directly
  // with what the last snapshot plus its spin would show.
  if (rotationError(last, now) > ROT_ERROR + Math.hypot(last.wx, last.wy, last.wz) * (since / 1000)) return true;
  return Math.abs(last.yaw - now.yaw) > AIM_ERROR || Math.abs(last.pitch - now.pitch) > AIM_ERROR;
}
