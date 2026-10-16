import { len, q, q4, sinCosTurns } from './dmath';
import { BARRIER_THICK } from './constants';
import type { Rng } from './rng';
import type { ThemeId } from './spec';
import type { SceneryItem } from './types';

/*
 * Scenery outside the barriers: floodlights along the whole loop, tyre walls round the outside of
 * hairpins, a grandstand by the start, and the theme's junk scattered about (containers and cranes
 * at the docks, rocks in the quarry, smokestacks at the foundry). Nothing is placed where it could
 * touch the track or another prop. Pure.
 */

/** Footprint radius of each kind (m) */
export const PROP_RADIUS: Record<string, number> = {
  container: 4, containerStack: 4.5, crane: 10, barrels: 1.6, warehouse: 15, tyres: 1.4, rock: 4, boulder: 2.2,
  silo: 4.5, smokestack: 4, fireBarrel: 0.8, furnace: 9, pipes: 6, floodlight: 1, grandstand: 16,
};

const SCATTER: Record<ThemeId, readonly (readonly [string, number])[]> = {
  docks: [['container', 5], ['containerStack', 3], ['crane', 0.6], ['barrels', 2], ['warehouse', 0.8], ['tyres', 0.6]],
  quarry: [['rock', 5], ['boulder', 4], ['barrels', 1.5], ['silo', 0.6], ['container', 0.8], ['tyres', 0.6]],
  foundry: [['container', 3], ['fireBarrel', 3], ['smokestack', 0.9], ['furnace', 0.7], ['pipes', 1.6], ['barrels', 1.5]],
};

/** Props drawn as natural forms get a random size */
const VARIES = new Set(['rock', 'boulder']);
const MAX_PROPS = 420;

export interface SceneryInput {
  n: number;
  ds: number;
  pos: ArrayLike<number>;
  right: ArrayLike<number>;
  fwd: ArrayLike<number>;
  halfWidth: ArrayLike<number>;
  curvature: ArrayLike<number>;
  verge: number;
  ground: number;
  theme: ThemeId;
  chunk: number;
}

export function placeScenery(rng: Rng, t: SceneryInput): SceneryItem[] {
  const { n, ds, pos, right, fwd, halfWidth, verge } = t;
  const edge = (i: number) => (halfWidth[i] as number) + verge + BARRIER_THICK;
  // Track samples in a grid, for "is this spot clear of the road".
  const CELL = 24;
  const key = (gx: number, gz: number) => (gx + 4096) * 8192 + (gz + 4096);
  const samples = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor((pos[i * 3] as number) / CELL), Math.floor((pos[i * 3 + 2] as number) / CELL));
    const list = samples.get(k);
    if (list) list.push(i);
    else samples.set(k, [i]);
  }
  const clearOfTrack = (x: number, z: number, r: number) => {
    const gx = Math.floor(x / CELL);
    const gz = Math.floor(z / CELL);
    const reach = Math.ceil((r + 30) / CELL);
    for (let ox = -reach; ox <= reach; ox++) {
      for (let oz = -reach; oz <= reach; oz++) {
        for (const j of samples.get(key(gx + ox, gz + oz)) ?? []) {
          if (len(x - (pos[j * 3] as number), z - (pos[j * 3 + 2] as number)) < edge(j) + 1.5 + r) return false;
        }
      }
    }
    return true;
  };
  const props: SceneryItem[] = [];
  const PCELL = 20;
  const placed = new Map<number, SceneryItem[]>();
  const clearOfProps = (x: number, z: number, r: number) => {
    const gx = Math.floor(x / PCELL);
    const gz = Math.floor(z / PCELL);
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        for (const p of placed.get(key(gx + ox, gz + oz)) ?? []) {
          if (len(x - p.x, z - p.z) < (PROP_RADIUS[p.kind] ?? 2) * p.scale + r + 1) return false;
        }
      }
    }
    return true;
  };
  const add = (kind: string, i: number, x: number, z: number, fx: number, fz: number, scale = 1) => {
    const item: SceneryItem = { kind, x: q(x), y: q(t.ground), z: q(z), fx: q4(fx), fz: q4(fz), scale: q(scale), chunk: Math.floor(i / t.chunk) };
    props.push(item);
    const k = key(Math.floor(x / PCELL), Math.floor(z / PCELL));
    const list = placed.get(k);
    if (list) list.push(item);
    else placed.set(k, [item]);
  };
  /** The point `d` metres out on `side` (-1 left, 1 right) of sample i */
  const out = (i: number, side: number, d: number) => ({
    x: (pos[i * 3] as number) + (right[i * 3] as number) * side * d,
    z: (pos[i * 3 + 2] as number) + (right[i * 3 + 2] as number) * side * d,
  });

  // Floodlights every ~55 m, alternating sides, facing the road.
  let side = 1;
  for (let s = 30; s < n * ds - 20; s += 55) {
    const i = Math.floor(s / ds) % n;
    const p = out(i, side, edge(i) + 2.2);
    add('floodlight', i, p.x, p.z, -(right[i * 3] as number) * side, -(right[i * 3 + 2] as number) * side);
    side = -side;
  }
  // Tyre walls round the outside of hairpins.
  for (let i = 0; i < n; i += 3) {
    const k = t.curvature[i] as number;
    if (Math.abs(k) < 1 / 35) continue;
    const s2 = k > 0 ? -1 : 1;
    const p = out(i, s2, edge(i) + 1.4);
    if (clearOfProps(p.x, p.z, PROP_RADIUS.tyres as number)) add('tyres', i, p.x, p.z, fwd[i * 3] as number, fwd[i * 3 + 2] as number);
  }
  // A grandstand by the start.
  {
    const i = Math.floor(25 / ds) % n;
    const sd = rng.chance(0.5) ? 1 : -1;
    const r = PROP_RADIUS.grandstand as number;
    const p = out(i, sd, edge(i) + r + 2);
    if (clearOfTrack(p.x, p.z, r - 4)) add('grandstand', i, p.x, p.z, -(right[i * 3] as number) * sd, -(right[i * 3 + 2] as number) * sd);
  }
  // The theme's scatter.
  const sc = { s: 0, c: 0 };
  for (let s = 0; s < n * ds && props.length < MAX_PROPS; s += 8) {
    const i = Math.floor(s / ds) % n;
    for (const sd of [-1, 1]) {
      if (!rng.chance(0.55)) continue;
      const kind = rng.weighted(SCATTER[t.theme]);
      const scale = VARIES.has(kind) ? rng.range(0.75, 1.35) : 1;
      const r = (PROP_RADIUS[kind] ?? 2) * scale;
      const p = out(i, sd, edge(i) + r + rng.range(2, 40));
      if (!clearOfTrack(p.x, p.z, r) || !clearOfProps(p.x, p.z, r)) continue;
      // Boxy things mostly line up with the track; the rest face anywhere.
      if ((kind === 'container' || kind === 'containerStack' || kind === 'warehouse') && rng.chance(0.6)) {
        add(kind, i, p.x, p.z, fwd[i * 3] as number, fwd[i * 3 + 2] as number, scale);
      } else {
        sinCosTurns(rng.next(), sc);
        add(kind, i, p.x, p.z, sc.c, sc.s, scale);
      }
    }
  }
  return props;
}
