import type { TrackPad } from '../track/types';
import type { SkillParams } from './skills';

/*
 * Where across the road a bot wants to be, and whether to drop a defence: passing a slower car
 * ahead, swerving for a pad it wants, side-swiping a rival alongside. Pure.
 */

export interface Rival {
  /** Race distance difference (m, + ahead of the bot) and lateral offset (m, + to the bot's right) */
  dD: number;
  du: number;
  speed: number;
  armour: number;
}

/** Lateral offset (m from the racing line) to steer for, given the cars around and the pads coming up */
export function laneOffset(
  self: { s: number; u: number; line: number; speed: number; armour: number; wantsSword: boolean; wantsShield: boolean; wantsSkull?: boolean },
  rivals: readonly Rival[], pads: readonly TrackPad[], lapLength: number, skill: SkillParams, roll: number,
): number {
  // A pad within reach that it wants: go for it.
  if (roll < skill.padGreed) {
    for (const p of pads) {
      let ahead = p.s - self.s;
      if (ahead < 0) ahead += lapLength;
      if (ahead < 12 || ahead > 70) continue;
      if ((p.kind === 'sword' && self.wantsSword) || (p.kind === 'shield' && self.wantsShield) || (p.kind === 'skull' && self.wantsSkull)) return p.u - self.line;
    }
  }
  let offset = 0;
  let passing: Rival | null = null;
  for (const r of rivals) {
    // The nearest car ahead in our lane that we're catching: the one to get round.
    const closing = self.speed - r.speed;
    const reach = 10 + Math.max(0, closing) * 2.5;
    if (r.dD > 1 && r.dD < Math.min(45, reach) && Math.abs(r.du) < 3.4 && closing > -1 && (!passing || r.dD < passing.dD)) passing = r;
  }
  if (passing) {
    // Aim for a lane 3.8 m beside it, on whichever side keeps us nearer the racing line.
    const rivalU = self.u + passing.du;
    const left = rivalU - 3.8;
    const right = rivalU + 3.8;
    const target = Math.abs(left - self.line) < Math.abs(right - self.line) ? left : right;
    offset = target - self.line;
  }
  for (const r of rivals) {
    // A rival alongside with less armour: lean on them.
    if (skill.rams && Math.abs(r.dD) < 3 && Math.abs(r.du) < 5 && Math.abs(r.du) > 1.5 && self.armour > r.armour + 20) {
      offset += Math.sign(r.du) * 2.5;
    }
  }
  return Math.max(-6, Math.min(6, offset));
}

/**
 * Use the rear defence now: someone close behind (smart bots wait until they're lined up). The
 * flamethrower only reaches a few car lengths, so it waits for someone right on the bumper.
 */
export function shouldDefend(rivals: readonly Rival[], skill: SkillParams, roll: number, flame = false): boolean {
  const reach = flame ? -11 : -25;
  for (const r of rivals) {
    if (r.dD < -2 && r.dD > reach && (!skill.smartItems || Math.abs(r.du) < 3)) return skill.smartItems || roll < 0.02;
  }
  return false;
}
