/** Player preferences (controls, video, sound, camera), saved in this browser. */

export type Action =
  | 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'nitro'
  | 'missile' | 'defence' | 'lookBack' | 'respawn' | 'scoreboard';

export const ACTIONS: { action: Action; label: string }[] = [
  { action: 'throttle', label: 'Accelerate' },
  { action: 'brake', label: 'Brake / reverse' },
  { action: 'left', label: 'Steer left' },
  { action: 'right', label: 'Steer right' },
  { action: 'handbrake', label: 'Handbrake' },
  { action: 'nitro', label: 'Nitro' },
  { action: 'missile', label: 'Fire missile (also right mouse)' },
  { action: 'defence', label: 'Drop rear defence' },
  { action: 'lookBack', label: 'Look back' },
  { action: 'respawn', label: 'Respawn on the track' },
  { action: 'scoreboard', label: 'Standings (hold)' },
];

export type Bindings = Record<Action, string>;

export type Quality = 'low' | 'medium' | 'high';
export type MotionPref = 'system' | 'reduce' | 'full';
export type Units = 'kmh' | 'mph';

export interface Settings {
  /** Multiplier on the base mouse speed (turret aim) */
  sensitivity: number;
  invertY: boolean;
  /** Field of view at rest, degrees (nitro widens it) */
  fov: number;
  /** Rendering: resolution cap, shadows, scenery density */
  quality: Quality;
  /** Camera shake on hits, rams and landings */
  screenShake: boolean;
  /** Swing the camera back behind the car after a moment without aiming */
  recentre: boolean;
  /** Pulsing / zooming HUD animations: follow the OS, or force on/off */
  reduceMotion: MotionPref;
  hudScale: number;
  showFps: boolean;
  units: Units;
  /** 0..1 */
  sfxVolume: number;
  musicVolume: number;
  /** Gamepad stick deadzone (0..0.4) */
  deadzone: number;
  /** Turret aim assist on gamepad and touch */
  aimAssist: boolean;
  /** The turret locks onto the car the camera faces by itself (combat/rules/autoAim.ts) */
  autoAim: boolean;
  /** Touch: accelerate on its own unless braking */
  autoAccelerate: boolean;
  /** Gamepad rumble on hits and crashes */
  rumble: boolean;
  /** Replay your wreck in slow motion (skippable) */
  replays: boolean;
  /** Bright outlines round every car, for seeing them against busy scenery */
  outlines: boolean;
  /** Draw cars and scenery with the Kenney kit models when they're installed (public/models/) */
  kitModels: boolean;
  /** KeyboardEvent.code for each action (arrow keys always steer and pedal too) */
  bindings: Bindings;
}

export const SENSITIVITY_MIN = 0.1;
export const SENSITIVITY_MAX = 4;
export const FOV_MIN = 60;
export const FOV_MAX = 100;
export const FOV_DEFAULT = 72;
export const HUD_SCALE_MIN = 0.8;
export const HUD_SCALE_MAX = 1.4;
export const MOTION_OPTIONS: { value: MotionPref; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: "Follow the device's reduce-motion setting" },
  { value: 'reduce', label: 'On', hint: 'No pulsing, zooming or camera shake' },
  { value: 'full', label: 'Off', hint: 'All animations' },
];
export const QUALITIES: { value: Quality; label: string; hint: string }[] = [
  { value: 'low', label: 'Low', hint: 'No shadows, lower resolution, sparse scenery' },
  { value: 'medium', label: 'Medium', hint: 'Shadows, most scenery' },
  { value: 'high', label: 'High', hint: 'Sharp shadows, full scenery, smooth edges (next race)' },
];

export const DEFAULT_BINDINGS: Bindings = {
  throttle: 'KeyW',
  brake: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  handbrake: 'Space',
  nitro: 'ShiftLeft',
  missile: 'KeyQ',
  defence: 'KeyF',
  lookBack: 'KeyC',
  respawn: 'KeyR',
  scoreboard: 'Tab',
};

/** Arrow keys drive too, whatever the bindings (they can't be rebound) */
export const ARROW_ACTIONS: Record<string, Action> = {
  ArrowUp: 'throttle', ArrowDown: 'brake', ArrowLeft: 'left', ArrowRight: 'right',
};

const COARSE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
const MOTION_QUERY = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const DEFAULTS: Settings = {
  sensitivity: 1, invertY: false, fov: FOV_DEFAULT,
  // Phones start low; they can turn it up.
  quality: COARSE ? 'low' : 'high', screenShake: !MOTION_QUERY?.matches, recentre: true,
  reduceMotion: 'system', hudScale: 1, showFps: false, units: 'kmh', sfxVolume: 1, musicVolume: 0.7,
  deadzone: 0.15, aimAssist: true, autoAim: true, autoAccelerate: true, rumble: true, replays: true, outlines: false, kitModels: true,
  bindings: DEFAULT_BINDINGS,
};

/** Esc always releases the mouse, and the arrows always drive, so neither can be bound. */
export const RESERVED_KEYS = new Set(['Escape', ...Object.keys(ARROW_ACTIONS)]);

const STORAGE_KEY = 'diffrace-settings';
/** Bumped when a default changes in a way saved settings should pick up. */
const VERSION = 1;

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Omit<Partial<Settings>, 'bindings'> & {
      version?: number;
      bindings?: Partial<Bindings>;
    };
    const num = (v: unknown, min: number, max: number, fallback: number) =>
      Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(max, Math.max(min, Number(v))) : fallback;
    const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    return {
      sensitivity: num(saved.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, DEFAULTS.sensitivity),
      invertY: bool(saved.invertY, DEFAULTS.invertY),
      fov: num(saved.fov, FOV_MIN, FOV_MAX, DEFAULTS.fov),
      quality: QUALITIES.some((q) => q.value === saved.quality) ? (saved.quality as Quality) : DEFAULTS.quality,
      screenShake: bool(saved.screenShake, DEFAULTS.screenShake),
      recentre: bool(saved.recentre, DEFAULTS.recentre),
      reduceMotion: MOTION_OPTIONS.some((o) => o.value === saved.reduceMotion) ? (saved.reduceMotion as MotionPref) : DEFAULTS.reduceMotion,
      hudScale: num(saved.hudScale, HUD_SCALE_MIN, HUD_SCALE_MAX, DEFAULTS.hudScale),
      showFps: bool(saved.showFps, DEFAULTS.showFps),
      units: saved.units === 'mph' ? 'mph' : 'kmh',
      sfxVolume: num(saved.sfxVolume, 0, 1, DEFAULTS.sfxVolume),
      musicVolume: num(saved.musicVolume, 0, 1, DEFAULTS.musicVolume),
      deadzone: num(saved.deadzone, 0.02, 0.4, DEFAULTS.deadzone),
      aimAssist: bool(saved.aimAssist, DEFAULTS.aimAssist),
      autoAim: bool(saved.autoAim, DEFAULTS.autoAim),
      autoAccelerate: bool(saved.autoAccelerate, DEFAULTS.autoAccelerate),
      rumble: bool(saved.rumble, DEFAULTS.rumble),
      replays: bool(saved.replays, DEFAULTS.replays),
      outlines: bool(saved.outlines, DEFAULTS.outlines),
      kitModels: bool(saved.kitModels, DEFAULTS.kitModels),
      // Start from the defaults so actions added later still get a key.
      bindings: { ...DEFAULT_BINDINGS, ...pickStrings(saved.bindings) },
    };
  } catch {
    return DEFAULTS;
  }
}

function pickStrings(value: unknown): Partial<Bindings> {
  if (!value || typeof value !== 'object') return {};
  const out: Partial<Bindings> = {};
  for (const { action } of ACTIONS) {
    const code = (value as Record<string, unknown>)[action];
    if (typeof code === 'string' && code && !RESERVED_KEYS.has(code)) out[action] = code;
  }
  return out;
}

let current: Settings = load();
const listeners = new Set<() => void>();

function set(next: Settings): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, version: VERSION }));
  } catch { /* storage unavailable: keep the settings for this session */ }
  listeners.forEach((l) => l());
}

export const settings = {
  get: (): Settings => current,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  update(patch: Partial<Omit<Settings, 'bindings'>>): void {
    set({ ...current, ...patch });
  },

  /** Bind `code` to `action`. If another action had that key, it takes this action's old key. */
  bind(action: Action, code: string): void {
    if (RESERVED_KEYS.has(code)) return;
    const bindings = { ...current.bindings };
    const previous = bindings[action];
    const clash = ACTIONS.find((a) => a.action !== action && bindings[a.action] === code);
    if (clash) bindings[clash.action] = previous;
    bindings[action] = code;
    set({ ...current, bindings });
  },

  reset(): void {
    set(DEFAULTS);
  },
};

/** Whether animations should be toned down right now: the setting, or the OS when it's 'system'. */
export const reducedMotion = (s: Settings = current): boolean =>
  s.reduceMotion === 'reduce' || (s.reduceMotion === 'system' && !!MOTION_QUERY?.matches);

/** Keep `html.reduce-motion` in step with the setting and the OS, for the CSS. */
export function watchReducedMotion(): void {
  const apply = () => document.documentElement.classList.toggle('reduce-motion', reducedMotion());
  apply();
  settings.subscribe(apply);
  MOTION_QUERY?.addEventListener('change', apply);
}

/** Which action, if any, `code` is bound to (arrows included). */
export function actionFor(code: string): Action | null {
  if (ARROW_ACTIONS[code]) return ARROW_ACTIONS[code];
  const found = ACTIONS.find((a) => current.bindings[a.action] === code);
  return found ? found.action : null;
}

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Cmd', MetaRight: 'R Cmd',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};

/** Short label for a KeyboardEvent.code, e.g. KeyW -> W, Digit1 -> 1. */
export function keyLabel(code: string): string {
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** km/h or mph from m/s, per the setting */
export const speedIn = (ms: number, units: Units = current.units): number => Math.abs(ms) * (units === 'mph' ? 2.23694 : 3.6);
