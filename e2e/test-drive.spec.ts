import { expect, test } from '@playwright/test';
import { Player } from './support/player';

/*
 * The test drive: the lobby starts a race on the proving ground and the car drives.
 * Software rendering is slow and the game caps each frame's time step, so game time runs slower
 * than the wall clock: wait on state (expect.poll), never on time.
 */

test('the test drive starts and the car drives off the grid', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.page.goto('/');
  await p.startCustom('Test Drive');
  await expect.poll(async () => (await p.state()).phase).toBe('ready');
  await expect.poll(async () => (await p.state()).grounded).toBe(4);
  const start = (await p.state()).pos!;
  await p.hold({ throttle: 1 });
  await expect.poll(async () => (await p.state()).speed, { timeout: 60_000 }).toBeGreaterThan(10);
  // The grid is just behind the start line, so `s` wraps past 0 here: measure the distance driven.
  await expect.poll(async () => {
    const at = (await p.state()).pos!;
    return Math.hypot(at.x - start.x, at.z - start.z);
  }).toBeGreaterThan(5);
  // The HUD shows the speed.
  await expect(p.page.locator('#hud-speed span')).not.toHaveText('0');
  await p.close();
});
