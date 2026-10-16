import { clamp, len3, q4 } from './dmath';

/*
 * The frame of every centre-line sample: forward along the track, right across it and up out of
 * the road, plus the signed curvature (positive: turning right). Banking tilts the frame into
 * corners: the outside edge rises.
 */

/** Curvature (1/m) times this is the bank, as the drop of the right vector per metre across */
const BANK_GAIN = 6;
/** At most this much tilt (≈ 11°) */
const MAX_BANK = 0.2;
/** Curvature is box-filtered over this many samples each side before banking, so banking eases in */
const KAPPA_SMOOTH = 3;

export interface Frames {
  fwd: Float64Array;
  right: Float64Array;
  up: Float64Array;
  curvature: Float64Array;
}

/**
 * Frames of a closed loop of `n` points (3 per point in `pos`) spaced `ds` apart.
 * `bank` scales the banking (0: flat road). Outputs are rounded (q4) so they're deterministic.
 */
export function computeFrames(pos: ArrayLike<number>, n: number, ds: number, bank = 1): Frames {
  const fwd = new Float64Array(n * 3);
  const flat = new Float64Array(n * 3);
  const raw = new Float64Array(n);
  const p = (i: number, k: number) => pos[((i + n) % n) * 3 + k] as number;
  for (let i = 0; i < n; i++) {
    const dx = p(i + 1, 0) - p(i - 1, 0);
    const dy = p(i + 1, 1) - p(i - 1, 1);
    const dz = p(i + 1, 2) - p(i - 1, 2);
    const l = len3(dx, dy, dz) || 1;
    fwd[i * 3] = dx / l;
    fwd[i * 3 + 1] = dy / l;
    fwd[i * 3 + 2] = dz / l;
    // Right on the level: forward × world up = (-fz, 0, fx), normalised.
    const h = Math.sqrt(dx * dx + dz * dz) || 1;
    flat[i * 3] = -dz / h;
    flat[i * 3 + 2] = dx / h;
  }
  const f = (i: number, k: number) => fwd[((i + n) % n) * 3 + k] as number;
  for (let i = 0; i < n; i++) {
    // How fast forward turns toward the right, per metre.
    const turn = (f(i + 1, 0) - f(i - 1, 0)) * (flat[i * 3] as number) + (f(i + 1, 2) - f(i - 1, 2)) * (flat[i * 3 + 2] as number);
    raw[i] = turn / (2 * ds);
  }
  const curvature = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -KAPPA_SMOOTH; k <= KAPPA_SMOOTH; k++) sum += raw[(i + k + n) % n] as number;
    curvature[i] = sum / (2 * KAPPA_SMOOTH + 1);
  }
  const right = new Float64Array(n * 3);
  const up = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const tx = fwd[i * 3] as number;
    const ty = fwd[i * 3 + 1] as number;
    const tz = fwd[i * 3 + 2] as number;
    const b = clamp((curvature[i] as number) * BANK_GAIN * bank, -MAX_BANK, MAX_BANK);
    // Tilted right: dip it on a right-hand bend, so the outside (left) edge rises.
    let rx = flat[i * 3] as number;
    let ry = -b;
    let rz = flat[i * 3 + 2] as number;
    // up = right × forward, then right = forward × up: an orthonormal frame even on a slope.
    let ux = ry * tz - rz * ty;
    let uy = rz * tx - rx * tz;
    let uz = rx * ty - ry * tx;
    const ul = len3(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    rx = ty * uz - tz * uy;
    ry = tz * ux - tx * uz;
    rz = tx * uy - ty * ux;
    const rl = len3(rx, ry, rz) || 1;
    right[i * 3] = q4(rx / rl);
    right[i * 3 + 1] = q4(ry / rl);
    right[i * 3 + 2] = q4(rz / rl);
    up[i * 3] = q4(ux);
    up[i * 3 + 1] = q4(uy);
    up[i * 3 + 2] = q4(uz);
    fwd[i * 3] = q4(tx);
    fwd[i * 3 + 1] = q4(ty);
    fwd[i * 3 + 2] = q4(tz);
    curvature[i] = Math.round((curvature[i] as number) * 1e6) / 1e6;
  }
  return { fwd, right, up, curvature };
}
