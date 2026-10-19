import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ACTIONS, FOV_MAX, FOV_MIN, HUD_SCALE_MAX, HUD_SCALE_MIN, keyLabel, MOTION_OPTIONS, QUALITIES, RESERVED_KEYS,
  settings, type Action, type MotionPref, type Quality,
} from '../game/settings';
import { useDialogFocus } from './useDialogFocus';
import { MenuTabs, type MenuTab } from './MenuShell';
import { ConfirmButton } from './ConfirmButton';
import { isValidName } from './playerName';
import { useSettings } from './useSettings';

interface Props {
  onClose: () => void;
  /** In the lobby: your name, to change here */
  profile?: { name: string; onRename(name: string): void };
}

type Tab = 'controls' | 'video' | 'camera' | 'audio';
const TABS: MenuTab[] = [
  { id: 'controls', label: 'Controls', sub: 'Keys, aiming, gamepad, touch', icon: '⌨' },
  { id: 'video', label: 'Video', sub: 'Quality, HUD, models', icon: '▣' },
  { id: 'camera', label: 'Camera', sub: 'View, shake, motion', icon: '◉' },
  { id: 'audio', label: 'Sound', sub: 'Effects and music', icon: '♪' },
];

/**
 * Every setting, in the menus' look (as Arena FPS's): a big glass dialog, its tabs down the side,
 * the chosen one beside them, Done along the foot. Opened from the lobby (with your name at the
 * top) and from the pause menu. Changes apply at once.
 */
export function SettingsPanel({ onClose, profile }: Props) {
  const s = useSettings();
  const [tab, setTab] = useState<Tab>('controls');
  const root = useRef<HTMLDivElement>(null);
  useDialogFocus(root);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div id="settings" className="overlay modal" role="dialog" aria-modal="true" aria-label="Settings" ref={root}>
      <div className="menu-dialog">
        <header className="menu-dialog-head">
          <h3>Settings</h3>
          <span className="muted esc-hint">Esc to close</span>
        </header>
        {profile && <ProfileRow profile={profile} />}
        <div className="menu-dialog-main">
          <nav className="menu-dialog-rail" aria-label="Settings sections">
            <MenuTabs tabs={TABS} active={tab} onSelect={(id) => setTab(id as Tab)} label="Settings" idPrefix="settings-" />
          </nav>
          <div className="menu-dialog-body" role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
            {tab === 'controls' && (
              <>
                <section>
                  <h4>Keyboard</h4>
                  <div className="bindings">
                    {ACTIONS.map(({ action, label }) => <KeybindRow key={action} action={action} label={label} code={s.bindings[action]} />)}
                  </div>
                  <p className="muted hint">Arrow keys always drive too. Left mouse fires, right mouse launches a missile. The turret aims itself: it locks onto the car in front (look back to shoot behind).</p>
                </section>
                <section>
                  <h4>Gamepad</h4>
                  <Slider label="Stick deadzone" min={0.02} max={0.4} step={0.01} value={s.deadzone}
                    format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => settings.update({ deadzone: v })} />
                  <Toggle label="Rumble" value={s.rumble} onChange={(v) => settings.update({ rumble: v })} />
                </section>
                <section>
                  <h4>Touch</h4>
                  <Toggle label="Accelerate automatically" value={s.autoAccelerate} onChange={(v) => settings.update({ autoAccelerate: v })} />
                </section>
              </>
            )}
            {tab === 'video' && (
              <>
                <section>
                  <h4>Quality</h4>
                  <Choices label="Quality" value={s.quality} options={QUALITIES.map((q) => ({ value: q.value as Quality, label: q.label, title: q.hint }))}
                    onChange={(quality) => settings.update({ quality })} />
                  <p className="muted hint">{QUALITIES.find((q) => q.value === s.quality)?.hint}</p>
                  <Toggle label="Kenney models for cars and scenery (from the next race)" value={s.kitModels} onChange={(v) => settings.update({ kitModels: v })} />
                  <Toggle label="High-visibility car outlines" value={s.outlines} onChange={(v) => settings.update({ outlines: v })} />
                </section>
                <section>
                  <h4>HUD</h4>
                  <Slider label="HUD size" min={HUD_SCALE_MIN} max={HUD_SCALE_MAX} step={0.05} value={s.hudScale}
                    format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => settings.update({ hudScale: v })} />
                  <div className="setting">
                    <span>Speed in</span>
                    <Choices label="Speed units" value={s.units} options={[{ value: 'kmh' as const, label: 'km/h' }, { value: 'mph' as const, label: 'mph' }]}
                      onChange={(units) => settings.update({ units })} />
                  </div>
                  <Toggle label="Show frame rate" value={s.showFps} onChange={(v) => settings.update({ showFps: v })} />
                </section>
              </>
            )}
            {tab === 'camera' && (
              <>
                <section>
                  <h4>View</h4>
                  <Slider label="Field of view" min={FOV_MIN} max={FOV_MAX} step={1} value={s.fov} format={(v) => `${v}°`}
                    onChange={(v) => settings.update({ fov: v })} />
                  <Toggle label="Screen shake" value={s.screenShake} onChange={(v) => settings.update({ screenShake: v })} />
                  <Toggle label="Replay my wrecks" value={s.replays} onChange={(v) => settings.update({ replays: v })} />
                </section>
                <section>
                  <h4>Reduce motion</h4>
                  <Choices label="Reduce motion" value={s.reduceMotion} options={MOTION_OPTIONS.map((o) => ({ value: o.value as MotionPref, label: o.label, title: o.hint }))}
                    onChange={(reduceMotion) => settings.update({ reduceMotion })} />
                  <p className="muted hint">{MOTION_OPTIONS.find((o) => o.value === s.reduceMotion)?.hint}</p>
                </section>
              </>
            )}
            {tab === 'audio' && (
              <section>
                <h4>Volume</h4>
                <Slider label="Sound effects" min={0} max={1} step={0.05} value={s.sfxVolume} format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => settings.update({ sfxVolume: v })} />
                <Slider label="Music" min={0} max={1} step={0.05} value={s.musicVolume} format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => settings.update({ musicVolume: v })} />
              </section>
            )}
          </div>
        </div>
        <footer className="menu-dialog-foot">
          <ConfirmButton className="danger" question="Put every setting back?" yes="Reset" no="Keep" onConfirm={() => settings.reset()}>Reset everything</ConfirmButton>
          <button type="button" className="primary push" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}

/** Your name, changeable (lobby only) */
function ProfileRow({ profile }: { profile: NonNullable<Props['profile']> }) {
  const [draft, setDraft] = useState(profile.name);
  const [saved, setSaved] = useState(false);
  const valid = isValidName(draft);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    profile.onRename(draft.trim().replace(/\s+/g, ' '));
    setSaved(true);
  };
  return (
    <form className="profile-row" onSubmit={save}>
      <span className="muted">Your name</span>
      <input value={draft} maxLength={16} aria-label="Your name" aria-invalid={!valid} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} />
      <button disabled={!valid || draft.trim() === profile.name}>{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}

/** A row of choices, one selected */
function Choices<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange(v: T): void;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title}
          className={value === o.value ? 'choice selected' : 'choice'} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function KeybindRow({ action, label, code }: { action: Action; label: string; code: string }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape' && !RESERVED_KEYS.has(e.code)) settings.bind(action, e.code);
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, action]);
  return (
    <div className="binding">
      <span>{label}</span>
      <button type="button" className={`key ${listening ? 'listening' : ''}`} aria-label={`${label}: ${keyLabel(code)}. Change`}
        onClick={() => setListening(true)}>{listening ? 'Press a key…' : keyLabel(code)}</button>
    </div>
  );
}

function Slider({ label, min, max, step, value, format, onChange }: {
  label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="setting">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output className="number-readout">{format(value)}</output>
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting check">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
