import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propModel } from '../models';

/*
 * Procedural scenery: every kind of prop is a handful of boxes, cylinders and rocks merged into
 * one geometry with its colours baked into the vertices, so each kind draws as a single instanced
 * mesh. Origin at the foot of the prop, facing -z (the generator's facing vector).
 *
 * Parts that glow (floodlight heads, fire, beacons) go into a separate "glow" geometry drawn with
 * an emissive material.
 */

export interface PropGeometry {
  body: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  /** Whether instances get a colour of their own (containers come in many) */
  tinted: boolean;
  /** A realistic model's own textured material (models.ts); without one, the body's colours are in its vertices */
  material?: THREE.MeshStandardMaterial;
}

type Part = { g: THREE.BufferGeometry; color: number };

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r: number, h: number, x = 0, y = 0, z = 0, seg = 12, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg).translate(x, y + h / 2, z);

/** A rough rock: an icosahedron with its corners pushed about (the same shape every time) */
function rock(r: number, squash: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.78 + 0.32 * Math.abs(Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 - y * 0.9));
    p.setXYZ(i, x * k, Math.max(-0.2, y * k * squash), z * k);
  }
  g.translate(0, r * squash * 0.55, 0);
  g.computeVertexNormals();
  return g;
}

function build(parts: Part[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((p) => colored(p.g, p.color)));
}

const RUST = 0x7a4a2a;
const STEEL = 0x55595e;
const DARK = 0x26272a;
const CONCRETE = 0x9a968e;
const WHITE = 0xffffff;

type PropSpec = { body: Part[]; glow?: Part[]; tinted?: boolean };

const BUILDERS: Record<string, () => PropSpec> = {
  container: () => ({
    body: [{ g: box(2.5, 2.6, 6.1), color: WHITE }, { g: box(2.56, 0.12, 6.16, 0, 2.6), color: 0xd0d0d0 }],
    tinted: true,
  }),
  containerStack: () => ({
    body: [
      { g: box(2.5, 2.6, 6.1), color: WHITE },
      { g: box(2.5, 2.6, 6.1, 0.15, 2.6, 0.4), color: 0xc8c8c8 },
      { g: box(2.5, 2.6, 6.1, -0.1, 5.2, -0.3), color: 0xe6e6e6 },
    ],
    tinted: true,
  }),
  crane: () => {
    const body: Part[] = [];
    for (const x of [-4, 4]) for (const z of [-4, 4]) body.push({ g: box(0.7, 22, 0.7, x, 0, z), color: 0xd9a21b });
    body.push({ g: box(9, 1.4, 1.4, 0, 21, -4), color: 0xd9a21b }, { g: box(9, 1.4, 1.4, 0, 21, 4), color: 0xd9a21b });
    body.push({ g: box(1.4, 1.4, 26, 0, 22.4, -6), color: 0xc8901a });
    body.push({ g: box(3, 2.5, 3, 0, 18.5, -12), color: DARK });
    return { body, glow: [{ g: box(0.5, 0.5, 0.5, 0, 24, -18), color: 0xff2a10 }] };
  },
  barrels: () => ({
    body: [
      { g: cyl(0.45, 1.25, -0.5, 0, 0.3), color: 0x2c5f8a },
      { g: cyl(0.45, 1.25, 0.55, 0, -0.2), color: 0x8a2c2c },
      { g: cyl(0.45, 1.25, 0, 0, -0.9), color: 0x6a6a2a },
    ],
  }),
  warehouse: () => ({
    body: [
      { g: box(20, 9, 26), color: 0x6c6a66 },
      { g: box(20.6, 0.6, 26.6, 0, 9), color: 0x3d3c3a },
      { g: box(8, 6, 0.3, 0, 0, -13.1), color: 0x46484a },
    ],
    glow: [{ g: box(14, 0.4, 0.2, 0, 7.2, -13.2), color: 0xffe0a0 }],
  }),
  tyres: () => {
    const body: Part[] = [];
    for (let k = 0; k < 4; k++) body.push({ g: cyl(0.5, 0.32, 0, k * 0.32, 0, 12, 0.5), color: k % 2 ? 0x1a1a1a : 0xd8d8d8 });
    return { body };
  },
  rock: () => ({ body: [{ g: rock(4, 0.7), color: 0x8b5a3c }] }),
  boulder: () => ({ body: [{ g: rock(2.2, 0.9), color: 0x9a6a4a }] }),
  silo: () => ({
    body: [
      { g: cyl(4, 14, 0, 0, 0, 16), color: CONCRETE },
      { g: cyl(4.1, 1.6, 0, 14, 0, 16, 0.6), color: STEEL },
    ],
  }),
  smokestack: () => ({
    body: [
      { g: cyl(3.2, 34, 0, 0, 0, 14, 2.2), color: 0x4a3e38 },
      { g: cyl(2.4, 1.2, 0, 33, 0, 14), color: DARK },
    ],
    glow: [{ g: box(0.6, 0.6, 0.6, 0, 34.6, 0), color: 0xff2010 }],
  }),
  fireBarrel: () => ({
    body: [{ g: cyl(0.42, 1.1), color: RUST }],
    glow: [{ g: new THREE.ConeGeometry(0.36, 0.9, 7).translate(0, 1.5, 0), color: 0xff7a1a }],
  }),
  furnace: () => ({
    body: [
      { g: box(14, 10, 12), color: 0x3a3330 },
      { g: cyl(2, 8, -4, 10, 0, 10, 1.4), color: 0x2e2826 },
      { g: cyl(2, 6, 4, 10, 2, 10, 1.4), color: 0x2e2826 },
    ],
    glow: [{ g: box(6, 3, 0.3, 0, 1, -6.1), color: 0xff5a0a }],
  }),
  pipes: () => {
    const body: Part[] = [];
    for (const [z, y] of [[-1.5, 1.6], [0, 2.4], [1.5, 1.6]] as const) {
      body.push({ g: new THREE.CylinderGeometry(0.6, 0.6, 12, 10).rotateZ(Math.PI / 2).translate(0, y, z), color: z === 0 ? 0x6a5a48 : 0x5a5f64 });
    }
    for (const x of [-5, 0, 5]) body.push({ g: box(0.4, 2.4, 4, x, 0, 0), color: STEEL });
    return { body };
  },
  floodlight: () => ({
    body: [
      { g: box(0.35, 13, 0.35), color: STEEL },
      { g: box(2.6, 1.3, 0.5, 0, 12.4, 0), color: DARK },
    ],
    glow: [{ g: box(2.3, 1.0, 0.1, 0, 12.55, -0.3), color: 0xfff6dc }],
  }),
  grandstand: () => {
    const body: Part[] = [];
    for (let k = 0; k < 6; k++) body.push({ g: box(30, 1, 1.6, 0, k * 1, 6 - k * 1.6), color: k % 2 ? 0x5a5c60 : 0x6b6d72 });
    body.push({ g: box(30, 0.4, 11, 0, 9, 2), color: 0x3a3c40 });
    for (const x of [-14, 0, 14]) body.push({ g: box(0.4, 9, 0.4, x, 0, 7), color: STEEL });
    return { body, glow: [{ g: box(26, 0.3, 0.2, 0, 8.6, -3.4), color: 0xffd9a0 }] };
  },
};

const cache = new Map<string, PropGeometry>();

const borrowed = new WeakMap<PropGeometry, PropGeometry>();

/**
 * The geometry for a kind: a kit model's when one's loaded (models.ts), else built once. Unknown
 * kinds draw as a crate. A realistic model has nothing glowing of its own: it borrows the
 * procedural prop's glow (a fire barrel's flames).
 */
export function propGeometry(kind: string): PropGeometry {
  const kit = propModel(kind);
  if (kit && (!kit.material || kit.glow)) return kit;
  if (kit) {
    let g = borrowed.get(kit);
    if (!g) {
      g = { ...kit, glow: procedural(kind).glow };
      borrowed.set(kit, g);
    }
    return g;
  }
  return procedural(kind);
}

function procedural(kind: string): PropGeometry {
  let g = cache.get(kind);
  if (!g) {
    const crate = (): PropSpec => ({ body: [{ g: box(1.5, 1.5, 1.5), color: 0x8a6a40 }] });
    const spec = (BUILDERS[kind] ?? crate)();
    g = { body: build(spec.body), glow: spec.glow ? build(spec.glow) : null, tinted: spec.tinted ?? false };
    cache.set(kind, g);
  }
  return g;
}

/** Container paint: rusty reds, blues, greens, yellows */
export const CONTAINER_COLORS = [0x9b2f22, 0x2a5a8a, 0x3c6e3c, 0xc08a1c, 0x7a3a6a, 0x5a6a72, 0xb2551f, 0x1f4f5a];
