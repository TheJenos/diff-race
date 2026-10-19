/*
 * The bridge from the game (plain classes, updated every frame) to the React HUD: one immutable
 * state object, replaced whenever something in it changes. `update()` drops patches that change
 * nothing, so the game can call it every frame without re-rendering React. React reads it with
 * useSyncExternalStore(hud.subscribe, hud.get).
 *
 * Numbers that change every frame (speed, the race clock, gaps) don't go through here: the HUD
 * gives the game DOM nodes to write them into directly (see Hud.tsx).
 */

export type GamePhase = 'loading' | 'ready' | 'failed';

export interface RaceResults {
  /** Race total (s) */
  total: number;
  lapTimes: number[];
  bestLap: number;
  /** New personal bests on this track */
  newLap: boolean;
  newTotal: boolean;
}

/** One line of the standings, in race order */
export interface StandingRow {
  id: string;
  name: string;
  color: string;
  self: boolean;
  /** Finish time (s), null while racing */
  time: number | null;
  /** Seconds behind the winner, when both finished */
  diff: number | null;
  bestLap: number | null;
  kills: number;
  laps: number;
  dnf: boolean;
  /** Knocked out (Elimination) */
  out: boolean;
}

export interface FeedLine {
  id: number;
  text: string;
  /** 'kill': someone wrecked someone; 'you': it involved the player; 'info': anything else */
  kind: 'kill' | 'you' | 'info';
}

/** The big banner: DIFFED by…, YOU DIFFED…, LAPPED */
export interface Banner {
  id: number;
  title: string;
  sub: string;
  kind: 'diffed' | 'diffing' | 'lapped' | 'pickup';
}

export interface HudState {
  phase: GamePhase;
  /** Loading or failure message */
  status: string;
  /** Seconds of nitro in the tank, and the tank size */
  nitro: number;
  nitroTank: number;
  nitroActive: boolean;
  /** Short-lived message in the middle of the screen */
  toast: string | null;
  trackName: string;
  /** Laps to race (0: endless) and the lap now being driven */
  laps: number;
  lap: number;
  /** 3, 2, 1, 0 (GO) during the countdown */
  count: number | null;
  wrongWay: boolean;
  /** Completed lap times (s), the best lap on this track before this race, and the last lap against it */
  lapTimes: number[];
  bestLap: number | null;
  lapDelta: number | null;
  results: RaceResults | null;
  /** Race place (1-based) and how many cars */
  place: number;
  cars: number;
  armour: number;
  armourMax: number;
  /** 0..1, and whether it's locked out overheated */
  heat: number;
  gunLocked: boolean;
  /** Machine-gun rounds left (none until a gun pad) */
  ammo: number;
  /** Seconds of armed spell left */
  armed: number;
  missiles: number;
  defence: string | null;
  /** Weapons work yet (they're cold for the first seconds of a race) */
  weaponsHot: boolean;
  feed: FeedLine[];
  banner: Banner | null;
  /** Increments on every hit the player lands, and on every hit the player takes (with where from, radians) */
  hits: number;
  hurt: number;
  hurtAngle: number;
  /** Standings: live during the race, final at the end */
  standings: StandingRow[];
  /** All the cars are done (or out of time): the standings are final */
  over: boolean;
  /** The player is wrecked: who did it (for the wreck cam caption) */
  wreckedBy: string | null;
  /** The wreck replay is showing */
  replay: boolean;
}

const INITIAL: HudState = {
  phase: 'loading', status: 'Loading…', nitro: 0, nitroTank: 1, nitroActive: false, toast: null, trackName: '',
  laps: 0, lap: 1, count: null, wrongWay: false, lapTimes: [], bestLap: null, lapDelta: null, results: null,
  place: 1, cars: 1, armour: 1, armourMax: 1, heat: 0, gunLocked: false, ammo: 0, armed: 0, missiles: 0, defence: null, weaponsHot: false,
  feed: [], banner: null, hits: 0, hurt: 0, hurtAngle: 0, standings: [], over: false, wreckedBy: null, replay: false,
};

export class HudStore {
  private state: HudState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  readonly get = (): HudState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<HudState>): void {
    let changed = false;
    for (const key in patch) {
      if (patch[key as keyof HudState] !== this.state[key as keyof HudState]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** A message for `ms` milliseconds */
  toast(text: string, ms = 2500): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.update({ toast: text });
    this.toastTimer = setTimeout(() => this.update({ toast: null }), ms);
  }

  private feedId = 0;
  private readonly feedTimers = new Set<ReturnType<typeof setTimeout>>();
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  /** A kill feed line, gone after a few seconds (the newest 5 shown) */
  pushFeed(text: string, kind: FeedLine['kind']): void {
    const line = { id: ++this.feedId, text, kind };
    this.update({ feed: [...this.state.feed, line].slice(-5) });
    const t = setTimeout(() => {
      this.feedTimers.delete(t);
      this.update({ feed: this.state.feed.filter((l) => l.id !== line.id) });
    }, 6000);
    this.feedTimers.add(t);
  }

  /** The big banner, for `ms` */
  announce(title: string, sub: string, kind: Banner['kind'], ms = 2600): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.update({ banner: { id: ++this.feedId, title, sub, kind } });
    this.bannerTimer = setTimeout(() => this.update({ banner: null }), ms);
  }

  dispose(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    for (const t of this.feedTimers) clearTimeout(t);
    this.listeners.clear();
  }
}
