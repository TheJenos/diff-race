/*
 * The race clock from one shared moment, `startAt` (server time in a room, local time offline):
 * the countdown before it and the race time after. Nothing is written when the lights go green;
 * every client works it out from the same number. Pure.
 */

export type ClockPhase = 'intro' | 'countdown' | 'racing';

/** How long the "3, 2, 1" lasts before the start (ms) */
export const COUNTDOWN_MS = 3_000;
/** "GO!" stays up this long (ms) */
export const GO_MS = 900;

export interface ClockState {
  phase: ClockPhase;
  /** 3, 2, 1 before the start, 0 for "GO!", null otherwise */
  count: number | null;
  /** Seconds since the start (negative before it) */
  raceTime: number;
}

export function clockAt(now: number, startAt: number, out: ClockState): ClockState {
  const ms = now - startAt;
  out.raceTime = ms / 1000;
  if (ms >= 0) {
    out.phase = 'racing';
    out.count = ms < GO_MS ? 0 : null;
  } else if (ms >= -COUNTDOWN_MS) {
    out.phase = 'countdown';
    out.count = Math.ceil(-ms / 1000);
  } else {
    out.phase = 'intro';
    out.count = null;
  }
  return out;
}

/** mm:ss.mmm (or ss.mmm under a minute) */
export function formatTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const tail = `${String(s).padStart(m ? 2 : 1, '0')}.${String(r).padStart(3, '0')}`;
  return m ? `${m}:${tail}` : tail;
}

/** A signed gap: −0.840 / +1.200 */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  return `${sign}${formatTime(Math.abs(seconds))}`;
}
