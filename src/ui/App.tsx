import { useEffect, useState } from 'react';
import { GameView } from './GameView';
import { Lobby } from './Lobby';
import { RoomView } from './RoomView';
import type { Session } from '../types';
import { initAudio } from '../game/audio';
import { RoomConnection } from '../net/room';
import { randomId } from '../net/lobby';
import { friendlyError } from './errors';
import { DiscordLobby } from './DiscordLobby';
import { IN_DISCORD } from '../discord/patch';

type Screen =
  | { kind: 'lobby'; error?: string }
  | { kind: 'race'; session: Session; key: number }
  | { kind: 'room'; conn: RoomConnection; name: string };

/** This tab's id in rooms (a refresh gets a new one) */
const PLAYER_ID = randomId(12);

/** An invite link's room code: #CODE or ?room=CODE */
function inviteCode(): string | null {
  const hash = location.hash.replace('#', '').trim().toUpperCase();
  if (/^[A-Z0-9]{4,10}$/.test(hash)) return hash;
  const q = new URLSearchParams(location.search).get('room');
  return q && /^[A-Z0-9]{4,10}$/i.test(q) ? q.toUpperCase() : null;
}

/**
 * No router: the lobby, an offline race, or a room (whose races happen inside it). Entering a room
 * puts its code in the URL (#CODE), so the address bar is an invite link; leaving keeps the query
 * string (inside Discord it carries frame_id and instance_id).
 */
export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'lobby' });

  const enterRoom = async (code: string, name: string) => {
    const conn = new RoomConnection(code, PLAYER_ID, { name, c: 0 });
    try {
      await conn.join();
      history.replaceState(null, '', `${location.pathname}${location.search}#${code}`);
      setScreen({ kind: 'room', conn, name });
    } catch (err) {
      void conn.leave();
      setScreen({ kind: 'lobby', error: friendlyError(err) });
    }
  };
  const leaveRoom = (conn: RoomConnection) => {
    void conn.leave();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    setScreen({ kind: 'lobby', ...(IN_DISCORD ? { error: 'You left the race.' } : {}) });
  };
  // Leaving the page: our records go now, not when the server notices the socket gone.
  useEffect(() => {
    if (screen.kind !== 'room') return;
    const conn = screen.conn;
    const bye = () => void conn.leave();
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [screen]);

  if (screen.kind === 'race') {
    return <GameView key={screen.key} session={screen.session} onExit={() => setScreen({ kind: 'lobby' })}
      onRestart={() => setScreen({ ...screen, key: screen.key + 1 })} />;
  }
  if (screen.kind === 'room') {
    return <RoomView conn={screen.conn} playerName={screen.name} onLeave={() => leaveRoom(screen.conn)} />;
  }
  if (IN_DISCORD) {
    return <DiscordLobby playerId={PLAYER_ID} notice={screen.error} onEnterRoom={(code, name) => { initAudio(); void enterRoom(code, name); }} />;
  }
  return (
    <Lobby
      playerId={PLAYER_ID}
      initialCode={inviteCode()}
      error={screen.error}
      // Starting a race is a click: the moment browsers allow sound to start.
      onStart={(s) => { initAudio(); setScreen({ kind: 'race', session: s, key: Date.now() }); }}
      onEnterRoom={(code, name) => { initAudio(); void enterRoom(code, name); }}
    />
  );
}
