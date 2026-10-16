import { neutralInput, type CarInput } from '../input/carInput';
import { frameAt, newFrame } from '../track/sample';
import type { TrackData } from '../track/types';
import type { SkillParams } from './skills';

/*
 * A bot's driving: pure pursuit along the racing line (steer for a point some way ahead, further
 * the faster it goes), throttle and brakes from the speed profile, an offset across the road for
 * passing, pads and wobble, and getting itself unstuck. Pure: it reads a snapshot of the car and
 * writes a CarInput, exactly what a player's keys would.
 */

export interface DriverView {
  x: number; z: number;
  /** Forward and right (unit, world) */
  fx: number; fz: number;
  rx: number; rz: number;
  /** Forward speed (m/s) */
  speed: number;
  /** Track position */
  s: number;
  u: number;
  /** Nitro left (s) */
  nitro: number;
}

/** The driving's own numbers (tuned with the headless sim) */
export const DRIVER = {
  /** Look-ahead (m): base + per m/s of speed, within min..max, shortened in tight bends */
  lookBase: 4,
  lookPerSpeed: 0.55,
  lookMin: 7,
  lookMax: 24,
  /** Steering per radian of angle to the target */
  steerGain: 2.2,
  /** Speed margins (m/s) before full throttle / braking, and braking per m/s over */
  under: 1.5,
  over: 2,
  brakePer: 6,
  /** Deceleration (m/s²) it plans its braking around */
  decel: 11,
};

export interface DriverState {
  /** Seconds slow while trying to go */
  stuckFor: number;
  /** Times it has backed out without getting going again */
  escapes: number;
  /** Seconds going properly (resets the escape count) */
  movingFor: number;
  /** Seconds left of backing out */
  reverseFor: number;
  /** Wanders across the line (m), changing slowly */
  wobble: number;
  wobbleTarget: number;
  /** Seconds spun round, facing back down the track */
  backwardFor: number;
  /** Asks the game to respawn it */
  wantsRespawn: boolean;
}

export const newDriverState = (): DriverState => ({ stuckFor: 0, escapes: 0, movingFor: 0, reverseFor: 0, wobble: 0, wobbleTarget: 0, backwardFor: 0, wantsRespawn: false });

const frame = newFrame();

/**
 * One decision. `offset`: metres right of the racing line it wants to be (passing, a pad);
 * `pace`: speed multiplier (skill × rubber band); `rand`: a 0..1 random number.
 */
export function drive(
  t: TrackData, profile: Float32Array, v: DriverView, st: DriverState, skill: SkillParams,
  offset: number, pace: number, dt: number, rand: number, out: CarInput = neutralInput(),
): CarInput {
  Object.assign(out, neutralInput());
  // Wobble: a new random target now and then, eased toward.
  if (rand < dt * 0.4) st.wobbleTarget = (rand / (dt * 0.4) - 0.5) * 2 * skill.lineError;
  st.wobble += (st.wobbleTarget - st.wobble) * Math.min(1, dt * 0.8);

  const D = DRIVER;
  // Spun round: a three-point turn costs more than a respawn, so ask for one.
  frameAt(t, v.s, frame);
  const facing = v.fx * frame.fwd.x + v.fz * frame.fwd.z;
  st.backwardFor = facing < -0.2 && Math.abs(v.speed) < 12 ? st.backwardFor + dt : 0;
  if (st.backwardFor > 1.5) {
    st.backwardFor = 0;
    st.wantsRespawn = true;
  }
  // Look less far ahead into a tight bend, or the chord to the target cuts across the inside.
  const bend = Math.abs(t.curvature[Math.floor((v.s + 10) / t.ds) % t.n] as number);
  const look = Math.max(D.lookMin, Math.min(D.lookMax, D.lookBase + D.lookPerSpeed * Math.abs(v.speed)) * (1 - Math.min(0.5, bend * 12)));
  frameAt(t, v.s + look, frame);
  const hw = frame.halfWidth - 2;
  const u = Math.max(-hw, Math.min(hw, frame.line + offset + st.wobble));
  const tx = frame.pos.x + frame.right.x * u - v.x;
  const tz = frame.pos.z + frame.right.z * u - v.z;
  const lx = tx * v.rx + tz * v.rz;
  const lz = tx * v.fx + tz * v.fz;
  const angle = Math.atan2(lx, Math.max(0.1, lz));
  out.steer = Math.max(-1, Math.min(1, angle * D.steerGain));

  // Speed: what the profile allows here, times pace, and whether something further ahead needs
  // braking for already: the deceleration it would take to get down to each slower point in time.
  const sp = v.speed;
  const here = Math.floor((v.s + 4) / t.ds) % t.n;
  let want = (profile[here] as number) * pace;
  let need = 0;
  const reach = (sp * sp) / (2 * D.decel) + 15;
  for (let d = 6; d < reach; d += 4) {
    const p = (profile[Math.floor((v.s + d) / t.ds) % t.n] as number) * pace;
    if (p < sp) need = Math.max(need, (sp * sp - p * p) / (2 * d));
  }
  if (need > D.decel * 0.75) {
    out.brake = Math.min(1, (need - D.decel * 0.6) / (D.decel * 0.5));
    want = Math.min(want, sp - 1);
  } else if (sp < want - D.under) out.throttle = 1;
  else if (sp > want + D.over) out.brake = Math.min(1, (sp - want) / D.brakePer);
  else out.throttle = 0.45;
  // Steering hard at speed: lift.
  if (Math.abs(out.steer) > 0.85 && sp > want * 0.9) out.throttle *= 0.5;

  // Nitro on a long straight with the tank to spare: nothing in the next 150 m needs braking for.
  if (v.nitro > 1.5 && Math.abs(angle) < 0.08 && need === 0 && out.throttle === 1 && rand > 1 - skill.nitro) {
    let clear = true;
    for (let d = 20; d < 150 && clear; d += 10) if ((profile[Math.floor((v.s + d) / t.ds) % t.n] as number) * pace < sp + 6) clear = false;
    out.nitro = clear;
  }

  // Unsticking: crawling while trying to go means something's in the way.
  if (st.reverseFor > 0) {
    st.reverseFor -= dt;
    out.throttle = 0;
    out.brake = 1;
    out.steer = -out.steer;
    out.nitro = false;
    return out;
  }
  if (out.throttle > 0 && Math.abs(sp) < 2) st.stuckFor += dt;
  else st.stuckFor = Math.max(0, st.stuckFor - dt * 2);
  st.movingFor = Math.abs(sp) > 8 ? st.movingFor + dt : 0;
  if (st.movingFor > 2) st.escapes = 0;
  if (st.stuckFor > 1.2) {
    // Back out (steering the other way); after two tries that didn't take, give up and respawn.
    st.stuckFor = 0;
    st.escapes++;
    if (st.escapes > 2) {
      st.escapes = 0;
      st.wantsRespawn = true;
    } else {
      st.reverseFor = 1.1;
    }
  }
  return out;
}
