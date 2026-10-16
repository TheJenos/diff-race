import { describe, expect, it } from 'vitest';
import { arm, newGun, roundDamage, stepGun } from '../rules/heat';
import { GUN } from '../rules/weapons';
import { rayBox, type Box } from '../rules/hitTest';
import { aimError, anglesOf, barrel, newTurret, slew } from '../../car/turret';

const box = (over: Partial<Box> = {}): Box => ({ cx: 0, cy: 0, cz: -10, qx: 0, qy: 0, qz: 0, qw: 1, hx: 1, hy: 0.5, hz: 2, ...over });

describe('machine gun', () => {
  it('fires at its rate, overheats after about 3 s and locks out', () => {
    const g = newGun();
    let shots = 0;
    for (let i = 0; i < 120 * 2.9; i++) shots += stepGun(g, true, 1 / 120);
    expect(shots).toBeGreaterThanOrEqual(28);
    expect(g.locked).toBe(0);
    for (let i = 0; i < 30; i++) shots += stepGun(g, true, 1 / 120);
    expect(g.locked).toBeGreaterThan(0);
    const before = shots;
    for (let i = 0; i < 60; i++) shots += stepGun(g, true, 1 / 120);
    expect(shots).toBe(before);
  });

  it('does not overheat while armed, and hits harder', () => {
    const g = newGun();
    arm(g);
    for (let i = 0; i < 120 * 6; i++) stepGun(g, true, 1 / 120);
    expect(g.locked).toBe(0);
    expect(roundDamage(g, 10)).toBeCloseTo(GUN.damage * 1.5);
  });

  it('falls off with range', () => {
    const g = newGun();
    expect(roundDamage(g, 50)).toBe(GUN.damage);
    expect(roundDamage(g, GUN.maxRange)).toBeCloseTo(GUN.damage / 2);
  });
});

describe('ray vs box', () => {
  it('hits a box straight ahead and misses beside it', () => {
    expect(rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 100, box())).toBeCloseTo(8);
    expect(rayBox({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 100, box())).toBeNull();
    expect(rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 5, box())).toBeNull();
  });

  it('respects the box rotation and reports the local hit point', () => {
    // Turned a quarter about y: now 4 wide in x, 2 deep in z.
    const s = Math.SQRT1_2;
    const b = box({ qy: s, qw: s });
    const local = { x: 0, y: 0, z: 0 };
    expect(rayBox({ x: 1.8, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 100, b, local)).toBeCloseTo(9);
    expect(Math.abs(local.x)).toBeCloseTo(1, 3);
  });
});

describe('turret', () => {
  it('swings at its rate toward the target and points where it says', () => {
    const t = newTurret();
    const want = anglesOf(-1, 0, 0); // straight left
    slew(t, want.yaw, want.pitch, 0.1);
    expect(t.yaw).toBeCloseTo(0.7, 5);
    for (let i = 0; i < 10; i++) slew(t, want.yaw, want.pitch, 0.1);
    expect(aimError(t, want.yaw, want.pitch)).toBeLessThan(1e-6);
    const d = barrel(t, { x: 0, y: 0, z: 0 });
    expect(d.x).toBeCloseTo(-1, 5);
  });

  it('keeps the guns within their pitch limits', () => {
    const t = newTurret();
    for (let i = 0; i < 100; i++) slew(t, 0, 1.4, 0.05);
    expect(t.pitch).toBeLessThanOrEqual(0.44);
  });
});
