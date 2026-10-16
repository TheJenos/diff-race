import { neutralInput, type CarInput } from './carInput';

/*
 * Touch controls' state: TouchControls.tsx (React, pointer events) writes it, the game reads it
 * each frame like any other input source. Look drags accumulate until read.
 */

export class TouchInput {
  readonly input: CarInput = neutralInput();
  /** Accelerate on its own unless braking (the setting; default on for touch) */
  autoAccelerate = true;
  active = false;
  private lookX = 0;
  private lookY = 0;
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
  /** A look drag (rad) */
  look(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  /** This frame's input, and the look drag since the last read */
  read(): { input: CarInput; aimX: number; aimY: number } {
    const i = this.input;
    const out = {
      input: {
        ...i,
        throttle: this.active && this.autoAccelerate && i.brake <= 0 ? 1 : i.throttle,
        respawn: this.respawnAsked,
      },
      aimX: this.lookX,
      aimY: this.lookY,
    };
    this.lookX = this.lookY = 0;
    this.respawnAsked = false;
    i.missile = false;
    i.defence = false;
    return out;
  }

  clear(): void {
    Object.assign(this.input, neutralInput());
    this.lookX = this.lookY = 0;
  }
}
