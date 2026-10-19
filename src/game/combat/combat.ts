import * as THREE from 'three';
import { GROUP, type PhysicsWorld, type RayHit } from '../physics';
import type { Racer } from '../racer';
import type { Racers } from '../racers';
import type { Effects } from '../world/effects';
import type { TrackData } from '../track/types';
import type { Surface } from '../car/params';
import { patch, zoneAt } from '../car/damage';
import { arm, loadGun, roundDamage, stepGun } from './rules/heat';
import { DEFENCE, GUN, MISSILE, PAD, SPIKES, TRAP, type DefenceKind, type HazardKind } from './rules/weapons';
import { rayBox, toBoxSpace, type Box } from './rules/hitTest';
import { seekScore, steer } from './rules/homing';
import { loopDelta } from '../race/progress';
import { basis } from '../math/vec3';
import { FLAG } from '../../net/carCodec';

/*
 * Weapons and pads, for every car simulated on this client: the machine gun's rounds (hitscan:
 * a ray against the world and against each car's box), missiles (heat-seeking, with a splash),
 * the rear defences (oil, smoke, napalm, mines) and the pads on the road (gun, sword, shield, skull).
 * Damage goes through Racers.hurt, so kills and wrecks are handled in one place.
 */

export interface CombatEvents {
  /** A round from `shooter` hit `victim` (for the hitmarker) */
  hit(shooter: Racer, victim: Racer): void;
  fired(shooter: Racer): void;
  missile(shooter: Racer): void;
  explosion(x: number, y: number, z: number, size: number): void;
  pickup(r: Racer, kind: 'gun' | 'sword' | 'shield' | 'skull', defence: DefenceKind | null, spikes: boolean): void;
  dropped(r: Racer, kind: DefenceKind): void;
}

/** Where combat meets the network (rooms only): what other clients must hear about */
export interface CombatNet {
  /** A local car fired a missile, chasing `target` (others draw it) */
  missile(owner: Racer, pos: THREE.Vector3, vel: THREE.Vector3, target: Racer | null): void;
  /** A blast here (others apply its splash to their own cars) */
  boom(x: number, y: number, z: number, radius: number, damage: number, push: number, owner: Racer | null, source: 'missile' | 'mine'): void;
  /** A local car dropped this hazard: returns its id in the room */
  hazard(h: { kind: HazardKind; x: number; y: number; z: number; owner: Racer; until: number }): string | null;
  /** A local car set off a mine (anyone's): resolves to whether it was first (it explodes) */
  claim(id: string): Promise<boolean>;
}

interface Missile {
  owner: Racer;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  mesh: THREE.Mesh;
  /** Another client's missile: drawn here, its blast decided there */
  visual: boolean;
  /** The car it's chasing (null once it's lost it, or if it never had one) */
  target: Racer | null;
}

interface Hazard {
  kind: HazardKind;
  owner: Racer | null;
  x: number; y: number; z: number;
  until: number;
  born: number;
  mesh: THREE.Object3D | null;
  /** Its id in the room (rooms only) */
  netId: string | null;
  /** A mine whose claim is on its way */
  claiming?: boolean;
}

const TRACERS = 160;
const TRACER_LIFE = 0.05;

export class Combat {
  readonly group = new THREE.Group();
  private readonly missiles: Missile[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly booms: { mesh: THREE.Mesh; age: number; size: number }[] = [];
  private readonly box: Box = { cx: 0, cy: 0, cz: 0, qx: 0, qy: 0, qz: 0, qw: 1, hx: 1, hy: 1, hz: 1 };
  private readonly hit: RayHit = { toi: 0, nx: 0, ny: 1, nz: 0, collider: 0 };
  private readonly tracerPos = new Float32Array(TRACERS * 6);
  private readonly tracerLife = new Float32Array(TRACERS);
  private tracerHead = 0;
  private readonly tracers: THREE.LineSegments;
  private readonly mats: Record<'missile' | 'boom' | 'oil' | 'napalm' | 'mine', THREE.Material>;
  private readonly geos: Record<'missile' | 'boom' | 'disc' | 'mine', THREE.BufferGeometry>;
  /** Weapons work (after the start's grace period, and if the room has them) */
  hot = false;
  /** Set in a room */
  net: CombatNet | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly track: TrackData,
    private readonly racers: Racers,
    private readonly effects: Effects,
    private readonly events: CombatEvents,
    private readonly placeOf: (r: Racer) => number,
  ) {
    this.group.name = 'combat';
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    this.group.add(this.tracers);
    this.geos = {
      missile: new THREE.CylinderGeometry(0.09, 0.12, 0.9, 8).rotateX(Math.PI / 2),
      boom: new THREE.SphereGeometry(1, 16, 10),
      disc: new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2),
      mine: new THREE.CylinderGeometry(0.32, 0.36, 0.14, 12),
    };
    this.mats = {
      missile: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0xff5a1a, emissiveIntensity: 0.6 }),
      boom: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      oil: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -3 }),
      napalm: new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
      mine: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, emissive: 0xff1a10, emissiveIntensity: 1 }),
    };
  }

  // ---------------------------------------------------------------- per physics step

  fixed(dt: number, now: number): void {
    for (const r of this.racers.list) {
      if (r.remote) continue;
      if (r.wrecked) {
        stepGun(r.gun, false, dt);
        continue;
      }
      const shots = stepGun(r.gun, this.hot && r.input.fire, dt);
      for (let k = 0; k < shots; k++) this.fireRound(r, now);
      if (shots) this.events.fired(r);
      if (this.hot && r.input.missile && r.missiles > 0) this.launch(r, now);
      if (this.hot && r.input.defence && r.defence) this.drop(r, now);
      if (r.flaming > 0) this.flame(r, dt, now);
      this.pads(r, now);
    }
    this.stepMissiles(dt, now);
    this.stepHazards(dt, now);
  }

  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly local = { x: 0, y: 0, z: 0 };

  private fireRound(r: Racer, now: number): void {
    const o = this.o;
    const d = this.d;
    this.racers.muzzle(r, o, d);
    // Spread: a random tilt within the cone.
    d.x += (Math.random() - 0.5) * GUN.spread * 2;
    d.y += (Math.random() - 0.5) * GUN.spread * 2;
    d.z += (Math.random() - 0.5) * GUN.spread * 2;
    d.normalize();
    let range = GUN.maxRange;
    if (this.physics.castRay(o, d, range, GROUP.WORLD | GROUP.BARRIER, this.hit)) range = this.hit.toi;
    let victim: Racer | null = null;
    for (const other of this.racers.list) {
      if (other === r || other.wrecked || other.ghost(now)) continue;
      const t = rayBox(o, d, range, this.racers.boxOf(other, this.box), this.local);
      if (t !== null && t < range) {
        range = t;
        victim = other;
      }
    }
    const ex = o.x + d.x * range;
    const ey = o.y + d.y * range;
    const ez = o.z + d.z * range;
    this.tracer(o.x, o.y, o.z, ex, ey, ez);
    if (victim) {
      this.racers.boxOf(victim, this.box);
      toBoxSpace({ x: ex, y: ey, z: ez }, this.box, this.local);
      this.racers.hurt(victim, roundDamage(r.gun, range), zoneAt(this.local.x, this.local.y - 0.2, this.local.z), r, 'gun', now);
      this.events.hit(r, victim);
      if (Math.random() < 0.5) this.effects.sparks(ex, ey, ez, 2);
    } else if (range < GUN.maxRange && Math.random() < 0.25) {
      this.effects.sparks(ex, ey, ez, 1);
    }
  }

  private tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const i = this.tracerHead;
    this.tracerHead = (this.tracerHead + 1) % TRACERS;
    // A short streak toward the end point, not the whole line: reads as a bullet.
    const len = Math.hypot(bx - ax, by - ay, bz - az) || 1;
    const k = Math.min(1, 9 / len);
    const sx = ax + (bx - ax) * Math.random() * (1 - k);
    const sy = ay + (by - ay) * Math.random() * (1 - k);
    const sz = az + (bz - az) * Math.random() * (1 - k);
    this.tracerPos.set([sx, sy, sz, sx + (bx - ax) * k, sy + (by - ay) * k, sz + (bz - az) * k], i * 6);
    this.tracerLife[i] = TRACER_LIFE;
  }

  private launch(r: Racer, now: number): void {
    r.missiles--;
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    this.racers.muzzle(r, o, d);
    const target = this.seek(r, o, d, now);
    const v = r.car.body.body.linvel();
    const mesh = new THREE.Mesh(this.geos.missile, this.mats.missile);
    mesh.position.copy(o);
    this.group.add(mesh);
    const vel = d.multiplyScalar(MISSILE.speed).add(new THREE.Vector3(v.x, v.y, v.z));
    this.missiles.push({ owner: r, pos: o, vel, age: 0, mesh, visual: false, target });
    this.net?.missile(r, o, vel, target);
    this.events.missile(r);
  }

  /** The car a missile fired from `pos` along `dir` (unit) locks onto: the seeker's best that's in sight and out of smoke */
  private seek(owner: Racer, pos: THREE.Vector3, dir: THREE.Vector3, now: number): Racer | null {
    let best: Racer | null = null;
    let bestScore = Infinity;
    for (const r of this.racers.list) {
      if (r === owner || r.wrecked || r.ghost(now)) continue;
      const p = r.car.position;
      const c = { x: p.x, y: p.y + 0.3, z: p.z };
      const score = seekScore(pos, dir, c);
      if (score === null || score >= bestScore) continue;
      if (this.inSmoke(p.x, p.z) || this.smokeBetween(pos.x, pos.z, p.x, p.z)) continue;
      const dx = c.x - pos.x;
      const dy = c.y - pos.y;
      const dz = c.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      this.d.set(dx / dist, dy / dist, dz / dist);
      if (this.physics.castRay(pos, this.d, Math.max(0, dist - 2), GROUP.WORLD | GROUP.BARRIER, this.hit)) continue;
      best = r;
      bestScore = score;
    }
    return best;
  }

  /** Another client's missile: flown here for show (chasing the same car); its blast comes as a boom (remoteBoom) */
  visualMissile(owner: Racer, pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }, target: Racer | null): void {
    const mesh = new THREE.Mesh(this.geos.missile, this.mats.missile);
    mesh.position.set(pos.x, pos.y, pos.z);
    this.group.add(mesh);
    this.missiles.push({ owner, pos: new THREE.Vector3(pos.x, pos.y, pos.z), vel: new THREE.Vector3(vel.x, vel.y, vel.z), age: 0, mesh, visual: true, target });
    this.events.missile(owner);
  }

  /** Another client's blast: its splash on our own cars, and the look of it (ending its missile) */
  remoteBoom(x: number, y: number, z: number, radius: number, damage: number, push: number, owner: Racer | null, source: 'missile' | 'mine', now: number): void {
    let nearest = -1;
    let best = 12;
    this.missiles.forEach((m, i) => {
      const d = m.pos.distanceTo(new THREE.Vector3(x, y, z));
      if (m.visual && m.owner === owner && d < best) { best = d; nearest = i; }
    });
    if (nearest >= 0) {
      this.group.remove(this.missiles[nearest]!.mesh);
      this.missiles.splice(nearest, 1);
    }
    this.explode(x, y, z, radius, damage, push, owner, source, now, false);
  }

  private stepMissiles(dt: number, now: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]!;
      m.age += dt;
      if (m.target) this.home(m, dt, now);
      const step = m.vel.length() * dt;
      this.d.copy(m.vel).normalize();
      let hitAt = step;
      let hit = false;
      if (this.physics.castRay(m.pos, this.d, step, GROUP.WORLD | GROUP.BARRIER, this.hit)) {
        hitAt = this.hit.toi;
        hit = true;
      }
      for (const r of this.racers.list) {
        if (r.wrecked || r.ghost(now) || (r === m.owner && m.age < 0.25) || m.visual) continue;
        const t = rayBox(m.pos, this.d, hitAt, this.racers.boxOf(r, this.box));
        if (t !== null && t <= hitAt) {
          hitAt = t;
          hit = true;
        }
      }
      m.pos.addScaledVector(this.d, hitAt);
      // Close enough to its car: the proximity fuse.
      if (m.target && !hit && m.pos.distanceTo(m.target.car.position) < MISSILE.seek.fuse) hit = true;
      if (!m.target) m.vel.y -= 2 * dt;
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(m.pos.x + m.vel.x, m.pos.y + m.vel.y, m.pos.z + m.vel.z);
      this.effects.emit(m.pos.x, m.pos.y, m.pos.z, 0, 0.5, 0, 0.75, 0.72, 0.68, 0.5, 0.7, 0.4, 1.4);
      if (hit || m.age > MISSILE.life) {
        // Another client's missile: just vanish here (its boom arrives over the network).
        if (!m.visual) this.explode(m.pos.x, m.pos.y, m.pos.z, MISSILE.radius, MISSILE.damage, MISSILE.push, m.owner, 'missile', now);
        else if (m.age > MISSILE.life + 1 || hit) this.blast(m.pos.x, m.pos.y, m.pos.z, 1.5);
        this.group.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }
  }

  /** Steer a missile after its car, or let it go: wrecked, ghosted, hidden in smoke, or overshot */
  private home(m: Missile, dt: number, now: number): void {
    const t = m.target!;
    const p = t.car.position;
    if (t.wrecked || t.ghost(now) || this.inSmoke(p.x, p.z) || this.inSmoke(m.pos.x, m.pos.z)) {
      m.target = null;
      return;
    }
    const v = t.car.body.body.linvel();
    if (!steer(m.pos, m.vel, { x: p.x, y: p.y + 0.3, z: p.z }, v, dt)) m.target = null;
  }

  /**
   * A blast: damage falling off from the centre, and a shove up and away, for the cars simulated
   * here. In a room, other clients hear of it (`announce`) and apply it to theirs.
   */
  explode(x: number, y: number, z: number, radius: number, damage: number, push: number, owner: Racer | null, source: 'missile' | 'mine', now: number, announce = true): void {
    if (announce) this.net?.boom(x, y, z, radius, damage, push, owner, source);
    for (const r of this.racers.list) {
      if (r.remote || r.wrecked || r.ghost(now)) continue;
      const t = r.car.body.body.translation();
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      const k = 1 - (dist / radius) * 0.67;
      this.racers.boxOf(r, this.box);
      toBoxSpace({ x, y, z }, this.box, this.local);
      this.racers.hurt(r, damage * k, zoneAt(this.local.x, this.local.y, this.local.z), owner, source, now);
      const l = Math.max(0.5, Math.hypot(dx, dz));
      const m = r.car.body.params.mass * push * k;
      r.car.body.body.applyImpulse({ x: (dx / l) * m * 0.6, y: m, z: (dz / l) * m * 0.6 }, true);
      r.car.body.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.6, y: 0, z: (Math.random() - 0.5) * m * 0.6 }, true);
    }
    this.blast(x, y, z, radius);
  }

  /** The look and sound of an explosion, without the damage (wrecks use it too) */
  blast(x: number, y: number, z: number, size: number): void {
    const mesh = new THREE.Mesh(this.geos.boom, (this.mats.boom as THREE.MeshBasicMaterial).clone());
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.booms.push({ mesh, age: 0, size });
    this.effects.sparks(x, y, z, 18);
    for (let k = 0; k < 10; k++) this.effects.emit(x, y + 0.5, z, (Math.random() - 0.5) * 6, 2 + Math.random() * 3, (Math.random() - 0.5) * 6, 0.25, 0.22, 0.2, 2.2, 2.2, 0.6, 2.6);
    this.events.explosion(x, y, z, size);
  }

  // ---------------------------------------------------------------- defences

  private drop(r: Racer, now: number): void {
    const defence = r.defence as DefenceKind;
    r.defence = null;
    if (defence === 'flame') {
      // Not dropped: the car breathes fire backward for a few seconds.
      r.flaming = DEFENCE.flame.life;
      this.events.dropped(r, defence);
      return;
    }
    const kind: HazardKind = defence;
    const g = r.car.view.group;
    const fwd = { x: 0, y: 0, z: 0 };
    const right = { x: 0, y: 0, z: 0 };
    basis(g.quaternion, right, { x: 0, y: 0, z: 0 }, fwd);
    const back = 3.8;
    const at = (side: number): Hazard => {
      const x = g.position.x - fwd.x * back + right.x * side;
      const z = g.position.z - fwd.z * back + right.z * side;
      // Down onto the road.
      const y = this.physics.castRay({ x, y: g.position.y + 2, z }, { x: 0, y: -1, z: 0 }, 8, GROUP.WORLD, this.hit) ? g.position.y + 2 - this.hit.toi : g.position.y - 0.6;
      return { kind, owner: r, x, y, z, born: now, until: now + (kind === 'mines' ? DEFENCE.mines.life : DEFENCE[kind].life), mesh: null, netId: null };
    };
    const made = kind === 'mines' ? [-2.6, 0, 2.6].map(at) : [at(0)];
    for (const h of made) {
      h.mesh = this.hazardMesh(h);
      if (h.mesh) this.group.add(h.mesh);
      h.netId = this.net?.hazard({ kind, x: h.x, y: h.y, z: h.z, owner: r, until: h.until - now }) ?? null;
      this.hazards.push(h);
    }
    this.events.dropped(r, kind);
  }

  /** The rear flamethrower: everything in the cone behind the car burns */
  private flame(r: Racer, dt: number, now: number): void {
    r.flaming = Math.max(0, r.flaming - dt);
    const g = r.car.view.group;
    const fwd = { x: 0, y: 0, z: 0 };
    basis(g.quaternion, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, fwd);
    const f = DEFENCE.flame;
    for (const o of this.racers.list) {
      if (o === r || o.wrecked || o.ghost(now)) continue;
      const dx = o.car.position.x - g.position.x;
      const dz = o.car.position.z - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d > f.range || d < 0.5) continue;
      // Behind: within the cone round the car's back.
      const back = -(dx * fwd.x + dz * fwd.z) / d;
      if (back < Math.cos(f.cone)) continue;
      this.racers.hurt(o, f.dps * dt * (1 - (d / f.range) * 0.5), 'front', r, 'napalm', now);
    }
  }

  /** A hazard another client dropped (it lasts `life` more seconds) */
  addRemoteHazard(netId: string, kind: HazardKind, x: number, y: number, z: number, owner: Racer | null, life: number, now: number): void {
    if (this.hazards.some((h) => h.netId === netId)) return;
    const h: Hazard = { kind, owner, x, y, z, born: now - 1, until: now + life, mesh: null, netId };
    h.mesh = this.hazardMesh(h);
    if (h.mesh) this.group.add(h.mesh);
    this.hazards.push(h);
  }

  /** Gone from the room (expired, or a mine that went off) */
  removeHazard(netId: string): void {
    const i = this.hazards.findIndex((h) => h.netId === netId);
    if (i < 0) return;
    const h = this.hazards[i]!;
    if (h.mesh) this.group.remove(h.mesh);
    this.hazards.splice(i, 1);
  }

  private hazardMesh(h: Hazard): THREE.Object3D | null {
    if (h.kind === 'smoke') return null;
    const m = new THREE.Mesh(h.kind === 'mines' ? this.geos.mine : this.geos.disc, this.mats[h.kind === 'mines' ? 'mine' : h.kind as 'oil' | 'napalm']);
    const r = h.kind === 'mines' ? 1 : DEFENCE[h.kind as 'oil' | 'napalm'].radius;
    m.scale.set(r, 1, r);
    m.position.set(h.x, h.y + (h.kind === 'mines' ? 0.07 : 0.04), h.z);
    return m;
  }

  private stepHazards(dt: number, now: number): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]!;
      let gone = now > h.until;
      if (!gone && (h.kind === 'napalm' || h.kind === 'mines')) {
        for (const r of this.racers.list) {
          if (r.remote || r.wrecked || r.ghost(now)) continue;
          const t = r.car.body.body.translation();
          const d = Math.hypot(t.x - h.x, t.z - h.z);
          if (h.kind === 'napalm' && d < DEFENCE.napalm.radius && Math.abs(t.y - h.y) < 3) {
            this.racers.hurt(r, DEFENCE.napalm.dps * dt, null, h.owner, 'napalm', now);
          } else if (h.kind === 'mines' && d < DEFENCE.mines.trigger && now - h.born > 0.6 && !(r === h.owner && now - h.born < 1.5)) {
            if (h.netId && this.net) {
              // In a room: whoever's claim wins sets it off, once.
              if (!h.claiming) {
                h.claiming = true;
                const at = { x: h.x, y: h.y, z: h.z, owner: h.owner };
                void this.net.claim(h.netId).then((won) => {
                  if (won) this.explode(at.x, at.y + 0.3, at.z, DEFENCE.mines.radius, DEFENCE.mines.damage, DEFENCE.mines.push, at.owner, 'mine', performance.now() / 1000);
                });
              }
              break;
            }
            this.explode(h.x, h.y + 0.3, h.z, DEFENCE.mines.radius, DEFENCE.mines.damage, DEFENCE.mines.push, h.owner, 'mine', now);
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        if (h.mesh) this.group.remove(h.mesh);
        this.hazards.splice(i, 1);
      }
    }
  }

  /** Oil under (x, z)? Wheels there have no grip. */
  surfaceAt(x: number, z: number): Surface | null {
    for (const h of this.hazards) {
      if (h.kind === 'oil' && Math.hypot(x - h.x, z - h.z) < DEFENCE.oil.radius) return 'oil';
    }
    return null;
  }

  /** Whether a point is inside a smoke cloud (bots can't see into, or out of, smoke) */
  inSmoke(x: number, z: number): boolean {
    for (const h of this.hazards) if (h.kind === 'smoke' && Math.hypot(x - h.x, z - h.z) < DEFENCE.smoke.radius) return true;
    return false;
  }

  /** Whether the line from a to b passes through smoke */
  smokeBetween(ax: number, az: number, bx: number, bz: number): boolean {
    for (const h of this.hazards) {
      if (h.kind !== 'smoke') continue;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((h.x - ax) * dx + (h.z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - h.x, az + dz * t - h.z) < DEFENCE.smoke.radius) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- pads

  private pads(r: Racer, now: number): void {
    const t = this.track;
    for (let i = 0; i < t.pads.length; i++) {
      const p = t.pads[i]!;
      if (Math.abs(loopDelta(r.loc.s, p.s, t.lapLength)) > PAD.reach || Math.abs(r.loc.u - p.u) > PAD.reach) continue;
      if ((r.pickups.cooldowns.get(i) ?? -Infinity) > now) continue;
      r.pickups.cooldowns.set(i, now + PAD.cooldown);
      if (p.kind === 'gun') {
        loadGun(r.gun);
        this.events.pickup(r, 'gun', null, false);
      } else if (p.kind === 'sword') {
        r.missiles = Math.min(MISSILE.max, r.missiles + MISSILE.perPad);
        arm(r.gun);
        const spikes = Math.random() < SPIKES.chance;
        if (spikes) r.spikes = SPIKES.duration;
        this.events.pickup(r, 'sword', null, spikes);
      } else if (p.kind === 'skull') {
        this.springTrap(r, p.s, now);
        this.events.pickup(r, 'skull', null, false);
      } else {
        patch(r.damage, PAD.patch);
        r.defence = rollDefence(this.placeOf(r), this.racers.list.length);
        this.events.pickup(r, 'shield', r.defence, false);
      }
    }
  }

  /** A skull pad's trap: a wall of fire across the road TRAP.ahead metres on, for whoever's ahead */
  private springTrap(r: Racer, padS: number, now: number): void {
    const t = this.track;
    const at = padS + TRAP.ahead;
    const i = Math.floor((((at % t.lapLength) + t.lapLength) % t.lapLength) / t.ds) % t.n;
    const hw = t.halfWidth[i] as number;
    for (let u = -hw + 2; u <= hw - 1; u += TRAP.spacing) {
      const x = (t.pos[i * 3] as number) + (t.right[i * 3] as number) * u;
      const y = t.pos[i * 3 + 1] as number;
      const z = (t.pos[i * 3 + 2] as number) + (t.right[i * 3 + 2] as number) * u;
      const h: Hazard = { kind: 'napalm', owner: r, x, y, z, born: now, until: now + TRAP.life, mesh: null, netId: null };
      h.mesh = this.hazardMesh(h);
      if (h.mesh) this.group.add(h.mesh);
      h.netId = this.net?.hazard({ kind: 'napalm', x, y, z, owner: r, until: TRAP.life }) ?? null;
      this.hazards.push(h);
    }
  }

  // ---------------------------------------------------------------- drawing

  private remoteFire = new Map<Racer, number>();

  frame(dt: number, now: number): void {
    // Other clients' cars firing: their tracers, drawn here (the hits are decided over there).
    for (const r of this.racers.list) {
      if (!r.remote || !(r.snap.flags & FLAG.firing) || r.snap.flags & FLAG.wrecked) continue;
      const t = (this.remoteFire.get(r) ?? 0) + dt;
      if (t < 0.1) {
        this.remoteFire.set(r, t);
        continue;
      }
      this.remoteFire.set(r, 0);
      const o = this.o;
      const d = this.d;
      this.racers.muzzle(r, o, d);
      let range = 110;
      if (this.physics.castRay(o, d, range, GROUP.WORLD | GROUP.BARRIER, this.hit)) range = this.hit.toi;
      this.tracer(o.x, o.y, o.z, o.x + d.x * range, o.y + d.y * range, o.z + d.z * range);
      this.events.fired(r);
    }
    // Flamethrowers: a jet of fire out of the back.
    for (const r of this.racers.list) {
      const on = r.remote ? (r.snap.flags & FLAG.flame) !== 0 : r.flaming > 0;
      if (!on || r.wrecked) continue;
      const g = r.car.view.group;
      const back = new THREE.Vector3(0, 0.1, 1).applyQuaternion(g.quaternion);
      const v = r.car.body.body.linvel();
      for (let k = 0; k < 3; k++) {
        const sp = 14 + Math.random() * 6;
        const spread = (Math.random() - 0.5) * 0.5;
        this.effects.emit(g.position.x + back.x * 2.5, g.position.y + 0.3, g.position.z + back.z * 2.5,
          v.x + (back.x + back.z * spread) * sp, 1 + Math.random(), v.z + (back.z - back.x * spread) * sp,
          1, 0.45 + Math.random() * 0.3, 0.08, 0.7, 0.55, 0.95, 2.6);
      }
    }
    for (let i = 0; i < TRACERS; i++) {
      if (this.tracerLife[i]! <= 0) continue;
      this.tracerLife[i] = this.tracerLife[i]! - dt;
      if (this.tracerLife[i]! <= 0) this.tracerPos.fill(0, i * 6, i * 6 + 6);
    }
    (this.tracers.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i]!;
      b.age += dt;
      const k = b.age / 0.45;
      b.mesh.scale.setScalar(b.size * (0.3 + k * 0.9));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.booms.splice(i, 1);
      }
    }
    for (const h of this.hazards) {
      if (h.kind === 'smoke' && Math.random() < dt * 30) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * DEFENCE.smoke.radius * 0.8;
        this.effects.emit(h.x + Math.cos(a) * rr, h.y + 0.5, h.z + Math.sin(a) * rr, 0, 0.6, 0, 0.55, 0.55, 0.58, 3.5, 2.5, 0.55, 2.4);
      } else if (h.kind === 'napalm' && Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * DEFENCE.napalm.radius;
        this.effects.emit(h.x + Math.cos(a) * rr, h.y + 0.2, h.z + Math.sin(a) * rr, 0, 2.2, 0, 1, 0.45, 0.1, 1.1, 0.6, 0.9, 1.2);
      } else if (h.kind === 'mines' && h.mesh) {
        ((h.mesh as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = Math.floor(now * 3) % 2 ? 2.5 : 0.3;
      }
    }
  }

  dispose(): void {
    this.tracers.geometry.dispose();
    (this.tracers.material as THREE.Material).dispose();
    for (const g of Object.values(this.geos)) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}

/** Which defence a shield pad gives: leaders get things to drop on the chasing pack, the back gets cover */
export function rollDefence(place: number, cars: number): DefenceKind {
  const back = cars > 1 ? (place - 1) / (cars - 1) : 0;
  const weights: [DefenceKind, number][] = [
    ['oil', 26 - back * 8],
    ['mines', 30 - back * 18],
    ['smoke', 13 + back * 13],
    ['napalm', 16 + back * 12],
    // The flamethrower is for whoever has someone right on their tail: mostly the front-runners.
    ['flame', 18 - back * 6],
  ];
  let total = 0;
  for (const [, w] of weights) total += w;
  let x = Math.random() * total;
  for (const [k, w] of weights) {
    x -= w;
    if (x < 0) return k;
  }
  return 'oil';
}
