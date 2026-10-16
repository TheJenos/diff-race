/*
 * Kenney kit models (CC0) for the scenery → public/models/props/*.glb, and the props in
 * public/models/manifest.json. Unzip the kits anywhere under assets-src/kenney/, pick models in
 * scripts/props.config.mjs, then:
 *
 *   npm run build:props             (or -- --list to see which models it found;
 *                                    -- --source, --out and --config to use other folders or another config)
 *
 * Each prop is sized and turned as its config says, stood on y = 0 and centred, its colours baked
 * into the vertices; emissive parts go in a separate glow part. The game instances them exactly
 * like its procedural props (src/game/world/sceneryMesh.ts), and keeps the procedural one for
 * any kind not built.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bounds, colorKey, dominantColor, findModels, io, luminance, pick, triangles, turn, transform, writeParts } from './lib/bake.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SOURCE = opt('source', 'assets-src/kenney');
const OUT = opt('out', 'public/models');
const CONFIG = opt('config', 'scripts/props.config.mjs');
const { PROPS } = await import(pathToFileURL(resolve(CONFIG)).href);

const found = await findModels(SOURCE);
if (args.includes('--list')) {
  console.log([...found.keys()].sort().join('\n') || `no models under ${SOURCE}`);
  process.exit(0);
}

async function build(kind, cfg, path) {
  const tris = triangles(await io.read(path));
  if (!tris.length) throw new Error('no triangles');
  turn(tris, cfg.turn ?? 2);
  const b = bounds(tris);
  const across = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const tall = b.max[1] - b.min[1];
  const k = cfg.height ? cfg.height / tall : cfg.size ? cfg.size / across : 1;
  if (!Number.isFinite(k) || k <= 0) throw new Error('it has no size');
  // Stood on the ground, centred over its origin.
  transform(tris, [-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2], [k, k, k]);
  if (cfg.tint) {
    const main = dominantColor(tris, (c) => luminance(c) < 0.05);
    for (const t of tris) if (colorKey(t.color) === main) t.color = [1, 1, 1];
  }
  const all = cfg.copies ? cfg.copies.flatMap(([x, y, z]) => tris.map((t) => ({ ...t, p: t.p.map((v, k) => v + [x, y, z][k % 3]) }))) : tris;
  const body = all.filter((t) => !t.glow);
  const glow = all.filter((t) => t.glow);
  await writeParts(join(OUT, 'props', `${kind}.glb`), { body, glow });
  return { file: `props/${kind}.glb`, tinted: Boolean(cfg.tint), triangles: all.length };
}

await mkdir(join(OUT, 'props'), { recursive: true });
const props = {};
for (const [kind, cfg] of Object.entries(PROPS)) {
  const hit = pick(found, cfg.files);
  if (!hit) {
    console.log(`· ${kind}: none of ${cfg.files.join(', ')} found, stays procedural`);
    continue;
  }
  try {
    props[kind] = await build(kind, cfg, hit[1]);
    console.log(`✓ ${kind} ← ${hit[0]}: ${props[kind].triangles} triangles`);
  } catch (err) {
    console.warn(`✗ ${kind} (${hit[0]}): ${err instanceof Error ? err.message : err}`);
  }
}

const manifestPath = join(OUT, 'manifest.json');
let manifest = { version: 1, cars: [], props: {} };
try {
  manifest = { ...manifest, ...JSON.parse(await readFile(manifestPath, 'utf8')) };
} catch {
  // A new manifest.
}
manifest.props = props;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${Object.keys(props).length} props → ${manifestPath}`);
