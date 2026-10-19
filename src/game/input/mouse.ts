/*
 * The mouse's buttons over the race. The turret aims itself (auto aim, game.ts), so the mouse
 * only fires: left button the machine gun (held), right button a missile.
 */

export class MouseInput {
  fire = false;
  private missile = false;

  constructor(target: HTMLElement, signal: AbortSignal, private readonly enabled: () => boolean) {
    target.addEventListener('mousedown', (e) => {
      if (!this.enabled()) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.missile = true;
    }, { signal });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
    }, { signal });
    window.addEventListener('blur', () => { this.fire = false; }, { signal });
    target.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }

  /** Whether a missile was asked for since the last read */
  take(): boolean {
    const out = this.missile;
    this.missile = false;
    return out;
  }
}
