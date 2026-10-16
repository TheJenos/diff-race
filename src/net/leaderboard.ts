import { limitToLast, onValue, orderByChild, query, ref, runTransaction, type Unsubscribe } from 'firebase/database';
import { db } from './firebase';
import type { BoardRecord } from './records';

/*
 * The global leaderboard: one record per profile (this browser's, or a Discord user's), updated
 * by its owner after every room race. The database rules check the score matches its formula and
 * that one race adds at most one race, podium and win (and a sane number of kills). Races against
 * bots alone don't count: nobody farms the easy bots for a place on the board.
 */

const PROFILE_KEY = 'diffrace-profile';

export const scoreOf = (r: Pick<BoardRecord, 'races' | 'podiums' | 'wins' | 'kills'>): number => r.races * 5 + r.podiums * 20 + r.wins * 50 + r.kills * 10;

/** This browser's profile id, made on first use (`p_` + 20 hex digits) */
export function browserProfileId(): string {
  try {
    let id = localStorage.getItem(PROFILE_KEY);
    if (!id || !/^p_[0-9a-f]{20}$/.test(id)) {
      id = `p_${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      localStorage.setItem(PROFILE_KEY, id);
    }
    return id;
  } catch {
    return `p_${'0'.repeat(20)}`;
  }
}

export const discordProfileId = (userId: string): string => `d_${userId}`;

let override: string | null = null;

/** Inside Discord the Discord user is the profile, not the browser */
export function setDiscordProfile(userId: string): void {
  override = discordProfileId(userId);
}

/** The profile results are recorded under */
export const currentProfileId = (): string => override ?? browserProfileId();

/** One race's result for the board */
export interface RaceOutcome {
  name: string;
  place: number;
  /** Other humans in the race (podiums and wins only count against people) */
  humans: number;
  kills: number;
}

export async function recordRace(profileId: string, o: RaceOutcome): Promise<void> {
  const podium = o.humans >= 2 && o.place <= 3 ? 1 : 0;
  const win = o.humans >= 2 && o.place === 1 ? 1 : 0;
  await runTransaction(ref(db(), `leaderboard/${profileId}`), (cur: BoardRecord | null) => {
    const next = {
      name: o.name,
      races: (cur?.races ?? 0) + 1,
      podiums: (cur?.podiums ?? 0) + podium,
      wins: (cur?.wins ?? 0) + win,
      kills: (cur?.kills ?? 0) + Math.min(50, o.kills),
    };
    return { ...next, score: scoreOf(next) };
  }, { applyLocally: false });
}

/** The top `n` by score, best first, kept up to date */
export function watchLeaderboard(n: number, cb: (rows: (BoardRecord & { id: string })[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onValue(query(ref(db(), 'leaderboard'), orderByChild('score'), limitToLast(n)), (snap) => {
    const rows: (BoardRecord & { id: string })[] = [];
    snap.forEach((c) => { rows.push({ id: c.key, ...(c.val() as BoardRecord) }); });
    cb(rows.reverse());
  }, (err) => onError?.(err));
}
