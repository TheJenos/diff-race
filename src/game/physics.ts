import type RAPIER_NS from '#rapier';

/*
 * Rapier rigid-body physics: the track's static geometry, every local car's chassis, the puppets
 * standing in for remote cars, and debris. No three.js here, so the same world runs in Node for
 * the car tests and the headless bot sim.
 *
 * The engine (a ~3 MB WebAssembly module) is loaded the first time a game starts, in its own
 * chunk, so the lobby never downloads it. `#rapier` (package.json "imports") is
 * @dimforge/rapier3d in the browser: a real .wasm file the browser compiles while it downloads.
 * Node gets the -compat build instead, which embeds the .wasm as base64 and needs init().
 *
 * Rapier isn't bit-for-bit identical across machines, so each client simulates only its own car
 * (and the room owner its bots) and sends the result; everything else is a prediction.
 */

export type Rapier = typeof RAPIER_NS;
export type RapierWorld = RAPIER_NS.World;
export type RapierBody = RAPIER_NS.RigidBody;
export type RapierCollider = RAPIER_NS.Collider;

let rapier: Rapier | null = null;
let loading: Promise<Rapier> | null = null;

/** Download and start the engine (once). Call early: the game can't start without it. */
export function loadPhysics(): Promise<Rapier> {
  loading ??= import('#rapier')
    .then(async (mod) => {
      const R = (mod as unknown as { default?: Rapier }).default ?? (mod as unknown as Rapier);
      // Only the -compat build has init(); the browser build is ready once imported
      const compat = R as Rapier & { init?: () => Promise<void> };
      if (typeof compat.init === 'function') await compat.init();
      rapier = R;
      return R;
    })
    .catch((err: unknown) => {
      loading = null; // allow a retry on the next start
      throw err;
    });
  return loading;
}

/** The engine, once loadPhysics() has resolved. */
export function getRapier(): Rapier {
  if (!rapier) throw new Error('Physics used before loadPhysics() finished');
  return rapier;
}

/** World gravity (m/s²): heavier than real, so cars feel planted and land hard */
export const GRAVITY = 16;
/**
 * Fixed simulation step (s). 120 Hz keeps stiff suspension springs stable and lets a fast car's
 * wheels see a kerb before they're past it.
 */
export const PHYSICS_STEP = 1 / 120;
/** At most this many steps per frame; after a long stall the simulation slows rather than spiral */
const MAX_STEPS = 8;

/**
 * Collision groups (Rapier packs "member of" in the high 16 bits and "collides with" in the low 16).
 * Wheels ray-cast against WORLD only, so they never ride on another car.
 */
export const GROUP = {
  /** The road, verge and ground */
  WORLD: 1 << 0,
  /** Barriers and walls: cars hit them, wheels don't stand on them */
  BARRIER: 1 << 1,
  /** Cars this client simulates (its own, and the owner's bots) */
  CAR: 1 << 2,
  /** Stand-ins for cars other clients simulate (car/puppet.ts): they only touch local cars */
  PUPPET: 1 << 3,
  DEBRIS: 1 << 4,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

/** One contact-force report: two colliders pushed on each other this step with this much force (N) */
export interface ContactForce {
  collider1: number;
  collider2: number;
  /** Sum of the contact forces (N) */
  total: number;
  /** The largest single contact force (N) and its direction */
  max: number;
  dir: { x: number; y: number; z: number };
}

type Vec = { x: number; y: number; z: number };

/** Where a ray stopped: distance along it, the surface normal, and the collider it hit */
export interface RayHit {
  toi: number;
  nx: number;
  ny: number;
  nz: number;
  collider: number;
}

export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RapierWorld;
  /** Set once freed: anything still holding bodies must not touch them */
  disposed = false;
  private readonly events: RAPIER_NS.EventQueue;
  private readonly ray: RAPIER_NS.Ray;
  private accumulator = 0;
  private readonly before = new Set<(dt: number) => void>();
  private readonly after = new Set<(dt: number) => void>();
  private readonly contacts = new Set<(c: ContactForce) => void>();
  private readonly contact: ContactForce = { collider1: 0, collider2: 0, total: 0, max: 0, dir: { x: 0, y: 0, z: 0 } };

  constructor() {
    this.R = getRapier();
    this.world = new this.R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_STEP;
    this.events = new this.R.EventQueue(true);
    this.ray = new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /**
   * The first thing a ray from `o` along unit `dir` hits within `max`, among colliders that are
   * members of `mask` (GROUP bits), and its surface normal.
   */
  castRay(o: Vec, dir: Vec, max: number, mask: number, out: RayHit): RayHit | null {
    const { origin, dir: d } = this.ray;
    origin.x = o.x;
    origin.y = o.y;
    origin.z = o.z;
    d.x = dir.x;
    d.y = dir.y;
    d.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, max, true, undefined, groups(0xffff, mask));
    if (!hit) return null;
    out.toi = hit.timeOfImpact;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    out.collider = hit.collider.handle;
    return out;
  }

  /** Run `fn` before every fixed step (drive forces, input). Returns an unsubscribe function. */
  onBeforeStep(fn: (dt: number) => void): () => void {
    this.before.add(fn);
    return () => this.before.delete(fn);
  }

  /** Run `fn` after every fixed step (read poses, progress). Returns an unsubscribe function. */
  onStep(fn: (dt: number) => void): () => void {
    this.after.add(fn);
    return () => this.after.delete(fn);
  }

  /**
   * Contact forces above each collider's threshold (setContactForceEventThreshold) after every
   * step: crash damage reads these. The report object is reused; copy what you keep.
   */
  onContactForce(fn: (c: ContactForce) => void): () => void {
    this.contacts.add(fn);
    return () => this.contacts.delete(fn);
  }

  /** One fixed step: before-listeners, the solver, contact reports, after-listeners. */
  step(): void {
    for (const fn of this.before) fn(PHYSICS_STEP);
    this.world.step(this.events);
    const c = this.contact;
    this.events.drainContactForceEvents((e) => {
      if (!this.contacts.size) return;
      c.collider1 = e.collider1();
      c.collider2 = e.collider2();
      c.total = e.totalForceMagnitude();
      c.max = e.maxForceMagnitude();
      const d = e.maxForceDirection();
      c.dir.x = d.x;
      c.dir.y = d.y;
      c.dir.z = d.z;
      for (const fn of this.contacts) fn(c);
    });
    for (const fn of this.after) fn(PHYSICS_STEP);
  }

  /** Advance by a frame's worth of fixed steps. Returns how far into the next step we are (0..1). */
  update(dt: number): number {
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_STEP * MAX_STEPS);
    while (this.accumulator >= PHYSICS_STEP) {
      this.step();
      this.accumulator -= PHYSICS_STEP;
    }
    return this.accumulator / PHYSICS_STEP;
  }

  dispose(): void {
    this.disposed = true;
    this.before.clear();
    this.after.clear();
    this.contacts.clear();
    this.events.free();
    this.world.free();
  }
}
