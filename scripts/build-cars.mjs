/*
 * Kenney's Car Kit (kenney.nl/assets/car-kit, CC0) → public/models/cars/*.glb, and the cars in
 * public/models/manifest.json. Unzip the kit anywhere under assets-src/kenney/, then:
 *
 *   npm run build:cars              (or -- --list to see which models it found)
 *
 * Each car comes out in three parts, in car space (front toward −z, right toward +x):
 *   paint  the body's main colour, made white: the game paints it in the racer's colour;
 *   trim   the rest of the body, colours baked into the vertices (from the kit's palette texture);
 *   wheel  one right-hand wheel, centred on its axle (the game mirrors it for the left).
 * The manifest says where the kit put its wheels, so the game can fit the body over the physics
 * car's wheels (src/game/models.ts). The armour plates, ram, wing and turret stay procedural.
 * Without the manifest, or a model, the game draws its procedural cars.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bounds, colorKey, dominantColor, findModels, io, luminance, triangles, turn, transform, writeParts } from './lib/bake.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SOURCE = opt('source', 'assets-src/kenney');
const OUT = opt('out', 'public/models');
/** The kit's cars, best first; the first eight found are used (one per paint) */
const CARS = ['sedan-sports', 'race', 'hatchback-sports', 'suv', 'police', 'taxi', 'race-future', 'sedan', 'suv-luxury', 'van'];
const MAX = 8;

const found = await findModels(SOURCE);
if (args.includes('--list')) {
  console.log([...found.keys()].sort().join('\n') || `no models under ${SOURCE}`);
  process.exit(0);
}

const centre = (tris) => {
  const b = bounds(tris);
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
};
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);

async function build(name, path) {
  const tris = triangles(await io.read(path));
  const isWheel = (t) => /wheel/i.test(t.node);
  // Wheels by the node they hang under: four, or the front and back pairs of a longer car.
  const groups = new Map();
  for (const t of tris.filter(isWheel)) {
    const list = groups.get(t.node);
    if (list) list.push(t);
    else groups.set(t.node, [t]);
  }
  if (groups.size < 4) throw new Error(`${groups.size} wheels found (nodes named "wheel…"); it needs four`);
  let wheels = [...groups].map(([node, list]) => ({ node, list, c: centre(list) })).sort((a, b) => a.c[2] - b.c[2]);
  wheels = [...wheels.slice(0, 2), ...wheels.slice(-2)];
  // Which end is the front: by name if the kit says, else Kenney's way (facing +z).
  const named = (re) => wheels.filter((w) => re.test(w.node));
  const front = named(/front/i).length === 2 ? named(/front/i) : wheels.slice(2);
  const frontZ = (front[0].c[2] + front[1].c[2]) / 2;
  const otherZ = wheels.filter((w) => !front.includes(w)).reduce((s, w) => s + w.c[2] / 2, 0);
  if (frontZ > otherZ) turn(tris, 2);
  // Centres again, now the car faces −z.
  const at = new Map(wheels.map((w) => [w, centre(w.list)]));
  const pos = (isFront, right) => {
    const w = wheels.find((x) => front.includes(x) === isFront && (at.get(x)[0] > 0) === right);
    if (!w) throw new Error('the wheels are not two each side');
    return w;
  };
  const fl = pos(true, false), fr = pos(true, true), rl = pos(false, false), rr = pos(false, true);
  const wb = bounds(fr.list);
  const wheelRadius = (wb.max[1] - wb.min[1]) / 2;

  const body = tris.filter((t) => !isWheel(t));
  if (!body.length) throw new Error('no body (everything is a wheel)');
  // The main colour (by area; not near-black glass or tyres) is the paint.
  const paintKey = dominantColor(body, (c) => luminance(c) < 0.05);
  const paint = [], trim = [];
  for (const t of body) {
    if (colorKey(t.color) === paintKey) paint.push({ ...t, color: [1, 1, 1] });
    else trim.push(t);
  }
  const wheel = fr.list.map((t) => ({ ...t, p: [...t.p] }));
  const c = at.get(fr);
  transform(wheel, [-c[0], -c[1], -c[2]], [1, 1, 1]);

  const b = bounds(body);
  const mid = (b.min[2] + b.max[2]) / 2;
  const half = (b.max[2] - b.min[2]) / 4;
  let roof = -Infinity;
  for (const t of body) for (let k = 0; k < 9; k += 3) if (Math.abs(t.p[k + 2] - mid) < half) roof = Math.max(roof, t.p[k + 1]);

  await writeParts(join(OUT, 'cars', `${name}.glb`), { paint, trim, wheel });
  return {
    id: name,
    file: `cars/${name}.glb`,
    wheels: { fl: r3(at.get(fl)), fr: r3(at.get(fr)), rl: r3(at.get(rl)), rr: r3(at.get(rr)) },
    wheelRadius: r3([wheelRadius])[0],
    body: { min: r3(b.min), max: r3(b.max) },
    roof: r3([roof])[0],
    triangles: paint.length + trim.length + wheel.length * 4,
  };
}

await mkdir(join(OUT, 'cars'), { recursive: true });
const cars = [];
for (const name of CARS) {
  if (cars.length >= MAX) break;
  const path = found.get(name);
  if (!path) continue;
  try {
    const car = await build(name, path);
    cars.push(car);
    console.log(`✓ ${name}: ${car.triangles} triangles`);
  } catch (err) {
    console.warn(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
  }
}
if (!cars.length) {
  console.error(`No cars built. Unzip Kenney's Car Kit under ${SOURCE}/ (looking for: ${CARS.join(', ')}).`);
  process.exit(1);
}

const manifestPath = join(OUT, 'manifest.json');
let manifest = { version: 1, cars: [], props: {} };
try {
  manifest = { ...manifest, ...JSON.parse(await readFile(manifestPath, 'utf8')) };
} catch {
  // A new manifest.
}
manifest.cars = cars;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${cars.length} cars → ${manifestPath}`);
