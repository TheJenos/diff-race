import { expect, test } from '@playwright/test';
import { Player } from './support/player';

/*
 * Death Race against bots, offline: the grid, weapons, crash damage, pads and the finish.
 * Bots are frozen where a test needs a still target (game.test.freezeBots); waits are on state.
 */

type Racer = { id: string; name: string; bot: boolean; armour: number; wrecked: boolean; kills: number; D: number; levels: Record<string, number> };

async function quickRace(p: Player, frozen = false) {
  await p.page.goto('/');
  await p.page.getByRole('button', { name: /quick race/i }).click();
  await expect.poll(async () => (await p.state()).phase, { timeout: 30_000 }).toBe('ready');
  // Bots held on the grid from the start, when a test needs a still target.
  if (frozen) await p.game((t) => t.freezeBots(true));
  await expect.poll(() => p.game((t) => t.race()?.phase), { timeout: 60_000 }).toBe('racing');
}

const racers = (p: Player) => p.game((t) => t.racers() as Racer[]);

test('a quick race lines up eight cars and ends on the standings', async ({ browser }) => {
  const p = await Player.open(browser);
  // Frozen bots: nobody shoots the player off the finishing straight.
  await quickRace(p, true);
  expect(await racers(p)).toHaveLength(8);
  await expect(p.page.locator('#hud-position')).toContainText('/8');
  await p.hold({ throttle: 1 });
  await p.game((t, g) => t.teleportToProgress(g.track.lapLength * 3 - 25));
  await expect(p.page.locator('#results')).toBeVisible({ timeout: 60_000 });
  await expect(p.page.locator('.standings tbody tr')).toHaveCount(8);
  await expect(p.page.locator('.standings tr.self')).toBeVisible();
  await p.close();
});

test('machine-gun fire wrecks a car, credits the kill and shows YOU DIFFED', async ({ browser }) => {
  const p = await Player.open(browser);
  await quickRace(p, true);
  const target = (await racers(p)).find((r) => r.bot)!;
  // The player clear of the grid (every bot starts ahead of it, and low guns would hit those first),
  // the target parked 25 m ahead.
  await p.game((t, _g, id) => {
    t.teleportToProgress(t.race().D + 150);
    t.placeRacer(id, t.state().s + 25, 0);
    t.aimAt(id);
  }, target.id);
  await expect.poll(() => p.game((_t, g) => g.session.combat.hot), { timeout: 30_000 }).toBe(true);
  // Soften it up, then finish it with the guns.
  await p.game((t, _g, id) => t.damage(140, id), target.id);
  await p.game((t) => t.give('armed'));
  await p.hold({ fire: true });
  await expect.poll(async () => (await racers(p)).find((r) => r.id === target.id)!.wrecked, { timeout: 60_000 }).toBe(true);
  expect((await p.state()).kills).toBe(1);
  await expect(p.page.locator('#diffed')).toContainText('YOU DIFFED');
  await expect(p.page.locator('#killfeed')).toContainText(target.name);
  await p.close();
});

test('auto aim locks onto the car ahead, and holding fire wrecks it', async ({ browser }) => {
  const p = await Player.open(browser);
  await quickRace(p, true);
  const target = (await racers(p)).find((r) => r.bot)!;
  // Clear of the grid, the target parked 25 m ahead: no aiming, just looking down the road.
  await p.game((t, _g, id) => {
    t.teleportToProgress(t.race().D + 150);
    t.placeRacer(id, t.state().s + 25, 0);
  }, target.id);
  await expect.poll(async () => (await p.state()).locked, { timeout: 10_000 }).toBe(target.id);
  await expect(p.page.locator('#lock-on')).toBeVisible();
  await expect.poll(() => p.game((_t, g) => g.session.combat.hot), { timeout: 30_000 }).toBe(true);
  await p.game((t, _g, id) => t.damage(140, id), target.id);
  await p.game((t) => t.give('armed'));
  await p.hold({ fire: true });
  await expect.poll(async () => (await racers(p)).find((r) => r.id === target.id)!.wrecked, { timeout: 60_000 }).toBe(true);
  await expect(p.page.locator('#diffed')).toContainText('YOU DIFFED');
  await p.close();
});

test('ramming a parked car hurts it more than the rammer, and dents it', async ({ browser }) => {
  const p = await Player.open(browser);
  await quickRace(p, true);
  const target = (await racers(p)).find((r) => r.bot)!;
  await p.game((t, _g, id) => {
    const me = t.state();
    t.placeRacer(id, me.s + 50, 0);
    t.teleport(me.s, 0);
  }, target.id);
  const theirs = (await racers(p)).find((r) => r.id === target.id)!.armour;
  const mine = (await p.state()).armour;
  await p.hold({ throttle: 1, nitro: true });
  await expect.poll(async () => (await racers(p)).find((r) => r.id === target.id)!.armour, { timeout: 60_000 }).toBeLessThan(theirs - 15);
  const hit = (await racers(p)).find((r) => r.id === target.id)!;
  // The parked car's rear took the hit; the rammer's armoured front far less.
  expect(theirs - hit.armour).toBeGreaterThan(mine - (await p.state()).armour);
  expect(hit.levels.rear).toBeGreaterThan(0);
  await p.close();
});

test('driving over a sword pad arms the guns and gives missiles', async ({ browser }) => {
  const p = await Player.open(browser);
  await quickRace(p);
  const pad = await p.game((_t, g) => g.track.pads.find((x: { kind: string }) => x.kind === 'sword'));
  expect(pad).toBeTruthy();
  await p.game((t, _g, pd: { s: number; u: number }) => t.teleport(pd.s - 3, pd.u), pad);
  await p.hold({ throttle: 0.4 });
  await expect(p.page.locator('#hud-weapons .missiles b')).toHaveText('2', { timeout: 30_000 });
  await expect(p.page.locator('#hud-weapons .gun')).toHaveClass(/armed/);
  await p.close();
});

test('elimination: wrecked bots stay out, and the last car running wins', async ({ browser }) => {
  const p = await Player.open(browser);
  await p.page.goto('/');
  await p.startCustom('Elimination', undefined, 3);
  await expect.poll(async () => (await p.state()).phase, { timeout: 30_000 }).toBe('ready');
  await p.game((t) => t.freezeBots(true));
  await expect.poll(() => p.game((t) => t.race()?.phase), { timeout: 60_000 }).toBe('racing');
  // Wreck every bot (as if the player had).
  for (const r of (await racers(p)).filter((x) => x.bot)) await p.game((t, _g, id: string) => t.damage(500, id, 'me'), r.id);
  await expect(p.page.locator('#results')).toBeVisible({ timeout: 30_000 });
  await expect(p.page.locator('.standings tbody tr').first()).toContainText('Driver');
  await expect(p.page.locator('.standings tbody')).toContainText('OUT');
  // They stay out: no respawn after the usual wreck time.
  await p.page.waitForTimeout(4000);
  expect((await racers(p)).filter((x) => x.bot && !x.wrecked)).toHaveLength(0);
  await p.close();
});
