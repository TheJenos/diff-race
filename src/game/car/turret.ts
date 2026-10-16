/*
 * The roof turret: where it points (yaw round the roof, pitch of the guns, both relative to the
 * car) and how it swings toward where the player or bot wants it. Pure.
 *
 * Car space: forward -z, right +x, up +y. Yaw 0 points forward; positive yaw turns left (as
 * three.js's rotation.y does), so the mesh can take it directly.
 */

export const TURRET = {
  /** Swing speed (rad/s), about 400°/s */
  slew: 7,
  minPitch: -0.14,
  maxPitch: 0.44,
  /** Turret pivot above the chassis centre, and how far forward of it the muzzles are (m) */
  height: 1.18,
  muzzle: 1.1,
};

export interface TurretState {
  yaw: number;
  pitch: number;
}

export const newTurret = (): TurretState => ({ yaw: 0, pitch: 0 });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Swing toward (yaw, pitch) at the turret's speed */
export function slew(t: TurretState, yaw: number, pitch: number, dt: number): void {
  const max = TURRET.slew * dt;
  const dy = wrap(yaw - t.yaw);
  t.yaw = wrap(t.yaw + Math.max(-max, Math.min(max, dy)));
  const p = Math.max(TURRET.minPitch, Math.min(TURRET.maxPitch, pitch));
  t.pitch += Math.max(-max, Math.min(max, p - t.pitch));
}

/** The yaw and pitch that point along a car-space direction */
export function anglesOf(x: number, y: number, z: number): { yaw: number; pitch: number } {
  return { yaw: Math.atan2(-x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/** The car-space direction the guns point */
export function barrel(t: TurretState, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = Math.cos(t.pitch);
  out.x = -Math.sin(t.yaw) * c;
  out.y = Math.sin(t.pitch);
  out.z = -Math.cos(t.yaw) * c;
  return out;
}

/** How far (rad) the guns are from pointing at (yaw, pitch) */
export function aimError(t: TurretState, yaw: number, pitch: number): number {
  return Math.hypot(wrap(yaw - t.yaw), pitch - t.pitch);
}
