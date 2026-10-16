import type { Browser, BrowserContext, Page } from '@playwright/test';

/*
 * One player: a browser context and page with the game's settings seeded (low quality, no sound)
 * and the sound files stubbed, so tests run fast on a software renderer.
 */

/** What window.game.test.state() returns (src/game/game.ts) */
export interface GameState {
  phase: string;
  speed: number;
  grounded: number;
  s: number;
  u: number;
  pos: { x: number; y: number; z: number } | null;
  trackHash: number;
  armour: number;
  wrecked: boolean;
  kills: number;
  place: number;
  /** The car auto aim is locked onto */
  locked: string | null;
}

export class Player {
  private constructor(readonly context: BrowserContext, readonly page: Page) {}

  static async open(browser: Browser, name = 'Driver'): Promise<Player> {
    const context = await browser.newContext();
    await context.addInitScript((n) => {
      localStorage.setItem('diffrace-name', n);
      // Only the first load: a reload keeps whatever the test changed.
      if (!localStorage.getItem('diffrace-settings')) {
        localStorage.setItem('diffrace-settings', JSON.stringify({ quality: 'low', sfxVolume: 0, musicVolume: 0, screenShake: false }));
      }
    }, name);
    const page = await context.newPage();
    await page.route('**/sounds/*.mp3', (r) => r.fulfill({ status: 200, body: '' }));
    page.on('pageerror', (e) => console.error(`[page error] ${e.message}`));
    return new Player(context, page);
  }

  /** The game's state; before the game exists (the track is still building), phase 'none' */
  state(): Promise<GameState> {
    return this.page.evaluate(() => {
      const g = (window as unknown as { game?: { test: { state(): GameState } } }).game;
      return g ? g.test.state() : { phase: 'none', speed: 0, grounded: 0, s: 0, u: 0, pos: null, trackHash: 0, armour: 0, wrecked: false, kills: 0, place: 0, locked: null };
    });
  }

  /** Run `fn(game.test, game)` in the page (game.test is the e2e facade in src/game/game.ts) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  game<T, A = undefined>(fn: (test: any, game: any, arg: A) => T, arg?: A): Promise<T> {
    return this.page.evaluate(({ src, arg }) => {
      const g = (window as unknown as { game?: { test: unknown } }).game;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return g ? new Function('t', 'g', 'a', `return (${src})(t, g, a)`)(g.test, g, arg) : null;
    }, { src: fn.toString(), arg }) as Promise<T>;
  }

  hold(input: Record<string, number | boolean>): Promise<void> {
    return this.page.evaluate((i) => (window as unknown as { game: { test: { hold(i: unknown): void } } }).game.test.hold(i), input);
  }

  /** From the lobby: a custom race of this mode on a short track */
  /** A custom race from the lobby, through its steps: the mode, a short track, the laps */
  async startCustom(mode: 'Death Race' | 'Elimination' | 'Time Trial' | 'Test Drive', laps?: 1 | 3 | 5, bots?: 3 | 5 | 7 | 11): Promise<void> {
    await this.page.getByRole('tab', { name: 'Custom race' }).click();
    await this.page.getByRole('radio', { name: mode }).click();
    await this.page.getByRole('button', { name: /^Next: Track/ }).click();
    await this.page.getByRole('radio', { name: 'Short' }).click();
    await this.page.getByRole('button', { name: /^Next: Race/ }).click();
    if (laps) await this.page.getByRole('radio', { name: `${laps} ${laps === 1 ? 'lap' : 'laps'}` }).click();
    if (bots) await this.page.getByRole('radio', { name: `${bots} bots` }).click();
    await this.page.locator('#start-race').click();
  }

  /** A new room from the lobby (the wizard's defaults; the room's settings are changed inside it). Returns its code. */
  async createRoom(): Promise<string> {
    await this.page.getByRole('tab', { name: 'Create room' }).click();
    await this.page.getByRole('button', { name: /^Next: Track/ }).click();
    await this.page.getByRole('button', { name: /^Next: Race/ }).click();
    await this.page.locator('#create-room').click();
    return (await this.page.locator('#room-code').textContent())!;
  }

  close(): Promise<void> {
    return this.context.close();
  }
}
