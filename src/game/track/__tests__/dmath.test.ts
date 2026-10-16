import { describe, expect, it } from 'vitest';
import { sinCosTurns, TAU, wrapHalf, wrapIndex } from '../dmath';

describe('sinCosTurns', () => {
  it('matches Math.sin / Math.cos to 1e-13 over many angles', () => {
    const out = { s: 0, c: 0 };
    let worst = 0;
    for (let i = 0; i <= 100_000; i++) {
      const t = -3 + (i / 100_000) * 6.5;
      sinCosTurns(t, out);
      worst = Math.max(worst, Math.abs(out.s - Math.sin(t * TAU)), Math.abs(out.c - Math.cos(t * TAU)));
    }
    expect(worst).toBeLessThan(1e-13);
  });

  it('is exact at quarter turns', () => {
    const out = { s: 0, c: 0 };
    expect(sinCosTurns(0, out)).toEqual({ s: 0, c: 1 });
    expect(sinCosTurns(0.25, out)).toEqual({ s: 1, c: -0 });
    expect(sinCosTurns(0.5, out)).toEqual({ s: -0, c: -1 });
    expect(sinCosTurns(0.75, out)).toEqual({ s: -1, c: 0 });
  });

  it('is periodic', () => {
    const a = sinCosTurns(0.137, { s: 0, c: 0 });
    const b = sinCosTurns(5.137, { s: 0, c: 0 });
    expect(b.s).toBeCloseTo(a.s, 12);
    expect(b.c).toBeCloseTo(a.c, 12);
  });
});

describe('wrapping', () => {
  it('wraps indices', () => {
    expect(wrapIndex(-1, 10)).toBe(9);
    expect(wrapIndex(10, 10)).toBe(0);
    expect(wrapIndex(23, 10)).toBe(3);
  });

  it('wraps distances into (-l/2, l/2]', () => {
    expect(wrapHalf(990, 1000)).toBe(-10);
    expect(wrapHalf(-990, 1000)).toBe(10);
    expect(wrapHalf(500, 1000)).toBe(500);
    expect(wrapHalf(30, 1000)).toBe(30);
  });
});
