import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEAN } from '../textures';

/*
 * The photo surfaces as shipped (public/textures/, from scripts/build-textures.mjs): one for each
 * procedural texture surfaces.ts can stand in for, every map there, and the numbers the game
 * tints and repeats them by in range.
 */

const DIR = 'public/textures';
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8')) as {
  sets: Record<string, { metres: number; mean: number[]; color: string; normal: string; arm: string }>;
};

describe('photo surfaces', () => {
  it('covers exactly the surfaces with a procedural stand-in', () => {
    expect(Object.keys(manifest.sets).sort()).toEqual(Object.keys(MEAN).sort());
  });

  it('ships every map as a JPEG, with a sensible size and average colour', () => {
    let total = 0;
    for (const set of Object.values(manifest.sets)) {
      expect(set.metres).toBeGreaterThan(0);
      expect(set.mean).toHaveLength(3);
      for (const c of set.mean) {
        expect(c).toBeGreaterThan(0.02);
        expect(c).toBeLessThan(1);
      }
      for (const file of [set.color, set.normal, set.arm]) {
        const bytes = readFileSync(`${DIR}/${file}`);
        expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
        const size = statSync(`${DIR}/${file}`).size;
        expect(size).toBeLessThan(600 * 1024);
        total += size;
      }
    }
    // They're downloaded before the first race: keep the lot under 3 MB.
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
