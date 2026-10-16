import { audioContext, noiseBuffer, sfxBus, thud, tone } from './audio';
import { gearAt } from './car/drivetrain';
import type { CarBody } from './car/carBody';

/*
 * The player's car, heard: a synthesised V8 (two detuned oscillators through a low-pass, pitched
 * by the pretend gears' revs), a tyre screech (band-passed noise, louder the more the tyres
 * slide), a nitro hiss, and thuds for crashes and hard landings.
 */

export class CarSounds {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly a: OscillatorNode;
  private readonly b: OscillatorNode;
  private readonly engine: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly screech: GainNode;
  private readonly hiss: GainNode;
  private lastGrounded = 4;
  private airTime = 0;

  static create(): CarSounds | null {
    const c = audioContext();
    const bus = sfxBus();
    return c && bus ? new CarSounds(c, bus) : null;
  }

  private constructor(private readonly c: AudioContext, bus: GainNode) {
    this.engine = c.createGain();
    this.engine.gain.value = 0;
    this.tone = c.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 2;
    this.a = c.createOscillator();
    this.a.type = 'sawtooth';
    this.b = c.createOscillator();
    this.b.type = 'square';
    this.b.detune.value = -1200 + 7;
    const mixB = c.createGain();
    mixB.gain.value = 0.5;
    this.a.connect(this.tone);
    this.b.connect(mixB).connect(this.tone);
    this.tone.connect(this.engine).connect(bus);

    const noise = noiseBuffer();
    this.screech = c.createGain();
    this.screech.gain.value = 0;
    this.hiss = c.createGain();
    this.hiss.gain.value = 0;
    if (noise) {
      const n1 = c.createBufferSource();
      n1.buffer = noise;
      n1.loop = true;
      const band = c.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2100;
      band.Q.value = 6;
      n1.connect(band).connect(this.screech).connect(bus);
      const n2 = c.createBufferSource();
      n2.buffer = noise;
      n2.loop = true;
      const high = c.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 3500;
      n2.connect(high).connect(this.hiss).connect(bus);
      n1.start();
      n2.start(0, 0.5);
      this.sources.push(n1, n2);
      this.nodes.push(band, high);
    }
    this.a.start();
    this.b.start();
    this.sources.push(this.a, this.b);
    this.nodes.push(mixB, this.tone, this.engine, this.screech, this.hiss);
  }

  update(car: CarBody, throttle: number, dt: number): void {
    const t = this.c.currentTime;
    const { rpm } = gearAt(car.speed);
    const air = car.grounded === 0;
    // In the air the engine revs free.
    const revs = air ? Math.min(1, rpm + throttle * 0.3) : rpm;
    const f = 38 + revs * 120 + (car.nitroActive ? 18 : 0);
    this.a.frequency.setTargetAtTime(f, t, 0.03);
    this.b.frequency.setTargetAtTime(f, t, 0.03);
    this.tone.frequency.setTargetAtTime(400 + revs * 1600 + throttle * 600, t, 0.05);
    this.engine.gain.setTargetAtTime(0.09 + throttle * 0.11 + revs * 0.05, t, 0.05);
    let slide = 0;
    for (const w of car.wheels) if (w.grounded) slide = Math.max(slide, w.slide);
    this.screech.gain.setTargetAtTime(Math.abs(car.speed) > 4 ? slide * 0.22 : 0, t, 0.04);
    this.hiss.gain.setTargetAtTime(car.nitroActive ? 0.12 : 0, t, 0.06);
    // Landing after a jump.
    if (air) this.airTime += dt;
    else {
      if (this.lastGrounded === 0 && this.airTime > 0.35) thud(Math.min(1, this.airTime * 0.8));
      this.airTime = 0;
    }
    this.lastGrounded = car.grounded;
  }

  dispose(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
      s.disconnect();
    }
    for (const n of this.nodes) n.disconnect();
  }
}

/** Countdown beeps: 3, 2, 1 low, GO high */
export function countdownBeep(count: number): void {
  if (count > 0) tone(440, 0.18, 0.25);
  else tone(880, 0.45, 0.3);
}

export function lapChime(best: boolean): void {
  tone(best ? 1046 : 784, 0.12, 0.2, 'triangle');
  setTimeout(() => tone(best ? 1318 : 988, 0.2, 0.2, 'triangle'), 110);
}

export { thud };

/** A machine-gun burst's worth of rounds this frame (volume 0..1 by distance) */
let lastGun = 0;
export function gunBurst(volume: number): void {
  const c = audioContext();
  const bus = sfxBus();
  const noise = noiseBuffer();
  if (!c || !bus || !noise || volume <= 0.02) return;
  const now = c.currentTime;
  if (now - lastGun < 0.07) return;
  lastGun = now;
  const src = c.createBufferSource();
  src.buffer = noise;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400 + Math.random() * 500;
  band.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(0.35 * volume, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  src.connect(band).connect(g).connect(bus);
  src.start(now, Math.random() * 0.8, 0.08);
}

export function missileLaunch(volume: number): void {
  const c = audioContext();
  const bus = sfxBus();
  const noise = noiseBuffer();
  if (!c || !bus || !noise || volume <= 0.02) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(600, now);
  f.frequency.exponentialRampToValueAtTime(3500, now + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0.5 * volume, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  src.connect(f).connect(g).connect(bus);
  src.start(now, 0, 0.65);
}

export function explosion(volume: number): void {
  if (volume <= 0.02) return;
  thud(Math.min(1, volume * 1.2));
  setTimeout(() => thud(volume * 0.6), 60);
}

export function pickup(kind: 'sword' | 'shield'): void {
  const base = kind === 'sword' ? 523 : 392;
  tone(base, 0.12, 0.18, 'sawtooth');
  setTimeout(() => tone(base * 1.5, 0.18, 0.18, 'sawtooth'), 90);
}

let lastTick = 0;
/** The hitmarker's tick */
export function hitTick(): void {
  const c = audioContext();
  if (!c || c.currentTime - lastTick < 0.05) return;
  lastTick = c.currentTime;
  tone(2600, 0.03, 0.08, 'square');
}

export function killSting(): void {
  tone(659, 0.1, 0.22, 'square');
  setTimeout(() => tone(988, 0.25, 0.22, 'square'), 100);
}

export function diffedSting(): void {
  tone(330, 0.18, 0.25, 'sawtooth');
  setTimeout(() => tone(220, 0.4, 0.25, 'sawtooth'), 160);
}
