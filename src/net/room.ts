import {
  get, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, onValue, push, query, orderByKey, ref, remove,
  runTransaction, serverTimestamp, set, startAt, update, type DatabaseReference, type Unsubscribe,
} from 'firebase/database';
import { db } from './firebase';
import { deleteRoom, isBotId } from './lobby';
import type { HazardRecord, LobbyRecord, PlayerRecord, RaceRecord, ReceivedEvent, ResultRecord, RoomEvent, RoomSettings } from './records';

/*
 * A live connection to one room: our presence in it (records written on join and on every
 * reconnect, queued for removal when the socket drops), a mirror of what's in it, and the writes
 * a race needs. The game is client-authoritative, as in Arena FPS: each client simulates and sends
 * its own car (the owner also its bots), the shooter decides what it hit, and every car applies the
 * damage done to it and reports its own wreck.
 *
 * Two ways to listen: `subscribe`/`view` for the room's slow-changing state (React reads it), and
 * per-record listeners for the fast stuff (poses, events), which never re-render React.
 */

const EVENT_TTL = 3_000;

export interface RoomView {
  connected: boolean;
  lobby: LobbyRecord | null;
  race: RaceRecord | null;
  /** Results of the current race, by car id */
  results: Record<string, ResultRecord>;
  ownerId: string | null;
  /** Member ids and names, in the order they joined (well: by id; the lobby has no order) */
  members: { id: string; name: string }[];
}

type Listener<T> = (id: string, value: T | null) => void;

export class RoomConnection {
  private readonly lobbyRef: DatabaseReference;
  private readonly playerRef: DatabaseReference;
  private readonly memberRef: DatabaseReference;
  private readonly raceRef: DatabaseReference;
  private readonly eventsRef: DatabaseReference;
  private readonly hazardsRef: DatabaseReference;
  private state: RoomView = { connected: false, lobby: null, race: null, results: {}, ownerId: null, members: [] };
  private readonly viewers = new Set<() => void>();
  readonly players = new Map<string, PlayerRecord>();
  readonly bots = new Map<string, PlayerRecord>();
  readonly hazards = new Map<string, HazardRecord>();
  private readonly playerListeners = new Set<Listener<PlayerRecord>>();
  private readonly botListeners = new Set<Listener<PlayerRecord>>();
  private readonly hazardListeners = new Set<Listener<HazardRecord>>();
  private readonly eventListeners = new Set<(e: ReceivedEvent) => void>();
  /** Bots this client writes (when it owns the room), as last written */
  private readonly ownBots = new Map<string, PlayerRecord>();
  private me: PlayerRecord;
  private serverOffset = 0;
  private left = false;
  private unsubs: Unsubscribe[] = [];
  private resultsUnsub: Unsubscribe | null = null;
  private resultsFor = -1;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(readonly code: string, readonly playerId: string, initial: PlayerRecord) {
    this.me = initial;
    this.lobbyRef = ref(db(), `lobby/${code}`);
    this.playerRef = ref(db(), `rooms/${code}/players/${playerId}`);
    this.memberRef = ref(db(), `lobby/${code}/members/${playerId}`);
    this.raceRef = ref(db(), `rooms/${code}/race`);
    this.eventsRef = ref(db(), `rooms/${code}/events`);
    this.hazardsRef = ref(db(), `rooms/${code}/hazards`);
  }

  // ---------------------------------------------------------------- joining

  async join(): Promise<void> {
    let first = true;
    await new Promise<void>((resolve, reject) => {
      this.unsubs.push(onValue(ref(db(), '.info/connected'), async (snap) => {
        const connected = !!snap.val();
        this.patch({ connected });
        if (!connected || this.left) return;
        try {
          await this.registerPresence();
          if (first) { first = false; resolve(); }
        } catch (err) {
          if (first) reject(err);
        }
      }));
    });
    if (this.left) return;
    this.unsubs.push(
      onValue(ref(db(), '.info/serverTimeOffset'), (s) => { this.serverOffset = Number(s.val()) || 0; }),
      onValue(this.lobbyRef, (s) => {
        const lobby = s.val() as LobbyRecord | null;
        const members = Object.entries(lobby?.members ?? {}).map(([id, name]) => ({ id, name })).sort((a, b) => (a.id < b.id ? -1 : 1));
        this.patch({ lobby, members });
        this.electOwner(lobby);
      }),
      onValue(this.raceRef, (s) => {
        const race = s.val() as RaceRecord | null;
        this.patch({ race: race ? { ...race, grid: race.grid ?? {} } : null });
        if (race && race.n !== this.resultsFor) this.watchResults(race.n);
      }),
    );
    const mirror = (path: string, map: Map<string, PlayerRecord>, listeners: Set<Listener<PlayerRecord>>) => {
      const r = ref(db(), `rooms/${this.code}/${path}`);
      const put = (id: string | null, v: PlayerRecord | null) => {
        if (!id) return;
        if (v) map.set(id, v);
        else map.delete(id);
        for (const l of listeners) l(id, v);
      };
      this.unsubs.push(
        onChildAdded(r, (s) => put(s.key, s.val() as PlayerRecord)),
        onChildChanged(r, (s) => put(s.key, s.val() as PlayerRecord)),
        onChildRemoved(r, (s) => {
          put(s.key, null);
          // Our own record vanished while we're still here (an old tab's socket closing late): put it back.
          if (s.key === this.playerId && !this.left && this.state.connected) void this.registerPresence();
        }),
      );
    };
    mirror('players', this.players, this.playerListeners);
    mirror('bots', this.bots, this.botListeners);
    const putHazard = (id: string | null, v: HazardRecord | null) => {
      if (!id) return;
      if (v) this.hazards.set(id, v);
      else this.hazards.delete(id);
      for (const l of this.hazardListeners) l(id, v);
    };
    this.unsubs.push(
      onChildAdded(this.hazardsRef, (s) => putHazard(s.key, s.val() as HazardRecord)),
      onChildRemoved(this.hazardsRef, (s) => putHazard(s.key, null)),
    );
    // Push keys are time-ordered: starting at a fresh one skips events from before we joined.
    const fromNow = query(this.eventsRef, orderByKey(), startAt(push(this.eventsRef).key));
    this.unsubs.push(onChildAdded(fromNow, (s) => {
      const e = s.val() as ReceivedEvent;
      // Something a slow connection delivered long after the fact is no use any more.
      if (typeof e.t === 'number' && this.serverNow() - e.t > 10_000) return;
      for (const l of this.eventListeners) l(e);
    }));
  }

  private async registerPresence(): Promise<void> {
    if (this.left) return;
    await Promise.all([this.playerRef, this.memberRef, ...[...this.ownBots.keys()].map((id) => this.botRef(id))].map((r) => onDisconnect(r).remove()));
    await set(this.playerRef, this.me);
    await set(this.memberRef, this.me.name);
    await Promise.all([...this.ownBots].map(([id, rec]) => set(this.botRef(id), rec)));
  }

  /**
   * The owner is whoever made the room. Once they've gone, the member with the lowest id takes
   * over and records it (so it doesn't move again when someone joins).
   */
  private electOwner(lobby: LobbyRecord | null): void {
    const members = lobby?.members ?? {};
    const ids = Object.keys(members).filter((id) => !isBotId(id));
    if (!ids.length || !lobby) return;
    if (lobby.hostId && members[lobby.hostId] !== undefined) {
      this.patch({ ownerId: lobby.hostId });
      return;
    }
    const heir = ids.sort()[0]!;
    if (heir === this.playerId) {
      update(this.lobbyRef, { hostId: heir, host: members[heir] }).catch((err: unknown) => console.warn('Could not take over the room', err));
    }
  }

  private watchResults(n: number): void {
    this.resultsUnsub?.();
    this.resultsFor = n;
    this.patch({ results: {} });
    this.resultsUnsub = onValue(ref(db(), `rooms/${this.code}/results/${n}`), (s) => {
      this.patch({ results: (s.val() ?? {}) as Record<string, ResultRecord> });
    });
  }

  // ---------------------------------------------------------------- the view (for React)

  readonly subscribe = (fn: () => void): (() => void) => {
    this.viewers.add(fn);
    return () => this.viewers.delete(fn);
  };

  readonly view = (): RoomView => this.state;

  private patch(p: Partial<RoomView>): void {
    this.state = { ...this.state, ...p };
    for (const v of this.viewers) v();
  }

  get isOwner(): boolean {
    return this.state.ownerId === this.playerId;
  }

  // ---------------------------------------------------------------- fast listeners (for the game)

  /** Each player record as it changes (and every existing one, straight away). Returns an unsubscribe. */
  onPlayer(fn: Listener<PlayerRecord>): () => void {
    this.playerListeners.add(fn);
    for (const [id, v] of this.players) fn(id, v);
    return () => this.playerListeners.delete(fn);
  }

  onBot(fn: Listener<PlayerRecord>): () => void {
    this.botListeners.add(fn);
    for (const [id, v] of this.bots) fn(id, v);
    return () => this.botListeners.delete(fn);
  }

  onHazard(fn: Listener<HazardRecord>): () => void {
    this.hazardListeners.add(fn);
    for (const [id, v] of this.hazards) fn(id, v);
    return () => this.hazardListeners.delete(fn);
  }

  onEvent(fn: (e: ReceivedEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  // ---------------------------------------------------------------- writing

  /** Our best estimate of the server's clock (ms) */
  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  /** Partial update of our record; null removes a field */
  sendState(partial: { [K in keyof PlayerRecord]?: PlayerRecord[K] | null }): Promise<void> {
    this.me = merge(this.me, partial);
    return update(this.playerRef, partial);
  }

  private botRef(id: string): DatabaseReference {
    return ref(db(), `rooms/${this.code}/bots/${id}`);
  }

  /** The bots this client now writes (the owner's): their records go with us when we drop */
  async adoptBots(records: Map<string, PlayerRecord>): Promise<void> {
    await Promise.all([...records.keys()].map((id) => onDisconnect(this.botRef(id)).remove()));
    await Promise.all([...records].map(([id, rec]) => set(this.botRef(id), rec)));
    // Only now do their updates go out: before the whole record is there, the rules refuse a partial one.
    if (this.left) return;
    for (const [id, rec] of records) this.ownBots.set(id, rec);
  }

  /** All our bots' changes in one write */
  sendBots(batch: Map<string, { [K in keyof PlayerRecord]?: PlayerRecord[K] | null }>): Promise<void> {
    const paths: Record<string, unknown> = {};
    for (const [id, partial] of batch) {
      const cur = this.ownBots.get(id);
      if (!cur) continue;
      this.ownBots.set(id, merge(cur, partial));
      for (const [k, v] of Object.entries(partial)) paths[`${id}/${k}`] = v;
    }
    return Object.keys(paths).length ? update(ref(db(), `rooms/${this.code}/bots`), paths) : Promise.resolve();
  }

  /** Take every bot record away (a race is over; new ones come with the next) */
  async clearBots(): Promise<void> {
    this.ownBots.clear();
    await remove(ref(db(), `rooms/${this.code}/bots`));
  }

  /**
   * Change the race record atomically: `change` edits it in place and returns false to leave it
   * alone (it may run several times if others write at once). Resolves to whether it was applied.
   */
  async mutateRace(change: (race: RaceRecord) => boolean): Promise<boolean> {
    const result = await runTransaction(this.raceRef, (current: RaceRecord | null) => {
      if (!current) return undefined;
      const race = { ...current, grid: { ...current.grid } };
      return change(race) ? race : undefined;
    }, { applyLocally: false });
    return result.committed;
  }

  /** The host changes the room's settings (used from the next race) */
  updateSettings(settings: Partial<RoomSettings>): Promise<void> {
    return update(this.lobbyRef, settings);
  }

  setRacing(racing: boolean): Promise<void> {
    return update(this.lobbyRef, { racing });
  }

  pushEvent(e: RoomEvent): void {
    const r = push(this.eventsRef);
    set(r, { ...e, from: this.playerId, t: serverTimestamp() }).catch((err: unknown) => console.warn('Could not send event', e.k, err));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      remove(r).catch(() => {});
    }, EVENT_TTL);
    this.timers.add(timer);
  }

  /** A hazard on the road: returns its id at once (the write goes in the background) */
  addHazard(h: HazardRecord): string | null {
    const r = push(this.hazardsRef);
    set(r, h).catch((err: unknown) => console.warn('Could not drop a hazard', err));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      remove(r).catch(() => {});
    }, Math.max(1000, h.until - this.serverNow()));
    this.timers.add(timer);
    return r.key;
  }

  /** Set off a mine: whoever's transaction wins removes it, exactly once. Resolves to whether it was us. */
  async claimHazard(id: string): Promise<boolean> {
    const result = await runTransaction(ref(db(), `rooms/${this.code}/hazards/${id}`), (cur: HazardRecord | null) => (cur ? null : undefined), { applyLocally: false });
    return result.committed;
  }

  /** A car's result in race n (each is written once) */
  writeResult(n: number, id: string, r: ResultRecord): Promise<void> {
    return set(ref(db(), `rooms/${this.code}/results/${n}/${id}`), r).catch((err: unknown) => console.warn('Could not save a result', err));
  }

  /** Safe to call more than once, and while join() is still under way */
  async leave(): Promise<void> {
    if (this.left) return;
    this.left = true;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.resultsUnsub?.();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    const bots = [...this.ownBots.keys()].map((id) => this.botRef(id));
    this.ownBots.clear();
    await Promise.all([this.playerRef, this.memberRef, ...bots].map((r) => remove(r)));
    const members = await get(ref(db(), `lobby/${this.code}/members`));
    if (!members.exists()) await deleteRoom(this.code);
  }
}

/** `base` with `partial` applied as a database update() applies it: null deletes a field. */
function merge<T extends object>(base: T, partial: Record<string, unknown>): T {
  const next = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(partial)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as T;
}
