import { IN_DISCORD } from '../../discord/patch';

/*
 * The mouse aims the turret (and orbits the camera with it). Clicking the race captures the pointer
 * (pointer lock), as in Arena FPS; Esc releases it. Where locking is refused (Discord's iframe,
 * some browsers), aiming falls back to dragging with the right button held.
 *
 * Left button: fire (held). Right button: missile.
 */

/** Radians per pixel at sensitivity 1 */
const RAD_PER_PX = 0.0022;

export class MouseInput {
  aimX = 0;
  aimY = 0;
  fire = false;
  private missile = false;
  locked = false;
  private freeLook = false;
  private dragging = false;

  constructor(private readonly target: HTMLElement, signal: AbortSignal, private readonly enabled: () => boolean, onLock: (locked: boolean) => void) {
    target.addEventListener('mousedown', (e) => {
      if (!this.enabled()) return;
      if (!this.locked && !this.freeLook && e.button === 0) {
        void this.lock();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) {
        this.missile = true;
        if (this.freeLook) this.dragging = true;
      }
    }, { signal });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.dragging = false;
    }, { signal });
    target.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled() || !(this.locked || this.dragging)) return;
      this.aimX += e.movementX * RAD_PER_PX;
      this.aimY += e.movementY * RAD_PER_PX;
    }, { signal });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.fire = false;
      onLock(this.locked);
    }, { signal });
    document.addEventListener('pointerlockerror', () => {
      // Discord (and some embeds) refuse pointer lock: aim by right-dragging instead.
      this.freeLook = true;
    }, { signal });
    if (IN_DISCORD) this.freeLook = false;
  }

  private async lock(): Promise<void> {
    try {
      await (this.target.requestPointerLock as (o?: object) => Promise<void> | void).call(this.target, { unadjustedMovement: true });
    } catch {
      try {
        await (this.target.requestPointerLock as () => Promise<void> | void).call(this.target);
      } catch {
        this.freeLook = true;
      }
    }
  }

  unlock(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  /** Aim since the last read (rad, before sensitivity), and whether a missile was asked for */
  take(): { aimX: number; aimY: number; missile: boolean } {
    const out = { aimX: this.aimX, aimY: this.aimY, missile: this.missile };
    this.aimX = this.aimY = 0;
    this.missile = false;
    return out;
  }
}
