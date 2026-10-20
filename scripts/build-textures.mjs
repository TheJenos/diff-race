/*
 * Photo-scanned surfaces from Poly Haven (polyhaven.com, CC0) → public/textures/, and their list in
 * public/textures/manifest.json. Put each texture's 1k JPGs (colour, OpenGL normal and ARM:
 * <id>_diff_1k.jpg, <id>_nor_gl_1k.jpg, <id>_arm_1k.jpg) under assets-src/polyhaven/, then:
 *
 *   npm run build:textures
 *
 * Each colour map has its brightness evened out (its average brought to MEAN, in linear light) so
 * dark asphalt keeps its detail through the JPEG and the game can tint every surface to its theme's
 * colour the same way; the manifest keeps each one's average colour for that. Normal and ARM
 * (occlusion, roughness, metalness) maps are just resized and recompressed. macOS only: it uses
 * `sips` for the images. Without the manifest the game draws its procedural textures.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SOURCE = opt('source', 'assets-src/polyhaven');
const OUT = opt('out', 'public/textures');

/**
 * The game's surfaces (src/game/surfaces.ts) and the Poly Haven texture for each: how many metres
 * one repeat covers in the game, and the size each map is kept at (px).
 */
const SETS = {
  asphalt: { id: 'asphalt_track', metres: 3, color: 768, normal: 1024, arm: 512 },
  gravel: { id: 'sandy_gravel', metres: 1.5, color: 1024, normal: 768, arm: 512 },
  ground: { id: 'dirt_aerial_02', metres: 40, color: 1024, normal: 512, arm: 512 },
  concrete: { id: 'concrete_wall_008', metres: 3, color: 1024, normal: 512, arm: 512 },
  metal: { id: 'metal_plate', metres: 1.5, color: 512, normal: 512, arm: 512 },
};
/** Every colour map's average brightness (linear), after evening out */
const MEAN = 0.22;
/** JPEG quality: normals band badly when squeezed, so they keep more */
const QUALITY = { color: 76, normal: 88, arm: 80 };

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function sips(...a) {
  execFileSync('sips', a, { stdio: 'pipe' });
}

const tmp = await mkdtemp(join(tmpdir(), 'diffrace-textures-'));
const manifest = { version: 1, source: 'Poly Haven (polyhaven.com), CC0 1.0', sets: {} };
let total = 0;
try {
  for (const [name, set] of Object.entries(SETS)) {
    const src = (map) => join(SOURCE, `${set.id}_${map}_1k.jpg`);
    for (const map of ['diff', 'nor_gl', 'arm']) {
      try {
        await stat(src(map));
      } catch {
        throw new Error(`missing ${src(map)}: download ${set.id} (1k JPG) from polyhaven.com/a/${set.id}`);
      }
    }
    const dir = join(OUT, name);
    await mkdir(dir, { recursive: true });

    // Colour: decode, even out the brightness, encode again.
    const png = join(tmp, `${name}.png`);
    sips('-s', 'format', 'png', '-Z', String(set.color), src('diff'), '--out', png);
    const img = PNG.sync.read(await readFile(png));
    const px = img.width * img.height;
    const sum = [0, 0, 0];
    for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) sum[c] += toLinear(img.data[i * 4 + c] / 255);
    const lum = (0.2126 * sum[0] + 0.7152 * sum[1] + 0.0722 * sum[2]) / px;
    const k = MEAN / lum;
    const mean = [0, 0, 0];
    for (let i = 0; i < px; i++) {
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, toLinear(img.data[i * 4 + c] / 255) * k);
        mean[c] += v;
        img.data[i * 4 + c] = Math.round(toSrgb(v) * 255);
      }
      img.data[i * 4 + 3] = 255;
    }
    await writeFile(png, PNG.sync.write(img));
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY.color), png, '--out', join(dir, 'color.jpg'));
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY.normal), '-Z', String(set.normal), src('nor_gl'), '--out', join(dir, 'normal.jpg'));
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', String(QUALITY.arm), '-Z', String(set.arm), src('arm'), '--out', join(dir, 'arm.jpg'));

    let bytes = 0;
    for (const f of ['color', 'normal', 'arm']) bytes += (await stat(join(dir, `${f}.jpg`))).size;
    total += bytes;
    manifest.sets[name] = {
      id: set.id,
      metres: set.metres,
      /** Average colour of color.jpg, linear */
      mean: mean.map((v) => Math.round((v / px) * 10000) / 10000),
      color: `${name}/color.jpg`,
      normal: `${name}/normal.jpg`,
      arm: `${name}/arm.jpg`,
    };
    console.log(`${name.padEnd(9)} ${set.id.padEnd(18)} ×${k.toFixed(2)} brightness  ${(bytes / 1024).toFixed(0)} KB`);
  }
} finally {
  await rm(tmp, { recursive: true, force: true });
}
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(OUT, 'CREDITS.txt'), [
  'Surface textures from Poly Haven (polyhaven.com), CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/):',
  ...Object.values(SETS).map((s) => `  ${s.id}  https://polyhaven.com/a/${s.id}`),
  'Resized and recompressed for Diff Race by scripts/build-textures.mjs.',
  '',
].join('\n'));
console.log(`${Object.keys(SETS).length} surfaces, ${(total / 1024 / 1024).toFixed(2)} MB → ${OUT}/`);
