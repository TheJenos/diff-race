import type { BotSkill } from './skills';

/* The bots' names and paint. Pure data. */

export interface BotProfile {
  name: string;
  color: number;
  stripe: number;
}

export const ROSTER: readonly BotProfile[] = [
  { name: 'Grinder', color: 0x2f3a44, stripe: 0xf2b21b },
  { name: 'Rattler', color: 0x5a6b2a, stripe: 0x111111 },
  { name: 'Hex', color: 0x6a1f7a, stripe: 0x30e0c0 },
  { name: 'Mad Dog', color: 0x8a5a1f, stripe: 0xffffff },
  { name: 'Viper', color: 0x1f6a3a, stripe: 0xd8ff40 },
  { name: 'Brick', color: 0x8a2c22, stripe: 0x2a2a2a },
  { name: 'Jackal', color: 0xb08a3a, stripe: 0x3a1f10 },
  { name: 'Nails', color: 0x3a4a8a, stripe: 0xff5a1a },
  { name: 'Diesel', color: 0x202020, stripe: 0xff2a1a },
  { name: 'Krait', color: 0xd8d0b8, stripe: 0x1a1a1a },
  { name: 'Vandal', color: 0x2a6a8a, stripe: 0xf0f0f0 },
];

/** A grid's worth of bots: skills spread so there's always someone to beat */
export function botLineup(count: number, skill: BotSkill | 'mixed'): { profile: BotProfile; skill: BotSkill }[] {
  const mix: BotSkill[] = ['normal', 'easy', 'hard', 'normal', 'expert', 'easy', 'hard', 'normal', 'hard', 'easy', 'expert'];
  return Array.from({ length: count }, (_, i) => ({ profile: ROSTER[i % ROSTER.length]!, skill: skill === 'mixed' ? mix[i % mix.length]! : skill }));
}
