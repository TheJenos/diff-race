/*
 * Realistic models → public/models/real/*.glb and public/models/real/manifest.json, alongside the
 * Kenney kit ones (build-cars.mjs, build-props.mjs):
 *
 *   props  Poly Haven's (polyhaven.com, CC0): oil drums, a rusty fire barrel, old tyres and two
 *          rocks. Each one's glTF (1k) goes in assets-src/polyhaven-models/<id>/ (<id>.gltf, its
 *          .bin and textures/).
 *   car    Khronos's Car Concept (CC-BY 4.0: Eric Chadwick, Darmstadt Graphics Group, from a CC0
 *          model by Unity Fan), Models/CarConcept/glTF-Binary/CarConcept.glb from
 *          github.com/KhronosGroup/glTF-Sample-Assets, in assets-src/khronos/.
 *
 *   npm run build:real
 *
 * Meshes are simplified (meshoptimizer) to what a race can draw dozens of, and textures shrunk
 * and turned into JPEGs (macOS sips). The car loses its interior, wipers, number plate, brake
 * callipers and the Khronos and 3D Commerce logos (on the tyre walls, the rims and the plate);
 * its paint, glass and lights become plain PBR materials (the game paints the body in each
 * racer's colour and lights the brake lights). It comes out in car space, front toward −z and
 * right toward +x, in three parts the game fits to the physics car as it fits the kit cars:
 *   paint  the main body colour;
 *   trim   everything else on the body, one primitive per material;
 *   wheel  one right-hand wheel centred on its axle (the game mirrors it for the left), its axle
 *          straightened along x: the model is posed with its front wheels steered 30°, and a
 *          wheel spun about any other line than its own axle wobbles.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { joinPrimitives, prune, quantize, simplifyPrimitive, transformPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PROPS_SOURCE = opt('props', 'assets-src/polyhaven-models');
const CAR_SOURCE = opt('car', 'assets-src/khronos/CarConcept.glb');
const OUT = opt('out', 'public/models/real');

/**
 * Scenery kinds (src/game/world/props.ts) and the Poly Haven model each one takes:
 *   height / size  metres tall, or across its widest side, once built (matching the procedural one)
 *   lie            lay it on its side first (the tyre stands on its tread)
 *   copies         more of it: [x, y, z, turn about y (rad)] once sized; y is a stack's step
 *   triangles      simplified to about this many (per copy)
 *   textures       px the maps are kept at
 *   matte / tint   rougher all over (no roughness map), and its colour multiplied: the scanned
 *                  rocks are dark and look wet, the quarry's are dry and red
 */
const PROPS = {
  barrels: { id: 'Barrel_01', height: 1.15, triangles: 700, textures: 512, copies: [[-0.5, 0, 0.3, 0.4], [0.55, 0, -0.2, 2.1], [0, 0, -0.9, 4.2]] },
  fireBarrel: { id: 'Barrel_02', height: 1.1, triangles: 700, textures: 512 },
  tyres: { id: 'old_tyre', size: 1, lie: true, triangles: 500, textures: 512, copies: [0, 1, 2, 3].map((k) => [0, k, 0, k * 1.3]) },
  rock: { id: 'rock_07', size: 8, triangles: 2400, textures: 512, sink: 0.15, matte: 0.92, tint: [1.9, 1.35, 1.05] },
  boulder: { id: 'rock_09', size: 4.4, triangles: 1600, textures: 512, sink: 0.1, matte: 0.92, tint: [1.7, 1.25, 1] },
};

/** Car parts left out: the cabin (behind dark glass), small or hidden mechanics, and the number plate */
const CAR_DROP = [/^Interior/, /Wipers/, /^License/, /^Engine$/, /^Axles$/, /BrakePad/, /^BodyHoodInterior/, /^BodyHoodUnder$/];
/** Not counted in the body's size: the mirrors stick out past the sides */
const NOT_BODY = /Mirror/;
/** The car's triangles are cut to this share, per part (the rims are the most over-built) */
const CAR_KEEP = { paint: 0.45, trim: 0.5, wheel: 0.3 };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.WARN));
await MeshoptSimplifier.ready;
const tmp = await mkdtemp(join(tmpdir(), 'diffrace-real-'));
await mkdir(OUT, { recursive: true });
const manifest = { version: 1, props: {}, car: null };

// ---------------------------------------------------------------- helpers

/** A texture shrunk to `size` px and stored as a JPEG (normal maps keep more quality) */
async function shrink(texture, size, normal) {
  const ext = texture.getMimeType() === 'image/png' ? 'png' : 'jpg';
  const src = join(tmp, `t.${ext}`);
  const out = join(tmp, 'out.jpg');
  await writeFile(src, texture.getImage());
  const [w] = texture.getSize() ?? [size];
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', normal ? '90' : '80', ...(w > size ? ['-Z', String(size)] : []), src, '--out', out], { stdio: 'pipe' });
  texture.setImage(new Uint8Array(await readFile(out))).setMimeType('image/jpeg').setURI('');
}

/** Every texture in the document shrunk (see `shrink`); `big` for any 2048 px or more (an atlas shared by many parts) */
async function shrinkAll(doc, size, big = size) {
  const normals = new Set(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
  for (const t of doc.getRoot().listTextures()) await shrink(t, (t.getSize()?.[0] ?? 0) >= 2048 ? big : size, normals.has(t));
}

/** A primitive's own copy, attributes and indices included (transforming it then leaves the original alone) */
function deepClone(prim) {
  const c = prim.clone();
  for (const s of c.listSemantics()) c.setAttribute(s, c.getAttribute(s).clone());
  if (c.getIndices()) c.setIndices(c.getIndices().clone());
  return c;
}

/** Positions' bounds over primitives */
function bounds(prims) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = [0, 0, 0];
  for (const p of prims) {
    const a = p.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) {
      a.getElement(i, v);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    }
  }
  return { min, max };
}

const tris = (p) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;

/** Simplified to about `keep` of its triangles, allowing `error` (a share of the mesh's size) */
function simplified(doc, prim, keep, error) {
  weldPrimitive(prim);
  simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.min(1, keep), error, lockBorder: false });
  return prim;
}

/**
 * A wheel's axle and centre, from its tyre's points: the tyre is a wide ring, so it spreads least
 * along its axle (the smallest eigenvector of their covariance), and its middle is its centre.
 */
function axleOf(prims) {
  const pts = [];
  const v = [0, 0, 0];
  for (const p of prims) {
    const a = p.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) pts.push([...a.getElement(i, v)]);
  }
  const c = [0, 0, 0];
  for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += ((p[i] - c[i]) * (p[j] - c[j])) / pts.length;
  // Power iteration on (trace·I − C) converges on C's smallest eigenvector.
  const tr = C[0][0] + C[1][1] + C[2][2];
  let axle = [1, 0, 0];
  for (let it = 0; it < 200; it++) {
    const n = [0, 1, 2].map((i) => tr * axle[i] - (C[i][0] * axle[0] + C[i][1] * axle[1] + C[i][2] * axle[2]));
    const l = Math.hypot(...n);
    axle = n.map((x) => x / l);
  }
  if (axle[0] < 0) axle = axle.map((x) => -x);
  // The ring's middle: halfway across its bounds (its points' average leans toward whichever side has more of them).
  const b = bounds(prims);
  return { axle, centre: b.min.map((m, k) => (m + b.max[k]) / 2) };
}

/** Column-major 4×4 turning unit vector `a` onto +x (Rodrigues' formula) */
function ontoX(a) {
  const [x, y, z] = a;
  // Axis a × x̂ = (0, z, −y), sin = |a × x̂|, cos = a·x̂.
  const s = Math.hypot(y, z);
  if (s < 1e-9) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const k = [0, z / s, -y / s];
  const c = x;
  const t = 1 - c;
  const m = (i, j) => (i === j ? c : 0) + t * k[i] * k[j] + s * (i === 0 ? [0, -k[2], k[1]] : i === 1 ? [k[2], 0, -k[0]] : [-k[1], k[0], 0])[j];
  // m(i, j) is row i, column j; glTF matrices are column-major.
  return [m(0, 0), m(1, 0), m(2, 0), 0, m(0, 1), m(1, 1), m(2, 1), 0, m(0, 2), m(1, 2), m(2, 2), 0, 0, 0, 0, 1];
}

/** Column-major 4×4: rotate `turn` about y, scale, then move */
function matrix(turn, s, tx, ty, tz) {
  const c = Math.cos(turn) * s;
  const n = Math.sin(turn) * s;
  return [c, 0, -n, 0, 0, s, 0, 0, n, 0, c, 0, tx, ty, tz, 1];
}

/** The scene rebuilt as just these named meshes (each a list of primitives), everything else pruned */
async function keepOnly(doc, parts) {
  const root = doc.getRoot();
  const scene = root.listScenes()[0] ?? doc.createScene();
  for (const n of root.listNodes()) n.dispose();
  for (const [name, prims] of Object.entries(parts)) {
    const mesh = doc.createMesh(name);
    for (const p of prims) mesh.addPrimitive(p);
    scene.addChild(doc.createNode(name).setMesh(mesh));
  }
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  root.setDefaultScene(scene);
  await doc.transform(prune());
}

async function write(doc, file) {
  await doc.transform(quantize());
  await io.write(join(OUT, file), doc);
  return (await stat(join(OUT, file))).size;
}

// ---------------------------------------------------------------- props

let total = 0;
for (const [kind, p] of Object.entries(PROPS)) {
  const file = join(PROPS_SOURCE, p.id, `${p.id}.gltf`);
  let doc;
  try {
    doc = await io.read(file);
  } catch {
    console.log(`${kind.padEnd(10)} skipped: no ${file} (download ${p.id}, glTF 1k, from polyhaven.com/a/${p.id})`);
    continue;
  }
  const root = doc.getRoot();
  // Into world space, one primitive (Poly Haven's props are one mesh, one material).
  const world = root.listNodes().filter((n) => n.getMesh()).flatMap((n) => n.getMesh().listPrimitives().map((prim) => {
    const c = deepClone(prim);
    transformPrimitive(c, n.getWorldMatrix());
    return c;
  }));
  let prim = world.length > 1 ? joinPrimitives(world) : world[0];
  if (p.lie) transformPrimitive(prim, [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
  const before = tris(prim);
  const b0 = bounds([prim]);
  const across = Math.max(b0.max[0] - b0.min[0], b0.max[2] - b0.min[2]);
  const tall = b0.max[1] - b0.min[1];
  prim = simplified(doc, prim, p.triangles / before, 0.02);
  // Standing on y = 0 (sunk a little, for rocks), centred, sized.
  const s = p.height ? p.height / tall : p.size / across;
  const centre = [(b0.min[0] + b0.max[0]) / 2, b0.min[1] + tall * (p.sink ?? 0), (b0.min[2] + b0.max[2]) / 2];
  transformPrimitive(prim, [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -centre[0] * s, -centre[1] * s, -centre[2] * s, 1]);
  const step = tall * s;
  const copies = (p.copies ?? [[0, 0, 0, 0]]).map(([x, y, z, turn]) => {
    const c = deepClone(prim);
    transformPrimitive(c, matrix(turn, 1, x, y * step, z));
    return c;
  });
  const body = copies.length > 1 ? joinPrimitives(copies) : copies[0];
  await keepOnly(doc, { body: [body] });
  const mat = body.getMaterial();
  if (mat && p.matte) mat.setMetallicRoughnessTexture(null).setRoughnessFactor(p.matte).setMetallicFactor(0);
  if (mat && p.tint) mat.setBaseColorFactor([...p.tint, 1]);
  await doc.transform(prune());
  await shrinkAll(doc, p.textures);
  const bytes = await write(doc, `${kind}.glb`);
  total += bytes;
  manifest.props[kind] = { file: `real/${kind}.glb`, id: p.id };
  console.log(`${kind.padEnd(10)} ${p.id.padEnd(10)} ${String(before).padStart(6)} → ${String(tris(body)).padStart(5)} triangles  ${(bytes / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------- car

/** The car's own materials, made plain PBR: no clearcoat, transmission, iridescence or logos */
function plainMaterials(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    for (const e of m.listExtensions()) m.setExtension(e.extensionName, null);
    // The Khronos logo is the emissive map on the rims, mirrors and plate.
    m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
    const name = m.getName();
    if (name === 'Glass') m.setBaseColorFactor([0.03, 0.035, 0.04, 1]).setMetallicFactor(0).setRoughnessFactor(0.04).setAlphaMode('OPAQUE');
    // Tyre walls carry the logos in their colour and bumps: plain rubber instead.
    if (name === 'Tireside') m.setBaseColorTexture(null).setNormalTexture(null).setBaseColorFactor([0.05, 0.05, 0.05, 1]).setRoughnessFactor(0.85);
    if (name === 'Tiretread') m.setBaseColorFactor([0.035, 0.035, 0.035, 1]).setRoughnessFactor(0.8);
    if (name === 'Headlight') m.setEmissiveFactor([1, 0.95, 0.85]).setBaseColorFactor([0.9, 0.9, 0.9, 1]);
    if (name === 'Brakelight') m.setEmissiveFactor([1, 0.08, 0.05]).setBaseColorFactor([0.3, 0, 0, 1]);
    if (name === 'Signallight') m.setEmissiveFactor([0.6, 0.3, 0]).setBaseColorFactor([0.4, 0.25, 0, 1]);
    // The black accent paint, metallic: dark chrome without reflections to show, so a touch less.
    if (name.startsWith('Paint 2')) m.setMetallicFactor(0.75).setRoughnessFactor(0.3);
  }
  // The tiled normal maps (paint flakes, tyre tread) keep their texture transforms.
  for (const v of doc.getRoot().listExtensionsUsed()) if (v.extensionName !== 'KHR_texture_transform') v.dispose();
}

async function buildCar() {
  let doc;
  try {
    doc = await io.read(CAR_SOURCE);
  } catch {
    console.log(`car        skipped: no ${CAR_SOURCE}`);
    return;
  }
  // The model faces +z with its left on +x: half a turn about y puts its front toward −z, right toward +x.
  const turn = matrix(Math.PI, 1, 0, 0, 0);
  const dropped = (n) => {
    for (let x = n; x; x = x.getParentNode()) if (CAR_DROP.some((re) => re.test(x.getName()))) return true;
    return false;
  };
  const wheelOf = (n) => {
    for (let x = n; x; x = x.getParentNode()) if (/^Wheel(Front|Rear)[LR]$/.test(x.getName())) return x.getName();
    return null;
  };
  const parts = { paint: [], trim: [], wheel: [] };
  const sizing = [];
  const wheelCentres = {};
  const nodes = doc.getRoot().listNodes();
  for (const n of nodes) {
    const w = /^Wheel(Front|Rear)[LR]$/.exec(n.getName());
    if (w) {
      const t = n.getWorldTranslation();
      wheelCentres[n.getName()] = [-t[0], t[1], -t[2]];
    }
  }
  // The model's right front wheel: after the turn it's on the right (+x), the side the game's wheel is.
  const keepWheel = 'WheelFrontR';
  for (const n of nodes) {
    const mesh = n.getMesh();
    if (!mesh || dropped(n)) continue;
    const wheel = wheelOf(n);
    if (wheel && wheel !== keepWheel) continue;
    for (const prim of mesh.listPrimitives()) {
      const c = deepClone(prim);
      transformPrimitive(c, n.getWorldMatrix());
      transformPrimitive(c, turn);
      const mat = c.getMaterial()?.getName() ?? '';
      if (wheel) {
        const [x, y, z] = wheelCentres[keepWheel];
        transformPrimitive(c, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1]);
        parts.wheel.push(c);
      } else {
        (mat === 'Paint 1 Carmine' ? parts.paint : parts.trim).push(c);
        if (!NOT_BODY.test(n.getName())) sizing.push(c);
      }
    }
  }
  // Straighten the wheel: its axle along x, about its tyre's centre.
  const tyre = parts.wheel.filter((p) => /^Tire/.test(p.getMaterial()?.getName() ?? ''));
  const { axle, centre } = axleOf(tyre);
  const toe = (Math.acos(Math.min(1, axle[0])) * 180) / Math.PI;
  for (const p of parts.wheel) {
    transformPrimitive(p, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -centre[0], -centre[1], -centre[2], 1]);
    transformPrimitive(p, ontoX(axle));
  }
  const before = Object.values(parts).flat().reduce((sum, p) => sum + tris(p), 0);
  const body = bounds(sizing);
  // Merge each part's primitives that share a material (and attributes), then simplify them.
  const merged = {};
  for (const [part, prims] of Object.entries(parts)) {
    const groups = new Map();
    for (const p of prims) {
      const key = `${p.getMaterial()?.getName()}|${p.listSemantics().sort().join(',')}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    merged[part] = [...groups.values()].map((g) => simplified(doc, g.length > 1 ? joinPrimitives(g) : g[0], CAR_KEEP[part], 0.002));
  }
  const wb = bounds(merged.wheel);
  const wheelRadius = Math.max(wb.max[1] - wb.min[1], wb.max[2] - wb.min[2]) / 2;
  plainMaterials(doc);
  await keepOnly(doc, merged);
  await shrinkAll(doc, 512, 1024);
  const bytes = await write(doc, 'car.glb');
  total += bytes;
  const at = (name) => wheelCentres[name].map((v) => Math.round(v * 1000) / 1000);
  // Car space: front toward −z, so the model's front wheels are at −z now; its left (L) at −x.
  manifest.car = {
    id: 'concept',
    file: 'real/car.glb',
    wheels: { fl: at('WheelFrontL'), fr: at('WheelFrontR'), rl: at('WheelRearL'), rr: at('WheelRearR') },
    wheelRadius: Math.round(wheelRadius * 1000) / 1000,
    body: { min: body.min.map((v) => Math.round(v * 1000) / 1000), max: body.max.map((v) => Math.round(v * 1000) / 1000) },
    roof: Math.round(body.max[1] * 1000) / 1000,
  };
  const after = Object.values(merged).flat().reduce((sum, p) => sum + tris(p), 0);
  console.log(`car        wheel straightened by ${toe.toFixed(1)}°, now ${(wb.max[0] - wb.min[0]).toFixed(3)} m wide and ${(wb.max[1] - wb.min[1]).toFixed(3)} × ${(wb.max[2] - wb.min[2]).toFixed(3)} m round`);
  console.log(`car        concept    ${before} → ${after} triangles (${Object.entries(merged).map(([k, v]) => `${k} ${v.reduce((s, p) => s + tris(p), 0)}`).join(', ')})  ${(bytes / 1024).toFixed(0)} KB`);
}

try {
  await buildCar();
} finally {
  await rm(tmp, { recursive: true, force: true });
}
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${Object.keys(manifest.props).length} props${manifest.car ? ' and the car' : ''}, ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}/`);
