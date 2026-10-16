import { describe, expect, it } from 'vitest';
import { ChaseCamera, CHASE, wrapAngle } from '../chase';

const target = (x: number, z: number, fx: number, fz: number, vx = fx * 20, vz = fz * 20) => ({
  pos: { x, y: 0, z }, fwd: { x: fx, y: 0, z: fz }, vel: { x: vx, y: 0, z: vz }, speedRatio: 0.4, nitro: false, lookBack: false,
});

describe('ChaseCamera', () => {
  it('sits behind and above the car', () => {
    const cam = new ChaseCamera();
    cam.snap(target(0, 0, 0, -1));
    expect(cam.pos.z).toBeCloseTo(CHASE.distance, 3);
    expect(cam.pos.y).toBeCloseTo(CHASE.height, 3);
    expect(cam.look.z).toBeLessThan(0);
  });

  it('follows a turn smoothly and converges without overshoot', () => {
    const cam = new ChaseCamera();
    cam.snap(target(0, 0, 0, -1));
    // The car now faces +x; the camera should end up on its -x side.
    let lastX = cam.pos.x;
    for (let i = 0; i < 240; i++) {
      cam.update(target(0, 0, 1, 0), 1 / 60);
      expect(cam.pos.x).toBeLessThanOrEqual(lastX + 1e-9);
      lastX = cam.pos.x;
    }
    expect(cam.pos.x).toBeCloseTo(-CHASE.distance, 1);
  });

  it('wraps angles', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2);
  });
});
