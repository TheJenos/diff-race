import { computeFrames } from './frames';
import { trackHash } from './hash';
import { q } from './dmath';
import type { ThemeId, TrackSpec } from './spec';
import type { GridSlot, SceneryItem, TrackBounds, TrackData, TrackKerb, TrackPad, TrackRamp } from './types';

/*
 * The generator's last stage, shared with the fallback: centre-line points and per-sample widths
 * in, a finished TrackData out (frames, rounded typed arrays, bounds, hash).
 */

export interface TrackParts {
  spec: TrackSpec;
  name: string;
  theme: ThemeId;
  /** 3 per sample, a closed loop, `ds` apart */
  pos: ArrayLike<number>;
  ds: number;
  halfWidth: ArrayLike<number>;
  /** Racing line offsets (m right of centre); omitted: the centre line */
  line?: ArrayLike<number>;
  verge: number;
  /** Banking scale (0: flat) */
  bank: number;
  grid: GridSlot[];
  checkpoints: number[];
  pads?: TrackPad[];
  ramps?: TrackRamp[];
  kerbs?: TrackKerb[];
  scenery?: SceneryItem[];
  fallback: boolean;
}

/** How far below the lowest road a car may fall before it respawns (m) */
const KILL_DEPTH = 12;

export function assembleTrack(p: TrackParts): TrackData {
  const n = p.halfWidth.length;
  const frames = computeFrames(p.pos, n, p.ds, p.bank);
  const pos = new Float32Array(n * 3);
  const bounds: TrackBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < n; i++) {
    const x = q(p.pos[i * 3] as number);
    const y = q(p.pos[i * 3 + 1] as number);
    const z = q(p.pos[i * 3 + 2] as number);
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  const halfWidth = new Float32Array(n);
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    halfWidth[i] = q(p.halfWidth[i] as number);
    line[i] = q(p.line ? (p.line[i] as number) : 0);
  }
  const data: Omit<TrackData, 'hash'> = {
    spec: p.spec,
    name: p.name,
    theme: p.theme,
    n,
    ds: q(p.ds),
    lapLength: q(n * p.ds),
    verge: p.verge,
    killY: q(bounds.minY - KILL_DEPTH),
    bounds,
    pos,
    fwd: Float32Array.from(frames.fwd),
    right: Float32Array.from(frames.right),
    up: Float32Array.from(frames.up),
    halfWidth,
    curvature: Float32Array.from(frames.curvature),
    line,
    grid: p.grid,
    checkpoints: p.checkpoints,
    pads: p.pads ?? [],
    ramps: p.ramps ?? [],
    kerbs: p.kerbs ?? [],
    scenery: p.scenery ?? [],
    fallback: p.fallback,
  };
  return { ...data, hash: trackHash(data) };
}
