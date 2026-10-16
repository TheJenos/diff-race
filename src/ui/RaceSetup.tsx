import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { GENERATOR_VERSION, SEED_MAX, type ThemeId, type TrackLength, type TrackSpec } from '../game/track/spec';
import { THEMES } from '../game/track/themes';
import { bestFor } from '../game/records';
import { formatTime } from '../game/race/clock';
import { BOT_SKILLS, type BotSkill } from '../game/bot/skills';
import type { RaceMode } from '../types';
import { TOUCH } from '../game/device';
import { StepBar } from './StepBar';
import { TrackPreview } from './TrackPreview';
import { TrackThumb, useTrack } from './TrackThumb';
import { randomSeed } from './seeds';

/*
 * Setting up a race, one decision at a time, as Arena FPS sets up a match: the mode, then the
 * track, then the race itself (laps, bots, crash damage; a room's name) with everything chosen on
 * one card and the button that starts it. Any step already reached can be gone back to (the step
 * bar, Back, or Esc); what was chosen stays chosen. The track picker and the race fields are also
 * the room's settings (RoomView.tsx).
 */

export interface RaceChoice {
  mode: RaceMode;
  seed: string;
  length: TrackLength;
  theme: ThemeId;
  laps: number;
  bots: number;
  skill: BotSkill | 'mixed';
  crash: number;
}

export const MODES: Record<RaceMode, { label: string; short: string; desc: string; facts: string[] }> = {
  race: { label: 'Death Race', short: 'DR', desc: 'Guns, pads and rams against the field', facts: ['First across the line wins', 'Wrecked cars respawn', 'Weapons hot 3 s after GO'] },
  elimination: { label: 'Elimination', short: 'EL', desc: 'Wrecked is out: finish first, or be the last car running', facts: ['No respawns', 'The last car running wins', 'Weapons hot 3 s after GO'] },
  timetrial: { label: 'Time Trial', short: 'TT', desc: 'Just you and the clock', facts: ['No weapons, no bots', 'Best laps saved per track'] },
  testdrive: { label: 'Test Drive', short: 'TD', desc: 'No clock, no laps: learn the car and the track', facts: ['Endless', 'No weapons, no bots'] },
};

const LENGTHS: { value: TrackLength; label: string; hint: string }[] = [
  { value: 's', label: 'Short', hint: '1.2–1.5 km' },
  { value: 'm', label: 'Medium', hint: '1.8–2.2 km' },
  { value: 'l', label: 'Long', hint: '2.6–3.2 km' },
];
const CRASH: { value: number; label: string }[] = [
  { value: 0, label: 'Bumper cars' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'Carnage' },
];

export const specOf = (c: Pick<RaceChoice, 'seed' | 'length' | 'theme'>): TrackSpec => ({ seed: c.seed.trim() || 'diff', length: c.length, theme: c.theme, gen: GENERATOR_VERSION });
const hasBots = (mode: RaceMode) => mode === 'race' || mode === 'elimination';

/** A row of choices, one of them selected (radios, named by their labels) */
export function Choice<T extends string | number | boolean>({ label, value, options, onChange, disabled }: {
  label: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange(v: T): void; disabled?: boolean;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} disabled={disabled}
          className={value === o.value ? 'choice selected' : 'choice'} onClick={() => onChange(o.value)}>
          {o.label}{o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

/** A labelled setting row: its name on the left, the control on the right */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setting">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** The mode as cards (radios named by the modes) */
function ModeCards({ modes, value, onChange }: { modes: readonly RaceMode[]; value: RaceMode; onChange(m: RaceMode): void }) {
  const m = MODES[value];
  return (
    <div className="mode-grid">
      <div className="mode-detail" aria-live="polite" aria-label="Selected mode">
        <div className="mode-detail-head">
          <span className={`mode-badge ${value}`}>{m.short}</span>
          <div className="mode-detail-title"><strong>{m.label}</strong><small className="muted">{m.desc}</small></div>
        </div>
        <ul className="mode-rules">{m.facts.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      <div className="mode-cards" role="radiogroup" aria-label="Mode">
        {modes.map((id) => {
          const mode = MODES[id];
          const selected = id === value;
          return (
            <button key={id} type="button" role="radio" aria-checked={selected} aria-label={mode.label}
              className={selected ? 'mode-card selected' : 'mode-card'} onClick={() => onChange(id)}>
              <span className="mode-card-top">
                <span className={`mode-badge ${id}`}>{mode.short}</span>
                {selected && <span className="mode-card-check" aria-hidden="true">✓</span>}
              </span>
              <span className="mode-card-name">{mode.label}</span>
              <span className="mode-card-desc">{mode.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The track: a big preview turning on its stage, and its seed, length and theme beside it */
export function TrackPicker({ value, onChange, disabled }: {
  value: Pick<RaceChoice, 'seed' | 'length' | 'theme'>;
  onChange(patch: Partial<RaceChoice>): void;
  disabled?: boolean;
}) {
  // Typing a seed rebuilds the preview a moment after the last key.
  const [typed, setTyped] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setTyped(value), 180);
    return () => clearTimeout(t);
  }, [value.seed, value.length, value.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const track = useTrack(specOf(typed));
  const best = track ? bestFor(track.spec) : null;
  return (
    <div className="map-picker large">
      <div className="map-stage">
        {track ? <TrackPreview track={track} fill /> : <div className="map-preview empty fill"><span className="spinner" aria-hidden="true" />Building the track…</div>}
        <span className="map-stage-hint" aria-hidden="true">{TOUCH ? 'Drag to turn' : 'Drag to turn · wheel to zoom'}</span>
      </div>
      <div className="map-controls">
        <strong aria-live="polite">{track ? track.name : 'Building…'}</strong>
        {track && (
          <p id="track-info" className="track-facts">
            <span>{(track.lapLength / 1000).toFixed(2)} km</span>
            <span>{track.pads.length} pads</span>
            <span>{track.ramps.length} {track.ramps.length === 1 ? 'ramp' : 'ramps'}</span>
            {best?.lap != null && <span className="good">Best lap {formatTime(best.lap)}</span>}
          </p>
        )}
        <div className="row">
          <input id="seed-input" className="seed-input" value={value.seed} maxLength={SEED_MAX} spellCheck={false} disabled={disabled}
            onChange={(e) => onChange({ seed: e.target.value.slice(0, SEED_MAX) })} aria-label="Track seed" placeholder="Seed" />
          <button type="button" title="New random track" aria-label="New random track" disabled={disabled} onClick={() => onChange({ seed: randomSeed() })}>🎲</button>
        </div>
        <Choice label="Track length" value={value.length} options={LENGTHS} onChange={(length) => onChange({ length })} disabled={disabled} />
        <Choice label="Theme" value={value.theme} disabled={disabled}
          options={(Object.keys(THEMES) as ThemeId[]).map((id) => ({ value: id, label: THEMES[id].name }))} onChange={(theme) => onChange({ theme })} />
        <small className="muted">Same seed, same track: share one to race it again.</small>
      </div>
    </div>
  );
}

/** Laps, bots and crash damage, as the mode allows */
export function RaceFields({ value, onChange, botOptions = [3, 5, 7, 11], disabled }: {
  value: RaceChoice; onChange(patch: Partial<RaceChoice>): void; botOptions?: number[]; disabled?: boolean;
}) {
  return (
    <div className="race-fields">
      {value.mode !== 'testdrive' && (
        <SettingRow label="Laps">
          <Choice label="Laps" value={value.laps} disabled={disabled}
            options={[1, 3, 5].map((n) => ({ value: n, label: `${n} ${n === 1 ? 'lap' : 'laps'}` }))} onChange={(laps) => onChange({ laps })} />
        </SettingRow>
      )}
      {hasBots(value.mode) && (
        <>
          <SettingRow label="Bots">
            <Choice label="Bots" value={value.bots} disabled={disabled}
              options={botOptions.map((n) => ({ value: n, label: n ? `${n} bots` : 'No bots' }))} onChange={(bots) => onChange({ bots })} />
          </SettingRow>
          <SettingRow label="Bot skill">
            <Choice label="Bot skill" value={value.skill} disabled={disabled}
              options={[{ value: 'mixed' as const, label: 'Mixed' }, ...BOT_SKILLS.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]}
              onChange={(skill) => onChange({ skill })} />
          </SettingRow>
          <SettingRow label="Crash damage">
            <Choice label="Crash damage" value={value.crash} options={CRASH} onChange={(crash) => onChange({ crash })} disabled={disabled} />
          </SettingRow>
        </>
      )}
    </div>
  );
}

interface Props {
  value: RaceChoice;
  onChange(v: RaceChoice): void;
  /** The modes on offer (a room races Death Race or Elimination) */
  modes: readonly RaceMode[];
  /** The last step's fields above the race's (e.g. the room's name) */
  roomFields?: ReactNode;
  botOptions?: number[];
  launchId: string;
  launchLabel: string;
  busy: boolean;
  disabled: boolean;
  onLaunch(): void;
  /** Under the button: why it didn't work, or a word about what happens */
  error?: string | null;
  note?: ReactNode;
  /** Esc on the first step */
  onExit(): void;
}

export function RaceWizard({ value, onChange, modes, roomFields, botOptions, launchId, launchLabel, busy, disabled, onLaunch, error, note, onExit }: Props) {
  const steps = [{ id: 'mode', label: 'Mode' }, { id: 'track', label: 'Track' }, { id: 'race', label: 'Race' }];
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const patch = (p: Partial<RaceChoice>) => onChange({ ...value, ...p });
  const go = (n: number) => {
    setStep(n);
    setReached((r) => Math.max(r, n));
  };
  // Each step starts at its top, with focus on it (for keyboard and screen readers).
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    body.current?.focus({ preventScroll: true });
  }, [step]);
  // Esc goes back a step (Settings handles its own first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || document.querySelector('#settings')) return;
      e.stopPropagation();
      if (step > 0) setStep(step - 1);
      else onExit();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [step, onExit]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onLaunch();
  };
  const mode = MODES[value.mode];
  const track = useTrack(specOf(value));

  return (
    <div className="wizard">
      <StepBar steps={steps} step={step} reached={reached} onStep={setStep} />
      <div ref={body} className="wizard-body" tabIndex={-1} aria-label={`Step ${step + 1} of 3: ${steps[step]!.label}`}>
        {step === 0 && <ModeCards modes={modes} value={value.mode} onChange={(m) => patch({ mode: m })} />}
        {step === 1 && <TrackPicker value={value} onChange={patch} />}
        {step === 2 && (
          <form id="launch-form" className="launch" onSubmit={submit}>
            <div className="launch-summary">
              <button type="button" className="launch-pick" onClick={() => setStep(0)} aria-label={`Mode: ${mode.label}. Change`}>
                <span className={`mode-badge ${value.mode}`}>{mode.short}</span>
                <span className="text"><strong>{mode.label}</strong><small className="muted">{mode.desc}</small></span>
                <span className="change" aria-hidden="true">Change</span>
              </button>
              <button type="button" className="launch-pick" onClick={() => setStep(1)} aria-label={`Track: ${track?.name ?? value.seed}. Change`}>
                <TrackThumb spec={specOf(value)} size={60} />
                <span className="text">
                  <strong>{track?.name ?? 'Building…'}</strong>
                  <small className="muted">{LENGTHS.find((l) => l.value === value.length)!.label} · {THEMES[value.theme].name} · seed {value.seed}</small>
                </span>
                <span className="change" aria-hidden="true">Change</span>
              </button>
            </div>
            {roomFields}
            <RaceFields value={value} onChange={patch} botOptions={botOptions} />
          </form>
        )}
      </div>
      <footer className="wizard-foot">
        {step > 0 ? <button type="button" onClick={() => setStep(step - 1)}>◂ Back</button> : <span />}
        <div className="wizard-foot-main">
          {step === 2 && error && <p className="error" role="alert">{error}</p>}
          {step === 2 && note && !error && <p className="muted note">{note}</p>}
          {/* Separate elements (keys): turning the clicked Next into the submit button would submit on that same click. */}
          {step < 2 ? (
            <button key="next" type="button" className="primary next" onClick={() => go(step + 1)}>Next: {steps[step + 1]!.label} ▸</button>
          ) : (
            <button key="launch" id={launchId} type="submit" form="launch-form" className="primary create-button" disabled={disabled}>
              {busy ? <><span className="spinner" aria-hidden="true" />Starting…</> : launchLabel}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
