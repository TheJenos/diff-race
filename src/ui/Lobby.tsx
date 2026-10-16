import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isConfigured } from '../net/firebase';
import { createRoom, getRoom } from '../net/lobby';
import type { RoomSettings } from '../net/records';
import { GENERATOR_VERSION } from '../game/track/spec';
import { DEFAULT_ARMOUR } from '../game/car/damage';
import type { Session } from '../types';
import { SettingsPanel } from './SettingsPanel';
import { NAME_PATTERN, loadName, saveName } from './playerName';
import { CodeJoin, RoomList, RoomSearch, useRooms, versionMessage } from './RoomBrowser';
import { Leaderboard } from './Leaderboard';
import { MenuFrame, MenuPanel, MenuPlay, MenuRail, ProfileChip, type MenuTab } from './MenuShell';
import { MODES, RaceWizard, specOf, type RaceChoice } from './RaceSetup';
import { randomSeed, seedOfTheDay } from './seeds';
import { friendlyError } from './errors';


interface Props {
  playerId: string;
  /** Room code from an invite link */
  initialCode: string | null;
  error?: string;
  onStart: (s: Session) => void;
  onEnterRoom: (code: string, name: string) => void;
}

type View = 'rooms' | 'create' | 'custom' | 'leaderboard';
/** What's under way, and where its error belongs */
type Action = 'code' | 'list' | 'create';
type Invite = 'auto' | 'closed' | null;

/** Seconds an invite link waits (with a Stay button) before joining */
const INVITE_MS = 2000;

/** A room's settings from what was chosen in the wizard */
const roomSettings = (c: RaceChoice): RoomSettings => ({
  seed: c.seed.trim() || randomSeed(), length: c.length, theme: c.theme, gen: GENERATOR_VERSION, laps: c.laps, bots: c.bots,
  skill: c.skill, crash: c.crash, armour: DEFAULT_ARMOUR, weapons: true, elim: c.mode === 'elimination',
});

/**
 * The main menu, laid out as Arena FPS's: Quick race at the top of the rail, then the views (the
 * open rooms, making one, a custom race offline, the leaderboard), joining by code under them, and
 * Settings at the foot. The first visit asks for a name; an invite link counts down to joining.
 */
export function Lobby({ playerId, initialCode, error: initialError, onStart, onEnterRoom }: Props) {
  const [name, setName] = useState(() => loadName().trim().slice(0, 16));
  const [draftName, setDraftName] = useState('');
  const [nameError, setNameError] = useState('');
  const [view, setView] = useState<View>(isConfigured ? 'rooms' : 'custom');
  const [search, setSearch] = useState('');
  const [roomName, setRoomName] = useState('');
  const [custom, setCustom] = useState<RaceChoice>(() => ({ mode: 'race', seed: randomSeed(), length: 'm', theme: 'docks', laps: 3, bots: 7, skill: 'mixed', crash: 1 }));
  const [room, setRoom] = useState<RaceChoice>(() => ({ mode: 'race', seed: randomSeed(), length: 'm', theme: 'docks', laps: 3, bots: 3, skill: 'mixed', crash: 1 }));
  const [error, setError] = useState<{ at: Action; text: string } | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [joiningCode, setJoiningCode] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { rooms, failed, retry } = useRooms();
  const [invite, setInvite] = useState<Invite>(() => (initialCode && isConfigured && !initialError ? 'auto' : null));
  const hasName = name.length > 0;
  const disabled = !!busy;
  const errorAt = (at: Action) => (error?.at === at ? error.text : null);

  const chooseName = (e: FormEvent) => {
    e.preventDefault();
    const chosen = draftName.trim().replace(/\s+/g, ' ');
    if (!NAME_PATTERN.test(chosen)) {
      setNameError('Names are 2–16 characters: letters, numbers, spaces, - or _.');
      return;
    }
    saveName(chosen);
    setName(chosen);
    setNameError('');
  };

  /** Runs `action` with the menu locked; its error shows next to it */
  const run = async (kind: Action, action: () => Promise<void>) => {
    if (!hasName || busy) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError({ at: kind, text: friendlyError(err) });
      setBusy(null);
      setJoiningCode('');
    }
  };

  const join = (code: string, from: 'code' | 'list') => {
    const target = code.trim().toUpperCase();
    setJoiningCode(target);
    return run(from, async () => {
      const found = await getRoom(target);
      if (!found) {
        if (target === initialCode) {
          // The invite points at a room that's gone: say so, and clear the stale code.
          setInvite('closed');
          history.replaceState(null, '', location.pathname + location.search);
        }
        throw new Error(`There's no room ${target}.`);
      }
      if (found.gen !== GENERATOR_VERSION) throw new Error(versionMessage(found.gen));
      onEnterRoom(target, name);
    });
  };

  const create = () => run('create', async () => {
    const code = await createRoom(roomName.trim().slice(0, 32) || `${name}'s room`, roomSettings(room), name, playerId);
    onEnterRoom(code, name);
  });

  const quickRace = () => {
    if (!hasName) return;
    onStart({
      mode: 'race', spec: { seed: seedOfTheDay(), length: 'm', theme: 'docks', gen: GENERATOR_VERSION },
      laps: 3, bots: 7, botSkill: 'mixed', crash: 1, armour: DEFAULT_ARMOUR, weapons: true, playerName: name,
    });
  };

  const startCustom = () => {
    if (!hasName) return;
    const c = custom;
    onStart({
      mode: c.mode, spec: specOf({ ...c, seed: c.seed.trim() || randomSeed() }), laps: c.mode === 'testdrive' ? 0 : c.laps,
      bots: c.bots, botSkill: c.skill, crash: c.crash, armour: DEFAULT_ARMOUR, weapons: c.mode !== 'timetrial', playerName: name,
    });
  };

  // An invite link: once there's a name, a short countdown (from the first idle moment), then in.
  const [counting, setCounting] = useState(false);
  useEffect(() => {
    if (invite !== 'auto' || !hasName || !initialCode) return;
    let timer = 0;
    const begin = () => {
      setCounting(true);
      timer = window.setTimeout(() => { void join(initialCode, 'code'); }, INVITE_MS);
    };
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(begin, { timeout: 1500 }) : (begin(), 0);
    return () => {
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
      setCounting(false);
    };
  }, [invite, hasName]); // eslint-disable-line react-hooks/exhaustive-deps

  const backToRooms = useCallback(() => setView(isConfigured ? 'rooms' : 'custom'), []);

  const alerts = (
    <>
      {initialError && <div className="warning" role="alert">{initialError}</div>}
      {hasName && invite === 'auto' && initialCode ? (
        <div className="invite-card" role="status">
          <p>{busy === 'code' && <span className="spinner" aria-hidden="true" />}Joining room <strong>{initialCode}</strong>…</p>
          <div className="row">
            <button type="button" className="primary" disabled={disabled} onClick={() => void join(initialCode, 'code')}>Join now</button>
            <button type="button" disabled={disabled} onClick={() => setInvite(null)}>Stay in the lobby</button>
          </div>
          {busy !== 'code' && counting && <div className="progress" aria-hidden="true" />}
        </div>
      ) : hasName && invite === 'closed' ? (
        <div className="warning">That room has closed. Create a new one, or ask for a fresh invite.</div>
      ) : null}
    </>
  );

  if (!hasName) {
    // First visit: pick the name once.
    return (
      <MenuFrame>
        <div className="menu-welcome">
          {alerts}
          <form className="name-setup" onSubmit={chooseName}>
            <p className="kicker">Armoured cars · roof turrets · no downloads</p>
            <h2>What should we call you?</h2>
            <p className="muted">
              {initialCode ? <>You've been invited to room <strong>{initialCode}</strong>. </> : null}
              It's how everyone sees you on the track and on the leaderboard. You can change it later in Settings.
            </p>
            <div className="row">
              <input id="name-input" value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={16}
                placeholder="e.g. Machine Gun Joe" autoComplete="off" autoFocus aria-label="Your name" />
              <button className="primary" disabled={draftName.trim().length < 2}>Continue ▸</button>
            </div>
            <small className="muted">2–16 characters: letters, numbers, spaces, - or _.</small>
            <p className="error">{nameError}</p>
          </form>
        </div>
      </MenuFrame>
    );
  }

  const tabs: MenuTab[] = [
    ...(isConfigured ? [
      { id: 'rooms', label: 'Rooms', short: 'Rooms', sub: 'Join a race with others', icon: '◇', ...(rooms ? { count: rooms.length } : {}) },
      { id: 'create', label: 'Create room', short: 'Create', sub: 'Race your friends', icon: '＋' },
    ] : []),
    { id: 'custom', label: 'Custom race', short: 'Custom', sub: 'Any track, any mode, offline', icon: '⚑' },
    ...(isConfigured ? [{ id: 'leaderboard', label: 'Leaderboard', short: 'Ranks', sub: 'The best drivers', icon: '★' }] : []),
  ];

  return (
    <MenuFrame
      profile={<ProfileChip name={name} title="Your name on this browser (change it in Settings)" />}
      onSettings={() => setSettingsOpen(true)}
      // An invite is counting down to joining: nothing heavy until it's done (or cancelled).
      backdropDelay={invite === 'auto' ? 4000 : undefined}
    >
      <div className="menu-alerts">
        {alerts}
        {!isConfigured && (
          <div className="warning">
            Rooms and the leaderboard need a database: copy <code>.env.example</code> to <code>.env</code> and fill it in,
            or run <code>npm run emulator</code> and <code>npm run dev:emu</code>. Races against the bots work without one.
          </div>
        )}
      </div>
      <MenuRail
        hero={<MenuPlay id="quick-race" label="▶ Quick race" sub="3 laps against 7 bots on today's track" disabled={disabled} onClick={quickRace} />}
        tabs={tabs}
        active={view}
        onSelect={(id) => setView(id as View)}
        extra={isConfigured && (
          <CodeJoin key={invite === 'closed' ? 'closed' : 'open'} initialCode={invite === 'closed' ? '' : initialCode ?? ''}
            joiningCode={busy === 'code' ? joiningCode : ''} disabled={disabled} error={errorAt('code')} onJoin={(c) => void join(c, 'code')} />
        )}
      />

      {view === 'rooms' && (
        <MenuPanel id="rooms" title={<>Open rooms {rooms && <span className="live"><span className="dot" aria-hidden="true" />{rooms.length} live</span>}</>}
          aside={<RoomSearch value={search} onChange={setSearch} />}>
          {errorAt('list') && <p className="error" role="alert">{errorAt('list')}</p>}
          <RoomList rooms={rooms} failed={failed} retry={retry} search={search} onClearSearch={() => setSearch('')}
            joiningCode={busy === 'list' ? joiningCode : ''} disabled={disabled} onJoin={(c) => void join(c, 'list')}
            onCreate={() => setView('create')} onQuickRace={quickRace} />
        </MenuPanel>
      )}

      {view === 'create' && (
        <MenuPanel id="create" title="Create a room">
          <RaceWizard value={room} onChange={setRoom} modes={['race', 'elimination']} botOptions={[0, 3, 5, 7]}
            roomFields={(
              <label className="field">
                <span>Room name</span>
                <input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={32} placeholder={`${name}'s room`} autoComplete="off" />
              </label>
            )}
            launchId="create-room" launchLabel={`Create ${MODES[room.mode].label} room`} busy={busy === 'create'} disabled={disabled}
            onLaunch={() => void create()} error={errorAt('create')} note="You'll get a code to share once you're in. Everything can be changed in the room." onExit={backToRooms} />
        </MenuPanel>
      )}

      {view === 'custom' && (
        <MenuPanel id="custom" title="Custom race">
          <RaceWizard value={custom} onChange={setCustom} modes={['race', 'elimination', 'timetrial', 'testdrive']}
            launchId="start-race" launchLabel={`▶ Start ${MODES[custom.mode].label}`} busy={false} disabled={disabled}
            onLaunch={startCustom} note="Offline: just you and the bots." onExit={backToRooms} />
        </MenuPanel>
      )}

      {view === 'leaderboard' && (
        <MenuPanel id="leaderboard">
          <Leaderboard />
        </MenuPanel>
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} profile={{ name, onRename: (n) => { saveName(n); setName(n); } }} />}
    </MenuFrame>
  );
}
