import { describe, expect, it } from 'vitest';
import { simulate } from '../sim/headless';
import { GENERATOR_VERSION } from '../../track/spec';

describe('bots, headless', () => {
  it('a field of bots finishes a lap on a generated track', async () => {
    const r = await simulate({ spec: { seed: 'sim-a', length: 's', gen: GENERATOR_VERSION }, laps: 1, bots: ['easy', 'normal', 'hard', 'expert'] });
    for (const c of r.cars) {
      expect(c.time, `${c.skill} finished`).not.toBeNull();
      expect(c.time!).toBeLessThan(r.idealLap * 2.2);
      expect(c.respawns).toBeLessThanOrEqual(2);
    }
  }, 60_000);
});
