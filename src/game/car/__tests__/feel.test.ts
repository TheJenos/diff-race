import { describe, expect, it } from 'vitest';
import { attitude, drive, flatWorld, speedOf } from './harness';

/*
 * The car's feel, pinned. These are targets, not physics: a deliberate retune updates them.
 */

describe('car on flat ground', () => {
  it('settles on its suspension and stays put', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 3, {});
    const t = car.body.translation();
    const v = car.body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(0.05);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(0.05);
    // Chassis centre rides about half a metre up; every wheel on the ground, carrying a quarter each.
    expect(t.y).toBeGreaterThan(0.45);
    expect(t.y).toBeLessThan(0.85);
    expect(car.grounded).toBe(4);
    for (const w of car.wheels) expect(w.load).toBeGreaterThan(4000);
    physics.dispose();
  });

  it('reaches 100 km/h in about 3.5 s and tops out near 180 km/h', async () => {
    const { physics, car } = await flatWorld();
    const to100 = drive(physics, car, 10, { throttle: 1 }, () => speedOf(car) >= 27.8);
    expect(to100).toBeGreaterThan(2.6);
    expect(to100).toBeLessThan(4.6);
    drive(physics, car, 25, { throttle: 1 });
    expect(speedOf(car)).toBeGreaterThan(46);
    expect(speedOf(car)).toBeLessThan(54);
    physics.dispose();
  });

  it('nitro adds speed', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 20, { throttle: 1 });
    const before = speedOf(car);
    drive(physics, car, 3.5, { throttle: 1, nitro: true });
    expect(speedOf(car)).toBeGreaterThan(before + 3);
    physics.dispose();
  });

  it('stops from 100 km/h within about 40 m', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 10, { throttle: 1 }, () => speedOf(car) >= 27.8);
    const start = car.body.translation();
    drive(physics, car, 6, { brake: 1 }, () => car.speed < 0.3);
    const end = car.body.translation();
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(45);
    physics.dispose();
  });

  it('turns a tight circle at low speed and a wide one fast', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 10, { throttle: 0.5 }, () => speedOf(car) >= 12);
    let yaw = 0;
    drive(physics, car, 3, { throttle: 0.35, steer: 1 }, () => { yaw = Math.abs(car.body.angvel().y); });
    const slowRadius = speedOf(car) / yaw;
    expect(slowRadius).toBeGreaterThan(6);
    expect(slowRadius).toBeLessThan(20);
    physics.dispose();
  });

  it('never rolls over at full lock at top speed', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 25, { throttle: 1 });
    let worst = 1;
    drive(physics, car, 4, { throttle: 1, steer: 1 }, () => { worst = Math.min(worst, attitude(car).up.y); });
    expect(worst).toBeGreaterThan(0.75);
    physics.dispose();
  });

  it('slides sideways on the handbrake', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 10, { throttle: 1 }, () => speedOf(car) >= 25);
    let slip = 0;
    drive(physics, car, 1.2, { steer: 1, handbrake: true }, () => {
      const v = car.body.linvel();
      const { fwd } = attitude(car);
      const sp = Math.hypot(v.x, v.z);
      if (sp > 5) slip = Math.max(slip, Math.acos(Math.min(1, (v.x * fwd.x + v.z * fwd.z) / sp)));
    });
    expect(slip).toBeGreaterThan(0.35); // over 20°
    physics.dispose();
  });

  it('rights itself from its side', async () => {
    const { physics, car } = await flatWorld();
    // On its left side (rolled a quarter turn about forward).
    const s = Math.SQRT1_2;
    car.place({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: s, w: s });
    const upright = drive(physics, car, 4, {}, () => attitude(car).up.y > 0.9 && car.grounded >= 3);
    expect(upright).toBeLessThan(3);
    physics.dispose();
  });
});
