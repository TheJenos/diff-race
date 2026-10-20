import { describe, expect, it } from 'vitest';
import { attitude, drive, flatWorld, speedOf } from './harness';
import { PHYSICS_STEP } from '../../physics';
import { MISSILE } from '../../combat/rules/weapons';

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

describe('spun by a missile', () => {
  // How far round it goes: its heading's change, summed step by step so it counts past a half turn.
  const turned = (physics: Parameters<typeof drive>[0], car: Parameters<typeof drive>[1], seconds: number) => {
    let total = 0;
    drive(physics, car, seconds, {}, () => {
      total += car.body.angvel().y * PHYSICS_STEP;
    });
    return total;
  };

  it('goes round about a turn, the way it was spun, then grips again', async () => {
    const { physics, car } = await flatWorld();
    drive(physics, car, 2, {});
    car.spinOut(MISSILE.spin.rate, MISSILE.spin.time);
    const round = turned(physics, car, 4);
    expect(round).toBeGreaterThan(Math.PI * 1.2);
    expect(round).toBeLessThan(Math.PI * 4);
    // Stopped by the end: it doesn't spin forever.
    expect(Math.abs(car.body.angvel().y)).toBeLessThan(0.2);
    physics.dispose();
  });

  it("spins far further than the same shove without the slide (the tyres would stop it)", async () => {
    const a = await flatWorld();
    drive(a.physics, a.car, 2, {});
    a.car.spinOut(MISSILE.spin.rate, MISSILE.spin.time);
    const spun = Math.abs(turned(a.physics, a.car, 4));
    a.physics.dispose();
    const b = await flatWorld();
    drive(b.physics, b.car, 2, {});
    b.car.spinOut(MISSILE.spin.rate, 0);
    const gripped = Math.abs(turned(b.physics, b.car, 4));
    b.physics.dispose();
    expect(spun).toBeGreaterThan(gripped * 2);
  });
});
