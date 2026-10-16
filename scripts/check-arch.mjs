#!/usr/bin/env node
/*
 * Architecture checks, run in CI (npm run check:arch):
 *
 * 1. No source file over MAX_LINES: subsystems stay in their own modules (Arena FPS's game.ts
 *    grew to 5,600 lines; this one doesn't).
 * 2. Pure code stays pure: the track generator, race rules, car maths, bot brains and codecs
 *    import no three.js, React, Firebase, Discord or DOM-only modules, and only other pure
 *    modules, so they run in Node for the unit tests and the headless bot sim.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');
const MAX_LINES = 700;

/** Pure folders (every file inside) and pure files, relative to src/ */
const PURE_DIRS = ['game/track', 'game/race', 'game/math', 'game/combat/rules', 'game/bot/sim'];
const PURE_FILES = [
  'game/car/params.ts', 'game/car/suspension.ts', 'game/car/tyre.ts', 'game/car/drivetrain.ts', 'game/car/steering.ts',
  'game/car/nitro.ts', 'game/car/turret.ts', 'game/car/damage.ts', 'game/car/collisionDamage.ts', 'game/car/ramHandshake.ts',
  'game/car/carTrack.ts', 'game/car/carBody.ts', 'game/physics.ts',
  'game/bot/driver.ts', 'game/bot/speedProfile.ts', 'game/bot/skills.ts', 'game/bot/rubberBand.ts', 'game/bot/gunner.ts',
  'game/bot/botDefences.ts', 'game/bot/padRouting.ts', 'game/bot/avoid.ts', 'game/bot/tactics.ts', 'game/bot/roster.ts',
  'game/net/carCodec.ts', 'net/carCodec.ts', 'net/sendPolicy.ts', 'net/damageLedger.ts', 'net/raceRecord.ts',
  'game/camera/chase.ts', 'game/input/carInput.ts', 'game/world/trackPhysics.ts',
];
/** Allowed to touch the DOM (Worker) but not three/react/firebase */
const WORKER_OK = ['game/track/client.ts', 'game/track/worker.ts'];
const FORBIDDEN = [/^three(\/|$)/, /^react(-dom)?(\/|$)/, /^firebase(\/|$)/, /^@discord\//];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (p) => relative(SRC, p).split('\\').join('/');
const isTest = (r) => r.includes('/__tests__/');
const isPure = (r) => !isTest(r) && (PURE_FILES.includes(r) || PURE_DIRS.some((d) => r.startsWith(`${d}/`)));

const problems = [];
for (const file of files) {
  const r = rel(file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > MAX_LINES && !isTest(r)) problems.push(`${r}: ${lines} lines (limit ${MAX_LINES}): split it`);
  if (!isPure(r)) continue;
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (FORBIDDEN.some((re) => re.test(spec))) {
      problems.push(`${r}: pure module imports ${spec}`);
      continue;
    }
    if (!spec.startsWith('.')) continue;
    const target = rel(resolve(dirname(file), spec)).replace(/\.(ts|tsx|js)$/, '');
    const candidates = [`${target}.ts`, `${target}/index.ts`];
    if (!candidates.some((c) => isPure(c) || WORKER_OK.includes(c))) {
      problems.push(`${r}: pure module imports non-pure ${spec}`);
    }
  }
}

if (problems.length) {
  console.error(`Architecture check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`Architecture check passed (${files.length} files).`);
