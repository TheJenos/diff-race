import * as THREE from 'three';
import type { Racer } from './racer';

/*
 * The wreck replay: every car's drawn pose is kept for the last few seconds, and when the player
 * is wrecked those seconds play back in slow motion with the camera circling the wreck. The race
 * goes on underneath (in a room it has to); only the drawing is borrowed.
 */

/** Seconds of history kept, replayed, and how fast the replay runs */
const KEEP = 4;
const REPLAY = 2.6;
const SPEED = 0.85;
/** Floats per car per frame: position, rotation, visible, turret yaw and pitch */
const STRIDE = 10;

interface Frame {
  t: number;
  data: Float32Array;
}

export class Replay {
  private readonly frames: Frame[] = [];
  private playing = false;
  private clock = 0;
  private end = 0;
  private focus = 0;
  private angle = 0;
  /** The racer list's order, fixed when recording started */
  private order: Racer[] = [];
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();

  get active(): boolean {
    return this.playing;
  }

  /** After the live poses are drawn: remember them */
  record(t: number, racers: readonly Racer[]): void {
    if (this.playing) return;
    if (racers.length !== this.order.length) {
      this.order = [...racers];
      this.frames.length = 0;
    }
    const data = new Float32Array(this.order.length * STRIDE);
    this.order.forEach((r, i) => {
      const g = r.car.view.group;
      data.set([g.position.x, g.position.y, g.position.z, g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w,
        g.visible ? 1 : 0, r.car.view.turret.rotation.y, r.car.view.guns.rotation.x], i * STRIDE);
    });
    this.frames.push({ t, data });
    while (this.frames.length > 2 && t - this.frames[0]!.t > KEEP) this.frames.shift();
  }

  /** Replay the moments up to now, circling `focus` */
  start(now: number, focus: Racer): boolean {
    const i = this.order.indexOf(focus);
    if (i < 0 || this.frames.length < 10) return false;
    this.playing = true;
    this.focus = i;
    this.end = now;
    this.clock = Math.max(this.frames[0]!.t, now - REPLAY);
    this.angle = Math.random() * Math.PI * 2;
    return true;
  }

  stop(): void {
    this.playing = false;
  }

  /**
   * Advance by `dt` and pose every car (and the camera) from history. Returns false once the
   * replay has caught up with the moment of the wreck.
   */
  apply(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (!this.playing) return false;
    this.clock += dt * SPEED;
    if (this.clock >= this.end) {
      this.playing = false;
      return false;
    }
    let k = 1;
    while (k < this.frames.length - 1 && this.frames[k]!.t < this.clock) k++;
    const a = this.frames[k - 1]!;
    const b = this.frames[k]!;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (this.clock - a.t) / (b.t - a.t))) : 0;
    this.order.forEach((r, i) => {
      const o = i * STRIDE;
      const g = r.car.view.group;
      const lerp = (j: number) => (a.data[o + j] as number) + ((b.data[o + j] as number) - (a.data[o + j] as number)) * f;
      g.position.set(lerp(0), lerp(1), lerp(2));
      this.q1.set(a.data[o + 3]!, a.data[o + 4]!, a.data[o + 5]!, a.data[o + 6]!);
      this.q2.set(b.data[o + 3]!, b.data[o + 4]!, b.data[o + 5]!, b.data[o + 6]!);
      g.quaternion.slerpQuaternions(this.q1, this.q2, f);
      g.visible = (f < 0.5 ? a.data[o + 7] : b.data[o + 7]) === 1;
      r.car.view.turret.rotation.y = lerp(8);
      r.car.view.guns.rotation.x = lerp(9);
    });
    // The camera circles the wreck, low and slow.
    const g = this.order[this.focus]!.car.view.group;
    this.angle += dt * 0.5;
    camera.position.set(g.position.x + Math.cos(this.angle) * 9, g.position.y + 3.2, g.position.z + Math.sin(this.angle) * 9);
    camera.lookAt(g.position.x, g.position.y + 0.6, g.position.z);
    return true;
  }
}
