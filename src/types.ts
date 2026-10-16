import type { TrackSpec } from './game/track/spec';
import type { BotSkill } from './game/bot/skills';

export type RaceMode = 'race' | 'elimination' | 'timetrial' | 'testdrive';

/** What GameView is asked to play */
export interface Session {
  mode: RaceMode;
  spec: TrackSpec;
  /** Laps; 0: endless (test drive) */
  laps: number;
  bots: number;
  botSkill: BotSkill | 'mixed';
  /** Crash damage: 0 bumper cars, 1 normal, 2 carnage */
  crash: number;
  armour: number;
  weapons: boolean;
  playerName: string;
}

/** The game's setup for a session */
export function setupFor(s: Session) {
  return {
    rules: { laps: s.laps, armour: s.armour, crash: s.crash, weapons: s.weapons, elimination: s.mode === 'elimination' },
    countdown: s.mode !== 'testdrive',
    bots: s.mode === 'race' || s.mode === 'elimination' ? s.bots : 0,
    botSkill: s.botSkill,
    playerName: s.playerName,
    color: 0xb3261e,
    stripe: 0xf2f2f2,
  };
}
