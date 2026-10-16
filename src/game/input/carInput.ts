/*
 * What a driver asks of their car this step, from any source: keys, a gamepad, touch, a bot, a
 * test. The car only ever reads this, so bots and tests drive exactly what players drive. Pure.
 */

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1: brake while moving forward, reverse once stopped */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
  /** Turret: machine gun held, missile and rear defence pressed this step */
  fire: boolean;
  missile: boolean;
  defence: boolean;
  lookBack: boolean;
  /** Asked to be put back on the track */
  respawn: boolean;
}

export const NEUTRAL: Readonly<CarInput> = Object.freeze({
  throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false,
  fire: false, missile: false, defence: false, lookBack: false, respawn: false,
});

export const neutralInput = (): CarInput => ({ ...NEUTRAL });

/**
 * Several sources into one: the strongest steer wins (so a keyboard tap can't cancel a stick),
 * pedals add up (capped), buttons are pressed if any source presses them.
 */
export function mergeInputs(inputs: readonly CarInput[], out: CarInput): CarInput {
  let steer = 0;
  let throttle = 0;
  let brake = 0;
  out.handbrake = out.nitro = out.fire = out.missile = out.defence = out.lookBack = out.respawn = false;
  for (const i of inputs) {
    if (Math.abs(i.steer) > Math.abs(steer)) steer = i.steer;
    throttle += i.throttle;
    brake += i.brake;
    out.handbrake ||= i.handbrake;
    out.nitro ||= i.nitro;
    out.fire ||= i.fire;
    out.missile ||= i.missile;
    out.defence ||= i.defence;
    out.lookBack ||= i.lookBack;
    out.respawn ||= i.respawn;
  }
  out.steer = Math.max(-1, Math.min(1, steer));
  out.throttle = Math.min(1, throttle);
  out.brake = Math.min(1, brake);
  return out;
}
