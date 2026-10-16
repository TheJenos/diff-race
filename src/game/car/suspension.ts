/*
 * One wheel's spring and damper, and an axle's anti-roll bar. Pure: forces in newtons from
 * compressions in metres, so the feel tests can drive them without Rapier.
 */

export interface SpringParams {
  restLength: number;
  spring: number;
  damperBump: number;
  damperRebound: number;
}

/**
 * Upward force from one wheel's suspension. `compression`: metres squeezed from full extension
 * (0..restLength); `speed`: how fast it's squeezing (m/s, negative while extending). Never pulls
 * the car down: a wheel leaving the ground just stops pushing.
 */
export function springForce(compression: number, speed: number, p: SpringParams): number {
  if (compression <= 0) return 0;
  const x = compression > p.restLength ? p.restLength : compression;
  const damping = speed > 0 ? p.damperBump : p.damperRebound;
  // At the bump stop the spring goes very stiff instead of letting the chassis hit the road.
  const stop = compression > p.restLength ? (compression - p.restLength) * p.spring * 6 : 0;
  const f = x * p.spring + speed * damping + stop;
  return f > 0 ? f : 0;
}

/**
 * An anti-roll bar: when one side of an axle is squeezed more than the other, push that side up
 * and the other down by the same amount. Returns the force to add on the left (subtract on the right).
 */
export function antiRoll(left: number, right: number, stiffness: number): number {
  return (left - right) * stiffness;
}
