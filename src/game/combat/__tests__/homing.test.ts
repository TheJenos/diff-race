import { describe, expect, it } from 'vitest';
import { seekScore, steer } from '../rules/homing';
import { MISSILE } from '../rules/weapons';

const O = { x: 0, y: 0, z: 0 };
const FWD = { x: 0, y: 0, z: -1 };
const angleBetween = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.acos((a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)));

describe('seekScore', () => {
  it('sees a car ahead, and prefers the one nearer the line of fire', () => {
    const onLine = seekScore(O, FWD, { x: 0, y: 0, z: -60 });
    const offLine = seekScore(O, FWD, { x: 15, y: 0, z: -40 });
    expect(onLine).not.toBeNull();
    expect(offLine).not.toBeNull();
    expect(onLine!).toBeLessThan(offLine!);
  });

  it("doesn't see outside its cone, past its range, or behind", () => {
    const wide = MISSILE.seek.cone + 0.05;
    expect(seekScore(O, FWD, { x: Math.sin(wide) * 30, y: 0, z: -Math.cos(wide) * 30 })).toBeNull();
    expect(seekScore(O, FWD, { x: 0, y: 0, z: -(MISSILE.seek.range + 1) })).toBeNull();
    expect(seekScore(O, FWD, { x: 0, y: 0, z: 30 })).toBeNull();
  });
});

describe('steer', () => {
  it('turns toward the target by no more than its turn rate, keeping its speed', () => {
    const vel = { x: 0, y: 0, z: -100 };
    const before = { ...vel };
    const dt = 1 / 120;
    expect(steer(O, vel, { x: 40, y: 0, z: -40 }, O, dt)).toBe(true);
    expect(Math.hypot(vel.x, vel.y, vel.z)).toBeCloseTo(100, 6);
    expect(angleBetween(before, vel)).toBeCloseTo(MISSILE.seek.turn * dt, 6);
    expect(vel.x).toBeGreaterThan(0);
  });

  it('points straight at a target within one step’s turn', () => {
    const vel = { x: 0, y: 0, z: -100 };
    expect(steer(O, vel, { x: 0.1, y: 0, z: -100 }, O, 1 / 60)).toBe(true);
    expect(angleBetween(vel, { x: 0.1, y: 0, z: -100 })).toBeLessThan(1e-6);
  });

  it('gives up on a target behind it, leaving its course alone', () => {
    const vel = { x: 0, y: 0, z: -100 };
    expect(steer(O, vel, { x: 5, y: 0, z: 20 }, O, 1 / 60)).toBe(false);
    expect(vel).toEqual({ x: 0, y: 0, z: -100 });
  });

  it('runs down a car driving across its path before it burns out', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: -MISSILE.speed };
    const car = { x: -20, y: 0, z: -70 };
    const carVel = { x: 30, y: 0, z: 0 };
    const dt = 1 / 120;
    let caught = false;
    for (let t = 0; t < MISSILE.life && !caught; t += dt) {
      car.x += carVel.x * dt;
      if (!steer(pos, vel, car, carVel, dt)) break;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;
      caught = Math.hypot(pos.x - car.x, pos.y - car.y, pos.z - car.z) < MISSILE.seek.fuse;
    }
    expect(caught).toBe(true);
  });

  it('overshoots a car that cuts hard across it at close range', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const vel = { x: 0, y: 0, z: -MISSILE.speed };
    const car = { x: 0, y: 0, z: -12 };
    const carVel = { x: 45, y: 0, z: 0 };
    const dt = 1 / 120;
    let caught = false;
    let lost = false;
    for (let t = 0; t < MISSILE.life && !caught && !lost; t += dt) {
      car.x += carVel.x * dt;
      lost = !steer(pos, vel, car, carVel, dt);
      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      caught = Math.hypot(pos.x - car.x, pos.z - car.z) < MISSILE.seek.fuse;
    }
    expect(caught).toBe(false);
    expect(lost).toBe(true);
  });
});
