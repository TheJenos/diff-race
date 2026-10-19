import { describe, expect, it } from 'vitest';
import { generateWithReport } from '../generate';
import { GENERATOR_VERSION, type TrackLength } from '../spec';
import { LENGTH_PARAMS } from '../params';
import { validate } from '../validate';
import { TRAP_AHEAD } from '../features';

const spec = (seed: string, length: TrackLength) => ({ seed, length, gen: GENERATOR_VERSION });

describe('track generator', () => {
  it('builds the same track twice from the same spec', () => {
    const a = generateWithReport(spec('twice', 'm')).track;
    const b = generateWithReport(spec('twice', 'm')).track;
    expect(a.hash).toBe(b.hash);
    expect(a.name).toBe(b.name);
    expect(Array.from(a.pos.slice(0, 30))).toEqual(Array.from(b.pos.slice(0, 30)));
  });

  for (const length of ['s', 'm', 'l'] as const) {
    it(`builds valid tracks in the length band (${length}), rarely falling back`, () => {
      let fallbacks = 0;
      const lp = LENGTH_PARAMS[length];
      for (let i = 0; i < 30; i++) {
        const { track: t } = generateWithReport(spec(`seed-${i}`, length));
        if (t.fallback) {
          fallbacks++;
          continue;
        }
        expect(t.lapLength).toBeGreaterThan(lp.min * 0.97);
        expect(t.lapLength).toBeLessThan(lp.max * 1.03);
        expect(validate({ pos: t.pos, n: t.n, ds: t.ds, halfWidth: t.halfWidth, verge: t.verge, curvature: t.curvature })).toBeNull();
        expect(t.grid).toHaveLength(12);
        expect(t.pads.some((p) => p.kind === 'sword')).toBe(true);
        expect(t.pads.some((p) => p.kind === 'shield')).toBe(true);
        // Guns: a row of three across the road soon after the start, and more round the lap.
        const guns = t.pads.filter((p) => p.kind === 'gun');
        expect(guns.filter((p) => p.s >= 140 && p.s <= 200)).toHaveLength(3);
        expect(guns.length).toBeGreaterThanOrEqual(5);
        expect(t.scenery.length).toBeGreaterThan(20);
        // The start line is level and straight.
        expect(Math.abs(t.curvature[0]!)).toBeLessThan(0.005);
        expect(Math.abs(t.pos[1]!)).toBeLessThan(0.01);
      }
      expect(fallbacks).toBeLessThanOrEqual(1);
    });
  }

  it('places skull pads whose traps land on gentle stretches', () => {
    for (let i = 0; i < 20; i++) {
      const t = generateWithReport(spec(`skull-${i}`, 'm')).track;
      const skulls = t.pads.filter((p) => p.kind === 'skull');
      expect(skulls.length).toBeGreaterThanOrEqual(1);
      for (const p of skulls) {
        const at = (p.s + TRAP_AHEAD) % t.lapLength;
        expect(Math.abs(t.curvature[Math.floor(at / t.ds) % t.n]!)).toBeLessThanOrEqual(1 / 80 + 1e-6);
        expect(Math.abs(p.u)).toBeLessThan(t.halfWidth[Math.floor(p.s / t.ds) % t.n]!);
      }
    }
  });

  it('keeps the racing line on the road', () => {
    const t = generateWithReport(spec('line', 'l')).track;
    for (let i = 0; i < t.n; i++) expect(Math.abs(t.line[i]!)).toBeLessThanOrEqual(t.halfWidth[i]! - 2);
  });
});
