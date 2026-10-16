/*
 * A ray against a car's box: the slab test in the box's own space. Pure. The shooter tests its
 * rounds against the boxes of the cars as it sees them (remote cars at their predicted present
 * position), so what you see is what you hit.
 */

export interface Box {
  /** Centre, rotation (unit quaternion) and half extents */
  cx: number; cy: number; cz: number;
  qx: number; qy: number; qz: number; qw: number;
  hx: number; hy: number; hz: number;
}

type V = { x: number; y: number; z: number };

/** Rotate v by the inverse of q (world into box space) */
function unrotate(q: Box, v: V, out: V): V {
  const qx = -q.qx, qy = -q.qy, qz = -q.qz, qw = q.qw;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  out.x = v.x + qw * tx + (qy * tz - qz * ty);
  out.y = v.y + qw * ty + (qz * tx - qx * tz);
  out.z = v.z + qw * tz + (qx * ty - qy * tx);
  return out;
}

const _o = { x: 0, y: 0, z: 0 };
const _d = { x: 0, y: 0, z: 0 };
const _r = { x: 0, y: 0, z: 0 };

/**
 * Distance along the ray (origin o, unit direction d) to where it enters the box, within `max`,
 * or null. `local` (if given) gets the hit point in box space (for which zone was hit).
 */
export function rayBox(o: V, d: V, max: number, b: Box, local?: V): number | null {
  _r.x = o.x - b.cx;
  _r.y = o.y - b.cy;
  _r.z = o.z - b.cz;
  unrotate(b, _r, _o);
  unrotate(b, d, _d);
  let near = 0;
  let far = max;
  for (const [p, v, h] of [[_o.x, _d.x, b.hx], [_o.y, _d.y, b.hy], [_o.z, _d.z, b.hz]] as const) {
    if (Math.abs(v) < 1e-9) {
      if (p < -h || p > h) return null;
      continue;
    }
    let t1 = (-h - p) / v;
    let t2 = (h - p) / v;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far) return null;
  }
  if (local) {
    local.x = _o.x + _d.x * near;
    local.y = _o.y + _d.y * near;
    local.z = _o.z + _d.z * near;
  }
  return near;
}

/** A point against a box, in box space (for splash: which zone faces the blast) */
export function toBoxSpace(p: V, b: Box, out: V): V {
  _r.x = p.x - b.cx;
  _r.y = p.y - b.cy;
  _r.z = p.z - b.cz;
  return unrotate(b, _r, out);
}
