/*
 * Plain {x, y, z} vector and {x, y, z, w} quaternion maths, in place, for code that must not
 * depend on three.js (the car body, the track, bots). Pure.
 */

export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const length = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

export function set(out: V3, x: number, y: number, z: number): V3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: V3, a: V3): V3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function cross(a: V3, b: V3, out: V3): V3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function normalize(a: V3, out: V3 = a): V3 {
  const l = length(a) || 1;
  out.x = a.x / l;
  out.y = a.y / l;
  out.z = a.z / l;
  return out;
}

/** out = a + b × k */
export function addScaled(a: V3, b: V3, k: number, out: V3): V3 {
  out.x = a.x + b.x * k;
  out.y = a.y + b.y * k;
  out.z = a.z + b.z * k;
  return out;
}

/** `v` rotated by unit quaternion `q` */
export function rotate(q: Q4, v: V3, out: V3): V3 {
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  const x = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const y = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const z = v.z + q.w * tz + (q.x * ty - q.y * tx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/** The car-space axes of rotation `q`: right (+x), up (+y), forward (-z) */
export function basis(q: Q4, right: V3, up: V3, fwd: V3): void {
  rotate(q, { x: 1, y: 0, z: 0 }, right);
  rotate(q, { x: 0, y: 1, z: 0 }, up);
  rotate(q, { x: 0, y: 0, z: -1 }, fwd);
}

/** The rotation whose right, up and forward (-z) axes are these (orthonormal) vectors */
export function quatFromBasis(right: V3, up: V3, fwd: V3, out: Q4): Q4 {
  // Rotation matrix columns: x = right, y = up, z = back = -fwd.
  const m00 = right.x, m01 = up.x, m02 = -fwd.x;
  const m10 = right.y, m11 = up.y, m12 = -fwd.y;
  const m20 = right.z, m21 = up.z, m22 = -fwd.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    out.w = 0.25 / s;
    out.x = (m21 - m12) * s;
    out.y = (m02 - m20) * s;
    out.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out.w = (m21 - m12) / s;
    out.x = 0.25 * s;
    out.y = (m01 + m10) / s;
    out.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out.w = (m02 - m20) / s;
    out.x = (m01 + m10) / s;
    out.y = 0.25 * s;
    out.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out.w = (m10 - m01) / s;
    out.x = (m02 + m20) / s;
    out.y = (m12 + m21) / s;
    out.z = 0.25 * s;
  }
  return out;
}
