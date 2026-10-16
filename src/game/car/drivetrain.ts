/*
 * The engine and gearbox, arcade style: a drive force that fades toward top speed, and pretend
 * gears that exist only for the engine note and the rev counter. Pure.
 */

export interface DriveParams {
  engineForce: number;
  topSpeed: number;
  reverseSpeed: number;
  nitroForce: number;
  nitroSpeed: number;
}

/**
 * Total drive force (N, along the car) for `throttle` (0..1) at forward speed `speed` (m/s).
 * `reverse` (0..1) drives backwards instead. Nitro raises the force and the top speed.
 */
export function driveForce(throttle: number, reverse: number, speed: number, nitro: boolean, p: DriveParams): number {
  if (reverse > 0 && throttle <= 0) {
    const back = -speed;
    const room = 1 - Math.max(0, back) / p.reverseSpeed;
    return room > 0 ? -reverse * p.engineForce * 0.45 * room : 0;
  }
  if (throttle <= 0) return 0;
  const top = p.topSpeed + (nitro ? p.nitroSpeed : 0);
  const v = Math.max(0, speed);
  // Strong low down, fading to nothing at the top: (1 - v/top)^0.6 keeps the pull going late.
  const room = 1 - v / top;
  if (room <= 0) return 0;
  return throttle * p.engineForce * (nitro ? p.nitroForce : 1) * Math.pow(room, 0.6);
}

/** Top of each pretend gear (m/s) */
const GEARS = [9, 17, 25, 33, 42, 70];

/** The pretend gear (1..6) and revs (0..1) at forward speed `speed`, for sound and the HUD */
export function gearAt(speed: number): { gear: number; rpm: number } {
  const v = Math.abs(speed);
  let lo = 0;
  for (let g = 0; g < GEARS.length; g++) {
    const hi = GEARS[g] as number;
    if (v < hi || g === GEARS.length - 1) {
      const rpm = Math.min(1, 0.22 + (0.78 * (v - lo)) / (hi - lo));
      return { gear: g + 1, rpm };
    }
    lo = hi;
  }
  return { gear: GEARS.length, rpm: 1 };
}
