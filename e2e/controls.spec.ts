import { expect, test } from '@playwright/test';
import { Player } from './support/player';

/*
 * The other ways to drive: touch (forced on with ?touch), a gamepad (the Gamepad API stubbed with
 * a pad holding the right trigger), and rebinding keys in Settings.
 */

async function startTestDrive(p: Player, url = '/') {
  await p.page.goto(url);
  await p.startCustom('Test Drive');
  await expect.poll(async () => (await p.state()).grounded, { timeout: 30_000 }).toBe(4);
}

test('touch: the controls show and the car accelerates on its own once steered', async ({ browser }) => {
  const p = await Player.open(browser);
  await startTestDrive(p, '/?touch');
  await expect(p.page.locator('#touch-controls')).toBeVisible();
  const box = (await p.page.locator('.touch-steer').boundingBox())!;
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await expect.poll(async () => (await p.state()).speed, { timeout: 60_000 }).toBeGreaterThan(5);
  await p.page.mouse.up();
  // Braking (held button) slows it down.
  await p.page.locator('#touch-brake').dispatchEvent('pointerdown', { pointerId: 7 });
  await expect.poll(async () => (await p.state()).speed, { timeout: 60_000 }).toBeLessThan(2);
  await p.close();
});

test('gamepad: the right trigger accelerates', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.context.addInitScript(() => {
    const button = (value: number) => ({ pressed: value > 0.5, touched: value > 0, value });
    const pad = {
      id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => button(i === 7 ? 1 : 0)),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await startTestDrive(p);
  await expect.poll(async () => (await p.state()).speed, { timeout: 60_000 }).toBeGreaterThan(5);
  await p.close();
});

test('settings: a rebound key is kept after a reload', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.page.goto('/');
  await p.page.getByRole('button', { name: /settings/i }).click();
  const nitro = p.page.getByRole('button', { name: /^Nitro: .*Change$/ });
  await nitro.click();
  await p.page.keyboard.press('KeyN');
  await expect(nitro).toHaveText('N');
  await p.page.reload();
  await p.page.getByRole('button', { name: /settings/i }).click();
  await expect(p.page.getByRole('button', { name: /^Nitro: .*Change$/ })).toHaveText('N');
  await p.close();
});
