import type { RoomConnection } from '../net/room';
import type { HazardRecord, PlayerRecord, ReceivedEvent } from '../net/records';
import { decodeCar, DENT_STEP, DENT_ZONES, encodeCar, FLAG, newSnapshot, packDents, unpackDents, type CarSnapshot } from '../net/carCodec';
import { shouldSend } from '../net/sendPolicy';
import type { Racer } from './racer';
import type { Racers } from './racers';
import type { Combat } from './combat/combat';
import type { DamageSource } from './car/damage';
import type { HazardKind } from './combat/rules/weapons';

/*
 * A race in a room: this client's cars (its player, and the bots if it owns the room) go out as
 * records; everyone else's come in as remote cars. Damage this client dealt to remote cars rides
 * along in its record (`d`, cumulative per victim), so per-bullet events never touch the
 * database; each car applies what it's been dealt. Wrecks, missiles and blasts are events.
 */

export interface NetHooks {
  /** A remote car was wrecked (the feed, the banners, the blast) */
  wrecked(victim: Racer, killer: Racer | null, source: DamageSource): void;
}

interface Outgoing {
  last: CarSnapshot | null;
  sentAt: number;
  dealt: string;
  kills: number;
  finished: boolean;
}

export class NetSync {
  private readonly out = new Map<string, Outgoing>();
  private readonly unsubs: (() => void)[] = [];
  private readonly snap = newSnapshot();

  constructor(
    private readonly conn: RoomConnection,
    readonly n: number,
    private readonly racers: Racers,
    private readonly combat: Combat,
    private readonly hooks: NetHooks,
    /** Local seconds (damage timers) */
    private readonly nowS: () => number,
  ) {
    this.unsubs.push(
      conn.onPlayer((id, rec) => this.incoming(id, rec)),
      conn.onBot((id, rec) => this.incoming(id, rec)),
      conn.onEvent((e) => this.event(e)),
      conn.onHazard((id, h) => {
        if (!h) {
          this.combat.removeHazard(id);
          return;
        }
        const owner = this.racers.get(h.by) ?? null;
        if (owner && owner.local) return; // ours: already on the road here
        this.combat.addRemoteHazard(id, h.k as HazardKind, h.x, h.y, h.z, owner, Math.max(0, (h.until - conn.serverNow()) / 1000), this.nowS());
      }),
    );
    combat.net = {
      missile: (owner, pos, vel, target) => conn.pushEvent({
        k: 'missile', by: owner.id, x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), vx: r2(vel.x), vy: r2(vel.y), vz: r2(vel.z), ...(target ? { v: target.id } : {}),
      }),
      boom: (x, y, z, radius, damage, push, owner, source) => conn.pushEvent({ k: 'boom', by: owner?.id ?? '', x: r2(x), y: r2(y), z: r2(z), r: radius, dmg: damage, push, w: source }),
      hazard: (h) => conn.addHazard({ k: h.kind as HazardRecord['k'], x: r2(h.x), y: r2(h.y), z: r2(h.z), by: h.owner.id, until: Math.round(conn.serverNow() + h.until * 1000) }),
      claim: (id) => conn.claimHazard(id),
    };
  }

  // ---------------------------------------------------------------- in

  private incoming(id: string, rec: PlayerRecord | null): void {
    const r = this.racers.get(id);
    if (!r || r.local) return;
    if (!rec) {
      // Gone from the room: out of the race.
      r.snap.flags |= FLAG.wrecked;
      r.remoteFinish = null;
      return;
    }
    if (rec.n !== this.n) return;
    if (rec.p && typeof rec.t === 'number' && decodeCar(rec.p, this.snap)) {
      r.track.push(this.snap, rec.t, this.conn.serverNow());
      if (this.snap.dents !== r.snap.dents) this.dents(r, r.snap.dents, this.snap.dents);
      Object.assign(r.snap, this.snap);
    }
    r.kills = rec.k ?? 0;
    r.remoteFinish = typeof rec.f === 'number' ? rec.f / 1000 : null;
    // What this car says it's dealt to our cars, beyond what we've already taken from it. (Its
    // record is cleared when it joins a race, so everything here is from this race.)
    for (const [victimId, total] of Object.entries(rec.d ?? {})) {
      const victim = this.racers.get(victimId);
      if (!victim || victim.remote) continue;
      const before = victim.taken.get(id) ?? 0;
      if (total > before) {
        victim.taken.set(id, total);
        this.racers.hurt(victim, total - before, null, r, 'gun', this.nowS());
      }
    }
  }

  /**
   * Another client's car took more damage on some side: dent it there (its own client dented it
   * where the blows landed; here, somewhere on that side). Less than before: it's a fresh car.
   */
  private dents(r: Racer, before: number, after: number): void {
    let was = unpackDents(before);
    const now = unpackDents(after);
    if (now.some((v, i) => v < was[i]!)) {
      r.car.view.repair();
      was = now.map(() => 0);
    }
    now.forEach((v, i) => {
      if (v > was[i]!) r.car.view.zoneImpact(DENT_ZONES[i]!, (v - was[i]!) * DENT_STEP, after * 7 + i);
    });
  }

  private event(e: ReceivedEvent): void {
    if (e.from === this.conn.playerId) return;
    const now = this.nowS();
    if (e.k === 'wreck') {
      const victim = this.racers.get(e.v);
      if (!victim || victim.local) return;
      const killer = e.by ? this.racers.get(e.by) ?? null : null;
      if (killer?.local) killer.kills++;
      this.hooks.wrecked(victim, killer, e.w as DamageSource);
    } else if (e.k === 'missile') {
      const owner = this.racers.get(e.by);
      if (owner && owner.remote) this.combat.visualMissile(owner, e, { x: e.vx, y: e.vy, z: e.vz }, e.v ? this.racers.get(e.v) ?? null : null);
    } else if (e.k === 'boom') {
      const owner = e.by ? this.racers.get(e.by) ?? null : null;
      this.combat.remoteBoom(e.x, e.y, e.z, e.r, e.dmg, e.push, owner, e.w === 'mine' ? 'mine' : 'missile', now);
    }
  }

  // ---------------------------------------------------------------- out

  /** A local car was wrecked: everyone's kill feed */
  announceWreck(victim: Racer, killer: Racer | null, source: DamageSource): void {
    this.conn.pushEvent({ k: 'wreck', v: victim.id, by: killer?.id ?? '', w: source });
  }

  /** Joining the race: our record starts clean (no damage, kills or finish from the last one) */
  start(): Promise<void> {
    return this.conn.sendState({ n: this.n, d: null, k: 0, f: null, p: null, t: null });
  }

  /** Once a frame: our cars' records, when there's something worth sending */
  frame(): void {
    const now = this.conn.serverNow();
    const bots = new Map<string, Record<string, unknown>>();
    for (const r of this.racers.list) {
      if (r.remote) continue;
      const patch = this.patchFor(r, now);
      if (!patch) continue;
      if (r.isBot) bots.set(r.id, patch);
      else void this.conn.sendState(patch).catch(() => {});
    }
    if (bots.size) void this.conn.sendBots(bots).catch(() => {});
  }

  private patchFor(r: Racer, now: number): Record<string, unknown> | null {
    let o = this.out.get(r.id);
    if (!o) this.out.set(r.id, (o = { last: null, sentAt: -Infinity, dealt: '', kills: 0, finished: false }));
    const s = snapshotOf(r, this.snap);
    const patch: Record<string, unknown> = {};
    if (shouldSend(o.last, s, now - o.sentAt)) {
      patch.p = encodeCar(s);
      patch.t = Math.round(now);
      o.last = { ...s };
      o.sentAt = now;
    }
    const dealt = Object.fromEntries([...r.dealt].map(([k, v]) => [k, Math.round(v * 10) / 10]));
    const key = JSON.stringify(dealt);
    if (key !== o.dealt) {
      patch.d = dealt;
      o.dealt = key;
    }
    if (r.kills !== o.kills) {
      patch.k = r.kills;
      o.kills = r.kills;
    }
    if (r.progress.finished && !o.finished && r.progress.finishTime !== null) {
      patch.f = Math.round(r.progress.finishTime * 1000);
      o.finished = true;
    }
    return Object.keys(patch).length ? patch : null;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.combat.net = null;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A local car's state as a snapshot */
export function snapshotOf(r: Racer, out: CarSnapshot): CarSnapshot {
  const b = r.car.body.body;
  const t = b.translation();
  const q = b.rotation();
  const v = b.linvel();
  const w = b.angvel();
  out.x = t.x; out.y = t.y; out.z = t.z;
  out.qx = q.x; out.qy = q.y; out.qz = q.z; out.qw = q.w;
  out.vx = v.x; out.vy = v.y; out.vz = v.z;
  out.wx = w.x; out.wy = w.y; out.wz = w.z;
  out.yaw = r.turret.yaw;
  out.pitch = r.turret.pitch;
  out.D = r.progress.D;
  out.armour = Math.ceil(r.damage.armour);
  const now = performance.now() / 1000;
  out.flags = (r.input.fire && r.gun.locked <= 0 && r.gun.ammo > 0 ? FLAG.firing : 0)
    | (r.car.body.nitroActive ? FLAG.nitro : 0)
    | (r.wrecked ? FLAG.wrecked : 0)
    | (r.ghost(now) ? FLAG.ghost : 0)
    | (r.progress.finished ? FLAG.finished : 0)
    | (r.gun.armed > 0 ? FLAG.armed : 0)
    | (r.input.brake > 0 && r.car.body.speed > 0.5 ? FLAG.braking : 0)
    | (r.spikes > 0 ? FLAG.spikes : 0)
    | (r.flaming > 0 ? FLAG.flame : 0);
  out.dents = packDents(r.damage.zoneDamage);
  return out;
}
