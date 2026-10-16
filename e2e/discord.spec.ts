import { expect, test } from '@playwright/test';
import { Player } from './support/player';

/*
 * The Discord Activity. Discord adds frame_id and instance_id to the Activity's URL; with those
 * the Discord lobby takes over. A real Discord client isn't available to tests: `?fakeDiscord`
 * (e2e builds only) signs in a made-up user, so the room flow can be tested end to end.
 */

test('inside Discord the Discord lobby takes over', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.page.goto('/?frame_id=e2e&instance_id=e2e&platform=desktop');
  await expect(p.page.locator('#discord-lobby')).toBeVisible();
  await expect(p.page.locator('#lobby')).toHaveCount(0);
  await p.close();
});

test('everyone in the voice channel lands in the same room, the first in charge', async ({ browser }) => {
  const instance = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alice = await Player.open(browser, 'Alice');
  const bob = await Player.open(browser, 'Bob');
  await alice.page.goto(`/?frame_id=e2e&instance_id=${instance}&fakeDiscord`);
  await expect(alice.page.locator('#room-code')).toHaveText(/^DC[A-Z0-9]{8}$/, { timeout: 30_000 });
  const code = await alice.page.locator('#room-code').textContent();
  await bob.page.goto(`/?frame_id=e2e&instance_id=${instance}&fakeDiscord`);
  await expect(bob.page.locator('#room-code')).toHaveText(code!, { timeout: 30_000 });
  await expect(bob.page.locator('#members')).toContainText('Alice');
  await expect(alice.page.locator('#start-room-race')).toBeVisible();
  await expect(bob.page.locator('#start-room-race')).toHaveCount(0);
  await alice.close();
  await bob.close();
});
