import { describe, expect, it } from 'vitest';
import { stadiumTrack } from '../fallback';
import { GENERATOR_VERSION } from '../spec';
import { at3, type TrackData } from '../types';

const spec = (length: 's' | 'm' | 'l') => ({ seed: 'x', length, gen: GENERATOR_VERSION });

function maxGap(t: TrackData): number {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (let i = 0; i < t.n; i++) {
    at3(t.pos, i, t.n, a);
    at3(t.pos, i + 1, t.n, b);
    worst = Math.max(worst, Math.abs(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - t.ds));
  }
  return worst;
}

describe('stadium fallback', () => {
  for (const length of ['s', 'm', 'l'] as const) {
    it(`closes the loop with even spacing (${length})`, () => {
      const t = stadiumTrack(spec(length));
      expect(t.ds).toBeGreaterThan(1.8);
      expect(t.ds).toBeLessThan(2.2);
      // Arc chords are a hair shorter than the arc; spacing stays within a centimetre or two.
      expect(maxGap(t)).toBeLessThan(0.03);
    });
  }

  it('has orthonormal frames with the road facing up', () => {
    const t = stadiumTrack(spec('m'));
    const f = { x: 0, y: 0, z: 0 };
    const r = { x: 0, y: 0, z: 0 };
    const u = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < t.n; i++) {
      at3(t.fwd, i, t.n, f);
      at3(t.right, i, t.n, r);
      at3(t.up, i, t.n, u);
      expect(Math.abs(f.x * r.x + f.y * r.y + f.z * r.z)).toBeLessThan(1e-3);
      expect(Math.abs(f.x * u.x + f.y * u.y + f.z * u.z)).toBeLessThan(1e-3);
      expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(1, 3);
      expect(u.y).toBeGreaterThan(0.95);
    }
  });

  it('banks the bends with the outside edge up', () => {
    const t = stadiumTrack(spec('m'));
    // The oval turns left (negative curvature); the outside is the right, so right points up.
    const mid = t.kerbs[0]!;
    const i = Math.floor((mid.i0 + mid.i1) / 2);
    expect(t.curvature[i]!).toBeLessThan(0);
    expect(t.right[i * 3 + 1]!).toBeGreaterThan(0.02);
  });

  it('starts on a straight with the grid behind the line', () => {
    const t = stadiumTrack(spec('s'));
    expect(Math.abs(t.curvature[0]!)).toBeLessThan(1e-4);
    expect(t.grid).toHaveLength(12);
    for (const g of t.grid) expect(g.s).toBeLessThan(0);
  });

  it('hashes the same every time', () => {
    expect(stadiumTrack(spec('l')).hash).toBe(stadiumTrack(spec('l')).hash);
    expect(stadiumTrack(spec('l')).hash).not.toBe(stadiumTrack(spec('s')).hash);
  });
});
