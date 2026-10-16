import { describe, expect, it } from 'vitest';
import { AUTO_AIM, aimScore, newAutoAim, updateAutoAim, type AimCandidate } from '../rules/autoAim';

// The camera at the origin looking down −z.
const eye = { x: 0, y: 0, z: 0 };
const fwd = { x: 0, y: 0, z: -1 };
const car = (id: string, x: number, z: number, visible = true): AimCandidate => ({ id, x, y: 0, z, visible });

describe('auto aim', () => {
  it('locks onto the car nearest the middle of the view', () => {
    const st = newAutoAim();
    expect(updateAutoAim(st, eye, fwd, [car('wide', 12, -40), car('middle', 1, -50)], 1 / 60)).toBe('middle');
  });

  it('ignores cars outside the cone, out of range, too near, or out of sight', () => {
    const st = newAutoAim();
    const behind = car('behind', 0, 30);
    const far = car('far', 0, -(AUTO_AIM.range + 5));
    const beside = car('beside', 1, -1);
    const hidden = car('hidden', 0, -30, false);
    expect(updateAutoAim(st, eye, fwd, [behind, far, beside, hidden], 1 / 60)).toBeNull();
    expect(aimScore(eye, fwd, behind)).toBeNull();
  });

  it('looks back with the camera: what is behind the car is then in front of the view', () => {
    const st = newAutoAim();
    expect(updateAutoAim(st, eye, { x: 0, y: 0, z: 1 }, [car('chaser', 0.5, 20), car('ahead', 0, -20)], 1 / 60)).toBe('chaser');
  });

  it('sticks with its target over a slightly better one, not a much better one', () => {
    const st = newAutoAim();
    updateAutoAim(st, eye, fwd, [car('a', 3, -40)], 1 / 60);
    // b is a little nearer the middle: a keeps the lock.
    expect(updateAutoAim(st, eye, fwd, [car('a', 3, -40), car('b', 2.4, -40)], 1 / 60)).toBe('a');
    // b dead centre and close: worth switching.
    expect(updateAutoAim(st, eye, fwd, [car('a', 9, -40), car('b', 0, -15)], 1 / 60)).toBe('b');
  });

  it('holds a target hidden for a moment, then lets go', () => {
    const st = newAutoAim();
    updateAutoAim(st, eye, fwd, [car('a', 0, -30)], 1 / 60);
    const hidden = [car('a', 0, -30, false)];
    expect(updateAutoAim(st, eye, fwd, hidden, 0.2)).toBe('a');
    expect(updateAutoAim(st, eye, fwd, hidden, 0.3)).toBeNull();
  });

  it('lets go at once of a target that leaves the view', () => {
    const st = newAutoAim();
    updateAutoAim(st, eye, fwd, [car('a', 0, -30)], 1 / 60);
    expect(updateAutoAim(st, eye, fwd, [car('a', 40, 10, false)], 1 / 60)).toBeNull();
  });
});
