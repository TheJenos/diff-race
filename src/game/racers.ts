import { Racer } from './racer';
import { GRAVITY, PHYSICS_STEP, type ContactForce, type PhysicsWorld } from './physics';
import { applyDamage, handlingOf, regen, restore, type DamageSource, type HitResult, type Zone } from './car/damage';
import { barrierDamage, crashDamage, SCRAPE_SPEED, scrapeDamage } from './car/collisionDamage';
import { slew, anglesOf, TURRET } from './car/turret';
import { stepProgress, resetTo, type ProgressEvent } from './race/progress';
import { locate } from './track/locate';
import { outOfBounds, surfaceAt } from './track/surface';
import { placeOnTrack } from './race/placement';
import { frameAt, newFrame } from './track/sample';
import type { TrackData } from './track/types';
import type { BotSkill } from './bot/skills';
import type { Box } from './combat/rules/hitTest';
import type { Surface } from './car/params';
import { basis, rotate, type V3 } from './math/vec3';
import type { CarInput } from './input/carInput';
import { newPose } from './car/carTrack';
import { FLAG } from '../net/carCodec';
import { settings } from './settings';

/*
 * Every car in the race, simulated here: the player's and the bots'. Owns what happens to cars
 * physically: placing them on the grid, crash damage from Rapier's contact reports, wrecks and
 * respawns, ghosting, progress round the laps. Weapons are combat.ts's; brains are bot/*.
 */

export interface RaceRules {
  laps: number;
  /** Starting armour */
  armour: number;
  /** Crash damage: 0 bumper cars, 1 normal, 2 carnage */
  crash: number;
  weapons: boolean;
  /** Elimination: a wrecked car is out of the race */
  elimination?: boolean;
}

export interface RacerEvents {
  hurt(victim: Racer, attacker: Racer | null, amount: number, source: DamageSource, result: HitResult): void;
  wrecked(victim: Racer, killer: Racer | null, source: DamageSource): void;
  respawned(r: Racer): void;
  lap(r: Racer, n: number, time: number): void;
  finished(r: Racer): void;
}

/** Seconds a wreck stays wrecked, and a respawn stays ghosted */
export const WRECK_TIME = 3;
export const GHOST_TIME = 2;
/** Respawns go back this far from where the car left the track (m) */
const RESPAWN_BACK = 15;
/** Fastest a car could possibly move (m/s), for telling driving from teleporting */
const MAX_SPEED = 80;

interface StepContact {
  other: Racer | 'barrier';
  force: number;
}

/** One crash in progress: the velocity change summed over the steps it lasts */
export interface Impact {
  other: Racer | 'barrier';
  dx: number;
  dy: number;
  dz: number;
  steps: number;
  /** Steps since it last touched */
  idle: number;
  /** Already judged: further contact is grinding */
  done: boolean;
}

/** Beyond this distance from the camera (m) a car is drawn without its small parts */
const LOD_DISTANCE = { low: 40, medium: 60, high: 80 } as const;

/** The longest an impact is summed over (steps: 0.1 s) before it's judged */
const IMPACT_STEPS = 12;

const frame = newFrame();

export class Racers {
  readonly list: Racer[] = [];
  private readonly byCollider = new Map<number, Racer>();
  private readonly contacts = new Map<Racer, StepContact[]>();
  private readonly event: ProgressEvent = {};
  player: Racer | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly track: TrackData,
    readonly rules: RaceRules,
    private readonly barriers: ReadonlySet<number>,
    private readonly events: RacerEvents,
    private readonly hazardSurface: (x: number, z: number) => Surface | null,
    /** Server time (ms), what remote cars' snapshots are stamped with */
    private readonly serverNow: () => number = () => performance.now(),
  ) {
    physics.onContactForce((c) => this.collect(c));
  }

  /** A car on grid slot `slot`. `remote`: another client simulates it (drawn from its snapshots). */
  add(id: string, name: string, color: number, stripe: number, slot: number, bot: BotSkill | null, remote = false): Racer {
    const g = this.track.grid[slot % this.track.grid.length]!;
    const r = new Racer(this.physics, id, name, color, stripe, this.track.lapLength + g.s, this.track.lapLength, this.rules.armour, bot, remote);
    for (const c of r.car.body.colliders) this.byCollider.set(c.handle, r);
    r.car.body.surfaceAt = (x, y, z) => this.hazardSurface(x, z) ?? this.trackSurface(r, x, y, z);
    this.place(r, g.s, g.u);
    resetTo(r.progress, ((g.s % this.track.lapLength) + this.track.lapLength) % this.track.lapLength, this.track.lapLength);
    r.progress.D = g.s;
    r.progress.maxD = g.s;
    this.list.push(r);
    if (!bot && !remote) this.player = r;
    return r;
  }

  private readonly wheelLoc = { i: 0, s: 0, u: 0, h: 0, dist: 0 };
  private trackSurface(r: Racer, x: number, y: number, z: number): Surface {
    locate(this.track, { x, y, z }, r.loc.i, this.wheelLoc);
    return surfaceAt(this.track, this.wheelLoc);
  }

  get(id: string): Racer | undefined {
    return this.list.find((r) => r.id === id);
  }

  /** Put a car on the road at (s, u), at rest, facing along the track */
  place(r: Racer, s: number, u: number): void {
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    placeOnTrack(this.track, s, u, pos, rot);
    r.car.place(pos, rot);
    locate(this.track, pos, -1, r.loc);
    r.turret.yaw = 0;
    r.turret.pitch = 0;
  }

  // ---------------------------------------------------------------- the physics step

  private readonly pose = newPose();

  /** Before the step: each car's input (held, coasting or its own), drive, and remember its velocity */
  before(dt: number, inputFor: (r: Racer) => CarInput): void {
    const now = this.serverNow();
    for (const r of this.list) {
      if (r.remote) {
        if (r.track.sample(now, this.pose)) r.car.body.follow(this.pose, dt);
        continue;
      }
      if (r.wrecked) continue;
      r.input = inputFor(r);
      r.car.fixed(r.input, dt);
      const v = r.car.body.body.linvel();
      r.vPre.x = v.x;
      r.vPre.y = v.y;
      r.vPre.z = v.z;
      this.aimTurret(r, dt);
    }
  }

  /** The turret swings toward the racer's aim point (or back to the front) */
  private aimTurret(r: Racer, dt: number): void {
    if (!r.aim) {
      slew(r.turret, 0, 0, dt);
      return;
    }
    const b = r.car.body.body;
    const t = b.translation();
    const q = b.rotation();
    const inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const local = rotate(inv, { x: r.aim.x - t.x, y: r.aim.y - (t.y + r.car.view.gunHeight), z: r.aim.z - t.z }, { x: 0, y: 0, z: 0 });
    const a = anglesOf(local.x, local.y, local.z);
    slew(r.turret, a.yaw, a.pitch, dt);
  }

  private collect(c: ContactForce): void {
    const a = this.byCollider.get(c.collider1);
    const b = this.byCollider.get(c.collider2);
    if (a && b && a === b) return;
    const add = (r: Racer, other: Racer | 'barrier') => {
      let list = this.contacts.get(r);
      if (!list) this.contacts.set(r, (list = []));
      const same = list.find((x) => x.other === other);
      if (same) same.force = Math.max(same.force, c.total);
      else list.push({ other, force: c.total });
    };
    if (a && b) {
      add(a, b);
      add(b, a);
    } else if (a && this.barriers.has(c.collider2)) add(a, 'barrier');
    else if (b && this.barriers.has(c.collider1)) add(b, 'barrier');
  }

  /** After the step: crash damage, progress, respawns, armour regeneration */
  after(dt: number, now: number, raceTime: number, racing: boolean): void {
    for (const r of this.list) {
      if (r.remote) {
        r.car.afterStep();
        locate(this.track, r.car.body.body.translation(), r.loc.i, r.loc);
        // Elimination: a remote car that's wrecked stays out.
        if (this.rules.elimination && r.snap.flags & FLAG.wrecked && !r.out && r.track.last) {
          r.out = true;
          r.outAt = now;
        }
        r.progress.D = r.snap.D;
        r.progress.finished = r.remoteFinish !== null;
        r.progress.finishTime = r.remoteFinish;
        continue;
      }
      if (r.wrecked) {
        if (!r.out && now - (r.wreckedAt as number) >= WRECK_TIME) this.respawn(r, now);
        continue;
      }
      r.car.afterStep();
      const body = r.car.body;
      const t = body.body.translation();
      locate(this.track, t, r.loc.i, r.loc);
      this.crashes(r, dt, now);
      if (r.wrecked) continue;
      regen(r.damage, now, dt);
      r.spikes = Math.max(0, r.spikes - dt);
      body.mods = handlingOf(r.damage);
      if (r.ghostUntil && now >= r.ghostUntil) {
        r.ghostUntil = 0;
        body.setGhost(false);
      }
      // Off the track, upside down, lost or stuck: back on (a kill if someone put it there).
      const stuckBot = r.brain?.driver.wantsRespawn ?? false;
      if (t.y < this.track.killY || outOfBounds(this.track, r.loc) || body.flipped || r.progress.lostFor > 1.5 || stuckBot || r.input.respawn) {
        if (r.brain) r.brain.driver.wantsRespawn = false;
        const d = r.damage;
        const pushed = d.lastAttacker !== null && now - d.lastAttackAt <= 5 && !r.input.respawn;
        if (pushed) this.hurt(r, d.armour + 1, null, null, 'fall', now);
        else this.respawn(r, now, false);
        continue;
      }
      frameAt(this.track, r.loc.s, frame);
      const fwd = { x: 0, y: 0, z: 0 };
      basis(body.body.rotation(), { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fwd);
      const align = fwd.x * frame.fwd.x + fwd.y * frame.fwd.y + fwd.z * frame.fwd.z;
      const e = stepProgress(r.progress, {
        s: r.loc.s, lapLength: this.track.lapLength, laps: this.rules.laps > 0 ? this.rules.laps : Infinity, dt,
        time: raceTime, speed: body.speed, alignment: align, maxSpeed: MAX_SPEED, racing,
      }, this.event);
      if (e.lap) this.events.lap(r, e.lap.n, e.lap.time);
      if (e.finished) this.events.finished(r);
    }
    this.contacts.clear();
  }

  /**
   * What this step's contacts did to `r`. A crash's impulse is spread over a few physics steps,
   * so the velocity change is summed over the whole impact (consecutive steps touching the same
   * car or barrier) and judged once when it ends. Contact that goes on past that is grinding.
   */
  private crashes(r: Racer, dt: number, now: number): void {
    const list = this.contacts.get(r) ?? [];
    const v = r.car.body.body.linvel();
    // The step's velocity change, less gravity: what the crash did this step.
    const dvx = v.x - r.vPre.x;
    const dvy = v.y - r.vPre.y + GRAVITY * PHYSICS_STEP;
    const dvz = v.z - r.vPre.z;
    const share = list.length ? 1 / list.length : 0;
    const touched = new Set<string>();
    for (const c of list) {
      const key = c.other === 'barrier' ? 'barrier' : c.other.id;
      touched.add(key);
      let imp = r.impacts.get(key);
      if (!imp) r.impacts.set(key, (imp = { other: c.other, dx: 0, dy: 0, dz: 0, steps: 0, idle: 0, done: false }));
      imp.idle = 0;
      if (imp.done) {
        // Still touching after the impact was judged: grinding along it.
        this.grind(r, c.other, v, dt, now);
        continue;
      }
      imp.dx += dvx * share;
      imp.dy += dvy * share;
      imp.dz += dvz * share;
      if (++imp.steps >= IMPACT_STEPS) this.judge(r, imp, now);
    }
    for (const [key, imp] of r.impacts) {
      if (touched.has(key)) continue;
      if (++imp.idle >= 2) {
        if (!imp.done) this.judge(r, imp, now);
        r.impacts.delete(key);
      }
    }
  }

  /** An impact is over (or has lasted long enough): how much it hurt */
  private judge(r: Racer, imp: Impact, now: number): void {
    imp.done = true;
    const dv = Math.hypot(imp.dx, imp.dy, imp.dz);
    const zone = this.zoneOf(r, -imp.dx, -imp.dy, -imp.dz);
    if (imp.other === 'barrier') {
      const amount = barrierDamage(dv, zone, this.rules.crash);
      if (amount > 0) this.hurt(r, amount, zone, null, 'barrier', now);
      return;
    }
    const other = imp.other;
    if (other.wrecked) return;
    const amount = crashDamage(dv, zone, {
      rule: this.rules.crash, ghost: r.ghost(now), otherNitro: other.car.body.nitroActive, otherArmed: other.gun.armed > 0,
      otherSpikes: other.spiked, selfSpikes: r.spiked,
    });
    if (amount > 0) this.hurt(r, amount, zone, other, 'ram', now);
  }

  /** Sliding along another car (or a barrier at speed) wears both down */
  private grind(r: Racer, other: Racer | 'barrier', v: { x: number; z: number }, dt: number, now: number): void {
    if (other === 'barrier') {
      if (Math.hypot(v.x, v.z) > 15 && this.tick(r, 'barrier', dt)) this.hurt(r, scrapeDamage(0.25, this.rules.crash) * 0.5, null, null, 'scrape', now);
      return;
    }
    if (other.wrecked) return;
    const ov = other.car.body.body.linvel();
    if (Math.hypot(v.x - ov.x, v.z - ov.z) > SCRAPE_SPEED && this.tick(r, other.id, dt)) {
      this.hurt(r, scrapeDamage(0.25, this.rules.crash), null, other, 'scrape', now);
    }
  }

  /** Scrapes hurt in quarter-second ticks (so sparks, sound and the HUD aren't 120 events a second) */
  private tick(r: Racer, key: string, dt: number): boolean {
    const t = (r.scraping.get(key) ?? 0) + dt * 2;
    if (t >= 0.25) {
      r.scraping.set(key, 0);
      return true;
    }
    r.scraping.set(key, t);
    return false;
  }

  /** The zone facing direction (x, y, z) (world): the side the hit came from */
  private zoneOf(r: Racer, x: number, y: number, z: number): Zone {
    const q = r.car.body.body.rotation();
    const d = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, { x, y, z }, { x: 0, y: 0, z: 0 });
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    if (d.y / l < -0.65) return 'roof';
    if (Math.abs(d.z) > Math.abs(d.x)) return d.z < 0 ? 'front' : 'rear';
    return d.x < 0 ? 'left' : 'right';
  }

  // ---------------------------------------------------------------- damage, wrecks, respawns

  /** Damage `r`; a wreck is handled here (the killer credited, the car taken out) */
  hurt(r: Racer, amount: number, zone: Zone | null, attacker: Racer | null, source: DamageSource, now: number): void {
    if (attacker === r) attacker = null;
    if (r.remote) {
      // Its own client applies it: record what we did, and it arrives with our next state.
      if (!(r.snap.flags & (FLAG.wrecked | FLAG.ghost)) && attacker?.local && amount > 0) {
        attacker.dealt.set(r.id, (attacker.dealt.get(r.id) ?? 0) + amount);
        this.events.hurt(r, attacker, amount, source, { wrecked: false, killer: null, source, levelUp: null });
      }
      return;
    }
    if (r.wrecked || r.ghost(now) || amount <= 0) return;
    const result = applyDamage(r.damage, amount, zone, attacker?.id ?? null, source, now);
    if (result.levelUp) r.car.view.dent(result.levelUp, r.damage.levels[result.levelUp]);
    this.events.hurt(r, attacker, amount, source, result);
    if (result.wrecked) {
      const killer = result.killer ? this.get(result.killer) ?? null : null;
      this.wreck(r, killer, result.source, now);
    }
  }

  private wreck(r: Racer, killer: Racer | null, source: DamageSource, now: number): void {
    r.wreckedAt = now;
    r.deaths++;
    if (this.rules.elimination) {
      r.out = true;
      r.outAt = now;
    }
    if (killer) killer.kills++;
    r.car.view.group.visible = false;
    r.car.body.setActive(false);
    r.gun.armed = 0;
    this.events.wrecked(r, killer, source);
  }

  /** Back on the track behind where it was, ghosted for a moment */
  respawn(r: Racer, now: number, fromWreck = true): void {
    const s = r.loc.s - RESPAWN_BACK;
    r.car.body.setActive(true);
    this.place(r, s, 0);
    resetTo(r.progress, r.loc.s, this.track.lapLength);
    if (fromWreck) restore(r.damage);
    r.car.view.reset(r.damage.levels);
    r.wreckedAt = null;
    r.ghostUntil = now + GHOST_TIME;
    r.car.body.setGhost(true);
    r.car.view.group.visible = true;
    r.scraping.clear();
    r.impacts.clear();
    this.events.respawned(r);
  }

  // ---------------------------------------------------------------- drawing and queries

  /** Where the camera is, for each car's level of detail */
  readonly eye = { x: 0, y: 0, z: 0 };

  render(alpha: number, now: number): void {
    const s = settings.get();
    const far = LOD_DISTANCE[s.quality];
    for (const r of this.list) {
      r.car.view.setOutline(s.outlines);
      const p = r.car.view.group.position;
      r.car.view.setDetail((p.x - this.eye.x) ** 2 + (p.z - this.eye.z) ** 2 < far * far);
      if (r.remote) {
        r.car.render(alpha);
        r.turret.yaw = r.snap.yaw;
        r.turret.pitch = r.snap.pitch;
        r.car.view.turret.rotation.y = r.snap.yaw;
        r.car.view.guns.rotation.x = r.snap.pitch;
        r.car.view.setNitro((r.snap.flags & FLAG.nitro) !== 0);
        r.car.view.setSpikes((r.snap.flags & FLAG.spikes) !== 0);
        r.car.view.setBraking((r.snap.flags & FLAG.braking) !== 0);
        r.car.view.group.visible = !(r.snap.flags & FLAG.wrecked);
        if (r.snap.flags & FLAG.ghost) r.car.view.setGhost(true, now);
        r.tag?.draw(r.snap.armour / r.damage.max);
        continue;
      }
      if (r.wrecked) {
        // (A replay may have shown it; a wreck stays hidden.)
        r.car.view.group.visible = false;
        continue;
      }
      r.car.render(alpha);
      r.car.view.turret.rotation.y = r.turret.yaw;
      r.car.view.guns.rotation.x = r.turret.pitch;
      r.car.view.setGhost(r.ghost(now), now);
      r.car.view.setSpikes(r.spikes > 0);
      r.tag?.draw(r.damage.armour / r.damage.max);
    }
  }

  /**
   * The room's owner left mid-race and we're the new one: the bots are ours to drive now. They
   * carry on from where they are (ghosted a moment, so the hand-over can't cause a crash).
   */
  promote(r: Racer, skill: BotSkill, now: number): void {
    if (!r.remote) return;
    const b = r.car.body;
    const v = { x: r.snap.vx, y: r.snap.vy, z: r.snap.vz };
    r.remote = false;
    b.setPuppet(false);
    b.body.setLinvel(v, true);
    r.adoptBrain(skill);
    r.damage.armour = Math.max(1, r.snap.armour);
    r.progress.D = r.snap.D;
    r.progress.maxD = Math.max(r.progress.maxD, r.snap.D);
    r.progress.lastS = r.loc.s;
    r.ghostUntil = now + 1;
    b.setGhost(true);
  }

  /** The car's hit box, as drawn */
  boxOf(r: Racer, out: Box): Box {
    const g = r.car.view.group;
    const up = rotate(g.quaternion, { x: 0, y: 0.2, z: 0 }, { x: 0, y: 0, z: 0 });
    out.cx = g.position.x + up.x;
    out.cy = g.position.y + up.y;
    out.cz = g.position.z + up.z;
    out.qx = g.quaternion.x;
    out.qy = g.quaternion.y;
    out.qz = g.quaternion.z;
    out.qw = g.quaternion.w;
    out.hx = 1.0;
    out.hy = 0.65;
    out.hz = 2.3;
    return out;
  }

  /** Where the guns' muzzles are and which way they point (world) */
  muzzle(r: Racer, pos: V3, dir: V3): void {
    const g = r.car.view.group;
    const c = Math.cos(r.turret.pitch);
    const local = { x: -Math.sin(r.turret.yaw) * c, y: Math.sin(r.turret.pitch), z: -Math.cos(r.turret.yaw) * c };
    rotate(g.quaternion, local, dir);
    const base = rotate(g.quaternion, { x: 0, y: r.car.view.gunHeight, z: 0.1 }, { x: 0, y: 0, z: 0 });
    pos.x = g.position.x + base.x + dir.x * TURRET.muzzle;
    pos.y = g.position.y + base.y + dir.y * TURRET.muzzle;
    pos.z = g.position.z + base.z + dir.z * TURRET.muzzle;
  }

  dispose(): void {
    for (const r of this.list) r.dispose();
    this.list.length = 0;
  }
}
