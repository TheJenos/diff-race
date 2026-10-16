/*
 * What separates an easy bot from an expert. Pure data.
 */

export type BotSkill = 'easy' | 'normal' | 'hard' | 'expert';
export const BOT_SKILLS: readonly BotSkill[] = ['easy', 'normal', 'hard', 'expert'];

export interface SkillParams {
  /** Fraction of the speed profile it dares */
  pace: number;
  /** How far off the racing line it wanders (m) */
  lineError: number;
  /** Aim wobble (rad) and how long before it reacts to a new target (s) */
  aimError: number;
  reaction: number;
  /** Chance per second of using nitro on a straight, of detouring to a pad it wants */
  nitro: number;
  padGreed: number;
  /** Shoves cars alongside when it has the armour for it */
  rams: boolean;
  /** Reaches for missiles and defences at good moments rather than at once */
  smartItems: boolean;
}

export const SKILLS: Record<BotSkill, SkillParams> = {
  easy: { pace: 0.8, lineError: 1.6, aimError: 0.12, reaction: 0.9, nitro: 0.1, padGreed: 0.25, rams: false, smartItems: false },
  normal: { pace: 0.88, lineError: 1.0, aimError: 0.07, reaction: 0.55, nitro: 0.35, padGreed: 0.5, rams: false, smartItems: false },
  hard: { pace: 0.93, lineError: 0.5, aimError: 0.04, reaction: 0.35, nitro: 0.6, padGreed: 0.7, rams: true, smartItems: true },
  expert: { pace: 0.97, lineError: 0.25, aimError: 0.025, reaction: 0.22, nitro: 0.85, padGreed: 0.85, rams: true, smartItems: true },
};

/** Rubber-banding: a little faster when far behind the nearest human, a little slower far ahead */
export function rubberBand(gapToHuman: number): number {
  // gap > 0: the bot is ahead of the human (m of race distance).
  const t = Math.max(-1, Math.min(1, gapToHuman / 150));
  return 1 - 0.08 * t;
}
