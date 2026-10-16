import { audioContext, musicBus, noiseBuffer } from './audio';

/*
 * The race music, made on the spot: a 132 BPM industrial loop of kick, snare, hats, a distorted
 * bass riff and lead stabs, scheduled a little ahead on the audio clock (so it keeps time whatever
 * the frame rate). Three intensities: 0 the grid (kick and bass pulse), 1 racing (the full kit),
 * 2 the final lap (sixteenth hats, the lead, the filter wide open).
 */

const BPM = 132;
const STEP = 60 / BPM / 4;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

/** E minor, the riff's notes as semitones from E1, one per step (null: rest) */
const RIFF: (number | null)[] = [0, null, 0, 12, null, 0, 3, null, 0, null, 0, 10, null, 7, 5, 3];
const RIFF_B: (number | null)[] = [0, null, 0, 12, null, 0, 3, null, 5, null, 5, 15, null, 12, 10, 7];
/** Lead stabs: semitones from E3 on these steps */
const LEAD: Record<number, number> = { 0: 7, 6: 10, 10: 12, 14: 15 };
const KICK = [0, 4, 8, 10, 12];
const SNARE = [4, 12];

const E1 = 41.2;

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private bar = 0;
  private intensity = 0;
  private readonly out: GainNode;
  private readonly drive: WaveShaperNode;
  private readonly filter: BiquadFilterNode;

  private constructor(private readonly c: AudioContext, bus: GainNode) {
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 3;
    // Soft clipping for the bass: grit.
    this.drive = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    this.drive.curve = curve;
    this.drive.connect(this.filter).connect(this.out);
    this.out.connect(bus);
  }

  static create(): Music | null {
    const c = audioContext();
    const bus = musicBus();
    return c && bus ? new Music(c, bus) : null;
  }

  start(): void {
    if (this.timer) return;
    this.next = this.c.currentTime + 0.05;
    this.out.gain.setTargetAtTime(0.5, this.c.currentTime, 0.4);
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  /** 0 grid, 1 racing, 2 final lap */
  setIntensity(level: number): void {
    if (level === this.intensity) return;
    this.intensity = level;
    const f = level >= 2 ? 3200 : level === 1 ? 1700 : 700;
    this.filter.frequency.setTargetAtTime(f, this.c.currentTime, 0.8);
  }

  /** Fade out and stop */
  stop(): void {
    this.out.gain.setTargetAtTime(0, this.c.currentTime, 0.6);
    const t = this.timer;
    this.timer = null;
    if (t) setTimeout(() => clearInterval(t), 2500);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.out.disconnect();
  }

  private schedule(): void {
    while (this.next < this.c.currentTime + LOOKAHEAD) {
      this.play(this.step, this.next);
      this.next += STEP;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  private play(step: number, t: number): void {
    const i = this.intensity;
    if (KICK.includes(step) && (i > 0 || step % 8 === 0)) this.kick(t);
    if (i > 0 && SNARE.includes(step)) this.snare(t);
    if (i > 0 && (i >= 2 || step % 2 === 0)) this.hat(t, step % 4 === 2 ? 0.07 : 0.035);
    const riff = this.bar % 4 === 3 ? RIFF_B : RIFF;
    const note = riff[step];
    if (note !== null && note !== undefined && (i > 0 || step % 4 === 0)) this.bass(t, E1 * Math.pow(2, note / 12));
    if (i >= 2 && LEAD[step] !== undefined && this.bar % 2 === 1) this.lead(t, E1 * 4 * Math.pow(2, (LEAD[step] as number) / 12));
  }

  private kick(t: number): void {
    const c = this.c;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.32);
  }

  private noise(t: number, len: number, type: BiquadFilterType, freq: number, volume: number): void {
    const c = this.c;
    const buf = noiseBuffer();
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.8, len + 0.02);
  }

  private snare(t: number): void {
    this.noise(t, 0.18, 'bandpass', 1800, 0.45);
    const o = this.c.createOscillator();
    const g = this.c.createGain();
    o.frequency.setValueAtTime(220, t);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.12);
  }

  private hat(t: number, volume: number): void {
    this.noise(t, 0.04, 'highpass', 7000, volume * 3);
  }

  private bass(t: number, freq: number): void {
    const c = this.c;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.8);
    o.connect(g).connect(this.drive);
    o.start(t);
    o.stop(t + STEP * 2);
  }

  private lead(t: number, freq: number): void {
    const c = this.c;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + STEP * 3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + STEP * 3.2);
  }
}
