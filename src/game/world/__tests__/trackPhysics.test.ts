import { describe, expect, it } from 'vitest';
import { loadPhysics, PhysicsWorld, PHYSICS_STEP } from '../../physics';
import { buildTrackPhysics } from '../trackPhysics';
import { stadiumTrack } from '../../track/fallback';
import { GENERATOR_VERSION } from '../../track/spec';
import { CarBody } from '../../car/carBody';
import { placeOnTrack } from '../../race/placement';
import { neutralInput } from '../../input/carInput';
import { basis } from '../../math/vec3';

async function setup() {
  await loadPhysics();
  const physics = new PhysicsWorld();
  const track = stadiumTrack({ seed: 't', length: 's', gen: GENERATOR_VERSION });
  buildTrackPhysics(physics, track);
  const car = new CarBody(physics);
  const pos = { x: 0, y: 0, z: 0 };
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  const slot = track.grid[0]!;
  placeOnTrack(track, slot.s, slot.u, pos, rot);
  car.place(pos, rot);
  return { physics, track, car };
}

describe('car on the track', () => {
  it('sits on the grid on all four wheels, facing along the track', async () => {
    const { physics, car } = await setup();
    const input = neutralInput();
    for (let i = 0; i < 240; i++) { car.fixed(input, PHYSICS_STEP); physics.step(); }
    expect(car.grounded).toBe(4);
    const r = { x: 0, y: 0, z: 0 };
    const u = { x: 0, y: 0, z: 0 };
    const f = { x: 0, y: 0, z: 0 };
    basis(car.body.rotation(), r, u, f);
    // The stadium's first straight heads +x.
    expect(f.x).toBeGreaterThan(0.99);
    physics.dispose();
  });

  it('drives down the straight and stops at the barrier instead of going through', async () => {
    const { physics, car } = await setup();
    const input = { ...neutralInput(), throttle: 1, steer: 0.35 };
    let maxZ = -Infinity;
    for (let i = 0; i < 120 * 6; i++) {
      car.fixed(input, PHYSICS_STEP);
      physics.step();
      maxZ = Math.max(maxZ, car.body.translation().z);
    }
    // Straight at z = 70, road half-width 9 + verge 6: the right-hand barrier is at z = 85.
    expect(maxZ).toBeLessThan(85);
    expect(car.body.translation().y).toBeGreaterThan(-1);
    physics.dispose();
  });
});
