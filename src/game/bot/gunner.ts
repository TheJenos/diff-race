import type { SkillParams } from './skills';

/*
 * A bot's shooting: pick the nearest car it can see within range, aim at it with a wobble its
 * skill allows (and a delay before it reacts to a new target), fire when the guns are on it and
 * not about to overheat, launch a missile when close and lined up. Pure.
 */

export interface GunnerTarget {
  id: string;
  x: number; y: number; z: number;
  vx: number; vz: number;
  /** Visible: line of sight is clear and it isn't in smoke */
  visible: boolean;
}

export interface GunnerState {
  /** Letting the guns cool between bursts */
  cooling: boolean;
  target: string | null;
  /** Seconds the current target has been tracked */
  tracked: number;
  /** Aim wobble (rad), drifting */
  wobbleYaw: number;
  wobblePitch: number;
}

export const newGunnerState = (): GunnerState => ({ cooling: false, target: null, tracked: 0, wobbleYaw: 0, wobblePitch: 0 });

export interface GunnerDecision {
  /** World point to aim at (null: nothing to shoot, point forward) */
  aim: { x: number; y: number; z: number } | null;
  fire: boolean;
  missile: boolean;
}

/** Furthest it will shoot (m), and how close for a missile */
const RANGE = 75;
const MISSILE_RANGE = 45;

export function gunner(
  self: { x: number; y: number; z: number; fx: number; fz: number; heat: number; locked: boolean; missiles: number },
  others: readonly GunnerTarget[], st: GunnerState, skill: SkillParams, aimError: number, dt: number, rand: () => number,
): GunnerDecision {
  let best: GunnerTarget | null = null;
  let bestD = RANGE;
  for (const o of others) {
    if (!o.visible) continue;
    const d = Math.hypot(o.x - self.x, o.z - self.z);
    // A bit of loyalty: keep shooting the current target unless another is much closer.
    const score = o.id === st.target ? d * 0.75 : d;
    if (score < bestD) {
      bestD = score;
      best = o;
    }
  }
  if (!best) {
    st.target = null;
    st.tracked = 0;
    return { aim: null, fire: false, missile: false };
  }
  if (best.id !== st.target) {
    st.target = best.id;
    st.tracked = 0;
  }
  st.tracked += dt;
  st.wobbleYaw += (rand() - 0.5) * skill.aimError * dt * 6 - st.wobbleYaw * dt * 2;
  st.wobblePitch += (rand() - 0.5) * skill.aimError * dt * 3 - st.wobblePitch * dt * 2;
  const d = Math.hypot(best.x - self.x, best.z - self.z);
  // Missiles fly at 70 m/s: lead a moving car a little.
  const lead = d / 70;
  const aim = {
    x: best.x + best.vx * lead * 0.5 + st.wobbleYaw * d,
    y: best.y + 0.3 + st.wobblePitch * d,
    z: best.z + best.vz * lead * 0.5 - st.wobbleYaw * d,
  };
  const ready = st.tracked > skill.reaction;
  // Bursts: fire until the guns are warm, then let them cool right down (smart bots stop short of overheating).
  if (self.heat > (skill.smartItems ? 0.7 : 0.9) || self.locked) st.cooling = true;
  else if (self.heat < 0.2) st.cooling = false;
  const coolEnough = !st.cooling;
  const fire = ready && coolEnough && aimError < 0.08 && d < RANGE;
  // Missiles: close, roughly ahead, guns on target.
  const ahead = ((best.x - self.x) * self.fx + (best.z - self.z) * self.fz) / Math.max(1, d);
  const missile = ready && self.missiles > 0 && d < MISSILE_RANGE && aimError < 0.06 && (skill.smartItems ? ahead > 0.85 : rand() < dt * 0.8);
  return { aim, fire, missile };
}
