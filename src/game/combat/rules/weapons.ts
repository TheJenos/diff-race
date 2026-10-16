import { TRAP_AHEAD } from '../../track/features';

/*
 * Every weapon's numbers. Pure data.
 */

export const GUN = {
  /** Rounds per second */
  rate: 10,
  /** Per round: 16 a second while firing, about 15 s of sustained fire (with overheating) to wreck a fresh car */
  damage: 1.6,
  /** Full damage to here, half by maxRange */
  falloffFrom: 80,
  maxRange: 150,
  /** Spread (rad), wider while moving the turret fast */
  spread: 0.012,
  /** Heat per round (3 s of fire to overheat), cooling per second, and the lockout when overheated (s) */
  heatPerShot: 1 / 30,
  cooling: 0.45,
  lockout: 1.5,
};

export const ARMED = {
  /** A sword pad arms the guns this long (s): more damage, no overheating */
  duration: 8,
  damage: 1.5,
};

export const MISSILE = {
  speed: 70,
  /** Seconds before it gives up and bursts */
  life: 3,
  /** Splash radius (m), damage at the centre (falling to a third at the edge), and the shove (m/s up and out) */
  radius: 4.5,
  damage: 28,
  push: 7,
  /** A sword pad gives this many, up to `max` */
  perPad: 2,
  max: 4,
};

export type DefenceKind = 'oil' | 'smoke' | 'napalm' | 'mines' | 'flame';
export const DEFENCES: readonly DefenceKind[] = ['oil', 'smoke', 'napalm', 'mines', 'flame'];
/** The defences that lie on the road (the rest act from the car) */
export type HazardKind = Exclude<DefenceKind, 'flame'>;

export const DEFENCE = {
  oil: { radius: 3.6, life: 20, grip: 0.15, slipFor: 1.5 },
  smoke: { radius: 7, life: 6 },
  napalm: { radius: 3.6, life: 5, dps: 10 },
  mines: { count: 3, life: 30, trigger: 2.6, radius: 4, damage: 26, push: 9 },
  /** A rear flamethrower: a cone of fire behind the car for `life` seconds */
  flame: { life: 3, range: 14, cone: 0.45, dps: 22 },
};

/** Ram spikes on the front (sometimes from a sword pad): rams hurt more, the front takes less */
export const SPIKES = { duration: 12, chance: 0.35, dealt: 1.6, front: 0.5 };

/** A skull pad springs a wall of fire this far ahead, across the road, for `life` seconds */
export const TRAP = { ahead: TRAP_AHEAD, life: 5, spacing: 5 };

export const PAD = {
  /** How close counts as driving over it (m), and how long before the same pad works again for you (s) */
  reach: 2.6,
  cooldown: 6,
  /** Armour a shield pad patches */
  patch: 25,
};

/** Weapons stay locked this long after the start (s): the first corner isn't a massacre */
export const WEAPONS_HOT_AFTER = 3;
