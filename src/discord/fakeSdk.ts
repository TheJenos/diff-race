import type { DiscordSession } from './discord';

/*
 * End-to-end tests can't run inside Discord. With `?fakeDiscord` in an e2e build, the Discord
 * lobby gets a made-up signed-in user in the instance the URL names (instance_id), so two test
 * players with the same instance land in the same room, as two people in a voice channel would.
 * Never in a production build: VITE_E2E is only set by `vite --mode e2e`.
 */

export const FAKE_DISCORD = import.meta.env.VITE_E2E === 'true' && new URLSearchParams(location.search).has('fakeDiscord');

export function fakeDiscordSession(): DiscordSession {
  const q = new URLSearchParams(location.search);
  let name = 'Tester';
  try {
    name = localStorage.getItem('diffrace-name') || name;
  } catch { /* no storage */ }
  const userId = String(100_000_000_000_000_000 + Math.floor(Math.random() * 1e15));
  return { instanceId: q.get('instance_id') ?? 'e2e', userId, guildId: q.get('guild_id'), name: name.slice(0, 16) };
}
