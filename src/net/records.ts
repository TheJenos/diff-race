import type { BotSkill } from '../game/bot/skills';
import type { ThemeId, TrackLength } from '../game/track/spec';

/*
 * What's in the database, record by record. (database.rules.json validates every field; keep
 * the two in step, and add a case to scripts/test-rules.mjs for each new field.)
 *
 *   lobby/{code}                       LobbyRecord: the room as the room list shows it, and its settings
 *   rooms/{code}/players/{pid}         PlayerRecord: each player's car, written by that player
 *   rooms/{code}/bots/{bid}            PlayerRecord: the bots, written by the room owner
 *   rooms/{code}/race                  RaceRecord: the current race, changed only by the owner (transactions)
 *   rooms/{code}/results/{n}/{id}      ResultRecord: each car's result in race n, written once
 *   rooms/{code}/hazards/{hid}         HazardRecord: oil, napalm and mines on the road
 *   rooms/{code}/events/{eid}          RoomEvent: one-shot news (wrecks, missiles, blasts), removed after a few seconds
 *   leaderboard/{profileId}            BoardRecord
 */

export interface RoomSettings {
  seed: string;
  length: TrackLength;
  theme: ThemeId;
  gen: number;
  laps: number;
  bots: number;
  skill: BotSkill | 'mixed';
  crash: number;
  armour: number;
  weapons: boolean;
  /** Elimination: wrecked cars are out (absent: a normal race) */
  elim?: boolean;
}

export interface LobbyRecord extends RoomSettings {
  name: string;
  hostId: string;
  host: string;
  createdAt: number;
  members?: Record<string, string>;
  /** A race is on (the room list says so) */
  racing?: boolean;
}

export interface PlayerRecord {
  name: string;
  /** Paint (index into PAINTS) */
  c: number;
  /** The race this car is in (0: not racing, watching) */
  n?: number;
  /** The car (net/carCodec.ts) and the server time it was taken */
  p?: string;
  t?: number;
  /** Damage this car has dealt to each other car this race, cumulative */
  d?: Record<string, number>;
  /** Kills this race */
  k?: number;
  /** Finish time (ms of race time), once finished */
  f?: number;
}

export type RacePhase = 'lobby' | 'grid' | 'results';

export interface RaceRecord {
  /** Race number: 0 before the first */
  n: number;
  phase: RacePhase;
  /** Server time the lights go green (ms) */
  startAt: number;
  /** Car id → grid slot */
  grid: Record<string, number>;
  /** The settings it's raced with (copied at the start, so changes wait for the next race) */
  settings: RoomSettings;
  /** Server time the results were called (ms) */
  endAt?: number;
}

export interface ResultRecord {
  name: string;
  /** Finish time (ms), or absent with dnf */
  ms?: number;
  best?: number;
  k: number;
  dnf?: boolean;
  bot?: boolean;
}

export interface HazardRecord {
  k: 'oil' | 'smoke' | 'napalm' | 'mines';
  x: number;
  y: number;
  z: number;
  by: string;
  /** Server time it's gone (ms) */
  until: number;
}

export type RoomEvent =
  | { k: 'wreck'; v: string; by: string; w: string }
  /** `v`: the car it's chasing (heat seeking), if it locked onto one */
  | { k: 'missile'; by: string; x: number; y: number; z: number; vx: number; vy: number; vz: number; v?: string }
  | { k: 'boom'; by: string; x: number; y: number; z: number; r: number; dmg: number; push: number; w: string };

/** As received: with who sent it and when (server ms) */
export type ReceivedEvent = RoomEvent & { from: string; t: number };

export interface BoardRecord {
  name: string;
  races: number;
  podiums: number;
  wins: number;
  kills: number;
  score: number;
}

/** Car paints players can be given (a room assigns each member one) */
export const PAINTS: readonly [number, number][] = [
  [0xb3261e, 0xf2f2f2], [0x1f5fb3, 0xffd23a], [0x2e8a3e, 0x111111], [0xd8a31a, 0x1a1a1a],
  [0x7a2a9a, 0x40e0d0], [0xe05a12, 0xffffff], [0x18a0a8, 0x101010], [0xf0f0f0, 0xd01010],
];
