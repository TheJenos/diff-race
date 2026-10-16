import { defineConfig } from 'vitest/config';

// Unit tests: pure code (the track generator, car maths, race rules) and the car on Rapier's
// Node build, all in Node. The game itself is tested end to end (e2e/).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
