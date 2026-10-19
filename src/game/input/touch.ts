import { neutralInput, type CarInput } from './carInput';

/*
 * Touch controls' state: TouchControls.tsx (React, pointer events) writes it, the game reads it
 * each frame like any other input source.
 */

export class TouchInput {
  readonly input: CarInput = neutralInput();
  /** Accelerate on its own unless braking (the setting; default on for touch) */
  autoAccelerate = true;
  active = false;
  private respawnAsked = false;

  setSteer(v: number): void { this.input.steer = Math.max(-1, Math.min(1, v)); this.active = true; }
  setBrake(on: boolean): void { this.input.brake = on ? 1 : 0; this.active = true; }
  setThrottle(on: boolean): void { this.input.throttle = on ? 1 : 0; this.active = true; }
  setHandbrake(on: boolean): void { this.input.handbrake = on; }
  setNitro(on: boolean): void { this.input.nitro = on; }
  setFire(on: boolean): void { this.input.fire = on; }
  setLookBack(on: boolean): void { this.input.lookBack = on; }
  tapMissile(): void { this.input.missile = true; }
  tapDefence(): void { this.input.defence = true; }
  tapRespawn(): void { this.respawnAsked = true; }
  /** This frame's input */
  read(): CarInput {
    const i = this.input;
    const out = {
      ...i,
      throttle: this.active && this.autoAccelerate && i.brake <= 0 ? 1 : i.throttle,
      respawn: this.respawnAsked,
    };
    this.respawnAsked = false;
    i.missile = false;
    i.defence = false;
    return out;
  }

  clear(): void {
    Object.assign(this.input, neutralInput());
  }
}
