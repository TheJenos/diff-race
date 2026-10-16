import { loadPhysics, GROUP, groups, PhysicsWorld, PHYSICS_STEP } from '../../physics';
import { CarBody } from '../carBody';
import { neutralInput, type CarInput } from '../../input/carInput';
import { basis, type V3 } from '../../math/vec3';

/*
 * A car on a huge flat slab, in Node (Rapier's compat build), for the feel tests: drive it with
 * scripted inputs and read back speed, heading and attitude.
 */

export async function flatWorld(): Promise<{ physics: PhysicsWorld; car: CarBody }> {
  await loadPhysics();
  const physics = new PhysicsWorld();
  const { R, world } = physics;
  const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
  world.createCollider(
    R.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setCollisionGroups(groups(GROUP.WORLD, 0xffff)),
    ground,
  );
  const car = new CarBody(physics);
  car.place({ x: 0, y: 0.9, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  world.step();
  return { physics, car };
}

/** Step the car `seconds` with `input` (or a function of time), calling `each` after every step. */
export function drive(
  physics: PhysicsWorld, car: CarBody, seconds: number,
  input: Partial<CarInput> | ((t: number) => Partial<CarInput>),
  each?: (t: number) => boolean | void,
): number {
  const steps = Math.round(seconds / PHYSICS_STEP);
  const full = neutralInput();
  for (let i = 0; i < steps; i++) {
    const t = i * PHYSICS_STEP;
    Object.assign(full, neutralInput(), typeof input === 'function' ? input(t) : input);
    car.fixed(full, PHYSICS_STEP);
    physics.world.step();
    if (each?.(t + PHYSICS_STEP) === true) return t + PHYSICS_STEP;
  }
  return seconds;
}

export function attitude(car: CarBody): { right: V3; up: V3; fwd: V3 } {
  const right = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 0, z: 0 };
  const fwd = { x: 0, y: 0, z: 0 };
  basis(car.body.rotation(), right, up, fwd);
  return { right, up, fwd };
}

export const speedOf = (car: CarBody): number => {
  const v = car.body.linvel();
  return Math.hypot(v.x, v.y, v.z);
};
