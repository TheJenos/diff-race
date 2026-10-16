import { describe, expect, it } from 'vitest';
import { stadiumTrack } from '../fallback';
import { locate, newLocation } from '../locate';
import { pointAt, newFrame } from '../sample';
import { GENERATOR_VERSION } from '../spec';

const track = stadiumTrack({ seed: 'loc', length: 'm', gen: GENERATOR_VERSION });

describe('locate', () => {
  it('finds s and u of points on the road, with and without a hint', () => {
    const p = { x: 0, y: 0, z: 0 };
    const frame = newFrame();
    const out = newLocation();
    for (const s of [0, 5, 333.3, 900, track.lapLength - 1]) {
      for (const u of [-8, 0, 4.5]) {
        pointAt(track, s, u, frame, p);
        locate(track, p, -1, out);
        expect(Math.abs(((out.s - s + track.lapLength * 1.5) % track.lapLength) - track.lapLength / 2)).toBeLessThan(0.3);
        expect(out.u).toBeCloseTo(u, 1);
        const hinted = locate(track, p, Math.floor(s / track.ds), newLocation());
        expect(hinted.i).toBe(out.i);
      }
    }
  });

  it('falls back to a full scan when the hint is wrong', () => {
    const p = { x: 0, y: 0, z: 0 };
    pointAt(track, 600, 2, newFrame(), p);
    const out = locate(track, p, 0, newLocation());
    expect(out.s).toBeCloseTo(600, 0);
  });
});
