/*
 * Every number that decides how a car drives. The DEV `?tune` panel edits these live; the feel
 * tests (car/__tests__) pin the targets, so a retune is a deliberate test update.
 *
 * Car space: forward is -z, right +x, up +y (three.js's camera convention, so the chase camera
 * behind a car looks the same way it does). The body's origin is the chassis box's centre.
 */

export interface WheelMount {
  /** Mount point in car space: the top of the suspension travel (m) */
  x: number;
  y: number;
  z: number;
  front: boolean;
}

export interface CarParams {
  /** kg */
  mass: number;
  /** Chassis box half extents (m) */
  half: { x: number; y: number; z: number };
  /** Cabin box half extents and centre (m) */
  cabin: { x: number; y: number; z: number; cy: number; cz: number };
  /** The centre of mass sits this far below the chassis centre (m): low, so the car rarely rolls */
  comDrop: number;
  /** Extra roll and pitch inertia over a plain box's (≥1): slower to tip */
  tipInertia: number;
  wheels: readonly WheelMount[];
  wheelRadius: number;
  /** Suspension travel from fully extended to bump stop (m) */
  restLength: number;
  /** Spring rate per wheel (N/m) and damping (N per m/s) compressing and rebounding */
  spring: number;
  damperBump: number;
  damperRebound: number;
  /** Anti-roll bar stiffness per axle (N/m of compression difference) */
  antiRollFront: number;
  antiRollRear: number;
  /** Steering lock (rad) at a standstill and at top speed, and how fast the wheels turn (rad/s) */
  steerLock: number;
  steerLockFast: number;
  steerRate: number;
  /** Drive force at the rear wheels from a standstill (N) and the speed where it runs out (m/s) */
  engineForce: number;
  topSpeed: number;
  /** Most speed in reverse (m/s) */
  reverseSpeed: number;
  /** Total braking force (N), and the share on the front wheels */
  brakeForce: number;
  brakeFront: number;
  /** Handbrake force on each rear wheel (N), and what's left of their sideways grip */
  handbrakeForce: number;
  handbrakeGrip: number;
  /** Tyre friction coefficient on tarmac */
  grip: number;
  /** Slip angle (rad) where grip peaks, and the fraction left once fully sliding */
  peakSlip: number;
  slideGrip: number;
  /** How much of the sideways slide each step tries to cancel (0..1): below 1 stays smooth */
  lateralStiffness: number;
  /** Lateral and longitudinal tyre forces act this far above the contact patch (m): less body roll */
  forceLift: number;
  /** Air drag (N per (m/s)²), rolling resistance per wheel (N), downforce (N per (m/s)²) */
  drag: number;
  rolling: number;
  downforce: number;
  /** Nitro: drive force multiplier, extra top speed (m/s), seconds of boost in a full tank, refill per second */
  nitroForce: number;
  nitroSpeed: number;
  nitroTank: number;
  nitroRefill: number;
  /** Mid-air control torque (N·m) for pitch, roll and yaw */
  airPitch: number;
  airRoll: number;
  airYaw: number;
  /** Torque (N·m per radian of tilt) that rolls a car on its side back onto its wheels */
  righting: number;
  /** Damping of yaw rate while gripping (1/s): steadies the car out of corners */
  yawDamping: number;
}

export const CAR: CarParams = {
  mass: 1500,
  half: { x: 0.95, y: 0.36, z: 2.2 },
  cabin: { x: 0.78, y: 0.28, z: 1.0, cy: 0.62, cz: 0.25 },
  comDrop: 0.35,
  tipInertia: 1.6,
  wheels: [
    { x: -0.86, y: -0.12, z: -1.38, front: true },
    { x: 0.86, y: -0.12, z: -1.38, front: true },
    { x: -0.86, y: -0.12, z: 1.32, front: false },
    { x: 0.86, y: -0.12, z: 1.32, front: false },
  ],
  wheelRadius: 0.38,
  restLength: 0.36,
  spring: 38_000,
  damperBump: 2_600,
  damperRebound: 3_600,
  antiRollFront: 22_000,
  antiRollRear: 14_000,
  steerLock: 0.56,
  steerLockFast: 0.11,
  steerRate: 3.2,
  engineForce: 15_500,
  topSpeed: 52,
  reverseSpeed: 12,
  brakeForce: 26_000,
  brakeFront: 0.62,
  handbrakeForce: 5_500,
  handbrakeGrip: 0.35,
  grip: 1.55,
  peakSlip: 0.14,
  slideGrip: 0.72,
  lateralStiffness: 0.85,
  forceLift: 0.28,
  drag: 0.38,
  rolling: 90,
  downforce: 1.4,
  nitroForce: 1.8,
  nitroSpeed: 12,
  nitroTank: 4,
  nitroRefill: 0.08,
  airPitch: 2_400,
  airRoll: 1_800,
  airYaw: 1_200,
  righting: 9_000,
  yawDamping: 0.9,
};

/** How much the tyres hold on each surface (multiplies `grip`) */
export const SURFACE_GRIP = { road: 1, verge: 0.62, oil: 0.15 } as const;
export type Surface = keyof typeof SURFACE_GRIP;
