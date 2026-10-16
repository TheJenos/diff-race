import { settings } from './settings';

/*
 * Web Audio, shared by the whole page: one context, a sound-effects bus and a music bus, both
 * through a limiter so a pile-up of crashes doesn't clip. The context can only start after a
 * user gesture (browsers' autoplay rules): initAudio() is called from the clicks that start a race.
 *
 * Phase 1's sounds are all synthesised (sfx.ts); sampled sounds can join through playBuffer.
 */

let ctx: AudioContext | null = null;
let sfx: GainNode | null = null;
let music: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function initAudio(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  try {
    ctx = new AudioContext();
  } catch {
    return null;
  }
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);
  sfx = ctx.createGain();
  music = ctx.createGain();
  sfx.connect(limiter);
  music.connect(limiter);
  const apply = () => {
    const s = settings.get();
    sfx?.gain.setTargetAtTime(s.sfxVolume, ctx!.currentTime, 0.05);
    music?.gain.setTargetAtTime(s.musicVolume * 0.6, ctx!.currentTime, 0.05);
  };
  apply();
  settings.subscribe(apply);
  return ctx;
}

export const audioContext = (): AudioContext | null => ctx;
export const sfxBus = (): GainNode | null => sfx;
export const musicBus = (): GainNode | null => music;

/** A second of white noise, looped by whoever needs it (tyre screech, wind, crunches) */
export function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
  }
  return noise;
}

/** A short tone: frequency (Hz), length (s), volume, waveform */
export function tone(freq: number, length: number, volume = 0.3, type: OscillatorType = 'square'): void {
  const c = ctx;
  const bus = sfx;
  if (!c || !bus) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime;
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + length + 0.02);
}

/** A thud: a burst of low-passed noise with a falling pitch underneath (crashes, landings) */
export function thud(strength: number): void {
  const c = ctx;
  const bus = sfx;
  const buf = noiseBuffer();
  if (!c || !bus || !buf) return;
  const t = c.currentTime;
  const k = Math.max(0.05, Math.min(1, strength));
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500 + 1800 * k;
  const g = c.createGain();
  g.gain.setValueAtTime(0.7 * k, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  src.connect(lp).connect(g).connect(bus);
  src.start(t, Math.random() * 0.5, 0.4);
  const o = c.createOscillator();
  const og = c.createGain();
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  og.gain.setValueAtTime(0.5 * k, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(og).connect(bus);
  o.start(t);
  o.stop(t + 0.32);
}
