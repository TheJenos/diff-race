/*
 * A car's armour and where it's been hit. Pure.
 *
 * Every hit takes armour and adds to the damage of the zone it landed on (front, rear, left,
 * right, roof). Each zone's damage shows as dents, then hanging and missing panels (levels 1-3),
 * and at level 3 the car handles a little worse. Armour creeps back after a while without being
 * hit. The last car to hurt you within KILL_WINDOW gets the kill when you're wrecked, whatever
 * finished you off (a barrier, a fall, a mine you drove into yourself).
 */

export type Zone = 'front' | 'rear' | 'left' | 'right' | 'roof';
export const ZONES: readonly Zone[] = ['front', 'rear', 'left', 'right', 'roof'];

/** Zone damage at which the zone reaches level 1, 2 and 3 */
export const ZONE_LEVELS = [18, 42, 70] as const;
/** Seconds after the last hit before armour starts coming back, and how fast (per second) */
export const REGEN_DELAY = 6;
export const REGEN_RATE = 3;
/** Seconds a hit stays credited to whoever landed it */
export const KILL_WINDOW = 5;
export const DEFAULT_ARMOUR = 150;

export type DamageSource = 'gun' | 'missile' | 'ram' | 'scrape' | 'barrier' | 'napalm' | 'mine' | 'fall';

export interface DamageState {
  armour: number;
  max: number;
  zoneDamage: Record<Zone, number>;
  /** 0..3 per zone */
  levels: Record<Zone, number>;
  lastAttacker: string | null;
  lastAttackAt: number;
  lastSource: DamageSource | null;
  /** Time (s) of the last damage of any kind */
  lastHurtAt: number;
  wrecked: boolean;
}

export const newDamage = (max = DEFAULT_ARMOUR): DamageState => ({
  armour: max, max,
  zoneDamage: { front: 0, rear: 0, left: 0, right: 0, roof: 0 },
  levels: { front: 0, rear: 0, left: 0, right: 0, roof: 0 },
  lastAttacker: null, lastAttackAt: -Infinity, lastSource: null, lastHurtAt: -Infinity, wrecked: false,
});

export interface HitResult {
  /** This hit wrecked the car */
  wrecked: boolean;
  /** Who gets the kill (null: nobody within the window) */
  killer: string | null;
  /** What did it */
  source: DamageSource;
  /** A zone that went up a level (for dents and loose panels) */
  levelUp: Zone | null;
}

const levelFor = (dmg: number) => (dmg >= ZONE_LEVELS[2] ? 3 : dmg >= ZONE_LEVELS[1] ? 2 : dmg >= ZONE_LEVELS[0] ? 1 : 0);

/** `amount` of damage on `zone` (null: no zone, e.g. fire) from `attacker` (null: the world) at time `now` (s) */
export function applyDamage(d: DamageState, amount: number, zone: Zone | null, attacker: string | null, source: DamageSource, now: number): HitResult {
  const out: HitResult = { wrecked: false, killer: null, source, levelUp: null };
  if (d.wrecked || amount <= 0) return out;
  d.armour = Math.max(0, d.armour - amount);
  d.lastHurtAt = now;
  if (attacker) {
    d.lastAttacker = attacker;
    d.lastAttackAt = now;
    d.lastSource = source;
  }
  if (zone) {
    d.zoneDamage[zone] += amount;
    const level = levelFor(d.zoneDamage[zone]);
    if (level > d.levels[zone]) {
      d.levels[zone] = level;
      out.levelUp = zone;
    }
  }
  if (d.armour <= 0) {
    d.wrecked = true;
    out.wrecked = true;
    out.killer = d.lastAttacker && now - d.lastAttackAt <= KILL_WINDOW ? d.lastAttacker : null;
    if (out.killer && attacker === null) out.source = d.lastSource ?? source;
  }
  return out;
}

/** Armour coming back after a quiet spell */
export function regen(d: DamageState, now: number, dt: number): void {
  if (d.wrecked || now - d.lastHurtAt < REGEN_DELAY) return;
  d.armour = Math.min(d.max, d.armour + REGEN_RATE * dt);
}

/** A shield pad's patch: armour back, and the worst zone mended one level */
export function patch(d: DamageState, armour: number): void {
  d.armour = Math.min(d.max, d.armour + armour);
  let worst: Zone | null = null;
  for (const z of ZONES) if (d.levels[z] > 0 && (!worst || d.levels[z] > d.levels[worst])) worst = z;
  if (worst) {
    d.levels[worst]--;
    d.zoneDamage[worst] = d.levels[worst] > 0 ? ZONE_LEVELS[d.levels[worst] - 1]! : 0;
  }
}

/** Back from a wreck: full armour, a fresh body */
export function restore(d: DamageState): void {
  Object.assign(d, newDamage(d.max));
}

/** Which zone a point in car space (forward -z, right +x, up +y; origin at the chassis centre) is in */
export function zoneAt(x: number, y: number, z: number): Zone {
  if (y > 0.5) return 'roof';
  if (z < -1.55) return 'front';
  if (z > 1.55) return 'rear';
  return x < 0 ? 'left' : 'right';
}

/** How the car drives with its damage: level-3 zones cost steering, speed, and pull it sideways */
export function handlingOf(d: DamageState): { steer: number; topSpeed: number; pull: number } {
  return {
    steer: d.levels.front >= 3 ? 0.9 : 1,
    topSpeed: d.levels.rear >= 3 ? 0.95 : 1,
    pull: (d.levels.left >= 3 ? -0.05 : 0) + (d.levels.right >= 3 ? 0.05 : 0),
  };
}
