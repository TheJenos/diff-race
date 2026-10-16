import { describe, expect, it } from 'vitest';
import { gapSeconds, rank } from '../ranking';

const car = (id: string, D: number, finishTime: number | null = null, outAt: number | null = null) => ({ id, D, finishTime, speed: 30, outAt });

describe('ranking', () => {
  it('puts finishers first by time, then the rest by distance', () => {
    expect(rank([car('a', 100), car('b', 900, 60), car('c', 300), car('d', 950, 55)])).toEqual(['d', 'b', 'c', 'a']);
  });

  it('keeps places steady through a near tie', () => {
    expect(rank([car('a', 100), car('b', 100.3)], ['a', 'b'])).toEqual(['a', 'b']);
    expect(rank([car('a', 100), car('b', 101)], ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('ranks the knocked-out last, the last one out highest of them', () => {
    expect(rank([car('a', 500, null, 20), car('b', 50), car('c', 800, null, 40)])).toEqual(['b', 'c', 'a']);
  });

  it('turns distance into seconds', () => {
    expect(gapSeconds(car('a', 130), car('b', 100))).toBeCloseTo(1);
  });
});
