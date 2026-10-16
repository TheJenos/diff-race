import { clockAt, COUNTDOWN_MS, type ClockState } from './clock';
import { newProgress, resetTo, stepProgress, type Progress, type ProgressEvent } from './progress';

/*
 * A race this client runs on its own (a time trial, a test drive, and in Phase 2 a race against
 * bots): the clock from a start time, and the player's progress round the laps. Pure: the game
 * feeds it where the car is each physics step.
 */

export interface RaceSetup {
  /** Laps to finish; 0: endless (test drive) */
  laps: number;
  /** Count down from the grid; false: drive away at once */
  countdown: boolean;
}

/** Time on the grid before the countdown starts (ms): the camera's look round */
export const INTRO_MS = 1_500;

export class LocalRace {
  readonly progress: Progress;
  readonly clock: ClockState = { phase: 'intro', count: null, raceTime: 0 };
  readonly startAt: number;
  private readonly event: ProgressEvent = {};

  constructor(readonly setup: RaceSetup, readonly lapLength: number, gridS: number, now: number) {
    this.startAt = setup.countdown ? now + INTRO_MS + COUNTDOWN_MS : now;
    this.progress = newProgress(gridS, lapLength);
    clockAt(now, this.startAt, this.clock);
  }

  /** Before the lights go green: the car is held on the grid */
  get held(): boolean {
    return this.clock.phase !== 'racing';
  }

  get finished(): boolean {
    return this.progress.finished;
  }

  /** One physics step at time `now` (ms) with the car at track position `s` */
  step(now: number, s: number, dt: number, speed: number, alignment: number, maxSpeed: number): ProgressEvent {
    clockAt(now, this.startAt, this.clock);
    return stepProgress(this.progress, {
      s, lapLength: this.lapLength, laps: this.setup.laps > 0 ? this.setup.laps : Infinity, dt,
      time: this.clock.raceTime, speed, alignment, maxSpeed, racing: this.clock.phase === 'racing',
    }, this.event);
  }

  respawnAt(s: number): void {
    resetTo(this.progress, s, this.lapLength);
  }
}
