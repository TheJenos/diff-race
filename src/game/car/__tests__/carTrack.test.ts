import { describe, expect, it } from 'vitest';
import { CarTrack, BLEND_MS, newPose, predict } from '../carTrack';
import { newSnapshot } from '../../../net/carCodec';

const snap = (x: number, vx: number, flags = 0) => ({ ...newSnapshot(), x, vx, flags });

describe('remote car prediction', () => {
  it('carries a snapshot forward by its velocity, up to a limit', () => {
    const out = newPose();
    predict(snap(0, 30), 1000, 1100, out);
    expect(out.x).toBeCloseTo(3);
    predict(snap(0, 30), 1000, 5000, out);
    expect(out.x).toBeCloseTo(9); // 300 ms at most
  });

  it('integrates spin', () => {
    const out = newPose();
    predict({ ...newSnapshot(), wy: 1 }, 0, 200, out);
    // About 0.2 rad about y: qy ≈ sin(0.1)
    expect(out.qy).toBeCloseTo(Math.sin(0.1), 2);
  });

  it('glides onto a corrected snapshot instead of jumping', () => {
    const t = new CarTrack();
    t.push(snap(0, 20), 0, 0);
    // A new snapshot says it's 1 m further along than predicted.
    t.push(snap(3, 20), 100, 100);
    const out = newPose();
    t.sample(100, out);
    expect(out.x).toBeCloseTo(2, 1); // still on the old prediction
    t.sample(100 + BLEND_MS, out);
    expect(out.x).toBeCloseTo(3 + 20 * (BLEND_MS / 1000), 1); // fully on the new one
  });

  it('snaps on a teleport, and drops out-of-order snapshots', () => {
    const t = new CarTrack();
    t.push(snap(0, 0), 0, 0);
    t.push(snap(100, 0), 100, 100);
    const out = newPose();
    expect(t.sample(110, out)!.x).toBeCloseTo(100);
    t.push(snap(-50, 0), 50, 120);
    expect(t.sample(130, out)!.x).toBeCloseTo(100);
  });
});
