/*
 * Checks database.rules.json against the Realtime Database emulator: loads the rules into a
 * namespace of its own, then makes writes the game makes (which must be allowed) and writes a
 * cheater or a bug would make (which must be refused). Run inside the emulator:
 *
 *   npm run test:rules
 *
 * No dependencies: it talks to the emulator's REST API. (The same harness as Arena FPS.)
 * Every new database field gets cases here.
 */

import { readFile } from 'node:fs/promises';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST ?? '127.0.0.1:9000';
const NS = 'rules-test';
const base = `http://${HOST}`;

const rules = await readFile(new URL('../database.rules.json', import.meta.url), 'utf8');
JSON.parse(rules); // fail early on broken JSON

async function admin(method, path, body) {
  const res = await fetch(`${base}/${path}?ns=${NS}`, {
    method,
    headers: { Authorization: 'Bearer owner' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

/** An unauthenticated client write, like the game's. True if the rules allowed it. */
async function write(path, value) {
  const res = await fetch(`${base}/${path}.json?ns=${NS}`, { method: 'PUT', body: JSON.stringify(value) });
  return res.ok;
}

/** A client's partial update (PATCH), like update() */
async function patch(path, value) {
  const res = await fetch(`${base}/${path}.json?ns=${NS}`, { method: 'PATCH', body: JSON.stringify(value) });
  return res.ok;
}

await admin('PUT', '.settings/rules.json', rules);
await admin('DELETE', '.json');

const PID = 'ABCDEFGH2345';
const PID2 = 'ZYXWVUTS9876';
const settings = { seed: 'rust-417', length: 'm', theme: 'docks', gen: 1, laps: 3, bots: 3, skill: 'mixed', crash: 1, armour: 150, weapons: true };
const lobby = (over = {}) => ({ name: "Alice's room", host: 'Alice', hostId: PID, createdAt: 1, members: { [PID]: 'Alice' }, ...settings, ...over });
const race = (over = {}) => ({ n: 1, phase: 'grid', startAt: 1000, grid: { b_0: 0, [PID]: 1 }, settings, ...over });
const POSE = '-oxo.1v.401.-b.gh.-1i.0.-5.0.0.0.0.0.0.ai.2p.0';
const board = (over = {}) => {
  const e = { name: 'Alice', races: 1, podiums: 1, wins: 1, kills: 3, ...over };
  return { ...e, score: over.score ?? e.races * 5 + e.podiums * 20 + e.wins * 50 + e.kills * 10 };
};

/** [description, path, value, should it be allowed?, how] run in order (later ones build on earlier ones) */
const cases = [
  // ---- lobby
  ['lobby: a new room', 'lobby/AB2CD', lobby(), true],
  ['lobby: bad room code', 'lobby/ab-cd', lobby(), false],
  ['lobby: 0 laps', 'lobby/AB2CD/laps', 0, false],
  ['lobby: 10 laps', 'lobby/AB2CD/laps', 10, false],
  ['lobby: 5 laps', 'lobby/AB2CD/laps', 5, true],
  ['lobby: unknown theme', 'lobby/AB2CD/theme', 'moon', false],
  ['lobby: seed too long', 'lobby/AB2CD/seed', 'x'.repeat(17), false],
  ['lobby: 12 bots', 'lobby/AB2CD/bots', 12, false],
  ['lobby: carnage', 'lobby/AB2CD/crash', 2, true],
  ['lobby: elimination', 'lobby/AB2CD/elim', true, true],
  ['lobby: elimination as text', 'lobby/AB2CD/elim', 'yes', false],
  ['lobby: crash 3', 'lobby/AB2CD/crash', 3, false],
  ['lobby: a member', `lobby/AB2CD/members/${PID2}`, 'Bob', true],
  ['lobby: a member with a bad id', 'lobby/AB2CD/members/bob', 'Bob', false],
  ['lobby: unknown field', 'lobby/AB2CD/admin', true, false],
  // ---- players
  ['player: joins', `rooms/AB2CD/players/${PID}`, { name: 'Alice', c: 0, n: 0 }, true],
  ['player: a pose', `rooms/AB2CD/players/${PID}/p`, POSE, true],
  ['player: a pose with capitals', `rooms/AB2CD/players/${PID}/p`, POSE.toUpperCase(), false],
  ['player: a pose too long', `rooms/AB2CD/players/${PID}/p`, '1.'.repeat(120), false],
  ['player: damage dealt', `rooms/AB2CD/players/${PID}/d`, { b_0: 12.5, [PID2]: 40 }, true],
  ['player: negative damage', `rooms/AB2CD/players/${PID}/d/b_0`, -5, false],
  ['player: paint 8', `rooms/AB2CD/players/${PID}/c`, 8, false],
  ['player: unknown field', `rooms/AB2CD/players/${PID}/god`, true, false],
  ['player: bad id', 'rooms/AB2CD/players/nope', { name: 'X', c: 0 }, false],
  // ---- bots
  ['bot: written by the owner', 'rooms/AB2CD/bots/b_0', { name: 'Grinder', c: 0, n: 1, p: POSE, k: 0 }, true],
  ['bot: bad id', 'rooms/AB2CD/bots/robot', { name: 'X', c: 0 }, false],
  // ---- race
  ['race: a race on the grid', 'rooms/AB2CD/race', race(), true],
  ['race: a stored countdown phase', 'rooms/AB2CD/race/phase', 'countdown', false],
  ['race: 12 laps in its settings', 'rooms/AB2CD/race/settings/laps', 12, false],
  ['race: negative start', 'rooms/AB2CD/race/startAt', -1, false],
  ['race: slot 12', 'rooms/AB2CD/race/grid/b_1', 12, false],
  ['race: results', 'rooms/AB2CD/race', race({ phase: 'results', endAt: 5000 }), true],
  // ---- results
  ['result: first write', `rooms/AB2CD/results/1/${PID}`, { name: 'Alice', ms: 180000, best: 58000, k: 2 }, true],
  ['result: overwritten', `rooms/AB2CD/results/1/${PID}`, { name: 'Alice', ms: 1000, best: 500, k: 50 }, false],
  ['result: best lap longer than the race', `rooms/AB2CD/results/1/${PID2}`, { name: 'Bob', ms: 100000, best: 200000, k: 0 }, false],
  ['result: a DNF bot', 'rooms/AB2CD/results/1/b_0', { name: 'Grinder', k: 1, dnf: true, bot: true }, true],
  // ---- hazards and events
  ['hazard: oil', 'rooms/AB2CD/hazards/h1', { k: 'oil', x: 10, y: 0.2, z: -40, by: PID, until: 9000 }, true],
  ['hazard: a shell (not a hazard)', 'rooms/AB2CD/hazards/h2', { k: 'shell', x: 10, y: 0, z: 0, by: PID, until: 9000 }, false],
  ['hazard: off the map', 'rooms/AB2CD/hazards/h3', { k: 'mines', x: 99999, y: 0, z: 0, by: PID, until: 9000 }, false],
  ['event: a wreck', 'rooms/AB2CD/events/e1', { k: 'wreck', v: PID2, by: PID, w: 'ram', from: PID, t: 1 }, true],
  ['event: a heat-seeking missile', 'rooms/AB2CD/events/e5', { k: 'missile', by: PID, x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: -70, v: PID2, from: PID, t: 1 }, true],
  ['event: a boom', 'rooms/AB2CD/events/e2', { k: 'boom', by: PID, x: 1, y: 2, z: 3, r: 4.5, dmg: 28, push: 7, w: 'missile', from: PID, t: 1 }, true],
  ['event: a nuke', 'rooms/AB2CD/events/e3', { k: 'boom', by: PID, x: 1, y: 2, z: 3, r: 4.5, dmg: 1000, push: 7, w: 'missile', from: PID, t: 1 }, false],
  ['event: unknown kind', 'rooms/AB2CD/events/e4', { k: 'teleport', from: PID, t: 1 }, false],
  ['rooms: unknown branch', 'rooms/AB2CD/secrets', { a: 1 }, false],
  ['rooms: deleting a room', 'rooms/AB2CD', null, true],
  // ---- leaderboard
  ['board: first race', 'leaderboard/p_browser0001', board(), true],
  ['board: next race', 'leaderboard/p_browser0001', board({ races: 2, podiums: 2, wins: 1, kills: 5 }), true],
  ['board: a win without a podium', 'leaderboard/p_browser0001', board({ races: 3, podiums: 2, wins: 2, kills: 5 }), false],
  ['board: two races at once', 'leaderboard/p_browser0001', board({ races: 4, podiums: 2, wins: 1, kills: 5 }), false],
  ['board: score not matching the formula', 'leaderboard/p_browser0001', board({ races: 3, podiums: 2, wins: 1, kills: 5, score: 9999 }), false],
  ['board: 60 kills in a race', 'leaderboard/p_browser0001', board({ races: 3, podiums: 2, wins: 1, kills: 65 }), false],
  ['board: bad profile id', 'leaderboard/hacker', board(), false],
];

let failed = 0;
for (const [name, path, value, allowed] of cases) {
  const ok = (await write(path, value)) === allowed;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} (${allowed ? 'allowed' : 'refused'} expected)`);
}
// A partial update as the game sends it.
const okPatch = await patch(`rooms/AB2CD/players/${PID}`, { p: POSE, t: 123 }) === false; // room was deleted above: no name/c, refused
if (!okPatch) failed++;
console.log(`${okPatch ? '✓' : '✗'} player: an update to a record that's gone is refused (no partial records)`);

await admin('DELETE', '.json');
if (failed) {
  console.error(`\n${failed} of ${cases.length + 1} rule checks failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length + 1} rule checks passed`);
