/*
 * How far round the race a car is: its race distance D (metres from the start line, negative on
 * the grid, growing by a lap length every lap), its laps and lap times, and whether it's going
 * the wrong way. Pure.
 *
 * D only ever moves by what the car could physically have driven since the last step, so a
 * respawn or a teleport can't skip a lap; those go through `resetTo`. Laps count from the most
 * D ever reached, so reversing back over the line and crossing it again never counts twice.
 */

export interface Progress {
  /** Race distance (m) */
  D: number;
  /** Furthest D reached */
  maxD: number;
  /** Track position last step (0..lapLength) */
  lastS: number;
  lapsDone: number;
  /** Race time (s) the current lap started */
  lapStart: number;
  /** Seconds per completed lap */
  lapTimes: number[];
  finished: boolean;
  /** Race time (s) the car crossed the line for the last time */
  finishTime: number | null;
  /** Seconds the car has gone the wrong way, and whether that's long enough to say so */
  wrongFor: number;
  wrongWay: boolean;
  /** Seconds since the position last made sense (left the track somehow) */
  lostFor: number;
}

export interface ProgressEvent {
  /** A lap was completed: its number (1-based) and time (s) */
  lap?: { n: number; time: number };
  finished?: boolean;
}

/** A car on the grid at track position `s` (behind the line: `s` near lapLength, D = s - lapLength) */
export function newProgress(gridS: number, lapLength: number): Progress {
  const D = gridS > lapLength / 2 ? gridS - lapLength : gridS;
  return {
    D, maxD: D, lastS: wrap(gridS, lapLength), lapsDone: 0, lapStart: 0, lapTimes: [], finished: false, finishTime: null,
    wrongFor: 0, wrongWay: false, lostFor: 0,
  };
}

const wrap = (s: number, l: number) => s - Math.floor(s / l) * l;

/** Shortest signed distance from a to b round a loop of length l */
export function loopDelta(a: number, b: number, l: number): number {
  let d = wrap(b - a, l);
  if (d > l / 2) d -= l;
  return d;
}

export interface StepInput {
  /** Track position now (0..lapLength) */
  s: number;
  lapLength: number;
  laps: number;
  dt: number;
  /** Race time (s) at the end of this step */
  time: number;
  /** Forward speed (m/s) and how the car points along the track (dot of its forward with the track's) */
  speed: number;
  alignment: number;
  /** The most a car can move in a step, per second (m/s) */
  maxSpeed: number;
  /** Before the start the clock isn't running: no laps, no wrong way */
  racing: boolean;
}

export function stepProgress(p: Progress, i: StepInput, out: ProgressEvent): ProgressEvent {
  out.lap = undefined;
  out.finished = undefined;
  const d = loopDelta(p.lastS, i.s, i.lapLength);
  p.lastS = i.s;
  if (Math.abs(d) > i.maxSpeed * i.dt + 2) {
    // Not something a car could drive: the position jumped (off the track, through a gap).
    p.lostFor += i.dt;
    return out;
  }
  p.lostFor = 0;
  const before = p.D;
  p.D += d;
  if (p.D > p.maxD) p.maxD = p.D;

  // Wrong way: pointing back down the track while moving, or well behind your best.
  const backward = i.alignment < -0.3 && Math.abs(i.speed) > 4;
  const behind = p.D < p.maxD - 25;
  if (i.racing && !p.finished && (backward || behind)) p.wrongFor += i.dt;
  else p.wrongFor = Math.max(0, p.wrongFor - i.dt * 2);
  p.wrongWay = p.wrongFor > 1;

  if (!i.racing || p.finished) return out;
  const laps = p.D >= 0 ? Math.floor(p.D / i.lapLength) : 0;
  if (laps > p.lapsDone) {
    // Crossed the line part-way through the step: when exactly?
    const line = laps * i.lapLength;
    const f = p.D > before ? (line - before) / (p.D - before) : 1;
    const t = i.time - i.dt + i.dt * Math.min(1, Math.max(0, f));
    p.lapsDone = laps;
    p.lapTimes.push(t - p.lapStart);
    out.lap = { n: laps, time: t - p.lapStart };
    p.lapStart = t;
    if (laps >= i.laps) {
      p.finished = true;
      p.finishTime = t;
      out.finished = true;
    }
  }
  return out;
}

/**
 * After a respawn or teleport: put the car at track position `s`. D never goes past the best it
 * reached by driving, so a car moved ahead keeps the skipped distance as a deficit (it can't gain
 * ground by being teleported).
 */
export function resetTo(p: Progress, s: number, lapLength: number): void {
  const d = loopDelta(p.lastS, s, lapLength);
  p.D = Math.min(p.D + d, p.maxD);
  p.lastS = wrap(s, lapLength);
  p.lostFor = 0;
  p.wrongFor = 0;
  p.wrongWay = false;
}

/** The lap to show (1-based), counting the one in progress */
export const displayLap = (p: Progress, laps: number): number => (p.finished ? laps : Math.min(laps, p.lapsDone + 1));
