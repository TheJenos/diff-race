import { describe, expect, it } from 'vitest';
import { displayLap, loopDelta, newProgress, resetTo, stepProgress, type ProgressEvent, type StepInput } from '../progress';
import { clockAt, formatDelta, formatTime } from '../clock';

const L = 1000;
const base = (s: number, time: number, over: Partial<StepInput> = {}): StepInput => ({
  s: ((s % L) + L) % L, lapLength: L, laps: 3, dt: 0.1, time, speed: 30, alignment: 1, maxSpeed: 70, racing: true, ...over,
});

/** Drive from D0 to D1 at `v` m/s, stepping 0.1 s */
function drive(p: ReturnType<typeof newProgress>, from: number, to: number, v: number, t0: number) {
  const events: ProgressEvent[] = [];
  let t = t0;
  const dir = Math.sign(to - from);
  for (let d = from; dir > 0 ? d < to : d > to; d += dir * v * 0.1) {
    t += 0.1;
    const e = stepProgress(p, base(d + dir * v * 0.1, t, { speed: v, alignment: dir }), {});
    if (e.lap || e.finished) events.push({ ...e });
  }
  return { events, t };
}

describe('race progress', () => {
  it('starts behind the line and counts laps with their times', () => {
    const p = newProgress(L - 20, L);
    expect(p.D).toBe(-20);
    const { events } = drive(p, -20, 3 * L + 5, 50, 0);
    expect(events.filter((e) => e.lap)).toHaveLength(3);
    expect(p.finished).toBe(true);
    // Lap 1 includes the 20 m from the grid: 1020 m at 50 m/s = 20.4 s.
    expect(p.lapTimes[0]).toBeCloseTo(20.4, 1);
    expect(p.lapTimes[1]).toBeCloseTo(20, 1);
    expect(p.finishTime).toBeCloseTo(60.4, 1);
  });

  it('never counts a lap twice by reversing back over the line', () => {
    const p = newProgress(L - 20, L);
    let { t } = drive(p, -20, L + 30, 50, 0);
    expect(p.lapsDone).toBe(1);
    ({ t } = drive(p, L + 30, L - 40, 10, t));
    ({ t } = drive(p, L - 40, L + 40, 20, t));
    expect(p.lapsDone).toBe(1);
    expect(p.lapTimes).toHaveLength(1);
    expect(displayLap(p, 3)).toBe(2);
  });

  it('ignores impossible jumps and flags them as lost', () => {
    const p = newProgress(0, L);
    stepProgress(p, base(5, 0.1), {});
    stepProgress(p, base(500, 0.2), {});
    expect(p.D).toBeCloseTo(5, 5);
    expect(p.lostFor).toBeGreaterThan(0);
  });

  it('respawns never move a car ahead of its best', () => {
    const p = newProgress(0, L);
    drive(p, 0, 300, 50, 0);
    resetTo(p, 400, L);
    expect(p.D).toBeLessThanOrEqual(p.maxD);
    // The 100 m it was moved ahead is never credited: from here on it's 100 m behind where it is.
    resetTo(p, 285, L);
    expect(p.D).toBeCloseTo(185, 0);
  });

  it('notices a car going the wrong way', () => {
    const p = newProgress(0, L);
    drive(p, 0, 200, 40, 0);
    let t = 5;
    for (let k = 0; k < 15; k++) stepProgress(p, base(200 - k, (t += 0.1), { alignment: -1, speed: 10 }), {});
    expect(p.wrongWay).toBe(true);
  });

  it('wraps distances round the loop', () => {
    expect(loopDelta(990, 10, L)).toBeCloseTo(20);
    expect(loopDelta(10, 990, L)).toBeCloseTo(-20);
  });
});

describe('race clock', () => {
  it('counts down 3, 2, 1, GO and then runs', () => {
    const c = { phase: 'intro' as const, count: null, raceTime: 0 } as ReturnType<typeof clockAt>;
    expect(clockAt(1000, 6000, c).phase).toBe('intro');
    expect(clockAt(3500, 6000, c).count).toBe(3);
    expect(clockAt(5500, 6000, c).count).toBe(1);
    expect(clockAt(6100, 6000, c)).toMatchObject({ phase: 'racing', count: 0 });
    expect(clockAt(8000, 6000, c)).toMatchObject({ phase: 'racing', count: null, raceTime: 2 });
  });

  it('formats times and gaps', () => {
    expect(formatTime(65.4321)).toBe('1:05.432');
    expect(formatTime(9.5)).toBe('9.500');
    expect(formatDelta(-0.84)).toBe('−0.840');
    expect(formatDelta(1.2)).toBe('+1.200');
  });
});
