import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/game';
import { requestTrack } from '../game/track/client';
import { loadModels } from '../game/models';
import { loadSurfaces } from '../game/surfaces';
import { errorMessage } from './errors';
import { setupFor, type Session } from '../types';
import type { RoomConnection } from '../net/room';
import type { RaceRecord } from '../net/records';
import { roomSessionSetup, trackOf } from '../net/raceSetup';
import { Hud } from './Hud';
import { TouchControls } from './TouchControls';
import { TOUCH } from '../game/device';
import { initAudio } from '../game/audio';
import { SettingsPanel } from './SettingsPanel';
import { PauseMenu } from './PauseMenu';
import { TunePanel, TUNING } from './TunePanel';

interface Props {
  /** An offline race... */
  session?: Session;
  /** ...or a race in a room */
  room?: { conn: RoomConnection; race: RaceRecord };
  playerName?: string;
  onExit: () => void;
  /** Same track, from the grid again (offline) */
  onRestart: () => void;
}

declare global {
  interface Window {
    /** The running game, for the e2e tests and the console (dev and e2e builds only) */
    game?: Game;
  }
}

/** The race: owns the Game for as long as it's on screen. */
export function GameView({ session, room, playerName = 'Driver', onExit, onRestart }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let instance: Game | null = null;
    let cancelled = false;
    // The track is built in a worker first (and the kit models and photo textures loaded, if there are any); the game starts on it.
    const spec = session ? session.spec : trackOf(room!.race.settings);
    Promise.all([requestTrack(spec), loadModels(), loadSurfaces()]).then(([track]) => {
      if (cancelled) return;
      const setup = session ? setupFor(session) : roomSessionSetup(room!.conn, room!.race, room!.conn.view().lobby, playerName);
      instance = new Game(el, { track, setup });
      if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') window.game = instance;
      setGame(instance);
      void instance.start();
    }, (err: unknown) => {
      if (!cancelled) setFailed(`Couldn't build the track: ${errorMessage(err)}`);
    });
    return () => {
      cancelled = true;
      instance?.dispose();
      if (window.game === instance) delete window.game;
    };
    // A room race is the same race for as long as its number is (a re-render with a fresh `room` object isn't a new race).
  }, [session, room?.conn, room?.race.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    game?.setPaused(paused);
  }, [game, paused]);

  useEffect(() => {
    if (!game) return;
    game.onPauseRequest = () => setPaused((p) => !p);
    return () => { game.onPauseRequest = null; };
  }, [game]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      initAudio();
      if (e.code === 'Escape' && !e.defaultPrevented) setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section id="game-screen" className="screen">
      <div ref={host} className="game-host" />
      {game && TOUCH && !paused && <TouchControls touch={game.inputs.touch} />}
      {game ? <Hud game={game} onRestart={onRestart} onExit={onExit} inRoom={!!room} /> : (
        <div id="connecting-overlay" className="overlay" role="status">
          <div className="panel-box"><p>{failed ?? 'Building the track…'}</p></div>
        </div>
      )}
      {paused && game && !showSettings && (
        <PauseMenu game={game} inRoom={!!room} onResume={() => setPaused(false)} onRestart={onRestart}
          onSettings={() => setShowSettings(true)} onExit={onExit} />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {TUNING && <TunePanel />}
    </section>
  );
}
