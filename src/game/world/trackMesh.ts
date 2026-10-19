import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { texture, TILE } from '../textures';
import { THEMES } from '../track/themes';
import type { TrackData } from '../track/types';
import { BARRIER_HEIGHT, BARRIER_THICK, groundY } from './trackPhysics';
import { TRACK_CHUNK } from '../track/constants';
import { frameAt, newFrame } from '../track/sample';

/*
 * The drawn track, from its TrackData: road, verge, kerbs, barriers with hazard bands, the start
 * line and the ground. Everything along the loop is built in chunks of CHUNK samples, one mesh
 * per material per chunk, so frustum culling skips the parts behind the camera. The road and
 * verge use exactly the vertices of the physics trimesh (trackPhysics.ts), so wheels sit on what
 * you see.
 */

/** Two of the data's chunks per drawn piece: fewer draw calls, still culled by the half-lap */
const CHUNK = TRACK_CHUNK * 2;
/** Height of the hazard band at the top of the barriers' inner face (m) */
const STRIPE_BAND = 0.3;
/** Kerb width (m), inside the road edge */
const KERB_WIDTH = 1.1;

/** A point across the track at one sample: `u` metres right of centre, `h` up from the road */
interface ProfilePoint { u: number; h: number }
type Profile = (i: number) => readonly ProfilePoint[];

/**
 * A strip along samples i0..i0+count (wrapping), its cross-section given by `profile`. UVs run
 * across by profile distance / tileAcross and along by distance / tileAlong.
 */
function ribbon(t: TrackData, i0: number, count: number, profile: Profile, tileAcross: number, tileAlong: number): THREE.BufferGeometry {
  const cols = profile(i0).length;
  const positions = new Float32Array(count * cols * 3);
  const uvs = new Float32Array(count * cols * 2);
  for (let k = 0; k < count; k++) {
    const i = (i0 + k) % t.n;
    const pts = profile(i);
    let across = 0;
    for (let c = 0; c < cols; c++) {
      const p = pts[c] as ProfilePoint;
      if (c > 0) {
        const q = pts[c - 1] as ProfilePoint;
        across += Math.hypot(p.u - q.u, p.h - q.h);
      }
      const o = (k * cols + c) * 3;
      for (let a = 0; a < 3; a++) {
        positions[o + a] = (t.pos[i * 3 + a] as number) + (t.right[i * 3 + a] as number) * p.u + (t.up[i * 3 + a] as number) * p.h;
      }
      uvs[(k * cols + c) * 2] = across / tileAcross;
      uvs[(k * cols + c) * 2 + 1] = ((i0 + k) * t.ds) / tileAlong;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < count - 1; k++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c;
      const b = a + 1;
      const cc = a + cols;
      const d = cc + 1;
      index.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function material(name: Parameters<typeof texture>[0], color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: texture(name), color, roughness: 0.92, metalness: 0, ...extra });
}

export interface TrackMesh {
  group: THREE.Group;
  dispose(): void;
}

export function buildTrackMesh(t: TrackData, shadows: boolean): TrackMesh {
  const palette = THEMES[t.theme];
  const group = new THREE.Group();
  group.name = 'track';
  const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const mats = {
    road: material('asphalt', palette.road),
    verge: material('gravel', palette.verge),
    barrier: material('concrete', palette.barrier, { side: THREE.DoubleSide }),
    stripe: material('stripes', palette.stripe, { side: THREE.DoubleSide, ...decal }),
    kerb: material('kerb', 0xffffff, decal),
    checker: material('checker', 0xffffff, decal),
    ground: material('ground', palette.ground),
    skirt: material('ground', palette.ground, { side: THREE.DoubleSide }),
    ramp: material('metal', 0x8a8c90, { roughness: 0.55, metalness: 0.6 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8, ...decal }),
  };
  const geometries: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.castShadow = cast && shadows;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    geometries.push(g);
  };

  const ground = groundY(t);
  const hw = (i: number) => t.halfWidth[i] as number;
  const edge = (i: number) => hw(i) + t.verge;
  const kerbAt = new Int8Array(t.n);
  for (const k of t.kerbs) {
    for (let i = k.i0; ; i = (i + 1) % t.n) {
      kerbAt[i] = kerbAt[i]! | (k.side < 0 ? 1 : 2);
      if (i === k.i1) break;
    }
  }

  for (let i0 = 0; i0 < t.n; i0 += CHUNK) {
    const count = Math.min(CHUNK, t.n - i0) + 1;
    add(ribbon(t, i0, count, (i) => [{ u: -hw(i), h: 0 }, { u: hw(i), h: 0 }], TILE.asphalt, TILE.asphalt), mats.road, false);
    add(mergeGeometries([
      ribbon(t, i0, count, (i) => [{ u: -edge(i), h: 0 }, { u: -hw(i), h: 0 }], TILE.gravel, TILE.gravel),
      ribbon(t, i0, count, (i) => [{ u: hw(i), h: 0 }, { u: edge(i), h: 0 }], TILE.gravel, TILE.gravel),
    ]), mats.verge, false);
    const walls: THREE.BufferGeometry[] = [];
    const stripes: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const e = (i: number) => side * edge(i);
      const o = (i: number) => side * (edge(i) + BARRIER_THICK);
      walls.push(
        ribbon(t, i0, count, (i) => [{ u: e(i), h: 0 }, { u: e(i), h: BARRIER_HEIGHT - STRIPE_BAND }], TILE.concrete, TILE.concrete),
        ribbon(t, i0, count, (i) => [{ u: e(i), h: BARRIER_HEIGHT }, { u: o(i), h: BARRIER_HEIGHT }], TILE.concrete, TILE.concrete),
        ribbon(t, i0, count, (i) => [{ u: o(i), h: BARRIER_HEIGHT }, { u: o(i), h: 0 }], TILE.concrete, TILE.concrete),
      );
      stripes.push(ribbon(t, i0, count, (i) => [{ u: e(i), h: BARRIER_HEIGHT - STRIPE_BAND }, { u: e(i), h: BARRIER_HEIGHT }], STRIPE_BAND, TILE.stripes));
    }
    add(mergeGeometries(walls), mats.barrier, true);
    add(mergeGeometries(stripes), mats.stripe, false);
    // Embankments: from the barriers' outer foot down to the ground, so a raised road sits on something.
    const skirts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      skirts.push(ribbon(t, i0, count, (i) => {
        const o = side * (edge(i) + BARRIER_THICK);
        const drop = (t.pos[i * 3 + 1] as number) - ground + 0.05;
        return [{ u: o, h: 0 }, { u: o + side * (drop * 1.6 + 1), h: -drop }];
      }, TILE.ground, TILE.ground));
    }
    add(mergeGeometries(skirts), mats.skirt, false);
  }

  // Kerbs: one ribbon per run, on the inside edge of the road, all in one mesh.
  const kerbs = t.kerbs.map((k) => {
    const count = ((k.i1 - k.i0 + t.n) % t.n) + 2;
    const s = k.side;
    return ribbon(t, k.i0, count, (i) => [
      { u: s < 0 ? -hw(i) : hw(i) - KERB_WIDTH, h: 0.015 },
      { u: s < 0 ? -hw(i) + KERB_WIDTH : hw(i), h: 0.015 },
    ], KERB_WIDTH, TILE.kerb);
  });
  if (kerbs.length) add(mergeGeometries(kerbs), mats.kerb, false);

  // The start line: a checkered band across the road at s = 0.
  add(ribbon(t, 0, 2, (i) => [{ u: -hw(i), h: 0.01 }, { u: hw(i), h: 0.01 }], TILE.checker, TILE.checker), mats.checker, false);

  if (t.ramps.length) add(mergeGeometries(t.ramps.map((r) => rampGeometry(t, r))), mats.ramp, true);
  add(mergeGeometries(t.grid.map((g) => gridBox(t, g.s, g.u))), mats.paint, false);

  // The ground: a big plane under everything.
  const b = t.bounds;
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 1600;
  const plane = new THREE.PlaneGeometry(size, size);
  plane.rotateX(-Math.PI / 2);
  const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (size / TILE.ground), uv.getY(i) * (size / TILE.ground));
  plane.translate((b.minX + b.maxX) / 2, ground - 0.02, (b.minZ + b.maxZ) / 2);
  add(plane, mats.ground, false);

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
    },
  };
}

const frame = newFrame();

/** A point on the road at (s, u), `h` up from the surface */
function roadPoint(t: TrackData, s: number, u: number, h: number, out: THREE.Vector3): THREE.Vector3 {
  frameAt(t, s, frame);
  return out.set(
    frame.pos.x + frame.right.x * u + frame.up.x * h,
    frame.pos.y + frame.right.y * u + frame.up.y * h,
    frame.pos.z + frame.right.z * u + frame.up.z * h,
  );
}

/** A quad on the road from (s0, u0) to (s1, u1), lifted `h`, with its UVs spanning 0..1 */
function roadQuad(t: TrackData, s0: number, s1: number, u0: number, u1: number, h: number): THREE.BufferGeometry {
  const p = [0, 1, 2, 3].map(() => new THREE.Vector3());
  roadPoint(t, s0, u0, h, p[0]!);
  roadPoint(t, s0, u1, h, p[1]!);
  roadPoint(t, s1, u0, h, p[2]!);
  roadPoint(t, s1, u1, h, p[3]!);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
}

/** A weapon pad's glowing decal, 4 m square */

/** A grid slot's painted box: a U open toward the start line */
function gridBox(t: TrackData, s: number, u: number): THREE.BufferGeometry {
  const w = 1.2;
  const d = 2.6;
  const line = 0.18;
  return mergeGeometries([
    roadQuad(t, s - d, s - d + line, u - w, u + w, 0.02),
    roadQuad(t, s - d, s + d * 0.4, u - w, u - w + line, 0.02),
    roadQuad(t, s - d, s + d * 0.4, u + w - line, u + w, 0.02),
  ]);
}

/** A kicker ramp: a wedge rising over its length, open-backed */
function rampGeometry(t: TrackData, r: { s: number; len: number; h: number; u0: number; u1: number }): THREE.BufferGeometry {
  const v = (s: number, u: number, h: number) => roadPoint(t, s, u, h, new THREE.Vector3());
  const a = v(r.s, r.u0, 0.02);
  const b = v(r.s, r.u1, 0.02);
  const c = v(r.s + r.len, r.u0, r.h);
  const d = v(r.s + r.len, r.u1, r.h);
  const e = v(r.s + r.len, r.u0, 0);
  const f = v(r.s + r.len, r.u1, 0);
  const pos = [a, b, c, d, e, f].flatMap((p) => [p.x, p.y, p.z]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 3, 2, 3, 0, 3.4, 2, 3.4], 2));
  // Top slope, back face, two side triangles.
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 0, 2, 4, 1, 5, 3]);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
