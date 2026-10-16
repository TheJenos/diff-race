import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';

describe('Rng', () => {
  it('rolls the same sequence for the same seed, on every engine', () => {
    const r = new Rng('diff');
    expect(Array.from({ length: 6 }, () => r.next())).toMatchSnapshot();
  });

  it('forks independent streams', () => {
    const a = new Rng('seed').fork('layout');
    const b = new Rng('seed').fork('scenery');
    expect(a.next()).not.toBe(b.next());
    expect(new Rng('seed').fork('layout').next()).toBe(new Rng('seed').fork('layout').next());
  });

  it('stays in range', () => {
    const r = new Rng('range');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
