import { useCallback, useEffect, useState } from 'react';
import { connectDiscord, setDiscordActivity } from '../discord/discord';
import { roomCodeFor } from '../discord/roomCode';
import { createRoomWithCode, getRoom } from '../net/lobby';
import { defaultSettings } from '../net/raceSetup';
import { setDiscordProfile } from '../net/leaderboard';
import { saveName } from './playerName';
import { seedOfTheDay } from './seeds';
import { MenuFrame } from './MenuShell';
import { friendlyError } from './errors';

interface Props {
  playerId: string;
  /** Why we're back here (left the room, or something failed) */
  notice?: string;
  onEnterRoom: (code: string, name: string) => void;
}

/**
 * The start inside Discord, in the menus' look: the player is signed in by Discord, and everyone in
 * the voice channel shares one room (its code comes from the Activity instance), so there's nothing
 * to choose: we go straight in, making the room if we're the first.
 */
export function DiscordLobby({ playerId, notice, onEnterRoom }: Props) {
  const [status, setStatus] = useState('Connecting to Discord…');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(!!notice);

  const go = useCallback(async () => {
    setError(null);
    setLeft(false);
    try {
      setStatus('Connecting to Discord…');
      const d = await connectDiscord();
      setDiscordProfile(d.userId);
      saveName(d.name);
      const code = roomCodeFor(d.instanceId);
      setStatus('Joining the voice channel’s race…');
      const room = await getRoom(code);
      if (!room || !Object.keys(room.members ?? {}).length) {
        await createRoomWithCode(code, 'Voice channel race', defaultSettings(seedOfTheDay()), d.name, playerId);
      }
      setDiscordActivity({ details: 'In the pits', state: 'Waiting for the start' });
      onEnterRoom(code, d.name);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [playerId, onEnterRoom]);

  useEffect(() => {
    if (!notice) void go();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MenuFrame id="discord-lobby" discord>
      <div className="menu-welcome">
        <div className="name-setup discord-connect">
          <p className="kicker">Diff Race · Discord Activity</p>
          {left ? (
            <>
              <h2>Back in the pits</h2>
              <p className="muted">{notice}</p>
              <button type="button" id="rejoin" className="primary" onClick={() => void go()}>▶ Back to the race</button>
            </>
          ) : error ? (
            <>
              <h2>Couldn't get in</h2>
              <p className="error" role="alert">{error}</p>
              <button type="button" id="retry" className="primary" onClick={() => void go()}>Try again</button>
            </>
          ) : (
            <h2 id="discord-status" role="status"><span className="spinner" aria-hidden="true" />{status}</h2>
          )}
        </div>
      </div>
    </MenuFrame>
  );
}
