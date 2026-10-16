import { ARMED, GUN } from './weapons';

/*
 * The machine gun: rounds fired at its rate while the trigger is held, heat building with each,
 * and a lockout when it overheats. A sword pad's armed spell turns the heat off. Pure.
 */

export interface GunState {
  /** 0..1 */
  heat: number;
  /** Seconds left locked out after overheating */
  locked: number;
  /** Seconds of armed spell left */
  armed: number;
  /** Fraction of the next round already "loaded" (keeps the rate exact at any frame rate) */
  charge: number;
}

export const newGun = (): GunState => ({ heat: 0, locked: 0, armed: 0, charge: 0 });

/** Advance `dt` seconds with the trigger held or not; returns how many rounds fired */
export function stepGun(g: GunState, firing: boolean, dt: number): number {
  g.armed = Math.max(0, g.armed - dt);
  if (g.locked > 0) {
    g.locked = Math.max(0, g.locked - dt);
    g.heat = Math.max(0, g.heat - GUN.cooling * dt * 1.5);
    g.charge = 0;
    return 0;
  }
  if (!firing) {
    g.heat = Math.max(0, g.heat - GUN.cooling * dt);
    g.charge = 0;
    return 0;
  }
  g.charge += GUN.rate * dt;
  const shots = Math.floor(g.charge);
  g.charge -= shots;
  if (g.armed <= 0) {
    g.heat += shots * GUN.heatPerShot;
    if (g.heat >= 1) {
      g.heat = 1;
      g.locked = GUN.lockout;
    }
  }
  return shots;
}

/** Damage of one round at `dist` metres (armed spells hit harder) */
export function roundDamage(g: GunState, dist: number): number {
  const fall = dist <= GUN.falloffFrom ? 1 : Math.max(0.5, 1 - (0.5 * (dist - GUN.falloffFrom)) / (GUN.maxRange - GUN.falloffFrom));
  return GUN.damage * fall * (g.armed > 0 ? ARMED.damage : 1);
}

export function arm(g: GunState): void {
  g.armed = ARMED.duration;
  g.heat = 0;
  g.locked = 0;
}
