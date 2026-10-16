import type { V3 } from '../math/vec3';

/*
 * The chase camera's motion, without three.js: a point behind and above the car that follows it
 * on springs. It swings round toward where the car is going (velocity), not just where it points,
 * so slides read on screen. Aim offsets (the turret's free look) orbit it round the car. Pure.
 */

export interface ChaseParams {
  /** Behind the car and above it (m) */
  distance: number;
  height: number;
  /** The look point: ahead of the car and above its centre (m) */
  lookAhead: number;
  lookHeight: number;
  /** How quickly the camera's heading follows the car's (1/s) */
  yawRate: number;
  /** How quickly the position catches up across and up/down (1/s) */
  follow: number;
  followUp: number;
  /** Field of view (deg) at rest; extra at top speed and on nitro */
  fov: number;
  fovSpeed: number;
  fovNitro: number;
}

export const CHASE: ChaseParams = {
  distance: 7.2, height: 2.6, lookAhead: 4, lookHeight: 1.1,
  yawRate: 5, follow: 9, followUp: 12,
  fov: 72, fovSpeed: 6, fovNitro: 9,
};

export interface ChaseTarget {
  pos: V3;
  /** The car's forward (unit) */
  fwd: V3;
  vel: V3;
  /** 0..1 of top speed */
  speedRatio: number;
  nitro: boolean;
  lookBack: boolean;
}

export class ChaseCamera {
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  readonly look: V3 = { x: 0, y: 0, z: 0 };
  fov = CHASE.fov;
  /** Camera heading (rad, 0 = looking along -z), and the aim offsets the player adds */
  private yaw = 0;
  aimYaw = 0;
  aimPitch = 0;
  private ready = false;
  private nitroEase = 0;

  constructor(private readonly p: ChaseParams = CHASE) {}

  /** Jump straight to the resting spot behind `t` (spawns, respawns) */
  snap(t: ChaseTarget): void {
    this.ready = false;
    this.update(t, 0);
  }

  update(t: ChaseTarget, dt: number): void {
    const p = this.p;
    // Heading toward the velocity when moving, else the car's nose; blended so slides show.
    const sp = Math.hypot(t.vel.x, t.vel.z);
    const carYaw = Math.atan2(-t.fwd.x, -t.fwd.z);
    const velYaw = sp > 3 ? Math.atan2(-t.vel.x, -t.vel.z) : carYaw;
    const forward = Math.cos(velYaw - carYaw) > 0;
    const target = (forward ? blendAngle(carYaw, velYaw, 0.45) : carYaw) + (t.lookBack ? Math.PI : 0) + this.aimYaw;
    if (!this.ready) this.yaw = target;
    else this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-p.yawRate * dt));

    const pitch = this.aimPitch;
    const back = p.distance * Math.cos(pitch);
    const lift = p.height + p.distance * Math.sin(pitch);
    const dx = -Math.sin(this.yaw);
    const dz = -Math.cos(this.yaw);
    const wantX = t.pos.x - dx * back;
    const wantY = t.pos.y + lift;
    const wantZ = t.pos.z - dz * back;
    if (!this.ready) {
      this.pos.x = wantX;
      this.pos.y = wantY;
      this.pos.z = wantZ;
      this.ready = true;
    } else {
      const k = 1 - Math.exp(-p.follow * dt);
      const ku = 1 - Math.exp(-p.followUp * dt);
      this.pos.x += (wantX - this.pos.x) * k;
      this.pos.y += (wantY - this.pos.y) * ku;
      this.pos.z += (wantZ - this.pos.z) * k;
    }
    this.look.x = t.pos.x + dx * p.lookAhead;
    this.look.y = t.pos.y + p.lookHeight;
    this.look.z = t.pos.z + dz * p.lookAhead;
    this.nitroEase += ((t.nitro ? 1 : 0) - this.nitroEase) * (1 - Math.exp(-4 * dt));
    this.fov = p.fov + p.fovSpeed * t.speedRatio + p.fovNitro * this.nitroEase;
  }
}

/** a + shortest turn toward b, times k */
export function blendAngle(a: number, b: number, k: number): number {
  return a + wrapAngle(b - a) * k;
}

/** An angle into (-π, π] */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}
