import { useState, useSyncExternalStore } from 'react';
import type { Game } from '../game/game';
import { ACTIONS, keyLabel } from '../game/settings';
import { formatTime } from '../game/race/clock';
import { TOUCH } from '../game/device';
import { ConfirmButton } from './ConfirmButton';
import { MenuPanel, MenuPlay, MenuRail, type MenuTab } from './MenuShell';
import { useSettings } from './useSettings';

interface Props {
  game: Game;
  /** A room race: it goes on behind the menu, and there's no restarting it */
  inRoom: boolean;
  onResume(): void;
  onRestart(): void;
  onSettings(): void;
  onExit(): void;
}

type View = 'race' | 'controls';

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * The pause menu: the lobby's menu over the race, as Arena FPS's is. Resume at the top of the rail,
 * this race (where everyone is) and the controls as views, Restart and Settings under them, and
 * leaving at the foot (asked first). Clicking the dimmed race around it resumes.
 */
export function PauseMenu({ game, inRoom, onResume, onRestart, onSettings, onExit }: Props) {
  const hud = useSyncExternalStore(game.hud.subscribe, game.hud.get);
  const [view, setView] = useState<View>('race');
  const tabs: MenuTab[] = [
    { id: 'race', label: 'This race', short: 'Race', sub: hud.cars > 1 ? `${ordinal(hud.place)} of ${hud.cars}` : 'Laps and times', icon: '⚑' },
    { id: 'controls', label: 'Controls', short: 'Keys', sub: 'What does what', icon: '⌨' },
  ];
  return (
    <div id="pause-overlay" className="overlay pause-menu" role="dialog" aria-modal="true" aria-label="Paused"
      onClick={(e) => { if (e.target === e.currentTarget) onResume(); }}>
      <div className="pause-frame" onClick={(e) => { if (e.target === e.currentTarget) onResume(); }}>
        <header className="menu-top">
          <div className="pause-heading">
            <span className="pause-kicker">{inRoom ? 'Menu · the race goes on' : 'Paused'}</span>
            <h2>{hud.trackName}</h2>
          </div>
          {hud.laps > 0 && <p className="pause-room">Lap <strong>{Math.min(hud.lap, hud.laps)}/{hud.laps}</strong></p>}
        </header>
        <div className="menu-body">
          <MenuRail
            label="Pause menu"
            tabsLabel="Pause"
            idPrefix="pause-"
            hero={<MenuPlay label="▶ Resume" sub="Esc to get back in" onClick={onResume} />}
            tabs={tabs}
            active={view}
            onSelect={(id) => setView(id as View)}
            extra={(
              <div className="pause-actions">
                {!inRoom && (
                  <ConfirmButton className="menu-action" yesClassName="primary" question="Restart from the grid?" yes="Restart" no="Keep racing" onConfirm={onRestart}>
                    <span className="icon" aria-hidden="true">↺</span>Restart
                  </ConfirmButton>
                )}
                <button type="button" className="menu-action" onClick={onSettings}><span className="icon" aria-hidden="true">⚙</span>Settings</button>
              </div>
            )}
          />
          <footer className="menu-foot pause-foot">
            <ConfirmButton className="danger menu-leave" question={inRoom ? 'Leave the race?' : 'Leave the race?'} yes="Leave" no="Stay" onConfirm={onExit}>
              <span className="icon" aria-hidden="true">⏏</span>{inRoom ? 'Leave the race' : 'Leave'}
            </ConfirmButton>
            {inRoom && <p className="muted leave-note">You'll go back to the room.</p>}
          </footer>
          {view === 'race' && (
            <MenuPanel id="race" idPrefix="pause-" title="This race">
              <RaceView game={game} />
            </MenuPanel>
          )}
          {view === 'controls' && (
            <MenuPanel id="controls" idPrefix="pause-" title="Controls">
              <ControlsView />
            </MenuPanel>
          )}
        </div>
      </div>
    </div>
  );
}

function RaceView({ game }: { game: Game }) {
  const hud = useSyncExternalStore(game.hud.subscribe, game.hud.get);
  return (
    <div className="pause-match">
      <div className="pause-score">
        {hud.cars > 1 && <span className="clock">{ordinal(hud.place)}<small className="muted">/{hud.cars}</small></span>}
        {hud.laps > 0 && <span>Lap <b>{Math.min(hud.lap, hud.laps)}</b> of {hud.laps}</span>}
        {hud.bestLap !== null && <span className="muted">Best here {formatTime(hud.bestLap)}</span>}
      </div>
      {hud.standings.length > 1 ? (
        <table className="standings">
          <thead><tr><th>#</th><th>Driver</th><th>Lap</th><th>Kills</th></tr></thead>
          <tbody>
            {hud.standings.map((r, i) => (
              <tr key={r.id} className={r.self ? 'self' : ''}>
                <td>{i + 1}</td>
                <td><i style={{ background: r.color }} />{r.name}</td>
                <td>{r.time !== null ? formatTime(r.time) : r.out ? 'OUT' : hud.laps ? `${Math.min(r.laps + 1, hud.laps)}/${hud.laps}` : '—'}</td>
                <td>{r.kills || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : hud.lapTimes.length > 0 ? (
        <ol className="results-laps">{hud.lapTimes.map((t, i) => <li key={i}><span>Lap {i + 1}</span><span>{formatTime(t)}</span></li>)}</ol>
      ) : (
        <p className="muted">No laps yet. Off you go.</p>
      )}
    </div>
  );
}

function ControlsView() {
  const s = useSettings();
  if (TOUCH) {
    return (
      <div className="pause-touch">
        <p className="touch-help">
          Drag on the left half to steer, on the right half to aim the turret. FIRE holds the guns down, MSL launches a missile,
          DROP lets the rear defence go; SLIDE is the handbrake and NOS the nitro. The car accelerates by itself (a setting).
        </p>
      </div>
    );
  }
  return (
    <div className="panel-controls">
      <ul className="keys">
        {ACTIONS.map(({ action, label }) => <li key={action}><kbd>{keyLabel(s.bindings[action])}</kbd>{label}</li>)}
        <li><kbd>Mouse</kbd>Aim the turret (click to capture it)</li>
        <li><kbd>Left mouse</kbd>Machine gun</li>
        <li><kbd>Right mouse</kbd>Missile</li>
        <li><kbd>Esc</kbd>This menu</li>
      </ul>
      <p className="muted hint">Keys can be changed in Settings → Controls. A gamepad works too: triggers drive, the right stick aims.</p>
    </div>
  );
}
