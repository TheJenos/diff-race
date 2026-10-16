import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isConfigured } from '../net/firebase';
import { ROOM_CODE, watchRooms, type RoomSummary } from '../net/lobby';
import { trackOf } from '../net/raceSetup';
import { GENERATOR_VERSION } from '../game/track/spec';
import { THEMES } from '../game/track/themes';
import { TrackThumb } from './TrackThumb';

/*
 * Rooms to race in with other people, as Arena FPS lists matches: the open rooms (live), a search
 * over them, and joining by code from the rail. Only shown when a database is configured (see
 * .env.example); offline races need none.
 */

const LENGTH_LABEL = { s: 'Short', m: 'Medium', l: 'Long' } as const;

/** Why we can't join a room made by another version of the game */
export const versionMessage = (gen: number): string => (gen > GENERATOR_VERSION
  ? 'That room uses a newer version of the game. Reload to update, then join.'
  : 'That room was made with an older version of the game. Start a new room instead.');

/** How long the list may stay on "Looking…" before we call it a failure (ms) */
const ROOMS_TIMEOUT_MS = 8_000;

/** Live list of open rooms; `rooms` is null while loading, and `failed` offers a retry */
export function useRooms(): { rooms: RoomSummary[] | null; failed: boolean; retry(): void } {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isConfigured) return;
    let got = false;
    const timer = setTimeout(() => { if (!got) setFailed(true); }, ROOMS_TIMEOUT_MS);
    const stop = watchRooms((list) => {
      got = true;
      clearTimeout(timer);
      setFailed(false);
      setRooms(list);
    }, () => setFailed(true));
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [attempt]);
  return { rooms, failed, retry: () => { setRooms(null); setFailed(false); setAttempt((a) => a + 1); } };
}

/** The search box for the room list (in the panel's header) */
export function RoomSearch({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <input type="search" className="room-search" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder="Search rooms, tracks, drivers…" aria-label="Search rooms" />
  );
}

interface ListProps {
  rooms: RoomSummary[] | null;
  failed: boolean;
  retry(): void;
  search: string;
  onClearSearch(): void;
  joiningCode: string;
  disabled: boolean;
  onJoin(code: string): void;
  onCreate(): void;
  onQuickRace(): void;
}

/** The open rooms matching the search: each with its track, mode, drivers and a Join button */
export function RoomList({ rooms, failed, retry, search, onClearSearch, joiningCode, disabled, onJoin, onCreate, onQuickRace }: ListProps) {
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rooms || !q) return rooms;
    return rooms.filter((r) => [r.name, r.code, r.host, r.settings.seed, THEMES[r.settings.theme]?.name ?? '', ...r.players]
      .some((field) => field.toLowerCase().includes(q)));
  }, [rooms, search]);

  return (
    <ul id="room-list">
      {!isConfigured ? (
        <li className="empty">Not connected to a database</li>
      ) : failed ? (
        <li className="empty">Couldn't reach the server <button type="button" onClick={retry}>Retry</button></li>
      ) : shown === null ? (
        <li className="empty"><span className="spinner" aria-hidden="true" />Looking for rooms…</li>
      ) : rooms && rooms.length === 0 ? (
        <li className="empty big">
          <strong>No open rooms right now</strong>
          <span className="muted">Start one and send your friends the code, or warm up against the bots.</span>
          <span className="row">
            <button type="button" className="primary" onClick={onCreate}>＋ Create the first room</button>
            <button type="button" disabled={disabled} onClick={onQuickRace}>▶ Race the bots</button>
          </span>
        </li>
      ) : shown.length === 0 ? (
        <li className="empty">No rooms match “{search.trim()}”. <button type="button" onClick={onClearSearch}>Clear search</button></li>
      ) : (
        shown.map((room) => {
          const s = room.settings;
          const playable = s.gen === GENERATOR_VERSION;
          const elim = s.elim === true;
          return (
            <li key={room.code} className="room-card">
              <TrackThumb spec={playable ? trackOf(s) : null} size={64} />
              <div className="info">
                <div className="name">
                  <span className={`mode-badge ${elim ? 'elimination' : 'race'}`}>{elim ? 'EL' : 'DR'}</span>
                  {room.name}
                </div>
                <div className="meta">
                  <span className="line">
                    {elim ? 'Elimination' : 'Death Race'} · {playable
                      ? `${LENGTH_LABEL[s.length]} ${THEMES[s.theme]?.name ?? s.theme} · ${s.laps} ${s.laps === 1 ? 'lap' : 'laps'}${s.bots ? ` · ${s.bots} bots` : ''}`
                      : <span className="version-badge">{s.gen > GENERATOR_VERSION ? 'Newer version' : 'Older version'}</span>}
                  </span>
                  <span className="line">
                    <span className="code" title="Room code">{room.code}</span>
                    <span className="playing"><span className="dot" aria-hidden="true" />{room.racing ? 'Racing' : 'In the pits'} · {room.players.length}</span>
                    <span className="names">{room.players.slice(0, 4).join(', ')}{room.players.length > 4 ? '…' : ''}</span>
                  </span>
                </div>
              </div>
              <button type="button" className="join" disabled={disabled || !playable} title={playable ? undefined : versionMessage(s.gen)} onClick={() => onJoin(room.code)}>
                {joiningCode === room.code ? <><span className="spinner" aria-hidden="true" />Joining…</> : 'Join'}
              </button>
            </li>
          );
        })
      )}
    </ul>
  );
}

/** Joining a room by its code (a friend sent it), on the rail */
export function CodeJoin({ initialCode = '', joiningCode, disabled, error, onJoin }: {
  initialCode?: string; joiningCode: string; disabled: boolean; error: string | null; onJoin(code: string): void;
}) {
  const [code, setCode] = useState(initialCode);
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    setInvalid(!ROOM_CODE.test(c));
    if (ROOM_CODE.test(c)) onJoin(c);
  };
  return (
    <div className="code-join-box">
      <span className="code-join-title">Have a room code?</span>
      <form className="code-join" onSubmit={submit}>
        <input id="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          maxLength={10} placeholder="Room code" aria-label="Room code" autoComplete="off" spellCheck={false} />
        <button id="join-code" disabled={disabled || !code.trim()}>
          {joiningCode && joiningCode === code.trim() ? <><span className="spinner" aria-hidden="true" />Joining…</> : 'Join'}
        </button>
      </form>
      {(invalid || error) && <p className="error" role="alert">{invalid ? 'Room codes are 4–10 letters and numbers.' : error}</p>}
    </div>
  );
}
