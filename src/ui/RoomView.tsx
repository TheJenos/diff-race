import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RoomConnection } from '../net/room';
import type { RaceRecord, RoomSettings } from '../net/records';
import { makeGrid } from '../net/raceSetup';
import { settingsOf } from '../net/lobby';
import { formatTime } from '../game/race/clock';
import type { RaceMode } from '../types';
import { GameView } from './GameView';
import { SettingsPanel } from './SettingsPanel';
import { ConfirmButton } from './ConfirmButton';
import { MenuFrame, MenuPanel, MenuPlay, MenuRail, ProfileChip, type MenuTab } from './MenuShell';
import { Choice, RaceFields, SettingRow, TrackPicker, type RaceChoice } from './RaceSetup';
import { IN_DISCORD } from '../discord/patch';
import { friendlyError } from './errors';

interface Props {
  conn: RoomConnection;
  playerName: string;
  onLeave: () => void;
}

/** Seconds from the host pressing Start to the green light: everyone's game loads its track meanwhile */
const START_DELAY_MS = 8_000;

type View = 'race' | 'results';

const choiceOf = (s: RoomSettings): RaceChoice => ({
  mode: s.elim ? 'elimination' : 'race', seed: s.seed, length: s.length, theme: s.theme, laps: s.laps, bots: s.bots, skill: s.skill, crash: s.crash,
});

/**
 * Inside a room, in the menus' look: Start at the top of the rail (the host's), the race's settings
 * and the last results as views, and the room's code, invite and drivers under them. The host
 * changes the settings; everyone sees them. When a race starts with us on the grid, the race takes
 * over the screen; back here after.
 */
export function RoomView({ conn, playerName, onLeave }: Props) {
  const room = useSyncExternalStore(conn.subscribe, conn.view);
  const [racing, setRacing] = useState<RaceRecord | null>(null);
  const [lastRace, setLastRace] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>('race');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const race = room.race;
  const lobby = room.lobby;
  const owner = room.ownerId === conn.playerId;

  // A new race with us on the grid: race it.
  useEffect(() => {
    if (race && race.phase === 'grid' && race.n > lastRace && race.grid[conn.playerId] !== undefined) {
      setLastRace(race.n);
      setRacing(race);
    }
  }, [race, lastRace, conn.playerId]);

  if (racing) {
    return <GameView room={{ conn, race: racing }} playerName={playerName} onExit={() => setRacing(null)} onRestart={() => setRacing(null)} />;
  }
  if (!lobby) {
    return (
      <MenuFrame id="room">
        <div className="menu-welcome">
          <div className="name-setup discord-connect" role="status">
            <h2><span className="spinner" aria-hidden="true" />{room.connected ? 'Joining the room…' : 'Connecting…'}</h2>
            <button type="button" onClick={onLeave}>Back</button>
          </div>
        </div>
      </MenuFrame>
    );
  }

  const set = (patch: Partial<RaceChoice>) => {
    // The rules need a seed: one cleared out to type a new one isn't sent until there's something in it.
    if (!owner || (patch.seed !== undefined && !patch.seed.trim())) return;
    const { mode, ...rest } = patch;
    const out: Partial<RoomSettings> = { ...rest };
    if (mode) out.elim = mode === 'elimination';
    conn.updateSettings(out).catch((err: unknown) => setError(friendlyError(err)));
  };
  const start = async () => {
    setError(null);
    try {
      const settings = settingsOf(lobby);
      const ok = await conn.mutateRace((r) => {
        if (r.phase === 'grid') return false;
        r.n += 1;
        r.phase = 'grid';
        r.startAt = conn.serverNow() + START_DELAY_MS;
        r.grid = makeGrid(room.members, settings);
        r.settings = settings;
        delete r.endAt;
        return true;
      });
      if (ok) await conn.setRacing(true);
    } catch (err) {
      setError(friendlyError(err));
    }
  };
  const invite = `${location.origin}${location.pathname}${location.search}#${conn.code}`;
  const raceOn = race?.phase === 'grid';
  const results = Object.entries(room.results).sort(([, a], [, b]) => (a.ms ?? Infinity) - (b.ms ?? Infinity));
  const showResults = results.length > 0 && race?.phase === 'results';
  const choice = choiceOf(lobby);
  const tabs: MenuTab[] = [
    { id: 'race', label: 'The race', short: 'Race', sub: owner ? 'Track, mode, laps, bots' : 'What the host has picked', icon: '⚑' },
    ...(showResults ? [{ id: 'results', label: 'Last race', short: 'Results', sub: 'How it finished', icon: '★' }] : []),
  ];

  return (
    <MenuFrame
      id="room"
      discord={IN_DISCORD}
      profile={<ProfileChip name={playerName} title="Your name in this room" />}
      onSettings={() => setSettingsOpen(true)}
      foot={(
        <ConfirmButton id="leave-room" className="danger menu-leave" question="Leave the room?" yes="Leave" no="Stay" onConfirm={onLeave}>
          <span className="icon" aria-hidden="true">⏏</span>Leave room
        </ConfirmButton>
      )}
    >
      <div className="menu-alerts">
        {raceOn && race && race.grid[conn.playerId] === undefined && <div className="warning">A race is on: you'll be on the grid for the next one.</div>}
        {error && <div className="warning" role="alert">{error}</div>}
      </div>
      <MenuRail
        label="Room"
        tabsLabel="Room"
        hero={owner ? (
          <MenuPlay id="start-room-race" label="▶ Start race" sub={`Everyone here lines up · ${room.members.length} ${room.members.length === 1 ? 'driver' : 'drivers'}${lobby.bots ? ` + ${lobby.bots} bots` : ''}`}
            disabled={raceOn} onClick={() => void start()} />
        ) : (
          <div className="menu-wait" role="status">
            <span className="spinner" aria-hidden="true" />
            <span><strong>{raceOn ? 'Race on' : 'Waiting for the host'}</strong><small className="muted">{raceOn ? 'You join the next one' : 'The host picks the track and starts'}</small></span>
          </div>
        )}
        tabs={tabs}
        active={showResults ? view : 'race'}
        onSelect={(id) => setView(id as View)}
        extra={(
          <div className="room-box">
            <div className="room-head">
              <div>
                <span className="code-join-title">{lobby.name}</span>
                <span className="room-code-line">Room <b id="room-code">{conn.code}</b></span>
              </div>
              {!IN_DISCORD && (
                <button type="button" id="copy-invite" onClick={() => { void navigator.clipboard?.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? 'Copied' : 'Copy invite'}
                </button>
              )}
            </div>
            <ul id="members" aria-label="Drivers">
              {room.members.map((m) => (
                <li key={m.id} className={m.id === conn.playerId ? 'self' : ''}>
                  <span className="avatar" aria-hidden="true">{m.name.slice(0, 1).toUpperCase()}</span>
                  <span className="who">{m.name}{m.id === conn.playerId ? ' (you)' : ''}</span>
                  {m.id === room.ownerId && <span className="host" title="Host">Host</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      />

      {(!showResults || view === 'race') && (
        <MenuPanel id="race" title={owner ? 'Set up the race' : 'The race'}>
          <div className="room-race">
            <SettingRow label="Mode">
              <Choice label="Race" value={choice.mode} disabled={!owner}
                options={[{ value: 'race' as RaceMode, label: 'Death Race' }, { value: 'elimination' as RaceMode, label: 'Elimination' }]}
                onChange={(mode) => set({ mode })} />
            </SettingRow>
            <TrackPicker value={choice} onChange={set} disabled={!owner} />
            <RaceFields value={choice} onChange={set} botOptions={[0, 3, 5, 7]} disabled={!owner} />
            {!owner && <p className="muted hint">Only the host can change these.</p>}
          </div>
        </MenuPanel>
      )}

      {showResults && view === 'results' && (
        <MenuPanel id="results" title="Last race">
          <ol id="room-results" className="results-laps">
            {results.map(([id, r]) => (
              <li key={id}><span>{r.name}</span><span>{r.ms !== undefined ? formatTime(r.ms / 1000) : 'DNF'}{r.k ? ` · ${r.k} kills` : ''}</span></li>
            ))}
          </ol>
        </MenuPanel>
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </MenuFrame>
  );
}
