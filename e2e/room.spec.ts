import { expect, test } from '@playwright/test';
import { Player } from './support/player';

/*
 * Two players racing in a room, over the Realtime Database emulator (run with `npm run test:e2e`,
 * or `npx playwright test` with `npm run emulator` already up). Each player is its own browser
 * context. Waits are on state: software rendering makes game time run slow.
 */

type Racer = { id: string; name: string; bot: boolean; armour: number; D: number; pos: { x: number; z: number } };
const racers = (p: Player) => p.game((t) => t.racers() as Racer[]);

async function roomOf(alice: Player, bob: Player): Promise<string> {
  await alice.page.goto('/');
  const code = await alice.createRoom();
  await alice.page.getByRole('radio', { name: 'No bots' }).click();
  await alice.page.getByRole('radio', { name: 'Short' }).click();
  await alice.page.getByRole('radio', { name: '1 lap' }).click();
  // Bob arrives by the invite link.
  await bob.page.goto(`/#${code}`);
  await expect(bob.page.locator('#members')).toContainText('Alice');
  await expect(alice.page.locator('#members')).toContainText('Bob');
  return code;
}

async function startRace(alice: Player, bob: Player) {
  await alice.page.locator('#start-room-race').click();
  for (const p of [alice, bob]) {
    await expect.poll(async () => (await p.state()).phase, { timeout: 30_000 }).toBe('ready');
    await expect.poll(() => p.game((t) => t.race()?.phase), { timeout: 60_000 }).toBe('racing');
  }
}

test('two players race in a room and see each other move', async ({ browser }) => {
  const alice = await Player.open(browser, 'Alice');
  const bob = await Player.open(browser, 'Bob');
  await roomOf(alice, bob);
  await startRace(alice, bob);
  expect((await racers(bob)).map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
  // Alice drives; Bob's view of her follows.
  const start = (await racers(bob)).find((r) => r.name === 'Alice')!.pos;
  await alice.hold({ throttle: 1 });
  await expect.poll(async () => {
    const a = (await racers(bob)).find((r) => r.name === 'Alice')!.pos;
    return Math.hypot(a.x - start.x, a.z - start.z);
  }, { timeout: 60_000 }).toBeGreaterThan(10);
  await alice.close();
  await bob.close();
});

test("a player's guns hurt another player's car, on that player's own client", async ({ browser }) => {
  const alice = await Player.open(browser, 'Alice');
  const bob = await Player.open(browser, 'Bob');
  await roomOf(alice, bob);
  await startRace(alice, bob);
  const bobId = (await racers(alice)).find((r) => r.name === 'Bob')!.id;
  await expect.poll(() => alice.game((_t, g) => g.session.combat.hot), { timeout: 30_000 }).toBe(true);
  // Bob parks 20 m ahead of Alice; she holds her turret on him and fires.
  await alice.game((t) => t.teleport(t.state().s, 0));
  const s = await alice.game((t) => t.state().s);
  await bob.game((t, _g, at: number) => t.teleport(at + 20, 0), s);
  await alice.game((t, _g, id: string) => { t.aimAt(id); t.give('armed'); }, bobId);
  await alice.hold({ fire: true });
  await expect.poll(async () => (await bob.state()).armour, { timeout: 60_000 }).toBeLessThan(140);
  await alice.close();
  await bob.close();
});

test('the race ends on the same standings for both players', async ({ browser }) => {
  const alice = await Player.open(browser, 'Alice');
  const bob = await Player.open(browser, 'Bob');
  await roomOf(alice, bob);
  await startRace(alice, bob);
  // Alice crosses the line first, then Bob (each in a lane of their own).
  for (const [p, u] of [[alice, -4], [bob, 4]] as const) {
    await p.hold({ throttle: 1 });
    await p.game((t, g, lane: number) => t.teleportToProgress(g.track.lapLength - 20, lane), u);
    await expect.poll(() => p.game((t) => t.race()?.finished), { timeout: 60_000 }).toBe(true);
  }
  for (const p of [alice, bob]) {
    await expect(p.page.locator('#results h2')).toHaveText('Results', { timeout: 60_000 });
    await expect(p.page.locator('.standings tbody tr').first()).toContainText('Alice');
    await expect(p.page.locator('.standings tbody tr').nth(1)).toContainText('Bob');
  }
  // Back to the room for the next one.
  await bob.page.locator('#back-to-room').click();
  await expect(bob.page.locator('#members')).toContainText('Alice');
  await alice.close();
  await bob.close();
});

test('when the owner leaves mid-race, the bots carry on for whoever takes over', async ({ browser }) => {
  const alice = await Player.open(browser, 'Alice');
  const bob = await Player.open(browser, 'Bob');
  await alice.page.goto('/');
  const code = await alice.createRoom();
  await alice.page.getByRole('radio', { name: '3 bots' }).click();
  await bob.page.goto(`/#${code}`);
  await expect(alice.page.locator('#members')).toContainText('Bob');
  await startRace(alice, bob);
  const bot = async () => (await racers(bob)).find((r) => r.bot)!;
  await expect.poll(async () => (await bot()).D, { timeout: 60_000 }).toBeGreaterThan(20);
  // Alice goes; Bob inherits the room and its bots.
  await alice.close();
  await expect(bob.page.locator('#killfeed')).toContainText('You took over the bots', { timeout: 30_000 });
  const before = (await bot()).D;
  await expect.poll(async () => (await bot()).D, { timeout: 60_000 }).toBeGreaterThan(before + 30);
  await bob.close();
});
