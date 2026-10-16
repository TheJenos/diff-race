/*
 * Kenney-like models for testing the model build: a car facing +z, coloured from a palette texture
 * (red paint, dark glass, black tyres, grey rims), with four wheels named the way the kit names
 * them; and a chimney with a glowing lamp on top.
 */
import { mkdir } from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { PNG } from 'pngjs';

// 4×1 palette: red paint, dark glass, black tyre, grey rim.
const pal = [[200, 30, 30], [20, 30, 50], [10, 10, 10], [180, 180, 180]];
const png = new PNG({ width: 4, height: 1 });
pal.forEach((c, i) => png.data.set([...c, 255], i * 4));
const image = PNG.sync.write(png);
const uvOf = (i) => [(i + 0.5) / 4, 0.5];

function boxPrim(doc, buf, mat, [sx, sy, sz], [cx, cy, cz], swatch) {
  const p = [], uv = [], idx = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, a, b] of faces) {
    const base = p.length / 3;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) p.push(([cx, cy, cz][k]) + ([sx, sy, sz][k] / 2) * (n[k] + a[k] * s + b[k] * t));
      uv.push(...uvOf(swatch));
    }
    // Wind counter-clockwise seen from outside: a × b should equal n.
    const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const ok = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
    idx.push(...(ok ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
  }
  return doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf))
    .setMaterial(mat);
}

async function car(out) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = doc.createTexture('colormap').setImage(image).setMimeType('image/png').setURI('colormap.png');
  const mat = doc.createMaterial('colormap').setBaseColorTexture(tex);
  const scene = doc.createScene();
  const body = doc.createMesh('body')
    .addPrimitive(boxPrim(doc, buf, mat, [1.0, 0.35, 2.2], [0, 0.35, 0], 0))
    .addPrimitive(boxPrim(doc, buf, mat, [0.8, 0.3, 1.0], [0, 0.66, -0.1], 1));
  scene.addChild(doc.createNode('body').setMesh(body));
  const wheel = doc.createMesh('wheel')
    .addPrimitive(boxPrim(doc, buf, mat, [0.2, 0.36, 0.36], [0, 0, 0], 2))
    .addPrimitive(boxPrim(doc, buf, mat, [0.04, 0.2, 0.2], [0.11, 0, 0], 3));
  for (const [name, x, z, flip] of [['wheel-front-left', -0.45, 0.7, true], ['wheel-front-right', 0.45, 0.7, false], ['wheel-back-left', -0.45, -0.7, true], ['wheel-back-right', 0.45, -0.7, false]]) {
    const n = doc.createNode(name).setMesh(wheel).setTranslation([x, 0.18, z]);
    if (flip) n.setRotation([0, 1, 0, 0]); // turned to face out, as kits do
    scene.addChild(n);
  }
  await new NodeIO().write(`${out}/car-kit/race.glb`, doc);
}

async function chimney(out) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const mat = doc.createMaterial('brick').setBaseColorFactor([0.4, 0.25, 0.2, 1]);
  const scene = doc.createScene();
  scene.addChild(doc.createNode('chimney').setMesh(doc.createMesh().addPrimitive(boxPrim(doc, buf, mat, [1, 4, 1], [0, 2, 0], 0))));
  const glowMat = doc.createMaterial('light').setEmissiveFactor([1, 0.2, 0.1]);
  scene.addChild(doc.createNode('lamp').setMesh(doc.createMesh().addPrimitive(boxPrim(doc, buf, glowMat, [0.2, 0.2, 0.2], [0, 4.1, 0], 0))));
  await new NodeIO().write(`${out}/chimney-large.glb`, doc);
}

/** Write the models under `out` (the car in a car-kit/ folder, as an unzipped kit would be) */
export async function makeFakeKit(out) {
  await mkdir(`${out}/car-kit`, { recursive: true });
  await car(out);
  await chimney(out);
}
