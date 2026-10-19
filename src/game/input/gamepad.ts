import { neutralInput, type CarInput } from './carInput';
import { curve, radialDeadzone, trigger } from './stick';

/*
 * The first connected gamepad with the standard mapping, polled once per frame:
 *
 *   left stick: steer      RT / LT: accelerate / brake      A: handbrake     B or L3: nitro
 *   RB: fire               LB: missile                      X: rear defence  (the turret aims itself)
 *   Y: look back           Back: respawn                    Start: pause
 *
 * Inside Discord's iframe the Gamepad API may be blocked by the permissions policy; reading it
 * then throws, and gamepads are simply off.
 */

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

export class GamepadInput {
  readonly input: CarInput = neutralInput();
  /** Start pressed this frame */
  pause = false;
  connected = false;
  private blocked = false;
  private prev = new Set<number>();
  private pad: Gamepad | null = null;

  read(deadzone: number): CarInput {
    const i = this.input;
    Object.assign(i, neutralInput());
    this.pause = false;
    const pad = this.poll();
    this.pad = pad;
    this.connected = !!pad;
    if (!pad) return i;
    const pressed = (b: number) => !!pad.buttons[b]?.pressed;
    const value = (b: number) => pad.buttons[b]?.value ?? 0;
    const edge = (b: number) => pressed(b) && !this.prev.has(b);
    const [sx] = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, deadzone);
    let steer = curve(sx, 1.6);
    if (pressed(B.LEFT)) steer = -1;
    if (pressed(B.RIGHT)) steer = 1;
    i.steer = steer;
    i.throttle = Math.max(trigger(value(B.RT)), pressed(B.UP) ? 1 : 0);
    i.brake = Math.max(trigger(value(B.LT)), pressed(B.DOWN) ? 1 : 0);
    i.handbrake = pressed(B.A);
    i.nitro = pressed(B.B) || pressed(B.L3);
    i.fire = pressed(B.RB);
    i.missile = edge(B.LB);
    i.defence = edge(B.X);
    i.lookBack = pressed(B.Y);
    i.respawn = edge(B.BACK);
    this.pause = edge(B.START);
    this.prev = new Set(pad.buttons.map((b, k) => (b.pressed ? k : -1)).filter((k) => k >= 0));
    return i;
  }

  /** A rumble, if the pad can (0..1 strength, milliseconds) */
  rumble(strength: number, ms: number): void {
    const act = (this.pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 })?.catch(() => {});
  }

  private poll(): Gamepad | null {
    if (this.blocked || typeof navigator.getGamepads !== 'function') return null;
    try {
      for (const p of navigator.getGamepads()) if (p && p.connected && p.mapping === 'standard') return p;
      for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    } catch {
      this.blocked = true;
    }
    return null;
  }
}
