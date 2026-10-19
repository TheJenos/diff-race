import { MISSILE } from './weapons';

/*
 * Heat-seeking missiles. At launch a missile's seeker picks the car it will chase: the one nearest
 * the line it's fired along (and, less, the nearest), inside its cone and range. In flight it turns
 * toward that car at a limited rate, aiming a little ahead of it, so a hard swerve at close range
 * can still beat it. It loses the car when the car gets behind it (it overshot); combat.ts also
 * drops the lock on smoke, a wreck or a ghosted car. Without a lock it flies on straight. Pure.
 */

type V3 = { x: number; y: number; z: number };

/** How well the seeker sees `c` from `pos` firing along `dir` (unit): lower is better, null if it can't */
export function seekScore(pos: V3, dir: V3, c: V3): number | null {
  const dx = c.x - pos.x;
  const dy = c.y - pos.y;
  const dz = c.z - pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > MISSILE.seek.range || d < 1) return null;
  const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle > MISSILE.seek.cone) return null;
  return angle / MISSILE.seek.cone + (d / MISSILE.seek.range) * 0.5;
}

/**
 * Turn `vel` (in place) toward `target`, moving at `tvel`, by at most MISSILE.seek.turn × dt
 * radians, keeping its speed. Returns false, leaving `vel` alone, when the target is behind.
 */
export function steer(pos: V3, vel: V3, target: V3, tvel: V3, dt: number): boolean {
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (speed < 1e-6) return false;
  const ux = vel.x / speed;
  const uy = vel.y / speed;
  const uz = vel.z / speed;
  const tx = target.x - pos.x;
  const ty = target.y - pos.y;
  const tz = target.z - pos.z;
  const d = Math.hypot(tx, ty, tz);
  if (d < 1e-6) return true;
  if (tx * ux + ty * uy + tz * uz <= 0) return false;
  // Aim where it'll be: ahead by the time to get there (capped, so a far car isn't over-led).
  const t = Math.min(d / speed, MISSILE.seek.lead);
  let wx = tx + tvel.x * t;
  let wy = ty + tvel.y * t;
  let wz = tz + tvel.z * t;
  const wl = Math.hypot(wx, wy, wz);
  if (wl < 1e-6) return true;
  wx /= wl;
  wy /= wl;
  wz /= wl;
  const cos = Math.max(-1, Math.min(1, ux * wx + uy * wy + uz * wz));
  const angle = Math.acos(cos);
  const most = MISSILE.seek.turn * dt;
  let nx = wx;
  let ny = wy;
  let nz = wz;
  if (angle > most) {
    // Part of the way round the great circle from where it's going to where it wants to go.
    const s = Math.sin(angle);
    const a = Math.sin(angle - most) / s;
    const b = Math.sin(most) / s;
    nx = ux * a + wx * b;
    ny = uy * a + wy * b;
    nz = uz * a + wz * b;
  }
  vel.x = nx * speed;
  vel.y = ny * speed;
  vel.z = nz * speed;
  return true;
}
