import * as THREE from 'three';
import { GROUP, type PhysicsWorld, type RayHit } from './physics';
import { newAutoAim, updateAutoAim, type AimCandidate } from './combat/rules/autoAim';
import type { RaceSession } from './raceSession';
import type { Racer } from './racer';

/*
 * The player's auto aim (the turret always aims itself): each frame, which car it locks onto, picked
 * by combat/rules/autoAim.ts from what's in front of the camera and in sight of the guns. Sight
 * is a ray from the guns to the car (barriers and hills block it) and no smoke between, checked
 * every SIGHT_EVERY per car, as the bots see.
 */

const SIGHT_EVERY = 0.1;

export class AutoAim {
  private readonly st = newAutoAim();
  private readonly sight = new Map<string, { at: number; visible: boolean }>();
  private readonly hit: RayHit = { toi: 0, nx: 0, ny: 1, nz: 0, collider: 0 };
  private readonly fwd = new THREE.Vector3();
  private readonly candidates: AimCandidate[] = [];

  constructor(private readonly physics: PhysicsWorld, private readonly session: RaceSession) {}

  /** The car to aim at this frame, or null to aim straight ahead */
  update(player: Racer, camera: THREE.Camera, dt: number): Racer | null {
    const now = performance.now() / 1000;
    camera.getWorldDirection(this.fwd);
    this.candidates.length = 0;
    for (const r of this.session.racers.list) {
      if (r === player || r.wrecked) continue;
      const p = r.car.position;
      this.candidates.push({ id: r.id, x: p.x, y: p.y + 0.3, z: p.z, visible: !r.ghost(now) && this.canSee(player, r, now) });
    }
    const id = updateAutoAim(this.st, camera.position, this.fwd, this.candidates, dt);
    return id ? this.session.racers.get(id) ?? null : null;
  }

  /** Forget the lock (a new race, a respawn) */
  reset(): void {
    this.st.target = null;
    this.st.lostFor = 0;
    this.sight.clear();
  }

  private canSee(player: Racer, o: Racer, now: number): boolean {
    const c = this.sight.get(o.id);
    if (c && now - c.at < SIGHT_EVERY) return c.visible;
    const a = player.car.position;
    const b = o.car.position;
    const from = { x: a.x, y: a.y + player.car.view.gunHeight, z: a.z };
    const dx = b.x - from.x;
    const dy = b.y + 0.3 - from.y;
    const dz = b.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    let visible = d > 0.1 && !this.physics.castRay(from, { x: dx / d, y: dy / d, z: dz / d }, Math.max(0, d - 2), GROUP.WORLD | GROUP.BARRIER, this.hit);
    const combat = this.session.combat;
    if (visible && (combat.inSmoke(b.x, b.z) || combat.smokeBetween(a.x, a.z, b.x, b.z))) visible = false;
    this.sight.set(o.id, { at: now, visible });
    return visible;
  }
}
