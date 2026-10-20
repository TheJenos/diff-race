import type { Zone } from './damage';

/*
 * How much a crash hurts. Pure: from the velocity change it gave the car (Δv, m/s), the zone it
 * hit and a few modifiers. Both cars in a crash work out their own damage this way; the armoured
 * front means the car that does the ramming comes off far better.
 */

/** Below this velocity change a bump is just a bump (sparks and a thud) */
export const BUMP_THRESHOLD = 3;
const K = 2;
const EXPONENT = 1.3;

/** How each zone takes a hit */
export const ZONE_FACTOR: Record<Zone, number> = { front: 0.4, left: 1, right: 1, rear: 1.2, roof: 1 };

/** Door-to-door grinding: damage per second to both cars */
export const SCRAPE_RATE = 4;
/** Relative sliding speed (m/s) that counts as grinding */
export const SCRAPE_SPEED = 3;

export interface CrashModifiers {
  /** The other car was on nitro / armed by a sword pad */
  otherNitro?: boolean;
  otherArmed?: boolean;
  /** The other car has ram spikes; this car does (its front takes even less) */
  otherSpikes?: boolean;
  selfSpikes?: boolean;
  /** This car is ghosted after a respawn: it takes nothing */
  ghost?: boolean;
  /** The room's crash rule: 0 bumper cars, 1 normal, 2 carnage */
  rule: number;
}

export function crashDamage(dv: number, zone: Zone, m: CrashModifiers): number {
  if (m.ghost || m.rule <= 0 || dv <= BUMP_THRESHOLD) return 0;
  let d = K * Math.pow(dv - BUMP_THRESHOLD, EXPONENT) * ZONE_FACTOR[zone];
  if (m.otherNitro) d *= 1.3;
  if (m.otherArmed) d *= 1.2;
  if (m.otherSpikes) d *= 1.6;
  if (m.selfSpikes && zone === 'front') d *= 0.5;
  return d * m.rule;
}

/** Hitting a barrier: only real impacts hurt, at half the car-to-car rate */
export function barrierDamage(dv: number, zone: Zone, rule: number): number {
  if (rule <= 0 || dv <= 10) return 0;
  return 0.5 * K * Math.pow(dv - BUMP_THRESHOLD, EXPONENT) * ZONE_FACTOR[zone] * rule;
}

/** Grinding along another car (or a barrier above 15 m/s) for `dt` seconds */
export function scrapeDamage(dt: number, rule: number): number {
  return rule <= 0 ? 0 : SCRAPE_RATE * dt * rule;
}
