import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Game } from '../game/game';
import { formatDelta, formatTime } from '../game/race/clock';
import type { Banner, FeedLine, HudState, RaceResults, StandingRow } from '../game/hudStore';
import { useSettings } from './useSettings';

interface Props {
  game: Game;
  onRestart: () => void;
  onExit: () => void;
  /** A room race: no restarting it, back to the room after */
  inRoom?: boolean;
}

const DEBUG = new URLSearchParams(location.search).has('debug');

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/**
 * Everything drawn over the race. State from the game's HudStore; numbers that change every
 * frame (speed, gear, the clock, the gaps) are written by the game straight into the nodes it's given.
 */
export function Hud({ game, onRestart, onExit, inRoom = false }: Props) {
  const hud = useSyncExternalStore(game.hud.subscribe, game.hud.get);
  const prefs = useSettings();
  const speed = useRef<HTMLSpanElement>(null);
  const gear = useRef<HTMLSpanElement>(null);
  const fps = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLDivElement>(null);
  const gapAhead = useRef<HTMLSpanElement>(null);
  const gapBehind = useRef<HTMLSpanElement>(null);
  const lock = useRef<HTMLDivElement>(null);
  const aim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    game.bindReadouts({ speed: speed.current, gear: gear.current, fps: fps.current, time: time.current, gapAhead: gapAhead.current, gapBehind: gapBehind.current, lock: lock.current, aim: aim.current });
    return () => game.bindReadouts({});
  }, [game]);
  const minimapHost = useCallback((el: HTMLDivElement | null) => game.mountMinimap(el), [game]);
  const racing = hud.cars > 1;
  const showResults = hud.results !== null || hud.over;

  return (
    <div id="hud" style={{ '--hud-scale': prefs.hudScale } as React.CSSProperties}>
      {hud.phase !== 'ready' && (
        <div id="connecting-overlay" className={`overlay ${hud.phase === 'failed' ? 'failed' : ''}`} role="status">
          <div className="panel-box"><p>{hud.status}</p></div>
        </div>
      )}
      <div id="hud-race">
        <div id="hud-track">{hud.trackName}</div>
        {racing && <div id="hud-position"><b>{hud.place}</b><small>/{hud.cars}</small></div>}
        {hud.laps > 0 && <div id="hud-lap">LAP <b>{Math.min(hud.lap, hud.laps)}</b>/{hud.laps}</div>}
        <div id="hud-time" ref={time}>0.000</div>
        {racing && (
          <div id="hud-diff">
            <span className="ahead" ref={gapAhead} />
            <span className="behind" ref={gapBehind} />
          </div>
        )}
        {hud.lapDelta !== null && (
          <div id="hud-lap-delta" className={hud.lapDelta <= 0 ? 'faster' : 'slower'}>{formatDelta(hud.lapDelta)}</div>
        )}
        <LapList laps={hud.lapTimes} best={hud.bestLap} />
      </div>
      <div id="minimap-host" ref={minimapHost} />
      <Feed lines={hud.feed} />
      {(prefs.showFps || DEBUG) && <div id="hud-fps" ref={fps} className="hud-chip" />}
      <div id="hud-combat">
        <ArmourBar armour={hud.armour} max={hud.armourMax} />
        <Weapons hud={hud} />
      </div>
      <div id="hud-dash">
        <div id="hud-speed"><span ref={speed}>0</span><small>{prefs.units === 'mph' ? 'mph' : 'km/h'}</small></div>
        <div id="hud-gear"><span ref={gear}>1</span></div>
        <NitroBar value={hud.nitro} max={hud.nitroTank} active={hud.nitroActive} />
      </div>
      {/* Moved by the game to where the turret is pointing */}
      <div id="aim-point" ref={aim}>
        <Crosshair hits={hud.hits} heat={hud.heat} locked={hud.gunLocked} empty={hud.ammo <= 0} hidden={showResults} />
      </div>
      {/* Moved by the game over the car auto aim is locked onto */}
      <div id="lock-on" ref={lock} hidden aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48"><path d="M2 14V2h12M34 2h12v12M46 34v12H34M14 46H2V34" /></svg>
      </div>
      <DamageArc game={game} hurt={hud.hurt} />
      {hud.count !== null && <div id="countdown" key={hud.count} className={hud.count === 0 ? 'go' : ''}>{hud.count === 0 ? 'GO!' : hud.count}</div>}
      {hud.wrongWay && !showResults && <div id="wrong-way" role="alert">WRONG WAY</div>}
      {hud.banner && <BannerView banner={hud.banner} />}
      {hud.replay && (
        <div id="replay" role="status">
          <b>● REPLAY</b>
          <span>{hud.wreckedBy ? `Diffed by ${hud.wreckedBy}` : 'Wrecked'} · accelerate or fire to skip</span>
        </div>
      )}
      {hud.toast && <div id="toast" role="status">{hud.toast}</div>}
      {showResults && <Results results={hud.results} rows={hud.standings} over={hud.over} racing={racing} inRoom={inRoom} onRestart={onRestart} onExit={onExit} />}
    </div>
  );
}

const LapList = memo(function LapList({ laps, best }: { laps: number[]; best: number | null }) {
  if (!laps.length) return null;
  const fastest = Math.min(...laps, best ?? Infinity);
  return (
    <ol id="hud-laps">
      {laps.map((t, i) => <li key={i} className={t === fastest ? 'best' : ''}>{formatTime(t)}</li>)}
    </ol>
  );
});

const NitroBar = memo(function NitroBar({ value, max, active }: { value: number; max: number; active: boolean }) {
  return (
    <div id="hud-nitro" className={active ? 'active' : ''} aria-label="Nitro">
      <div className="fill" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      <span>NITRO</span>
    </div>
  );
});

const ArmourBar = memo(function ArmourBar({ armour, max }: { armour: number; max: number }) {
  const k = Math.max(0, Math.min(1, armour / max));
  return (
    <div id="hud-armour" className={k < 0.25 ? 'critical' : k < 0.5 ? 'low' : ''} aria-label={`Armour ${armour}`}>
      <div className="fill" style={{ width: `${k * 100}%` }} />
      <span>ARMOUR {armour}</span>
    </div>
  );
});

const Weapons = memo(function Weapons({ hud }: { hud: HudState }) {
  return (
    <div id="hud-weapons" className={hud.weaponsHot ? '' : 'cold'}>
      <div className={`slot gun ${hud.armed > 0 ? 'armed' : ''} ${hud.gunLocked ? 'locked' : ''} ${hud.ammo > 0 ? '' : 'empty'}`}>
        <span className="icon">⁞⁞</span>{hud.ammo > 0 && <b>{hud.ammo}</b>}
        <div className="heat"><div style={{ width: `${hud.heat * 100}%` }} /></div>
        <small>{hud.ammo <= 0 ? 'NO GUN · FIND A PAD' : hud.gunLocked ? 'OVERHEAT' : hud.armed > 0 ? `ARMED ${hud.armed}s` : 'ROUNDS'}</small>
      </div>
      <div className={`slot missiles ${hud.missiles ? '' : 'empty'}`}>
        <span className="icon">➶</span><b>{hud.missiles}</b><small>MISSILES</small>
      </div>
      <div className={`slot defence ${hud.defence ? '' : 'empty'}`}>
        <span className="icon">⛨</span><small>{hud.defence ?? 'NO DEFENCE'}</small>
      </div>
    </div>
  );
});

/** The crosshair, flashing on each hit; its ring shows the guns' heat */
const Crosshair = memo(function Crosshair({ hits, heat, locked, empty, hidden }: { hits: number; heat: number; locked: boolean; empty: boolean; hidden: boolean }) {
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (!hits) return;
    setFlash(hits);
    const t = setTimeout(() => setFlash(0), 120);
    return () => clearTimeout(t);
  }, [hits]);
  if (hidden) return null;
  return (
    <div id="crosshair" className={`${flash ? 'hit' : ''} ${locked ? 'locked' : ''} ${empty ? 'empty' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="64" height="64">
        <circle cx="32" cy="32" r="20" className="ring" />
        <circle cx="32" cy="32" r="20" className="heat" strokeDasharray={`${heat * 125.6} 125.6`} transform="rotate(-90 32 32)" />
        <path d="M32 18v8M32 38v8M18 32h8M38 32h8" className="cross" />
        {flash ? <path d="M22 22l6 6M42 22l-6 6M22 42l6-6M42 42l-6-6" className="marker" /> : null}
      </svg>
    </div>
  );
});

/** A red arc round the screen's middle pointing where the last hit came from */
function DamageArc({ game, hurt }: { game: Game; hurt: number }) {
  const [shown, setShown] = useState<{ angle: number; key: number } | null>(null);
  useEffect(() => {
    if (!hurt) return;
    const angle = game.hurtAngle();
    if (angle === null) return;
    setShown({ angle, key: hurt });
    const t = setTimeout(() => setShown(null), 700);
    return () => clearTimeout(t);
  }, [game, hurt]);
  if (!shown) return <div id="damage-flash" key={hurt} className={hurt ? 'on' : ''} />;
  return (
    <>
      <div id="damage-flash" key={hurt} className="on" />
      <div id="damage-arc" style={{ transform: `translate(-50%, -50%) rotate(${shown.angle}rad)` }} />
    </>
  );
}

const Feed = memo(function Feed({ lines }: { lines: FeedLine[] }) {
  return (
    <ol id="killfeed" aria-live="polite">
      {lines.map((l) => <li key={l.id} className={l.kind}>{l.text}</li>)}
    </ol>
  );
});

function BannerView({ banner }: { banner: Banner }) {
  return (
    <div id="diffed" key={banner.id} className={banner.kind} role="status">
      <b>{banner.title}</b>
      <span>{banner.sub}</span>
    </div>
  );
}

function Results({ results, rows, over, racing, inRoom, onRestart, onExit }: {
  results: RaceResults | null; rows: StandingRow[]; over: boolean; racing: boolean; inRoom: boolean; onRestart: () => void; onExit: () => void;
}) {
  const me = rows.find((r) => r.self);
  const place = me ? rows.indexOf(me) + 1 : 0;
  return (
    <div id="results" className="overlay" role="dialog" aria-modal="true" aria-label="Results">
      <div className="panel-box results-box">
        <h2>{over ? 'Results' : 'Finished · the rest are still racing'}</h2>
        {racing && me && <div className="results-place">{ordinal(place)}</div>}
        {results && <div className="results-total">{formatTime(results.total)}{results.newTotal && <span className="badge">BEST</span>}</div>}
        {racing ? (
          <table className="standings">
            <thead><tr><th>#</th><th>Driver</th><th>Time</th><th>Diff</th><th>Best lap</th><th>Kills</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={r.self ? 'self' : ''}>
                  <td>{i + 1}</td>
                  <td><i style={{ background: r.color }} />{r.name}</td>
                  <td>{r.time !== null ? formatTime(r.time) : r.out ? 'OUT' : r.dnf ? 'DNF' : `lap ${r.laps + 1}`}</td>
                  <td>{r.diff !== null && r.diff > 0 ? formatDelta(r.diff) : ''}</td>
                  <td>{r.bestLap !== null ? formatTime(r.bestLap) : ''}</td>
                  <td>{r.kills || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : results && (
          <ol className="results-laps">
            {results.lapTimes.map((t, i) => (
              <li key={i} className={t === results.bestLap ? 'best' : ''}><span>Lap {i + 1}</span><span>{formatTime(t)}</span></li>
            ))}
          </ol>
        )}
        {results?.newLap && <p className="good">New best lap on this track</p>}
        {inRoom ? (
          <button type="button" id="back-to-room" className="primary" autoFocus onClick={onExit}>Back to the room</button>
        ) : (
          <>
            <button type="button" className="primary" autoFocus onClick={onRestart}>Race again</button>
            <button type="button" onClick={onExit}>Leave</button>
          </>
        )}
      </div>
    </div>
  );
}
