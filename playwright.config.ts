import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests: real browsers driving the game. Run them with `npm run test:e2e`, which
 * starts the Realtime Database emulator around Playwright for the room tests (see README).
 */

const PORT = 5174;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  // WebGL on a software renderer is slow; give a race room to run.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: CI ? 2 : 6,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 540 },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 540 },
        launchOptions: {
          // WebGL without a GPU, and sound without a click first.
          args: [
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npx vite --mode e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
