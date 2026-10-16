import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { makeFakeKit } from './fakeKit.mjs';

let dir = '';
let manifest = null;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffrace-models-'));
  await makeFakeKit(join(dir, 'src'));
  // The fake kit's chimney for smokestacks, and a container that isn't there.
  const config = join(dir, 'props.config.mjs');
  await writeFile(config, `export const PROPS = { smokestack: { files: ['chimney-large'], height: 34 }, container: { files: ['no-such-model'], size: 6 } };`);
  const args = ['--source', join(dir, 'src'), '--out', join(dir, 'out')];
  execFileSync(process.execPath, [join('scripts', 'build-cars.mjs'), ...args], { stdio: 'pipe' });
  execFileSync(process.execPath, [join('scripts', 'build-props.mjs'), ...args, '--config', config], { stdio: 'pipe' });
  manifest = JSON.parse(await readFile(join(dir, 'out', 'manifest.json'), 'utf8'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

/** Each part of a built model: its name and the distinct colours of its vertices */
async function parts(file) {
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(join(dir, 'out', file));
  return Object.fromEntries(doc.getRoot().listNodes().map((n) => {
    const c = n.getMesh().listPrimitives()[0].getAttribute('COLOR_0');
    const colors = new Set();
    for (let i = 0; i < c.getCount(); i++) colors.add(c.getElement(i, []).map((x) => x.toFixed(2)).join(','));
    return [n.getName(), [...colors]];
  }));
}

describe('the model build', () => {
  it('turns a car to face −z and finds its wheels', () => {
    const [car] = manifest.cars;
    expect(car.id).toBe('race');
    expect(car.wheels.fl[2]).toBeLessThan(car.wheels.rl[2]);
    expect(car.wheels.fl[0]).toBeLessThan(0);
    expect(car.wheels.fr[0]).toBeGreaterThan(0);
    expect(car.wheelRadius).toBeCloseTo(0.18, 3);
    expect(car.roof).toBeCloseTo(0.81, 3);
  });

  it('splits the paint (made white) from the trim and the wheel, colours from the palette', async () => {
    const p = await parts('cars/race.glb');
    expect(p.paint).toEqual(['1.00,1.00,1.00']);
    expect(p.trim).toHaveLength(1);
    expect(p.trim[0]).not.toBe('1.00,1.00,1.00');
    expect(p.wheel).toHaveLength(2);
  });

  it('builds the listed props it finds, glowing parts apart, and leaves the rest out', async () => {
    expect(Object.keys(manifest.props)).toEqual(['smokestack']);
    const p = await parts('props/smokestack.glb');
    expect(p.glow).toEqual(['1.00,0.20,0.10']);
    expect(p.body).toHaveLength(1);
  });
});
