import { settings } from '../settings';
import { mergeInputs, neutralInput, type CarInput } from './carInput';
import { GamepadInput } from './gamepad';
import { Keyboard } from './keyboard';
import { TouchInput } from './touch';

/*
 * Every input source (keyboard, gamepad, touch), read once per frame into one CarInput. The mouse
 * plays no part in a race. There's no aiming: the turret aims itself (game.ts), and the player
 * drives and pulls the triggers.
 */

export class InputRouter {
  readonly keyboard: Keyboard;
  readonly gamepad = new GamepadInput();
  readonly touch = new TouchInput();
  readonly input: CarInput = neutralInput();
  pause = false;
  /** Held by the e2e tests (game.test.hold) */
  test: CarInput = neutralInput();

  constructor(signal: AbortSignal, enabled: () => boolean) {
    this.keyboard = new Keyboard(signal, enabled);
  }

  read(): CarInput {
    const keys = this.keyboard.read();
    const pad = this.gamepad.read(settings.get().deadzone);
    const touch = this.touch.read();
    mergeInputs([keys, pad, touch, this.test], this.input);
    this.pause = this.gamepad.pause;
    return this.input;
  }

  clear(): void {
    this.keyboard.clear();
    this.touch.clear();
  }
}
