import { GROUP, groups, type PhysicsWorld, type RapierBody, type RapierCollider, type RayHit } from '../physics';
import type { CarInput } from '../input/carInput';
import { basis, cross, dot, normalize, rotate, set, type Q4, type V3 } from '../math/vec3';
import { CAR, SURFACE_GRIP, type CarParams, type Surface } from './params';
import { antiRoll, springForce } from './suspension';
import { tyreForces, type TyreOutput } from './tyre';
import { driveForce } from './drivetrain';
import { steerStep } from './steering';

/*
 * A car this client simulates: a Rapier dynamic body (chassis + cabin boxes) held up by four
 * ray-cast wheels. Every fixed step each wheel casts down from its mount, its spring pushes the
 * body up, and its tyre pushes along and across the road (car/tyre.ts). No three.js: the same
 * body runs in Node for the feel tests and the headless bot sim.
 */

export interface WheelState {
  /** Metres squeezed from full extension (0 in the air) */
  compression: number;
  grounded: boolean;
  /** Load on the tyre (N) */
  load: number;
  /** Rolling angle (rad), for drawing */
  spin: number;
  /** 0..1 sliding, for smoke, skids and the screech */
  slide: number;
  surface: Surface;
  /** Where the tyre touches (world), valid while grounded */
  contact: V3;
}

/** What surface is under a point; the game asks the track (track/surface.ts) */
export type SurfaceAt = (x: number, y: number, z: number) => Surface;

const DOWN_RAY_EXTRA = 0.05;
const WHEELBASE = 2.7;
/** Contact forces above this (N) are reported to physics.onContactForce: bumps and crashes */
const CONTACT_REPORT = 12_000;
/** Seconds on its roof or side, too slow to right itself, before the car asks to respawn */
const FLIPPED_RESPAWN = 3;
/** A puppet catches up with its predicted pose over this long (s) */
const FOLLOW = 0.08;

export class CarBody {
  readonly body: RapierBody;
  readonly colliders: RapierCollider[] = [];
  readonly wheels: WheelState[];
  /** Front wheels' angle (rad, + right) */
  steer = 0;
  /** Seconds of nitro in the tank */
  nitro: number;
  nitroActive = false;
  /** Forward speed (m/s, negative reversing) */
  speed = 0;
  /** Wheels on the ground */
  grounded = 0;
  /** Set once the car has been stuck on its roof or side for a while: the game respawns it */
  flipped = false;
  private flippedFor = 0;
  surfaceAt: SurfaceAt = () => 'road';
  /** Handling penalties from damage (car/damage.ts handlingOf) */
  mods = { steer: 1, topSpeed: 1, pull: 0 };
  private readonly member: number;

  private readonly right = { x: 0, y: 0, z: 0 };
  private readonly up = { x: 0, y: 0, z: 0 };
  private readonly fwd = { x: 0, y: 0, z: 0 };
  private readonly hit: RayHit = { toi: 0, nx: 0, ny: 1, nz: 0, collider: 0 };
  private readonly tyre: TyreOutput = { long: 0, lat: 0, slide: 0 };
  private readonly mounts: V3[];
  private readonly normals: V3[];
  /** Per wheel: contact-point velocity at the start of the step, tyre force (N), spring force (N) */
  private readonly pointVel: V3[];
  private readonly pushes: V3[];
  private readonly forces = [0, 0, 0, 0];

  constructor(readonly physics: PhysicsWorld, readonly params: CarParams = CAR, member: number = GROUP.CAR) {
    const { R, world } = physics;
    const p = params;
    const w = p.half.x * 2;
    const h = p.half.y * 2 + p.cabin.y * 2;
    const d = p.half.z * 2;
    const m = p.mass / 12;
    // Inertia of a box this size, with extra in pitch and roll so the car is slow to tip.
    const inertia = { x: m * (h * h + d * d) * p.tipInertia, y: m * (w * w + d * d), z: m * (w * w + h * h) * p.tipInertia };
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(p.mass, { x: 0, y: -p.comDrop, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(0.5)
        .setLinearDamping(0.01),
    );
    this.member = member;
    const collide = groups(member, GROUP.WORLD | GROUP.BARRIER | GROUP.CAR | GROUP.PUPPET | GROUP.DEBRIS);
    const shapes = [
      R.ColliderDesc.cuboid(p.half.x, p.half.y, p.half.z),
      R.ColliderDesc.cuboid(p.cabin.x, p.cabin.y, p.cabin.z).setTranslation(0, p.cabin.cy, p.cabin.cz),
    ];
    for (const desc of shapes) {
      desc.setDensity(0).setFriction(0.35).setRestitution(0.12).setCollisionGroups(collide)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(CONTACT_REPORT);
      this.colliders.push(world.createCollider(desc, this.body));
    }
    this.wheels = p.wheels.map(() => ({ compression: 0, grounded: false, load: 0, spin: 0, slide: 0, surface: 'road', contact: { x: 0, y: 0, z: 0 } }));
    this.mounts = p.wheels.map(() => ({ x: 0, y: 0, z: 0 }));
    this.normals = p.wheels.map(() => ({ x: 0, y: 1, z: 0 }));
    this.pointVel = p.wheels.map(() => ({ x: 0, y: 0, z: 0 }));
    this.pushes = p.wheels.map(() => ({ x: 0, y: 0, z: 0 }));
    this.nitro = p.nitroTank;
  }

  /** Ghosted (just respawned): passes through other cars, still hits the road and barriers */
  setGhost(on: boolean): void {
    const filter = on ? GROUP.WORLD | GROUP.BARRIER : GROUP.WORLD | GROUP.BARRIER | GROUP.CAR | GROUP.PUPPET | GROUP.DEBRIS;
    for (const c of this.colliders) c.setCollisionGroups(groups(on ? GROUP.DEBRIS : this.member, filter));
  }

  /** Out of the world while wrecked (no collisions, no gravity), back in when respawned */
  setActive(on: boolean): void {
    this.body.setEnabled(on);
  }

  /**
   * A stand-in for a car another client simulates: same shape and mass, no gravity, touching only
   * the cars simulated here. Each step `follow` steers it onto the predicted pose, so a local car
   * that hits it exchanges momentum with something of the right weight (an immovable stand-in
   * would bounce local cars off like a wall, and both sides would feel the full push).
   */
  setPuppet(on: boolean): void {
    this.puppet = on;
    this.body.setGravityScale(on ? 0 : 1, true);
    const filter = on ? GROUP.CAR : GROUP.WORLD | GROUP.BARRIER | GROUP.CAR | GROUP.PUPPET | GROUP.DEBRIS;
    for (const c of this.colliders) c.setCollisionGroups(groups(on ? GROUP.PUPPET : GROUP.CAR, filter));
    for (const w of this.wheels) {
      w.grounded = on;
      w.compression = on ? this.params.restLength * 0.45 : 0;
      w.slide = 0;
    }
  }

  puppet = false;

  /** Puppet: velocities that carry the body onto `p` within FOLLOW seconds (or a jump if it's far off) */
  follow(p: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; vx: number; vy: number; vz: number }, dt: number): void {
    const b = this.body;
    const t = b.translation();
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const dz = p.z - t.z;
    if (dx * dx + dy * dy + dz * dz > 36) {
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
      b.setLinvel({ x: p.vx, y: p.vy, z: p.vz }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } else {
      const k = 1 / FOLLOW;
      b.setLinvel({ x: p.vx + dx * k, y: p.vy + dy * k, z: p.vz + dz * k }, true);
      // Rotation error target × current⁻¹, as an axis and angle.
      const q = b.rotation();
      let ex = p.qw * -q.x + p.qx * q.w + p.qy * -q.z - p.qz * -q.y;
      let ey = p.qw * -q.y + p.qy * q.w + p.qz * -q.x - p.qx * -q.z;
      let ez = p.qw * -q.z + p.qz * q.w + p.qx * -q.y - p.qy * -q.x;
      let ew = p.qw * q.w - p.qx * -q.x - p.qy * -q.y - p.qz * -q.z;
      if (ew < 0) { ex = -ex; ey = -ey; ez = -ez; ew = -ew; }
      const sinHalf = Math.hypot(ex, ey, ez);
      const angle = 2 * Math.atan2(sinHalf, ew);
      const s2 = sinHalf > 1e-6 ? (angle * k) / sinHalf : 0;
      b.setAngvel({ x: ex * s2, y: ey * s2, z: ez * s2 }, true);
    }
    const fwd = this.fwd;
    basis(b.rotation(), this.right, this.up, fwd);
    this.speed = p.vx * fwd.x + p.vy * fwd.y + p.vz * fwd.z;
    for (const w of this.wheels) w.spin += (this.speed / this.params.wheelRadius) * dt;
  }

  /** Put the car at `pos` with rotation `rot`, at rest. */
  place(pos: V3, rot: Q4): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation(rot, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.flipped = false;
    this.flippedFor = 0;
    for (const wheel of this.wheels) wheel.compression = 0;
  }

  /** One fixed step of driving: suspension, tyres, engine, aero, air control and self-righting. */
  fixed(input: CarInput, dt: number): void {
    const p = this.params;
    const body = this.body;
    const t = body.translation();
    const q = body.rotation();
    const v = body.linvel();
    const { right, up, fwd } = this;
    basis(q, right, up, fwd);
    const speed = dot(v, fwd);
    this.speed = speed;
    const quarter = p.mass / 4;

    // Damage: a smashed front loses some lock, a smashed side pulls the car over.
    const wanted = Math.max(-1, Math.min(1, input.steer * this.mods.steer + this.mods.pull));
    this.steer = steerStep(this.steer, wanted, speed, dt, p);
    this.nitroActive = input.nitro && this.nitro > 0 && input.throttle > 0;
    this.nitro = this.nitroActive ? Math.max(0, this.nitro - dt) : Math.min(p.nitroTank, this.nitro + p.nitroRefill * dt);

    // Brake pedal: brakes while rolling forward, reverses once (nearly) stopped.
    const reversing = input.brake > 0 && speed < 1.5 && input.throttle <= 0;
    const brake = reversing ? 0 : input.brake;
    const drive = driveForce(input.throttle, reversing ? input.brake : 0, speed / this.mods.topSpeed, this.nitroActive, p);

    // Every wheel reads the body as it was at the start of the step, and every push is applied
    // after: applying one wheel's push before reading the next would let the order of the wheels
    // tilt the car and creep it across the ground.
    // ---- Suspension: cast every wheel, then the anti-roll bars share load across each axle.
    const reach = p.restLength + p.wheelRadius;
    const down = { x: -up.x, y: -up.y, z: -up.z };
    const forces = this.forces;
    this.grounded = 0;
    for (let k = 0; k < this.wheels.length; k++) {
      const wheel = this.wheels[k] as WheelState;
      forces[k] = 0;
      const mount = rotate(q, p.wheels[k] as V3, this.mounts[k] as V3);
      mount.x += t.x;
      mount.y += t.y;
      mount.z += t.z;
      const hit = this.physics.castRay(mount, down, reach + DOWN_RAY_EXTRA, GROUP.WORLD, this.hit);
      if (!hit || hit.toi > reach) {
        wheel.grounded = false;
        wheel.compression = 0;
        wheel.load = 0;
        wheel.slide = 0;
        continue;
      }
      const compression = reach - hit.toi;
      const c = wheel.contact;
      c.x = mount.x + down.x * hit.toi;
      c.y = mount.y + down.y * hit.toi;
      c.z = mount.z + down.z * hit.toi;
      set(this.normals[k] as V3, hit.nx, hit.ny, hit.nz);
      const pv = body.velocityAtPoint(c);
      set(this.pointVel[k] as V3, pv.x, pv.y, pv.z);
      // Squeezing while the wheel's point moves down into the road.
      forces[k] = springForce(compression, -dot(pv, up), p);
      wheel.grounded = true;
      wheel.compression = Math.min(compression, p.restLength);
      wheel.surface = this.surfaceAt(c.x, c.y, c.z);
      this.grounded++;
    }
    const w = this.wheels;
    const front = antiRoll((w[0] as WheelState).compression, (w[1] as WheelState).compression, p.antiRollFront);
    const rear = antiRoll((w[2] as WheelState).compression, (w[3] as WheelState).compression, p.antiRollRear);
    if (w[0]!.grounded && w[1]!.grounded) { forces[0]! += front; forces[1]! -= front; }
    if (w[2]!.grounded && w[3]!.grounded) { forces[2]! += rear; forces[3]! -= rear; }

    // ---- Tyres: forces from the start-of-step contact velocities.
    const wf = { x: 0, y: 0, z: 0 };
    const ws = { x: 0, y: 0, z: 0 };
    let drivenWheels = 0;
    for (let k = 2; k < 4; k++) if (w[k]!.grounded) drivenWheels++;
    // Parked: no pedals at a crawl, the tyres hold the car still instead of letting it roll.
    const parked = input.throttle <= 0 && input.brake <= 0 && Math.abs(speed) < 0.6;
    for (let k = 0; k < this.wheels.length; k++) {
      const wheel = this.wheels[k] as WheelState;
      const mount = p.wheels[k]!;
      const push = this.pushes[k] as V3;
      set(push, 0, 0, 0);
      if (!wheel.grounded) {
        // A free wheel keeps spinning down slowly; it doesn't push anything.
        wheel.spin += (speed / p.wheelRadius) * dt * 0.98;
        continue;
      }
      const load = Math.max(0, forces[k] as number);
      wheel.load = load;
      // The wheel's heading on the road plane: steered for the fronts.
      const n = this.normals[k] as V3;
      const st = mount.front ? this.steer : 0;
      const cs = Math.cos(st);
      const sn = Math.sin(st);
      set(wf, fwd.x * cs + right.x * sn, fwd.y * cs + right.y * sn, fwd.z * cs + right.z * sn);
      const along = dot(wf, n);
      set(wf, wf.x - n.x * along, wf.y - n.y * along, wf.z - n.z * along);
      normalize(wf);
      cross(wf, n, ws);
      const pv = this.pointVel[k] as V3;
      const vLong = dot(pv, wf);
      const vLat = dot(pv, ws);
      const isRear = !mount.front;
      const handbrake = input.handbrake && isRear;
      tyreForces({
        vLong,
        vLat,
        load,
        mu: p.grip * SURFACE_GRIP[wheel.surface],
        latGrip: handbrake ? p.handbrakeGrip : 1,
        mass: quarter,
        dt,
        drive: isRear && drivenWheels ? drive / drivenWheels : 0,
        brake: brake * p.brakeForce * (mount.front ? p.brakeFront : 1 - p.brakeFront) / 2 + (handbrake ? p.handbrakeForce : 0),
        rolling: parked ? 1e9 : p.rolling,
      }, p, this.tyre);
      wheel.slide = handbrake && Math.abs(speed) > 4 ? Math.max(this.tyre.slide, 0.6) : this.tyre.slide;
      wheel.spin += (vLong / p.wheelRadius) * dt * (handbrake ? 0 : 1);
      set(push, wf.x * this.tyre.long + ws.x * this.tyre.lat, wf.y * this.tyre.long + ws.y * this.tyre.lat, wf.z * this.tyre.long + ws.z * this.tyre.lat);
    }

    // ---- Apply: springs along the car's up at the mounts, tyres a little above the contact patch.
    const impulse = { x: 0, y: 0, z: 0 };
    const point = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < this.wheels.length; k++) {
      const wheel = this.wheels[k] as WheelState;
      if (!wheel.grounded) continue;
      const load = wheel.load;
      set(impulse, up.x * load * dt, up.y * load * dt, up.z * load * dt);
      body.applyImpulseAtPoint(impulse, this.mounts[k] as V3, true);
      const push = this.pushes[k] as V3;
      const c = wheel.contact;
      set(point, c.x + up.x * p.forceLift, c.y + up.y * p.forceLift, c.z + up.z * p.forceLift);
      set(impulse, push.x * dt, push.y * dt, push.z * dt);
      body.applyImpulseAtPoint(impulse, point, true);
    }

    // ---- Aero: drag against the motion, downforce into the road.
    const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
    const vl = Math.sqrt(v2);
    if (vl > 0.1) {
      const dragK = (p.drag * vl * dt);
      const down2 = p.downforce * v2 * dt;
      body.applyImpulse({ x: -v.x * dragK - up.x * down2, y: -v.y * dragK - up.y * down2, z: -v.z * dragK - up.z * down2 }, true);
    }

    const av = body.angvel();
    if (this.grounded >= 3 && !input.handbrake) {
      // Yaw assist: ease off yaw beyond what the steering asks for, so the car straightens out.
      const wanted = (speed * Math.tan(this.steer)) / WHEELBASE;
      const yaw = -dot(av, up); // positive: turning right
      const excess = yaw - wanted;
      const k = -excess * p.yawDamping * dt * p.mass * 1.9;
      body.applyTorqueImpulse({ x: -up.x * k, y: -up.y * k, z: -up.z * k }, true);
    }
    if (this.grounded === 0) this.airControl(input, dt);
    this.selfRight(dt, vl);
  }

  /** Mid-air: throttle and brake pitch the nose, steering rolls and turns a little. */
  private airControl(input: CarInput, dt: number): void {
    const p = this.params;
    const { right, fwd, up } = this;
    const pitch = -(input.throttle - input.brake) * p.airPitch * dt;
    const roll = input.steer * p.airRoll * dt;
    const yaw = -input.steer * p.airYaw * dt;
    this.body.applyTorqueImpulse({
      x: right.x * pitch + fwd.x * roll + up.x * yaw,
      y: right.y * pitch + fwd.y * roll + up.y * yaw,
      z: right.z * pitch + fwd.z * roll + up.z * yaw,
    }, true);
  }

  /** On its side or roof and slow: roll back onto the wheels; still stuck after a while, ask for a respawn. */
  private selfRight(dt: number, speed: number): void {
    const up = this.up;
    const tilted = up.y < 0.45;
    if (!tilted || speed > 6) {
      this.flippedFor = 0;
      return;
    }
    this.flippedFor += dt;
    if (this.flippedFor > 0.6) {
      // Torque about up × world-up turns the car's up toward the sky.
      const axis = { x: -up.z, y: 0, z: up.x };
      const l = Math.sqrt(axis.x * axis.x + axis.z * axis.z);
      const angle = Math.acos(Math.max(-1, Math.min(1, up.y)));
      const k = l > 1e-3 ? (this.params.righting * angle * dt) / l : this.params.righting * dt;
      // Upside down exactly, the axis is undefined: roll about the car's own forward axis.
      const ax = l > 1e-3 ? axis.x : this.fwd.x;
      const az = l > 1e-3 ? axis.z : this.fwd.z;
      this.body.applyTorqueImpulse({ x: ax * k, y: 0, z: az * k }, true);
    }
    if (this.flippedFor > FLIPPED_RESPAWN) this.flipped = true;
  }

  dispose(): void {
    if (!this.physics.disposed) this.physics.world.removeRigidBody(this.body);
  }
}
