import { botLineup } from '../game/bot/roster';
import { GENERATOR_VERSION, type TrackSpec } from '../game/track/spec';
import type { GridEntry, SessionSetup } from '../game/raceSession';
import { isBotId } from './lobby';
import { PAINTS, type LobbyRecord, type RaceRecord, type RoomSettings } from './records';
import type { RoomConnection } from './room';

/*
 * A room's race, in the game's terms: the track it's on, who's on the grid where (and in what
 * paint), and the rules. Every client works the same grid out from the race record, so only ids
 * and slots are stored.
 */

export const trackOf = (s: RoomSettings): TrackSpec => ({ seed: s.seed, length: s.length, theme: s.theme, gen: s.gen });

/** Bots in a room are b_0, b_1...: their names and skills come from the roster, the same everywhere */
export const botIds = (count: number): string[] => Array.from({ length: count }, (_, i) => `b_${i}`);

/** The grid for the next race: bots at the front, players behind in the order they joined */
export function makeGrid(members: { id: string }[], settings: RoomSettings): Record<string, number> {
  const grid: Record<string, number> = {};
  const bots = botIds(settings.bots);
  const players = members.filter((m) => !isBotId(m.id)).map((m) => m.id);
  [...bots, ...players].slice(0, 12).forEach((id, slot) => { grid[id] = slot; });
  return grid;
}

export function gridEntries(race: RaceRecord, lobby: LobbyRecord | null): GridEntry[] {
  const lineup = botLineup(race.settings.bots, race.settings.skill);
  const members = lobby?.members ?? {};
  const players = Object.keys(race.grid).filter((id) => !isBotId(id)).sort();
  return Object.entries(race.grid).map(([id, slot]) => {
    if (isBotId(id)) {
      const b = lineup[Number(id.slice(2))] ?? lineup[0]!;
      return { id, name: b.profile.name, paint: 0, color: b.profile.color, stripe: b.profile.stripe, bot: b.skill, slot };
    }
    const paint = players.indexOf(id) % PAINTS.length;
    const [color, stripe] = PAINTS[paint]!;
    return { id, name: members[id] ?? 'Driver', paint, color, stripe, bot: null, slot };
  });
}

export function roomSessionSetup(conn: RoomConnection, race: RaceRecord, lobby: LobbyRecord | null, playerName: string): SessionSetup {
  const s = race.settings;
  const grid = gridEntries(race, lobby);
  const me = grid.find((g) => g.id === conn.playerId);
  return {
    rules: { laps: s.laps, armour: s.armour, crash: s.crash, weapons: s.weapons, elimination: s.elim === true },
    countdown: true,
    bots: 0,
    botSkill: s.skill,
    playerName,
    color: me?.color ?? 0xb3261e,
    stripe: me?.stripe ?? 0xffffff,
    room: { conn, n: race.n, startAt: race.startAt, grid },
  };
}

/** Default settings for a new room */
export const defaultSettings = (seed: string): RoomSettings => ({
  seed, length: 'm', theme: 'docks', gen: GENERATOR_VERSION, laps: 3, bots: 3, skill: 'mixed', crash: 1, armour: 150, weapons: true, elim: false,
});
