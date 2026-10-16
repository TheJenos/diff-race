/*
 * Shared by build-cars.mjs and build-props.mjs: read a model, flatten its scene into world-space
 * triangles with one flat colour each, and write parts of it back out as a small GLB.
 *
 * Colours are baked into the vertices, so the game draws kit models with the same vertex-coloured
 * materials as its procedural ones. A triangle's colour is its material's base colour × its vertex
 * colours × its texture where its middle lands: Kenney's kits colour everything from one palette
 * texture of flat swatches, so one texel per triangle gives the colour exactly.
 */

import { readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { PNG } from 'pngjs';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** Every .glb and .gltf under `dir`, by file name without the extension (the first one found wins) */
export async function findModels(dir) {
  const found = new Map();
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(d, e.name);
      if (e.isDirectory()) await walk(path);
      else if (/\.(glb|gltf)$/i.test(e.name)) {
        const name = basename(e.name, extname(e.name));
        if (!found.has(name)) found.set(name, path);
      }
    }
  }
  await walk(dir);
  return found;
}

/** The first of `names` that's in `found`, as [name, path] */
export function pick(found, names) {
  for (const n of names) if (found.has(n)) return [n, found.get(n)];
  return null;
}

const pngs = new Map();

function decode(texture) {
  if (!texture) return null;
  if (pngs.has(texture)) return pngs.get(texture);
  let img = null;
  const bytes = texture.getImage();
  if (bytes && texture.getMimeType() === 'image/png') {
    try {
      img = PNG.sync.read(Buffer.from(bytes));
    } catch {
      img = null;
    }
  }
  pngs.set(texture, img);
  return img;
}

function texel(img, u, v) {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)));
  const i = (y * img.width + x) * 4;
  // sRGB in the image; linear in the vertices, as three.js expects of vertex colours.
  return [srgbToLinear(img.data[i] / 255), srgbToLinear(img.data[i + 1] / 255), srgbToLinear(img.data[i + 2] / 255)];
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Determinant of a column-major 4×4's upper 3×3: negative for a mirroring transform */
function det3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

/**
 * Every triangle in the default scene, in world space: { p: [9 numbers], color: [r,g,b] (linear),
 * glow: emissive material, node: the name of the nearest named node it hangs under }.
 */
export function triangles(doc) {
  const out = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) return out;
  const visit = (node, label) => {
    const name = node.getName() || label;
    const mesh = node.getMesh();
    if (mesh) {
      const m = node.getWorldMatrix();
      const det = det3(m);
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // triangles only
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const uv = prim.getAttribute('TEXCOORD_0');
        const vcol = prim.getAttribute('COLOR_0');
        const idx = prim.getIndices();
        const mat = prim.getMaterial();
        const base = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
        const img = mat ? decode(mat.getBaseColorTexture()) : null;
        const em = mat ? mat.getEmissiveFactor() : [0, 0, 0];
        const emImg = mat ? decode(mat.getEmissiveTexture()) : null;
        const glow = Math.max(...em) > 0.1;
        const count = idx ? idx.getCount() : pos.getCount();
        const at = (k) => (idx ? idx.getScalar(k) : k);
        const v = [0, 0, 0];
        for (let t = 0; t + 2 < count; t += 3) {
          const ids = det < 0 ? [at(t), at(t + 2), at(t + 1)] : [at(t), at(t + 1), at(t + 2)];
          const p = [];
          let u0 = 0, v0 = 0;
          let cr = 0, cg = 0, cb = 0;
          for (const id of ids) {
            pos.getElement(id, v);
            p.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
            if (uv) {
              const w = uv.getElement(id, [0, 0]);
              u0 += w[0] / 3;
              v0 += w[1] / 3;
            }
            if (vcol) {
              const c = vcol.getElement(id, [1, 1, 1, 1]);
              cr += c[0] / 3;
              cg += c[1] / 3;
              cb += c[2] / 3;
            } else {
              cr += 1 / 3;
              cg += 1 / 3;
              cb += 1 / 3;
            }
          }
          // A glowing part's colour is its glow (the emissive colour × its emissive map).
          const tex = glow ? (emImg && uv ? texel(emImg, u0, v0) : [1, 1, 1]) : img && uv ? texel(img, u0, v0) : [1, 1, 1];
          const tint = glow ? [em[0], em[1], em[2]] : [base[0] * cr, base[1] * cg, base[2] * cb];
          out.push({ p, color: [tint[0] * tex[0], tint[1] * tex[1], tint[2] * tex[2]], glow, node: name });
        }
      }
    }
    for (const child of node.listChildren()) visit(child, name);
  };
  for (const node of scene.listChildren()) visit(node, '');
  return out;
}

/** Bounds of a list of triangles: { min: [x,y,z], max: [x,y,z] } */
export function bounds(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 9; k++) {
      const a = k % 3;
      if (t.p[k] < min[a]) min[a] = t.p[k];
      if (t.p[k] > max[a]) max[a] = t.p[k];
    }
  }
  return { min, max };
}

/** Move and scale triangles in place: p' = (p + offset) × scale, per axis */
export function transform(tris, offset, scale) {
  for (const t of tris) for (let k = 0; k < 9; k++) t.p[k] = (t.p[k] + offset[k % 3]) * scale[k % 3];
  // A mirror (an odd number of negative scales) turns triangles inside out: wind them back.
  if (scale[0] * scale[1] * scale[2] < 0) for (const t of tris) t.p = [...t.p.slice(0, 3), ...t.p.slice(6, 9), ...t.p.slice(3, 6)];
}

/** Turn triangles about y by quarter turns (x, z) → (−z, x) each */
export function turn(tris, quarters) {
  const q = ((quarters % 4) + 4) % 4;
  for (const t of tris) {
    for (let k = 0; k < 9; k += 3) {
      let x = t.p[k], z = t.p[k + 2];
      for (let i = 0; i < q; i++) [x, z] = [-z, x];
      t.p[k] = x;
      t.p[k + 2] = z;
    }
  }
}

/** The colour covering the most area (rounded so near-identical swatches count as one), skipping `skip(color)` */
export function dominantColor(tris, skip = () => false) {
  const area = new Map();
  for (const t of tris) {
    if (skip(t.color)) continue;
    const key = colorKey(t.color);
    area.set(key, (area.get(key) ?? 0) + triArea(t.p));
  }
  let best = null, most = 0;
  for (const [k, a] of area) if (a > most) [best, most] = [k, a];
  return best;
}

export const colorKey = (c) => c.map((x) => Math.round(x * 40)).join(',');
export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function triArea(p) {
  const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
  const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
}

/**
 * Write named parts as one GLB: each part a node with one mesh of flat-shaded, vertex-coloured
 * triangles, welded (shared corners stored once) and quantized (KHR_mesh_quantization: 16-bit
 * positions, 8-bit normals and colours, about half the size; the loader turns them back into floats).
 */
export async function writeParts(path, parts) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('scene');
  doc.getRoot().setDefaultScene(scene);
  const material = doc.createMaterial('baked').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.7).setMetallicFactor(0.2);
  for (const [name, tris] of Object.entries(parts)) {
    if (!tris.length) continue;
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    tris.forEach((t, i) => {
      const p = t.p;
      const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
      const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (let j = 0; j < 3; j++) {
        const o = (i * 3 + j) * 3;
        pos.set(p.slice(j * 3, j * 3 + 3), o);
        nor.set([nx, ny, nz], o);
        col.set(t.color, o);
      }
    });
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer))
      .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer))
      .setMaterial(material);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    scene.addChild(doc.createNode(name).setMesh(mesh));
  }
  await doc.transform(weld(), dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }));
  await io.write(path, doc);
}
