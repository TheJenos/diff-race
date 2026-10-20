import { describe, expect, it } from 'vitest';
import { dentSize, dentVertices, landing, MAX_SAG, renormal, type Dent } from '../deform';

/** A flat square panel facing +x at x = 1: (n+1)² vertices over 2 × 2 m, two triangles per cell */
function panel(n = 20) {
  const pos: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(1, -1 + (2 * j) / n, -1 + (2 * i) / n);
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      index.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1);
    }
  }
  const normal = new Float32Array(pos.length);
  for (let k = 0; k < normal.length; k += 3) normal[k] = 1;
  return { pos: Float32Array.from(pos), rest: Float32Array.from(pos), normal, index, moved: new Uint8Array(pos.length / 3) };
}

/** A blow straight into the panel's middle, pushing −x */
const blow = (depth: number, radius: number): Dent => ({ x: 1, y: 0, z: 0, dx: -1, dy: 0, dz: 0, depth, radius });
const vertexAt = (n: number, j: number, i: number) => (j * (n + 1) + i) * 3;

describe('denting a panel', () => {
  it('pushes it in along the blow, most at the middle, not at all past the radius', () => {
    const p = panel();
    expect(dentVertices(p.pos, p.rest, blow(0.2, 0.6), p.moved)).toBe(true);
    const middle = p.pos[vertexAt(20, 10, 10)]!;
    const off = p.pos[vertexAt(20, 10, 13)]!; // 0.3 m from the middle
    const outside = p.pos[vertexAt(20, 10, 17)]!; // 0.7 m from it
    expect(middle).toBeLessThan(1 - 0.13);
    expect(off).toBeGreaterThan(middle);
    expect(off).toBeLessThan(1);
    expect(outside).toBe(1);
    // Only along the blow: nothing slides sideways.
    expect(p.pos[vertexAt(20, 10, 13) + 1]).toBe(p.rest[vertexAt(20, 10, 13) + 1]);
    expect(p.moved[vertexAt(20, 10, 17) / 3]).toBe(0);
  });

  it("caves in only so far, however often it's hit", () => {
    const p = panel();
    for (let k = 0; k < 40; k++) dentVertices(p.pos, p.rest, blow(0.25, 0.6), p.moved);
    for (let i = 0; i < p.pos.length; i += 3) expect(1 - p.pos[i]!).toBeLessThanOrEqual(MAX_SAG + 1e-6);
  });

  it("turns the moved vertices' normals with the dent, and leaves the rest alone", () => {
    const p = panel();
    dentVertices(p.pos, p.rest, blow(0.2, 0.6), p.moved);
    renormal(p.pos, p.normal, p.index, p.moved);
    // On the dent's slope (0.3 m along +z), the surface tilts toward the middle.
    const slope = vertexAt(20, 10, 13);
    expect(p.normal[slope + 2]).toBeGreaterThan(0.1);
    expect(Math.hypot(p.normal[slope]!, p.normal[slope + 1]!, p.normal[slope + 2]!)).toBeCloseTo(1, 5);
    const far = vertexAt(20, 0, 0);
    expect([p.normal[far], p.normal[far + 1], p.normal[far + 2]]).toEqual([1, 0, 0]);
  });
});

describe('where a blow lands', () => {
  const box = { min: [-1, -0.5, -2.2] as [number, number, number], max: [1, 0.8, 2.2] as [number, number, number] };

  it('on the face it comes in through', () => {
    const [x, y, z] = landing(5, 0.2, 1, -1, 0, 0, box);
    expect([x, y, z]).toEqual([1, 0.2, 1]);
  });

  it('a blow that misses the box lands on the side facing it', () => {
    // From the left, passing overhead: it lands on the left face, level with the middle.
    const [x, y] = landing(-5, 3, 0, 1, 0, 0, box);
    expect(x).toBeCloseTo(-1, 6);
    expect(y).toBeCloseTo(0.15, 6);
  });
});

describe('how big a dent', () => {
  it('pocks for a round, caves in for a hard ram, nothing for fire', () => {
    const round = dentSize('gun', 1.6)!;
    const nudge = dentSize('ram', 5)!;
    const tbone = dentSize('ram', 37)!;
    expect(round.radius).toBeLessThan(nudge.radius);
    expect(round.depth).toBeLessThan(nudge.depth);
    expect(tbone.depth).toBeGreaterThan(nudge.depth);
    expect(tbone.radius).toBeGreaterThan(nudge.radius);
    expect(tbone.depth).toBeLessThanOrEqual(0.26);
    expect(dentSize('napalm', 20)).toBeNull();
    expect(dentSize('ram', 0.5)).toBeNull();
  });
});
