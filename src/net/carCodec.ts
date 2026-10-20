/*
 * A car's state in one short string, for the database: what other clients need to draw and
 * predict it. Integers in base 36 joined by dots (about 70 characters), so a 20 Hz stream stays
 * small. Pure.
 *
 *   x.y.z (cm) . qx.qy.qz (rotation, smallest-three ×10000, w ≥ 0) . vx.vy.vz (cm/s)
 *   . wx.wy.wz (angular, mrad/s) . turret yaw.pitch (mrad) . D (race distance, dm)
 *   . armour . flags . dents
 * `dents` came later: a string without it decodes as no dents.
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
  /** Damage taken per zone, packed (packDents): other clients dent the car to match */
  dents: number;
}

/** Zone damage per 6 bits, in this order (car/damage.ts's zones), in steps of DENT_STEP, up to 63 steps */
export const DENT_ZONES = ['front', 'rear', 'left', 'right', 'roof'] as const;
export const DENT_STEP = 2;

export function packDents(damage: Readonly<Record<(typeof DENT_ZONES)[number], number>>): number {
  let n = 0;
  DENT_ZONES.forEach((z, i) => {
    n += Math.min(63, Math.max(0, Math.floor(damage[z] / DENT_STEP))) * 64 ** i;
  });
  return n;
}

/** Each zone's damage (in DENT_STEPs), in DENT_ZONES order */
export function unpackDents(n: number): number[] {
  return DENT_ZONES.map((_, i) => Math.floor(n / 64 ** i) % 64);
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
    enc(c.dents),
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
  out.dents = dec(p[17]);
  return out;
}

export const newSnapshot = (): CarSnapshot => ({
  x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, yaw: 0, pitch: 0, D: 0, armour: 0, flags: 0, dents: 0,
});

/** What the database rules accept for a pose string */
export const CODEC_PATTERN = /^[-0-9a-z.]{1,200}$/;
