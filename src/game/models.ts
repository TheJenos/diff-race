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
let loading: Promise<void> | null = null;

/** Load the kit models, once; resolves (never rejects) when they're in, or known not to be there */
export function loadModels(): Promise<void> {
  loading ??= load().catch((err: unknown) => console.warn('Kit models not loaded, using the procedural ones', err));
  return loading;
}

/** The kit car for a racer's paint (the same paint gets the same car on every client), or null */
export function carModelFor(paint: number): CarModel | null {
  if (!cars.length || !settings.get().kitModels) return null;
  const h = Math.imul(paint ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return cars[(h >>> 7) % cars.length] ?? null;
}

/** A kit prop for a scenery kind, or null for the procedural one */
export function propModel(kind: string): PropGeometry | null {
  if (!settings.get().kitModels) return null;
  return props.get(kind) ?? null;
}

async function load(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}models/`;
  const res = await fetch(`${base}manifest.json`);
  // A dev server answers a missing file with the page itself: only JSON counts.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
  const manifest = (await res.json()) as Manifest;
  // Fetched only when there are models to load: most players never need it.
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
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

const ids = new WeakMap<CarModel, string>();

/** What kit bodies are scaled to (m): the hitbox's length and width, a little over, and the procedural car's height */
const FIT = { length: 4.5, width: 2.1, height: 1.65 };
/** A tall body is lowered to FIT.height, but by no more than this share: they're cartoon-tall */
const SQUASH = 0.8;

/**
 * Fit a kit body to the physics car: as big as fits FIT's length and width (keeping its shape),
 * lowered toward FIT's height, its wheels on the road where the physics wheels are at rest.
 */
export function fitCar(m: ManifestCar, g: Map<string, THREE.BufferGeometry>): CarModel | null {
  const paint = g.get('paint');
  const wheel = g.get('wheel');
  if (!paint || !wheel) return null;
  const trim = g.get('trim') ?? null;
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
  paint.applyMatrix4(fit);
  trim?.applyMatrix4(fit);
  // Wheels as round as they were, as tall as the lowered arches.
  const wheelRight = wheel.clone().scale(s, sy, sy);
  const wheelLeft = mirrorX(wheelRight);
  const lift = m.wheelRadius * sy - CAR.wheelRadius;
  const wheels = CAR.wheels.map((mt) => {
    const k = mt.front ? (mt.x < 0 ? w.fl : w.fr) : mt.x < 0 ? w.rl : w.rr;
    return { x: (k[0] - midX) * s, z: (k[2] - midZ) * s, lift };
  });
  const farWheels = mergeGeometries(CAR.wheels.map((mt, i) => (mt.x < 0 ? wheelLeft : wheelRight).clone().translate(wheels[i]!.x, restY + lift, wheels[i]!.z)));
  const car: CarModel = {
    paint,
    trim,
    wheelLeft,
    wheelRight,
    wheels,
    farWheels,
    front: (b.min[2] - midZ) * s,
    rear: (b.max[2] - midZ) * s,
    halfWidth: ((b.max[0] - b.min[0]) / 2) * s,
    roof: ground + (m.roof - kitGround) * sy,
  };
  ids.set(car, m.id);
  return car;
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
