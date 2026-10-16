import { loadPhysics, PhysicsWorld, PHYSICS_STEP } from '../../physics';
import { CarBody } from '../../car/carBody';
import { CAR } from '../../car/params';
import { buildTrackPhysics } from '../../world/trackPhysics';
import { generate } from '../../track/generate';
import type { TrackSpec } from '../../track/spec';
import { locate, newLocation } from '../../track/locate';
import { outOfBounds, surfaceAt } from '../../track/surface';
import { placeOnTrack } from '../../race/placement';
import { newProgress, resetTo, stepProgress } from '../../race/progress';
import { frameAt, newFrame } from '../../track/sample';
import { basis } from '../../math/vec3';
import { drive, newDriverState } from '../driver';
import { carProfile } from '../speedProfile';
import { SKILLS, type BotSkill } from '../skills';
import { laneOffset, type Rival } from '../tactics';
import { neutralInput } from '../../input/carInput';
import { Rng } from '../../track/rng';

/*
 * A race with no screen: bots on a generated track, on the real physics (Rapier's Node build) and
 * the real driving code, as fast as the CPU goes. No weapons: this checks the driving. Used by
 * `npm run sim:bots` (many seeds, in CI) and a quick unit test.
 */

export interface SimOptions {
  spec: TrackSpec;
  laps: number;
  bots: readonly BotSkill[];
  /** Give up after this much race time (s) */
  maxTime?: number;
  /** Share of cornering grip the bots dare use (tuning) */
  grip?: number;
  /** Diagnostics: called when a car has sat still a while */
  onStill?: (info: { skill: BotSkill; s: number; u: number; y: number; time: number; throttle: number; steer: number; grounded: number }) => void;
  /** Diagnostics: called on every respawn, with why */
  onRespawn?: (info: { skill: BotSkill; s: number; u: number; why: string; time: number }) => void;
}

export interface SimCar {
  skill: BotSkill;
  /** Finish time (s), null: didn't finish */
  time: number | null;
  respawns: number;
  /** Longest it sat still (s) */
  stuck: number;
}

export interface SimResult {
  cars: SimCar[];
  /** The track's lap length (m) and the profile's ideal lap (s) */
  lapLength: number;
  idealLap: number;
  /** Wall-clock milliseconds the sim took */
  ms: number;
}

const THINK_EVERY = 4; // steps: 30 Hz at 120 Hz physics

export async function simulate(o: SimOptions): Promise<SimResult> {
  const t0 = performance.now();
  // Seeded, so a run is the same every time (Rapier is deterministic on one machine too).
  const rng = new Rng(`sim/${o.spec.seed}/${o.bots.join(',')}`);
  await loadPhysics();
  const track = generate(o.spec);
  const physics = new PhysicsWorld();
  buildTrackPhysics(physics, track);
  const profile = carProfile(track, CAR, o.grip);
  let ideal = 0;
  for (let i = 0; i < track.n; i++) ideal += track.ds / Math.max(1, profile[i] as number);
  const frame = newFrame();
  const cars = o.bots.map((skill, k) => {
    const body = new CarBody(physics);
    const g = track.grid[k % track.grid.length]!;
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    placeOnTrack(track, g.s, g.u, pos, rot);
    body.place(pos, rot);
    const loc = newLocation();
    locate(track, pos, -1, loc);
    const wheel = newLocation();
    body.surfaceAt = (x, y, z) => surfaceAt(track, locate(track, { x, y, z }, loc.i, wheel));
    const progress = newProgress(track.lapLength + g.s, track.lapLength);
    progress.D = g.s;
    progress.maxD = g.s;
    return {
      skill, body, loc, progress, driver: newDriverState(), input: neutralInput(), roll: rng.next(),
      result: { skill, time: null as number | null, respawns: 0, stuck: 0 }, still: 0,
    };
  });
  physics.world.step();
  const maxTime = o.maxTime ?? Math.max(120, ideal * o.laps * 2.2);
  const event = {};
  const fwd = { x: 0, y: 0, z: 0 };
  const right = { x: 0, y: 0, z: 0 };
  let step = 0;
  for (let time = 0; time < maxTime; time += PHYSICS_STEP, step++) {
    if (cars.every((c) => c.progress.finished)) break;
    for (const c of cars) {
      if (c.progress.finished) {
        c.input = { ...neutralInput(), brake: 0.3 };
      } else if (step % THINK_EVERY === 0) {
        const t = c.body.body.translation();
        basis(c.body.body.rotation(), right, { x: 0, y: 0, z: 0 }, fwd);
        const rivals: Rival[] = cars.filter((x) => x !== c).map((x) => ({
          dD: x.progress.D - c.progress.D, du: x.loc.u - c.loc.u, speed: x.body.speed, armour: 150,
        }));
        const skill = SKILLS[c.skill];
        const offset = laneOffset({ s: c.loc.s, u: c.loc.u, line: track.line[c.loc.i] as number, speed: c.body.speed, armour: 150, wantsSword: false, wantsShield: false },
          rivals, [], track.lapLength, skill, c.roll);
        c.input = drive(track, profile, {
          x: t.x, z: t.z, fx: fwd.x, fz: fwd.z, rx: right.x, rz: right.z, speed: c.body.speed, s: c.loc.s, u: c.loc.u, nitro: c.body.nitro,
        }, c.driver, skill, offset, skill.pace, PHYSICS_STEP * THINK_EVERY, rng.next(), c.input);
      }
      c.body.fixed(c.input, PHYSICS_STEP);
    }
    physics.world.step();
    for (const c of cars) {
      if (c.progress.finished) continue;
      const t = c.body.body.translation();
      locate(track, t, c.loc.i, c.loc);
      c.still = Math.abs(c.body.speed) < 1 ? c.still + PHYSICS_STEP : 0;
      if (o.onStill && c.still > 1 && c.still < 1 + PHYSICS_STEP) {
        o.onStill({ skill: c.skill, s: c.loc.s, u: c.loc.u, y: t.y, time, throttle: c.input.throttle, steer: c.input.steer, grounded: c.body.grounded });
      }
      c.result.stuck = Math.max(c.result.stuck, c.still);
      if (t.y < track.killY || outOfBounds(track, c.loc) || c.body.flipped || c.progress.lostFor > 1.5 || c.driver.wantsRespawn) {
        o.onRespawn?.({
          skill: c.skill, s: c.loc.s, u: c.loc.u, time,
          why: t.y < track.killY ? 'fell' : outOfBounds(track, c.loc) ? 'out' : c.body.flipped ? 'flipped' : c.progress.lostFor > 1.5 ? 'lost' : c.driver.backwardFor === 0 && c.driver.escapes === 0 ? 'driver' : 'stuck',
        });
        c.driver.wantsRespawn = false;
        const pos = { x: 0, y: 0, z: 0 };
        const rot = { x: 0, y: 0, z: 0, w: 1 };
        placeOnTrack(track, c.loc.s - 15, 0, pos, rot);
        c.body.place(pos, rot);
        locate(track, pos, -1, c.loc);
        resetTo(c.progress, c.loc.s, track.lapLength);
        c.result.respawns++;
        c.still = 0;
        continue;
      }
      frameAt(track, c.loc.s, frame);
      basis(c.body.body.rotation(), right, { x: 0, y: 0, z: 0 }, fwd);
      stepProgress(c.progress, {
        s: c.loc.s, lapLength: track.lapLength, laps: o.laps, dt: PHYSICS_STEP, time: time + PHYSICS_STEP,
        speed: c.body.speed, alignment: fwd.x * frame.fwd.x + fwd.y * frame.fwd.y + fwd.z * frame.fwd.z, maxSpeed: 80, racing: true,
      }, event);
      if (c.progress.finished) c.result.time = c.progress.finishTime;
    }
  }
  physics.dispose();
  return { cars: cars.map((c) => c.result), lapLength: track.lapLength, idealLap: ideal, ms: performance.now() - t0 };
}
