/*
 * Steering: the wheels' angle follows the stick at a limited rate, and the lock shrinks with speed
 * so a full flick at 180 km/h is a lane change, not a spin. Pure.
 */

export interface SteerParams {
  steerLock: number;
  steerLockFast: number;
  steerRate: number;
  topSpeed: number;
}

/** Most wheel angle (rad) at forward speed `speed` */
export function steerLimit(speed: number, p: SteerParams): number {
  const t = Math.min(1, Math.abs(speed) / p.topSpeed);
  // Falls fast at first (city speeds keep most of it), then levels out.
  const k = 1 - Math.sqrt(t);
  return p.steerLockFast + (p.steerLock - p.steerLockFast) * k;
}

/** The wheels' next angle: `current` moving toward input × limit at steerRate (returning to centre twice as fast) */
export function steerStep(current: number, input: number, speed: number, dt: number, p: SteerParams): number {
  const target = input * steerLimit(speed, p);
  const returning = Math.abs(target) < Math.abs(current) || Math.sign(target) !== Math.sign(current);
  const rate = p.steerRate * (returning ? 2 : 1) * dt;
  const d = target - current;
  return current + (d > rate ? rate : d < -rate ? -rate : d);
}
