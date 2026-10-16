import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fitCar, mirrorX, type ManifestCar } from '../../models';
import { CAR } from '../params';

// A kit car as build-cars.mjs describes it: facing −z, 2.2 long and 1 wide, standing on y = 0 on
// wheels 0.18 in radius, its roof at 0.81.
const kit: ManifestCar = {
  id: 'test',
  file: 'cars/test.glb',
  wheels: { fl: [-0.45, 0.18, -0.7], fr: [0.45, 0.18, -0.7], rl: [-0.45, 0.18, 0.7], rr: [0.45, 0.18, 0.7] },
  wheelRadius: 0.18,
  body: { min: [-0.5, 0.17, -1.1], max: [0.5, 0.81, 1.1] },
  roof: 0.81,
};

const parts = () => new Map<string, THREE.BufferGeometry>([
  ['paint', new THREE.BoxGeometry(1, 0.64, 2.2).translate(0, 0.49, 0)],
  ['wheel', new THREE.BoxGeometry(0.2, 0.36, 0.36)],
]);

const box = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox as THREE.Box3;
};

// The physics wheels' centres at rest, and the road under them.
const restY = CAR.wheels[0]!.y - CAR.restLength * 0.5;
const ground = restY - CAR.wheelRadius;

describe('fitting a kit car to the physics car', () => {
  const car = fitCar(kit, parts())!;
  // As long as fits (4.5 m), the width (2.1 m) not the limit here; lowered to 1.65 m tall.
  const s = 4.5 / 2.2;
  const sy = 1.65 / 0.81;

  it('scales the body to the length it fits and centres it', () => {
    const b = box(car.paint);
    expect(b.min.z).toBeCloseTo(-2.25, 5);
    expect(b.max.z).toBeCloseTo(2.25, 5);
    expect(car.front).toBeCloseTo(-2.25, 5);
    expect(car.rear).toBeCloseTo(2.25, 5);
    expect(car.halfWidth).toBeCloseTo(0.5 * s, 5);
  });

  it('stands it on the road under the physics wheels, lowered to the height it fits', () => {
    const b = box(car.paint);
    expect(b.min.y).toBeCloseTo(ground + 0.17 * sy, 5);
    expect(car.roof).toBeCloseTo(ground + 1.65, 5);
  });

  it('keeps the kit wheels in its arches, meeting the road where the physics wheels do', () => {
    expect(car.wheels[0]!.x).toBeCloseTo(-0.45 * s, 5);
    expect(car.wheels[0]!.z).toBeCloseTo(-0.7 * s, 5);
    expect(car.wheels[3]!.x).toBeCloseTo(0.45 * s, 5);
    expect(car.wheels[3]!.z).toBeCloseTo(0.7 * s, 5);
    expect(box(car.wheelRight).max.y).toBeCloseTo(0.18 * sy, 5);
    expect(car.wheels[0]!.lift).toBeCloseTo(0.18 * sy - CAR.wheelRadius, 5);
    expect(box(car.farWheels).min.y).toBeCloseTo(ground, 5);
  });

  it('fits a wide body by its width, and lowers a tall one by a fifth at most', () => {
    const wide = fitCar({ ...kit, body: { min: [-0.7, 0.17, -1.1], max: [0.7, 0.81, 1.1] } }, parts())!;
    expect(wide.halfWidth).toBeCloseTo(1.05, 5);
    const tall = fitCar({ ...kit, roof: 2 }, parts())!;
    expect(tall.roof).toBeCloseTo(ground + 2 * s * 0.8, 5);
  });

  it('gives up on a model without paint or a wheel', () => {
    expect(fitCar(kit, new Map([['paint', new THREE.BoxGeometry()]]))).toBeNull();
  });
});

describe('mirroring a wheel for the other side', () => {
  it('flips it across x and keeps its faces outward', () => {
    const g = new THREE.BoxGeometry(0.2, 0.4, 0.4).translate(0.3, 0, 0);
    const m = mirrorX(g);
    expect(box(m).min.x).toBeCloseTo(-0.4, 5);
    const pos = m.getAttribute('position');
    const nor = m.getAttribute('normal');
    const index = m.getIndex()!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(pos, index.getX(i));
      b.fromBufferAttribute(pos, index.getX(i + 1));
      c.fromBufferAttribute(pos, index.getX(i + 2));
      const face = b.sub(a).cross(c.sub(a)).normalize();
      n.fromBufferAttribute(nor, index.getX(i));
      expect(face.dot(n)).toBeGreaterThan(0.99);
    }
  });
});
