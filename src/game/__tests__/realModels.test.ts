import { readFileSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { fitCar, type ManifestCar } from '../models';

/*
 * The realistic models as shipped (public/models/real/, from scripts/build-real.mjs): the car the
 * right way round and the size of a car, so it fits the physics car as a kit car does, and every
 * file there, within the download budget.
 */

const DIR = 'public/models';
const manifest = JSON.parse(readFileSync(`${DIR}/real/manifest.json`, 'utf8')) as {
  car: ManifestCar | null;
  props: Record<string, { file: string }>;
};

describe('realistic models', () => {
  const car = manifest.car!;

  it('has the car in car space: front toward −z, right toward +x, on its wheels', () => {
    const w = car.wheels;
    expect(w.fl[2]).toBeLessThan(w.rl[2]);
    expect(w.fr[2]).toBeLessThan(w.rr[2]);
    expect(w.fl[0]).toBeLessThan(0);
    expect(w.fr[0]).toBeGreaterThan(0);
    expect(car.wheelRadius).toBeGreaterThan(0.25);
    expect(car.wheelRadius).toBeLessThan(0.5);
    // The wheels' bottoms are about where the body's are (it stands on them).
    expect(Math.abs(w.fl[1] - car.wheelRadius - car.body.min[1])).toBeLessThan(0.2);
    expect(car.roof).toBeGreaterThan(w.fl[1] + car.wheelRadius);
  });

  it('is the size of a car without its mirrors, and fits the physics car as wide as a kit car', () => {
    const length = car.body.max[2] - car.body.min[2];
    const width = car.body.max[0] - car.body.min[0];
    expect(length).toBeGreaterThan(3.8);
    expect(length).toBeLessThan(5);
    // A wide concept car: 2.24 m across the body (its mirrors not counted, or it would fit smaller).
    expect(width).toBeLessThan(2.3);
    const fitted = fitCar(car, new Map([
      ['paint', new THREE.BoxGeometry(width, 1, length).translate((car.body.min[0] + car.body.max[0]) / 2, 1, (car.body.min[2] + car.body.max[2]) / 2)],
      ['wheel', new THREE.BoxGeometry(0.3, car.wheelRadius * 2, car.wheelRadius * 2)],
    ]))!;
    expect(fitted.rear - fitted.front).toBeGreaterThan(4);
    expect(fitted.halfWidth * 2).toBeLessThanOrEqual(2.1 + 1e-6);
  });

  it('has a straight wheel: as wide as a tyre, as round as a wheel (a steered one wobbles as it spins)', async () => {
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(`${DIR}/${car.file}`);
    const wheel = doc.getRoot().listNodes().find((n) => n.getName() === 'wheel')!;
    const b = getBounds(wheel);
    const [w, h, d] = [0, 1, 2].map((k) => b.max[k]! - b.min[k]!);
    expect(w).toBeLessThan(0.4);
    expect(Math.abs(h! - d!)).toBeLessThan(0.01);
    // Centred on its axle.
    for (const k of [1, 2]) expect(Math.abs(b.max[k]! + b.min[k]!) / 2).toBeLessThan(0.005);
  });

  it('ships every model as a GLB, within the budget', () => {
    let total = 0;
    for (const file of [car.file, ...Object.values(manifest.props).map((p) => p.file)]) {
      const bytes = readFileSync(`${DIR}/${file}`);
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('glTF');
      total += statSync(`${DIR}/${file}`).size;
    }
    expect(Object.keys(manifest.props).sort()).toEqual(['barrels', 'boulder', 'fireBarrel', 'rock', 'tyres']);
    // Downloaded before the first race with everything else: keep the lot under 3.5 MB.
    expect(total).toBeLessThan(3.5 * 1024 * 1024);
  });
});
