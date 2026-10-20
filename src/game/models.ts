import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './car/params';
import { settings } from './settings';
import type { PropGeometry } from './world/props';

/*
 * Kit models (Kenney's, CC0), built into public/models/ by scripts/build-cars.mjs and
 * build-props.mjs, loaded once before the first race. When they aren't there, or don't load, the
 * game draws its procedural cars and props: nothing else changes. Kit cars are only skins: the
 * physics car and its hitbox stay the same whatever it looks like (only the guns sit where its
 * turret does).
 *
 * Realistic models (public/models/real/, scripts/build-real.mjs) take over where they're there:
 * Poly Haven's drums, tyres and rocks on medium and high quality, and Khronos's concept car, in
 * every racer's paint, on high (it's ten times the triangles of a kit car). Unlike the kit models
 * they keep their own textured materials. The e2e tests skip them, as they skip the photo textures.
 */

export interface CarModel {
  /** The body's main colour, white (it's painted in the racer's colour), fitted to the physics car */
  paint: THREE.BufferGeometry;
  /** The rest of the body, coloured per vertex */
  trim: THREE.BufferGeometry | null;
  /** One wheel centred on its axle, for each side */
  wheelLeft: THREE.BufferGeometry;
  wheelRight: THREE.BufferGeometry;
  /**
   * Where the kit's wheels go, in CAR.wheels' order: across and along (they stay in the body's
   * arches), and how much higher their centres ride than the physics wheels' (a kit wheel bigger
   * than the physics one still meets the road where it does)
   */
  wheels: { x: number; z: number; lift: number }[];
  /** The four at rest in one geometry, for a car far away */
  farWheels: THREE.BufferGeometry;
  /** Where the fitted body ends (car space), for the bolt-on armour and the turret */
  front: number;
  rear: number;
  halfWidth: number;
  roof: number;
  /**
   * A realistic car's parts in their own materials (glass, lights, tyres, rims...), its paint's
   * material to make each racer's from: `trim` goes unused, the wheel geometries are plain shapes
   */
  parts: { paint: THREE.MeshStandardMaterial; trim: CarPart[]; wheelLeft: CarPart[]; wheelRight: CarPart[] } | null;
}

export interface CarPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

type V = [number, number, number];
export interface ManifestCar {
  id: string;
  file: string;
  wheels: { fl: V; fr: V; rl: V; rr: V };
  wheelRadius: number;
  body: { min: V; max: V };
  roof: number;
}
interface Manifest {
  version: number;
  cars?: ManifestCar[];
  props?: Record<string, { file: string; tinted: boolean }>;
}

const cars: CarModel[] = [];
const props = new Map<string, PropGeometry>();
let realCar: CarModel | null = null;
const realProps = new Map<string, PropGeometry>();
let loading: Promise<void> | null = null;

/** Load the kit models, once; resolves (never rejects) when they're in, or known not to be there */
export function loadModels(): Promise<void> {
  loading ??= load().catch((err: unknown) => console.warn('Kit models not loaded, using the procedural ones', err));
  return loading;
}

/** The kit car for a racer's paint (the same paint gets the same car on every client), or null */
export function carModelFor(paint: number): CarModel | null {
  const s = settings.get();
  if (!s.kitModels) return null;
  if (realCar && s.quality === 'high') return realCar;
  if (!cars.length) return null;
  const h = Math.imul(paint ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return cars[(h >>> 7) % cars.length] ?? null;
}

/** A kit prop for a scenery kind (a realistic one above low quality), or null for the procedural one */
export function propModel(kind: string): PropGeometry | null {
  const s = settings.get();
  if (!s.kitModels) return null;
  return (s.quality !== 'low' ? realProps.get(kind) : undefined) ?? props.get(kind) ?? null;
}

/** The realistic car's materials (for reflections), if it's loaded */
export function realCarMaterials(): THREE.MeshStandardMaterial[] {
  if (!realCar?.parts) return [];
  return [...new Set([...realCar.parts.trim, ...realCar.parts.wheelRight].map((p) => p.material))];
}

/** A manifest, or null when it isn't there (a dev server answers a missing file with the page itself: only JSON counts) */
async function manifestAt<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
  return (await res.json()) as T;
}

async function load(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}models/`;
  const [manifest, real] = await Promise.all([
    manifestAt<Manifest>(`${base}manifest.json`),
    import.meta.env.VITE_E2E === 'true' ? null : manifestAt<RealManifest>(`${base}real/manifest.json`),
  ]);
  if (!manifest && !real) return;
  // Fetched only when there are models to load: most players never need it.
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  if (real) await loadReal(real, base, loader);
  if (!manifest) return;
  const parts = async (file: string) => {
    const gltf = await loader.loadAsync(base + file);
    const out = new Map<string, THREE.BufferGeometry>();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      // Quantized: small integers and a node transform to scale them back. Floats in place, for dents and fitting.
      if (o instanceof THREE.Mesh) out.set(o.name, floats(o.geometry as THREE.BufferGeometry).applyMatrix4(o.matrixWorld));
    });
    return out;
  };
  await Promise.all([
    ...(manifest.cars ?? []).map(async (m) => {
      try {
        const car = fitCar(m, await parts(m.file));
        if (car) cars.push(car);
      } catch (err) {
        console.warn(`Kit car ${m.id} not loaded`, err);
      }
    }),
    ...Object.entries(manifest.props ?? {}).map(async ([kind, p]) => {
      try {
        const g = await parts(p.file);
        const body = g.get('body');
        if (body) props.set(kind, { body, glow: g.get('glow') ?? null, tinted: p.tinted });
      } catch (err) {
        console.warn(`Kit prop ${kind} not loaded`, err);
      }
    }),
  ]);
  // Loaded in any order: keep the manifest's, so every client maps paints to the same cars.
  const order = (manifest.cars ?? []).map((m) => m.id);
  cars.sort((a, b) => order.indexOf(ids.get(a) ?? '') - order.indexOf(ids.get(b) ?? ''));
}

interface RealManifest {
  version: number;
  car?: ManifestCar | null;
  props?: Record<string, { file: string }>;
}

/** Each named part of a realistic model (its top-level nodes: paint, trim, wheel, body), with its own materials */
async function partsWithMaterials(loader: { loadAsync(url: string): Promise<{ scene: THREE.Object3D }> }, url: string): Promise<Map<string, CarPart[]>> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const out = new Map<string, CarPart[]>();
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    // A mesh of several materials loads as a group of meshes, one each: they go under the group's name.
    let part: THREE.Object3D = o;
    while (part.parent && part.parent !== gltf.scene) part = part.parent;
    const list = out.get(part.name) ?? [];
    list.push({ geometry: floats(o.geometry as THREE.BufferGeometry).applyMatrix4(o.matrixWorld), material: o.material });
    out.set(part.name, list);
  });
  return out;
}

async function loadReal(real: RealManifest, base: string, loader: { loadAsync(url: string): Promise<{ scene: THREE.Object3D }> }): Promise<void> {
  await Promise.all([
    (async () => {
      if (!real.car) return;
      try {
        realCar = fitRealCar(real.car, await partsWithMaterials(loader, base + real.car.file));
      } catch (err) {
        console.warn('Realistic car not loaded', err);
      }
    })(),
    ...Object.entries(real.props ?? {}).map(async ([kind, p]) => {
      try {
        const body = (await partsWithMaterials(loader, base + p.file)).get('body')?.[0];
        if (body) realProps.set(kind, { body: body.geometry, glow: null, tinted: false, material: body.material });
      } catch (err) {
        console.warn(`Realistic prop ${kind} not loaded`, err);
      }
    }),
  ]);
}

const ids = new WeakMap<CarModel, string>();

/** What kit bodies are scaled to (m): the hitbox's length and width, a little over, and the procedural car's height */
const FIT = { length: 4.5, width: 2.1, height: 1.65 };
/** A tall body is lowered to FIT.height, but by no more than this share: they're cartoon-tall */
const SQUASH = 0.8;

/** A kit car fitted to the physics car (carFit) */
export function fitCar(m: ManifestCar, g: Map<string, THREE.BufferGeometry>): CarModel | null {
  const paint = g.get('paint');
  const wheel = g.get('wheel');
  if (!paint || !wheel) return null;
  const f = carFit(m);
  if (!f) return null;
  const trim = g.get('trim') ?? null;
  paint.applyMatrix4(f.fit);
  trim?.applyMatrix4(f.fit);
  // Wheels as round as they were, as tall as the lowered arches.
  const wheelRight = wheel.clone().scale(f.s, f.sy, f.sy);
  const wheelLeft = mirrorX(wheelRight);
  const car: CarModel = { ...f.frame, paint, trim, wheelLeft, wheelRight, farWheels: farWheels(f, wheelLeft, wheelRight), parts: null };
  ids.set(car, m.id);
  return car;
}

/** The realistic car fitted as a kit car is, its parts keeping their materials */
function fitRealCar(m: ManifestCar, g: Map<string, CarPart[]>): CarModel | null {
  const paint = g.get('paint')?.[0];
  const wheel = g.get('wheel');
  const f = carFit(m);
  if (!paint || !wheel?.length || !f) return null;
  paint.geometry.applyMatrix4(f.fit);
  const trim = g.get('trim') ?? [];
  for (const p of trim) p.geometry.applyMatrix4(f.fit);
  const wheelRight = wheel.map((p) => ({ geometry: p.geometry.clone().scale(f.s, f.sy, f.sy), material: p.material }));
  const wheelLeft = wheelRight.map((p) => ({ geometry: mirrorX(p.geometry), material: p.material }));
  // One plain shape of each wheel for far away, in one mesh of all four.
  const shape = (parts: CarPart[]) => mergeGeometries(parts.map((p) => plain(p.geometry)));
  for (const mat of new Set([...trim, ...wheelRight].map((p) => p.material))) {
    if (mat.name === 'Headlight') mat.emissiveIntensity = 1.6;
    if (mat.name === 'Brakelight') mat.emissiveIntensity = 1.2;
  }
  return {
    ...f.frame,
    paint: paint.geometry,
    trim: null,
    wheelLeft: shape(wheelLeft),
    wheelRight: shape(wheelRight),
    farWheels: farWheels(f, shape(wheelLeft), shape(wheelRight)),
    parts: { paint: paint.material, trim, wheelLeft, wheelRight },
  };
}

/** Just positions and normals: parts in different materials can merge into one plain shape */
function plain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position'));
  g.setAttribute('normal', geo.getAttribute('normal'));
  if (geo.getIndex()) g.setIndex(geo.getIndex());
  return g;
}

interface Fit {
  /** Kit body space to car space */
  fit: THREE.Matrix4;
  s: number;
  sy: number;
  restY: number;
  frame: Pick<CarModel, 'wheels' | 'front' | 'rear' | 'halfWidth' | 'roof'>;
}

/**
 * How a kit body fits the physics car: as big as fits FIT's length and width (keeping its shape),
 * lowered toward FIT's height, its wheels on the road where the physics wheels are at rest.
 */
function carFit(m: ManifestCar): Fit | null {
  const b = m.body;
  const w = m.wheels;
  const kitGround = (w.fl[1] + w.fr[1] + w.rl[1] + w.rr[1]) / 4 - m.wheelRadius;
  const s = Math.min(FIT.length / (b.max[2] - b.min[2]), FIT.width / (b.max[0] - b.min[0]));
  const sy = Math.max(s * SQUASH, Math.min(s, FIT.height / (m.roof - kitGround)));
  if (!(s > 0) || !(sy > 0) || !(m.wheelRadius > 0)) return null;
  // Physics wheel centres at rest, and the road under them (car space).
  const restY = CAR.wheels.reduce((sum, mt) => sum + mt.y, 0) / CAR.wheels.length - CAR.restLength * 0.5;
  const ground = restY - CAR.wheelRadius;
  const midX = (b.min[0] + b.max[0]) / 2;
  const midZ = (b.min[2] + b.max[2]) / 2;
  const fit = new THREE.Matrix4().makeTranslation(0, ground, 0)
    .multiply(new THREE.Matrix4().makeScale(s, sy, s))
    .multiply(new THREE.Matrix4().makeTranslation(-midX, -kitGround, -midZ));
  const lift = m.wheelRadius * sy - CAR.wheelRadius;
  const wheels = CAR.wheels.map((mt) => {
    const k = mt.front ? (mt.x < 0 ? w.fl : w.fr) : mt.x < 0 ? w.rl : w.rr;
    return { x: (k[0] - midX) * s, z: (k[2] - midZ) * s, lift };
  });
  return {
    fit,
    s,
    sy,
    restY,
    frame: {
      wheels,
      front: (b.min[2] - midZ) * s,
      rear: (b.max[2] - midZ) * s,
      halfWidth: ((b.max[0] - b.min[0]) / 2) * s,
      roof: ground + (m.roof - kitGround) * sy,
    },
  };
}

/** The four wheels at rest in one geometry, for a car far away */
function farWheels(f: Fit, left: THREE.BufferGeometry, right: THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeGeometries(CAR.wheels.map((mt, i) => (mt.x < 0 ? left : right).clone().translate(f.frame.wheels[i]!.x, f.restY + f.frame.wheels[i]!.lift, f.frame.wheels[i]!.z)));
}

/** A copy with every attribute as plain floats (three's getters undo the normalising) */
function floats(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geo.attributes)) {
    const attr = a as THREE.BufferAttribute;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  const index = geo.getIndex();
  if (index) g.setIndex(new THREE.BufferAttribute(index.array.slice(), 1));
  return g;
}

/** A mirror image across x = 0, wound back the right way out */
export function mirrorX(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone().scale(-1, 1, 1);
  const index = g.getIndex();
  if (index) {
    const a = index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1] as number;
      a[i + 1] = a[i + 2] as number;
      a[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  return g;
}
