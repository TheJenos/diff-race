/**
 * Races bots on many generated tracks with no screen (src/game/bot/sim/headless.ts) and checks
 * the driving: every bot finishes, none sits stuck, few respawn, laps are near the speed profile's
 * ideal, and better bots are faster (on average: in a pack, traffic evens out single races).
 *
 *   npm run sim:bots -- [--seeds 12] [--lengths s,m,l] [--laps 2] [--bots 6]
 */
import { simulate } from '../src/game/bot/sim/headless';
import { GENERATOR_VERSION, type TrackLength } from '../src/game/track/spec';
import { BOT_SKILLS, type BotSkill } from '../src/game/bot/skills';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const SEEDS = Number(opt('seeds', '12'));
const LENGTHS = opt('lengths', 's,m,l').split(',') as TrackLength[];
const LAPS = Number(opt('laps', '2'));
const BOTS = Number(opt('bots', '6'));

/** Slowest acceptable race, as a multiple of the speed profile's ideal */
const SLOWEST = 1.75;
/** Longest a bot may sit still (s), and most respawns per lap (spins in the pack happen) */
const MAX_STILL = 6;
const MAX_RESPAWNS_PER_LAP = 2.5;

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`✗ ${msg}`); };
let expertWins = 0;
let duels = 0;
const ratios: Record<string, number[]> = {};

const field: BotSkill[] = Array.from({ length: BOTS }, (_, i) => BOT_SKILLS[i % BOT_SKILLS.length]!);
for (const length of LENGTHS) {
  for (let k = 0; k < SEEDS; k++) {
    const seed = `sim-${k}`;
    const r = await simulate({ spec: { seed, length, gen: GENERATOR_VERSION }, laps: LAPS, bots: field });
    const ideal = r.idealLap * LAPS;
    const line = r.cars.map((c) => `${c.skill.slice(0, 2)}:${c.time === null ? 'DNF' : (c.time / ideal).toFixed(2)}${c.respawns ? `/${c.respawns}r` : ''}`).join(' ');
    console.log(`${length}/${seed}: ${Math.round(r.lapLength)} m, ideal ${ideal.toFixed(1)} s · ${line} · ${(r.ms / 1000).toFixed(1)} s`);
    for (const c of r.cars) {
      if (c.time !== null) (ratios[c.skill] ??= []).push(c.time / ideal);
      if (c.time === null) fail(`${length}/${seed}: ${c.skill} didn't finish`);
      else if (c.time > ideal * SLOWEST) fail(`${length}/${seed}: ${c.skill} took ${(c.time / ideal).toFixed(2)}× the ideal`);
      if (c.stuck > MAX_STILL) fail(`${length}/${seed}: ${c.skill} sat still ${c.stuck.toFixed(1)} s`);
      if (c.respawns > MAX_RESPAWNS_PER_LAP * LAPS) fail(`${length}/${seed}: ${c.skill} respawned ${c.respawns} times`);
    }
    const best = (s: BotSkill) => Math.min(...r.cars.filter((c) => c.skill === s).map((c) => c.time ?? Infinity));
    if (field.includes('expert') && field.includes('easy')) {
      duels++;
      if (best('expert') < best('easy')) expertWins++;
    }
  }
}
// In a pack, traffic evens things out race to race; on average the better bots must still be faster.
const mean = (k: string) => (ratios[k] ?? []).reduce((a, b) => a + b, 0) / Math.max(1, (ratios[k] ?? []).length);
console.log(`mean race time / ideal: ${Object.keys(ratios).map((k) => `${k} ${mean(k).toFixed(3)}`).join(', ')}`);
if (duels && expertWins / duels < 0.6) fail(`expert beat easy in only ${expertWins}/${duels} races`);
if (ratios.expert && ratios.easy && mean('expert') > mean('easy') * 0.97) fail('expert bots are no faster than easy ones on average');
if (failures) {
  console.log(`\n${failures} problem(s)`);
  process.exit(1);
}
console.log(`bots fine (expert beat easy ${expertWins}/${duels})`);
