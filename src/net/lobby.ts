import { get, onValue, ref, remove, runTransaction, serverTimestamp, set, type Unsubscribe } from 'firebase/database';
import { db } from './firebase';
import type { LobbyRecord, RaceRecord, RoomSettings } from './records';

/*
 * The room list and making rooms. (Arena FPS's lobby, with Diff Race's settings.)
 */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Bots' ids start with this (players' never do: randomId has no lowercase or underscore). */
export const BOT_PREFIX = 'b_';
export const isBotId = (id: string): boolean => id.startsWith(BOT_PREFIX);

export function randomId(len = 12): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/** Codes people type: 5 characters, or longer for Discord's fixed per-channel codes */
export const ROOM_CODE = /^[A-Z0-9]{4,10}$/;

export interface RoomSummary {
  code: string;
  name: string;
  host: string;
  players: string[];
  racing: boolean;
  settings: RoomSettings;
}

export const settingsOf = (r: RoomSettings): RoomSettings => ({
  seed: r.seed, length: r.length, theme: r.theme, gen: r.gen, laps: r.laps, bots: r.bots, skill: r.skill, crash: r.crash, armour: r.armour, weapons: r.weapons,
  elim: r.elim === true,
});

/** Every open room, kept up to date. Abandoned rooms (nobody in them) are cleared away. */
export function watchRooms(callback: (rooms: RoomSummary[]) => void, onError?: (err: Error) => void): Unsubscribe {
  return onValue(ref(db(), 'lobby'), (snap) => {
    const rooms: RoomSummary[] = [];
    snap.forEach((child) => {
      const room = child.val() as LobbyRecord;
      const code = child.key;
      const members = Object.values(room.members ?? {});
      if (!members.length) {
        // Rooms are created with their first member, so an empty one is abandoned.
        void deleteRoom(code);
        return;
      }
      rooms.push({ code, name: room.name, host: room.host, players: members, racing: room.racing === true, settings: settingsOf(room) });
    });
    callback(rooms);
  }, (err) => onError?.(err));
}

/** A new room with a fresh code, us in it as host. Resolves to the code. */
export async function createRoom(name: string, settings: RoomSettings, host: string, playerId: string): Promise<string> {
  let code: string;
  do {
    code = randomId(5);
  } while ((await get(ref(db(), `lobby/${code}`))).exists());
  await set(ref(db(), `lobby/${code}`), { name, ...settings, host, hostId: playerId, createdAt: serverTimestamp(), members: { [playerId]: host } });
  await set(ref(db(), `rooms/${code}/race`), firstRace(settings));
  return code;
}

/**
 * Create room `code` unless someone already has it (Discord Activities use a fixed code per voice
 * channel, so two players starting at once must not both create it). Resolves to whether we did.
 */
export async function createRoomWithCode(code: string, name: string, settings: RoomSettings, host: string, playerId: string): Promise<boolean> {
  const result = await runTransaction(ref(db(), `lobby/${code}`), (current: LobbyRecord | null) => {
    // A record without members is a leftover from an abandoned room: take it over.
    if (current && Object.keys(current.members ?? {}).length > 0) return undefined;
    return { name, ...settings, host, hostId: playerId, createdAt: Date.now(), members: { [playerId]: host } };
  }, { applyLocally: false });
  if (!result.committed) return false;
  await set(ref(db(), `rooms/${code}/race`), firstRace(settings));
  return true;
}

const firstRace = (settings: RoomSettings): RaceRecord => ({ n: 0, phase: 'lobby', startAt: 0, grid: {}, settings });

/** The room's record, or null if there's no such room */
export async function getRoom(code: string): Promise<LobbyRecord | null> {
  return (await get(ref(db(), `lobby/${code}`))).val() as LobbyRecord | null;
}

export function deleteRoom(code: string): Promise<unknown> {
  return Promise.all([remove(ref(db(), `lobby/${code}`)), remove(ref(db(), `rooms/${code}`))]);
}
