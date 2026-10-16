import { describe, expect, it } from 'vitest';
import { CODEC_PATTERN, decodeCar, encodeCar, FLAG, newSnapshot } from '../carCodec';
import { shouldSend } from '../sendPolicy';

const sample = () => {
  const s = newSnapshot();
  // A rotation about y by 0.7 rad
  Object.assign(s, { x: -123.456, y: 4.2, z: 987.6, qx: 0, qy: Math.sin(0.35), qz: 0, qw: Math.cos(0.35),
    vx: 31.2, vy: -0.4, vz: -12.9, wx: 0.01, wy: -1.2, wz: 0, yaw: -2.5, pitch: 0.3, D: 1234.5, armour: 97, flags: FLAG.firing | FLAG.nitro });
  return s;
};

describe('car codec', () => {
  it('round-trips within its rounding', () => {
    const a = sample();
    const str = encodeCar(a);
    const b = decodeCar(str, newSnapshot())!;
    expect(b.x).toBeCloseTo(a.x, 2);
    expect(b.z).toBeCloseTo(a.z, 2);
    expect(b.qy).toBeCloseTo(a.qy, 3);
    expect(b.qw).toBeCloseTo(a.qw, 3);
    expect(b.vx).toBeCloseTo(a.vx, 2);
    expect(b.wy).toBeCloseTo(a.wy, 2);
    expect(b.yaw).toBeCloseTo(a.yaw, 2);
    expect(b.D).toBeCloseTo(a.D, 1);
    expect(b.armour).toBe(97);
    expect(b.flags).toBe(FLAG.firing | FLAG.nitro);
  });

  it('is short and matches what the database rules accept', () => {
    const str = encodeCar(sample());
    expect(str.length).toBeLessThan(110);
    expect(CODEC_PATTERN.test(str)).toBe(true);
  });

  it('keeps w positive', () => {
    const a = sample();
    a.qy = -a.qy; a.qw = -a.qw;
    const b = decodeCar(encodeCar(a), newSnapshot())!;
    expect(b.qw).toBeGreaterThan(0);
    expect(b.qy).toBeCloseTo(-a.qy, 3);
  });
});

describe('send policy', () => {
  it('sends nothing faster than 20 Hz and something at least every 220 ms', () => {
    const a = { ...sample(), vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 };
    expect(shouldSend(a, a, 30)).toBe(false);
    expect(shouldSend(a, a, 100)).toBe(false);
    expect(shouldSend(a, a, 230)).toBe(true);
  });

  it('sends when the prediction drifts or something discrete changes', () => {
    const a = sample();
    // Where it was going, 100 ms on: no need to send.
    const b = { ...a, x: a.x + a.vx * 0.1, y: a.y + a.vy * 0.1, z: a.z + a.vz * 0.1 };
    expect(shouldSend(a, b, 100)).toBe(false);
    expect(shouldSend(a, { ...b, x: b.x + 1 }, 100)).toBe(true);
    expect(shouldSend(a, { ...b, flags: 0 }, 100)).toBe(true);
    expect(shouldSend(a, { ...b, yaw: a.yaw + 0.1 }, 100)).toBe(true);
  });
});
