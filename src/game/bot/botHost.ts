import { GROUP, type PhysicsWorld, type RayHit } from '../physics';
import type { Racer } from '../racer';
import type { Racers } from '../racers';
import type { Combat } from '../combat/combat';
import type { TrackData } from '../track/types';
import { drive, type DriverView } from './driver';
import { gunner, type GunnerTarget } from './gunner';
import { laneOffset, shouldDefend, type Rival } from './tactics';
import { rubberBand } from './skills';
import { carProfile } from './speedProfile';
import { aimError, anglesOf } from '../car/turret';
import { CAR } from '../car/params';
import { basis, rotate } from '../math/vec3';
import { neutralInput } from '../input/carInput';

/*
 * Runs the bots this client is in charge of (offline: all of them). Each bot thinks 30 times a
 * second: where to drive (bot/driver.ts, with bot/tactics.ts choosing a lane), what to shoot
 * (bot/gunner.ts), when to use its items. Between decisions it holds its last input, as a player
 * holds keys.
 */

const THINK = 1 / 30;
/** Line-of-sight checks are costly-ish: a target's visibility is re-checked this often (s) */
const SIGHT_EVERY = 0.2;

export class BotHost {
  private readonly profile: Float32Array;
  private readonly hit: RayHit = { toi: 0, nx: 0, ny: 1, nz: 0, collider: 0 };
  private readonly sight = new Map<string, { at: number; visible: boolean }>();
  /** Bots hold still and hold fire (the e2e tests) */
  frozen = false;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly track: TrackData,
    private readonly racers: Racers,
    private readonly combat: Combat,
  ) {
    // What the car can take each part of the line at: grip it dares use, braking, accelerating.
    this.profile = carProfile(track, CAR);
  }

  /** Before each physics step: bots due a decision make one */
  think(dt: number, now: number, racing: boolean): void {
    for (const r of this.racers.list) {
      const b = r.brain;
      if (!b || r.wrecked) continue;
      b.think -= dt;
      if (b.think > 0) continue;
      b.think += THINK;
      if (Math.random() < THINK / 4) b.roll = Math.random();
      if (!racing || this.frozen) {
        b.input = this.frozen ? { ...neutralInput(), brake: 1, handbrake: true } : neutralInput();
        r.aim = null;
        continue;
      }
      this.decide(r, now);
    }
  }

  private decide(r: Racer, now: number): void {
    const b = r.brain!;
    const body = r.car.body;
    const t = body.body.translation();
    const q = body.body.rotation();
    const right = { x: 0, y: 0, z: 0 };
    const up = { x: 0, y: 0, z: 0 };
    const fwd = { x: 0, y: 0, z: 0 };
    basis(q, right, up, fwd);
    const view: DriverView = {
      x: t.x, z: t.z, fx: fwd.x, fz: fwd.z, rx: right.x, rz: right.z, speed: body.speed, s: r.loc.s, u: r.loc.u, nitro: body.nitro,
    };
    // The cars round it, in race terms.
    const rivals: Rival[] = [];
    const targets: GunnerTarget[] = [];
    let human: Racer | null = null;
    for (const o of this.racers.list) {
      if (o === r || o.wrecked) continue;
      if (!o.isBot && (!human || Math.abs(o.progress.D - r.progress.D) < Math.abs(human.progress.D - r.progress.D))) human = o;
      const dD = o.progress.D - r.progress.D;
      rivals.push({ dD, du: o.loc.u - r.loc.u, speed: o.car.body.speed, armour: o.damage.armour });
      const ot = o.car.body.body.translation();
      const ov = o.car.body.body.linvel();
      targets.push({ id: o.id, x: ot.x, y: ot.y, z: ot.z, vx: ov.x, vz: ov.z, visible: !o.ghost(now) && this.canSee(r, o, now) });
    }
    const line = this.track.line[r.loc.i] as number;
    const offset = laneOffset({
      s: r.loc.s, u: r.loc.u, line, speed: body.speed, armour: r.damage.armour,
      wantsSword: r.missiles < 2, wantsShield: !r.defence || r.damage.armour < r.damage.max * 0.6,
      // A trap is worth springing when someone's not far ahead to run into it.
      wantsSkull: rivals.some((x) => x.dD > 40 && x.dD < 160),
    }, rivals, this.track.pads, this.track.lapLength, b.skill, b.roll);
    const pace = b.skill.pace * (human ? rubberBand(r.progress.D - human.progress.D) : 1);
    const input = drive(this.track, this.profile, view, b.driver, b.skill, offset, pace, THINK, Math.random(), b.input);

    // Guns: aim at the chosen target, fire when on it.
    const shoot = gunner(
      { x: t.x, y: t.y, z: t.z, fx: fwd.x, fz: fwd.z, heat: r.gun.heat, locked: r.gun.locked > 0, missiles: r.missiles },
      targets, b.gunner, b.skill, this.turretError(r), THINK, Math.random,
    );
    r.aim = shoot.aim;
    input.fire = shoot.fire;
    input.missile = shoot.missile;
    input.defence = !!r.defence && shouldDefend(rivals, b.skill, Math.random(), r.defence === 'flame');
    input.respawn = false;
  }

  /** How far the turret is from the bot's aim point right now */
  private turretError(r: Racer): number {
    if (!r.aim) return 1;
    const b = r.car.body.body;
    const t = b.translation();
    const q = b.rotation();
    const local = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, { x: r.aim.x - t.x, y: r.aim.y - t.y - 1.2, z: r.aim.z - t.z }, { x: 0, y: 0, z: 0 });
    const a = anglesOf(local.x, local.y, local.z);
    return aimError(r.turret, a.yaw, a.pitch);
  }

  /** Line of sight from r to o: no barrier or hill in the way, no smoke (cached a moment) */
  private canSee(r: Racer, o: Racer, now: number): boolean {
    const key = `${r.id}>${o.id}`;
    const c = this.sight.get(key);
    if (c && now - c.at < SIGHT_EVERY) return c.visible;
    const a = r.car.body.body.translation();
    const b = o.car.body.body.translation();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz);
    let visible = d < 120;
    if (visible) {
      const from = { x: a.x, y: a.y + 1.3, z: a.z };
      const dir = { x: dx / d, y: (dy + 0) / d, z: dz / d };
      visible = !this.physics.castRay(from, dir, d - 2, GROUP.WORLD | GROUP.BARRIER, this.hit);
    }
    if (visible && (this.combat.inSmoke(b.x, b.z) || this.combat.smokeBetween(a.x, a.z, b.x, b.z))) visible = false;
    this.sight.set(key, { at: now, visible });
    return visible;
  }
}
