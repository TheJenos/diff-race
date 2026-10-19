import { actionFor, type Action } from '../settings';
import { neutralInput, type CarInput } from './carInput';

/*
 * Keys held right now, as a CarInput. Keys are tracked by KeyboardEvent.code and mapped through
 * the bindings when read, so rebinding mid-race just works. Released on blur, so alt-tabbing out
 * never leaves the throttle stuck down.
 */

export class Keyboard {
  private readonly held = new Set<string>();
  /** Presses since the last read, for one-shot actions (respawn) */
  private readonly pressed = new Set<Action>();
  readonly input: CarInput = neutralInput();

  constructor(signal: AbortSignal, private readonly enabled: () => boolean) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled() || e.repeat) {
        if (this.enabled() && actionFor(e.code)) e.preventDefault();
        return;
      }
      const action = actionFor(e.code);
      if (!action) return;
      e.preventDefault();
      this.held.add(e.code);
      this.pressed.add(action);
    }, { signal });
    window.addEventListener('keyup', (e) => { this.held.delete(e.code); }, { signal });
    window.addEventListener('blur', () => this.held.clear(), { signal });
  }

  private down(action: Action): boolean {
    for (const code of this.held) if (actionFor(code) === action) return true;
    return false;
  }

  /** Whether `action` was pressed since the last call (clears it) */
  take(action: Action): boolean {
    return this.pressed.delete(action);
  }

  /** The keys as an input (pedals and steering are all-or-nothing on keys) */
  read(): CarInput {
    const i = this.input;
    i.throttle = this.down('throttle') ? 1 : 0;
    i.brake = this.down('brake') ? 1 : 0;
    i.steer = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    i.handbrake = this.down('handbrake');
    i.nitro = this.down('nitro');
    i.fire = this.down('fire');
    i.lookBack = this.down('lookBack');
    i.missile = this.take('missile');
    i.defence = this.take('defence');
    i.respawn = this.take('respawn');
    return i;
  }

  clear(): void {
    this.held.clear();
    this.pressed.clear();
  }
}
