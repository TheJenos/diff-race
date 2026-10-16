/*
 * A car's state in one short string, for the database: what other clients need to draw and
 * predict it. Integers in base 36 joined by dots (about 70 characters), so a 20 Hz stream stays
 * small. Pure.
 *
 *   x.y.z (cm) . qx.qy.qz (rotation, smallest-three ×10000, w ≥ 0) . vx.vy.vz (cm/s)
 *   . wx.wy.wz (angular, mrad/s) . turret yaw.pitch (mrad) . D (race distance, dm)
 *   . armour . flags
 */

export interface CarSnapshot {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  yaw: number; pitch: number;
  D: number;
  armour: number;
  flags: number;
}

export const FLAG = {
  firing: 1,
  nitro: 2,
  wrecked: 4,
  ghost: 8,
  finished: 16,
  armed: 32,
  braking: 64,
  spikes: 128,
  flame: 256,
} as const;

const enc = (n: number) => Math.round(n).toString(36);
const dec = (s: string | undefined) => (s ? parseInt(s, 36) : 0) || 0;

export function encodeCar(c: CarSnapshot): string {
  // Keep w non-negative (q and -q are the same rotation) so it can be rebuilt from x, y, z.
  const k = c.qw < 0 ? -1 : 1;
  return [
    enc(c.x * 100), enc(c.y * 100), enc(c.z * 100),
    enc(c.qx * k * 10_000), enc(c.qy * k * 10_000), enc(c.qz * k * 10_000),
    enc(c.vx * 100), enc(c.vy * 100), enc(c.vz * 100),
    enc(c.wx * 1000), enc(c.wy * 1000), enc(c.wz * 1000),
    enc(c.yaw * 1000), enc(c.pitch * 1000),
    enc(c.D * 10),
    enc(Math.max(0, c.armour)),
    enc(c.flags),
  ].join('.');
}

export function decodeCar(s: string, out: CarSnapshot): CarSnapshot | null {
  const p = s.split('.');
  if (p.length < 17) return null;
  out.x = dec(p[0]) / 100;
  out.y = dec(p[1]) / 100;
  out.z = dec(p[2]) / 100;
  out.qx = dec(p[3]) / 10_000;
  out.qy = dec(p[4]) / 10_000;
  out.qz = dec(p[5]) / 10_000;
  out.qw = Math.sqrt(Math.max(0, 1 - out.qx * out.qx - out.qy * out.qy - out.qz * out.qz));
  out.vx = dec(p[6]) / 100;
  out.vy = dec(p[7]) / 100;
  out.vz = dec(p[8]) / 100;
  out.wx = dec(p[9]) / 1000;
  out.wy = dec(p[10]) / 1000;
  out.wz = dec(p[11]) / 1000;
  out.yaw = dec(p[12]) / 1000;
  out.pitch = dec(p[13]) / 1000;
  out.D = dec(p[14]) / 10;
  out.armour = dec(p[15]);
  out.flags = dec(p[16]);
  return out;
}

export const newSnapshot = (): CarSnapshot => ({
  x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, yaw: 0, pitch: 0, D: 0, armour: 0, flags: 0,
});

/** What the database rules accept for a pose string */
export const CODEC_PATTERN = /^[-0-9a-z.]{1,200}$/;
