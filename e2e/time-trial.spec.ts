import { expect, test } from '@playwright/test';
import { Player } from './support/player';

type RaceState = { D: number; lapsDone: number; lapTimes: number[]; finished: boolean; wrongWay: boolean; phase: string };
type TestApi = { test: { race(): RaceState | null; teleportToProgress(D: number, u?: number): void; hold(i: unknown): void }; track: { lapLength: number } };

const race = (p: Player) => p.page.evaluate(() => (window as unknown as { game?: TestApi }).game?.test.race() ?? null);

/*
 * A time trial on a generated track: the countdown holds the car, laps count at the line, the
 * finish shows the results. Driving a whole lap on a software renderer would take minutes, so
 * the car is put near the line as if it had driven there (teleportToProgress).
 */
test('a one-lap time trial counts down, times the lap and shows the results', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.page.goto('/');
  await p.startCustom('Time Trial', 1);
  await expect(p.page.locator('#countdown')).toBeVisible({ timeout: 30_000 });
  // Held on the grid during the countdown.
  await p.hold({ throttle: 1 });
  expect(Math.abs((await p.state()).speed)).toBeLessThan(1);
  await expect.poll(async () => (await race(p))?.phase, { timeout: 30_000 }).toBe('racing');
  await expect.poll(async () => (await p.state()).speed).toBeGreaterThan(5);
  await p.page.evaluate(() => {
    const g = (window as unknown as { game: TestApi }).game;
    g.test.teleportToProgress(g.track.lapLength - 25);
  });
  await expect.poll(async () => (await race(p))?.finished, { timeout: 60_000 }).toBe(true);
  await expect(p.page.locator('#results')).toBeVisible();
  await expect(p.page.locator('.results-laps li')).toHaveCount(1);
  await p.page.getByRole('button', { name: 'Race again' }).click();
  await expect(p.page.locator('#results')).toBeHidden();
  await p.close();
});
