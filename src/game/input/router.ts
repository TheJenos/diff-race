import { settings } from '../settings';
import { mergeInputs, neutralInput, type CarInput } from './carInput';
import { GamepadInput } from './gamepad';
import { Keyboard } from './keyboard';
import { MouseInput } from './mouse';
import { TouchInput } from './touch';

/*
 * Every input source, read once per frame into one CarInput plus the frame's aim (camera and
 * turret, radians). Remembers which device was used last, for the HUD's button hints.
 */

export type Device = 'keyboard' | 'gamepad' | 'touch';

export class InputRouter {
  readonly keyboard: Keyboard;
  readonly gamepad = new GamepadInput();
  readonly touch = new TouchInput();
  readonly mouse: MouseInput;
  readonly input: CarInput = neutralInput();
  aimX = 0;
  aimY = 0;
  /** Whether the player aimed this frame (the camera recentres after a while without) */
  aimed = false;
  pause = false;
  lastDevice: Device = 'keyboard';
  /** Held by the e2e tests (game.test.hold) */
  test: CarInput = neutralInput();

  constructor(canvas: HTMLElement, signal: AbortSignal, enabled: () => boolean, onLock: (locked: boolean) => void) {
    this.keyboard = new Keyboard(signal, enabled);
    this.mouse = new MouseInput(canvas, signal, enabled, onLock);
  }

  read(dt: number): CarInput {
    const s = settings.get();
    const keys = this.keyboard.read();
    const pad = this.gamepad.read(dt, s.deadzone);
    const touch = this.touch.read();
    const mouse = this.mouse.take();
    keys.fire = this.mouse.fire;
    keys.missile ||= mouse.missile;
    mergeInputs([keys, pad, touch.input, this.test], this.input);
    const invert = s.invertY ? -1 : 1;
    const g = this.gamepad;
    this.aimX = (mouse.aimX + touch.aimX + g.aimX) * s.sensitivity;
    this.aimY = (mouse.aimY + touch.aimY + g.aimY) * s.sensitivity * invert;
    this.aimed = this.aimX !== 0 || this.aimY !== 0;
    this.pause = this.gamepad.pause;
    if (pad.throttle || pad.brake || pad.steer || g.aimX) this.lastDevice = 'gamepad';
    else if (keys.throttle || keys.brake || keys.steer) this.lastDevice = 'keyboard';
    else if (this.touch.active) this.lastDevice = 'touch';
    return this.input;
  }

  clear(): void {
    this.keyboard.clear();
    this.touch.clear();
    this.mouse.fire = false;
  }
}
