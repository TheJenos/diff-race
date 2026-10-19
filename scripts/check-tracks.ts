/**
 * Generates many tracks and checks them all: valid (track/validate.ts), how many rolls each took and
 * why rolls failed, how often the stadium fallback was needed, timing per length, and how bendy
 * they come out (corners a lap, and how many times the road turns). Also checks that
 * generation is deterministic, that the generator never calls engine-dependent maths, and (with
 * --golden) that no track changed without a GENERATOR_VERSION bump.
 *
 * --dump SEED writes a picture per length: the road, barriers, racing line, start, pads, ramps
 * and scenery from above.
 *
 *   npm run check:tracks -- [--count 100] [--length s,m,l] [--dump SEED] [--golden] [--update-golden]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { generateWithReport } from '../src/game/track/generate';
import { GENERATOR_VERSION, type TrackLength } from '../src/game/track/spec';
import { validate } from '../src/game/track/validate';
import type { TrackData } from '../src/game/track/types';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const COUNT = Number(opt('count', '100'));
const LENGTHS = opt('length', 's,m,l').split(',') as TrackLength[];
const GOLDEN_FILE = 'src/game/track/golden.json';
const GOLDEN_SEEDS = 30;
/** Fallbacks allowed, as a fraction of tracks */
const MAX_FALLBACK = 0.005;

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`✗ ${msg}`); };

// ---------------------------------------------------------------- engine-dependent maths
const BANNED = /Math\.(hypot|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|random)\b|\*\*/;
for (const file of readdirSync('src/game/track')) {
  if (!file.endsWith('.ts')) continue;
  readFileSync(join('src/game/track', file), 'utf8').split('\n').forEach((line, i) => {
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').replace(/^\s*(\/\*\*|\*).*$/, '');
    if (BANNED.test(code) && !line.includes('det-ok')) fail(`track/${file}:${i + 1} uses engine-dependent maths: ${line.trim()}`);
  });
}

// ---------------------------------------------------------------- a track as a picture
function dump(t: TrackData, file: string): void {
  const S = 1.5;
  const b = t.bounds;
  const pad = 60;
  const W = Math.round((b.maxX - b.minX + pad * 2) * S);
  const H = Math.round((b.maxZ - b.minZ + pad * 2) * S);
  const png = new PNG({ width: W, height: H });
  png.data.fill(30);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  const put = (x: number, z: number, [r, g, bb]: [number, number, number], size = 1) => {
    const px = Math.round((x - b.minX + pad) * S);
    const py = Math.round((z - b.minZ + pad) * S);
    for (let a = -size + 1; a < size; a++) {
      for (let c = -size + 1; c < size; c++) {
        const qx = px + a;
        const qy = py + c;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const i = (qy * W + qx) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = bb;
      }
    }
  };
  const at = (i: number, u: number) => ({
    x: t.pos[i * 3]! + t.right[i * 3]! * u,
    z: t.pos[i * 3 + 2]! + t.right[i * 3 + 2]! * u,
  });
  for (let i = 0; i < t.n; i++) {
    const hw = t.halfWidth[i]!;
    // Height shades the road: low dark, high light.
    const lift = Math.round(((t.pos[i * 3 + 1]! - b.minY) / Math.max(1, b.maxY - b.minY)) * 90);
    for (let u = -hw; u <= hw; u += 0.6) {
      const p = at(i, u);
      put(p.x, p.z, [90 + lift, 90 + lift, 95 + lift]);
    }
    for (const side of [-1, 1]) {
      const p = at(i, side * (hw + t.verge));
      put(p.x, p.z, [200, 170, 40]);
    }
    const l = at(i, t.line[i]!);
    put(l.x, l.z, [60, 200, 255]);
  }
  for (let u = -12; u <= 12; u += 0.5) { const p = at(0, u); put(p.x, p.z, [255, 255, 255], 2); }
  for (const pd of t.pads) {
    const p = at(Math.floor(pd.s / t.ds) % t.n, pd.u);
    put(p.x, p.z, pd.kind === 'gun' ? [255, 176, 32] : pd.kind === 'sword' ? [255, 60, 40] : pd.kind === 'shield' ? [60, 120, 255] : [150, 255, 60], 4);
  }
  for (const r of t.ramps) {
    for (let s = r.s; s < r.s + r.len; s += 1) {
      for (let u = r.u0; u <= r.u1; u += 0.6) { const p = at(Math.floor(s / t.ds) % t.n, u); put(p.x, p.z, [255, 140, 0]); }
    }
  }
  for (const s of t.scenery) put(s.x, s.z, s.kind === 'floodlight' ? [255, 255, 160] : [120, 200, 90], 2);
  writeFileSync(file, PNG.sync.write(png));
}

// ---------------------------------------------------------------- how bendy a track is
/** Tighter than this (1/m, a 120 m radius) is a corner; this tight (a 50 m radius) a tight one */
const CORNER_KAPPA = 1 / 120;
const TIGHT_KAPPA = 1 / 50;

/**
 * Corners in a lap (runs of curvature one way past CORNER_KAPPA, joined across gaps under 25 m,
 * at least 6 m long), how many are tight, and how far the road turns in a lap, in whole turns
 * (a plain loop is 1).
 */
function bends(t: TrackData): { corners: number; tight: number; turns: number } {
  const { n, ds } = t;
  const k = (i: number) => t.curvature[((i % n) + n) % n] as number;
  let turning = 0;
  for (let i = 0; i < n; i++) turning += Math.abs(k(i)) * ds;
  // Start counting on a straight bit, so no corner is split by the wrap.
  let s0 = 0;
  while (s0 < n && Math.abs(k(s0)) > CORNER_KAPPA) s0++;
  const runs: { from: number; to: number; sign: number; peak: number }[] = [];
  for (let j = 0; j < n; j++) {
    const v = k(s0 + j);
    if (Math.abs(v) <= CORNER_KAPPA) continue;
    const sign = Math.sign(v);
    const last = runs[runs.length - 1];
    if (last && last.sign === sign && (j - last.to) * ds < 25) {
      last.to = j;
      last.peak = Math.max(last.peak, Math.abs(v));
    } else runs.push({ from: j, to: j, sign, peak: Math.abs(v) });
  }
  const corners = runs.filter((r) => (r.to - r.from + 1) * ds >= 6);
  return { corners: corners.length, tight: corners.filter((r) => r.peak >= TIGHT_KAPPA).length, turns: turning / (2 * Math.PI) };
}

// ---------------------------------------------------------------- generate everything
const golden: Record<string, Record<string, number>> = existsSync(GOLDEN_FILE) ? JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) : {};
const fresh: Record<string, number> = {};
for (const length of LENGTHS) {
  const reasons: Record<string, number> = {};
  let fallbacks = 0;
  let rolls = 0;
  let worstMs = 0;
  const bend = { corners: 0, tight: 0, turns: 0, km: 0 };
  const t0 = performance.now();
  for (let i = 0; i < COUNT; i++) {
    const seed = `check-${i}`;
    const s0 = performance.now();
    const r = generateWithReport({ seed, length, gen: GENERATOR_VERSION });
    worstMs = Math.max(worstMs, performance.now() - s0);
    rolls += r.attempts;
    for (const why of r.reasons) reasons[why] = (reasons[why] ?? 0) + 1;
    if (r.track.fallback) fallbacks++;
    const t = r.track;
    const b = bends(t);
    bend.corners += b.corners;
    bend.tight += b.tight;
    bend.turns += b.turns;
    bend.km += t.lapLength / 1000;
    if (!t.fallback) {
      const why = validate({ pos: t.pos, n: t.n, ds: t.ds, halfWidth: t.halfWidth, verge: t.verge, curvature: t.curvature });
      if (why) fail(`${length}/${seed}: generated an invalid track (${why})`);
    }
    if (i < GOLDEN_SEEDS) {
      const again = generateWithReport({ seed, length, gen: GENERATOR_VERSION }).track;
      if (again.hash !== t.hash) fail(`${length}/${seed}: not deterministic`);
      fresh[`${length}:${seed}`] = t.hash;
    }
  }
  const avg = (performance.now() - t0) / COUNT;
  console.log(`${length}: ${COUNT} tracks, ${(rolls / COUNT).toFixed(2)} rolls each, ${fallbacks} fallbacks, ${avg.toFixed(1)} ms avg / ${worstMs.toFixed(1)} ms worst; failed rolls: ${JSON.stringify(reasons)}`);
  console.log(`   bends: ${(bend.corners / COUNT).toFixed(1)} corners a lap (${(bend.tight / COUNT).toFixed(1)} tight), ${(bend.corners / bend.km).toFixed(1)} a km, the road turns ${(bend.turns / COUNT).toFixed(2)} times a lap`);
  if (fallbacks > Math.max(1, COUNT * MAX_FALLBACK)) fail(`${length}: ${fallbacks} fallbacks out of ${COUNT}`);
}

if (flag('golden')) {
  const known = golden[String(GENERATOR_VERSION)];
  if (!known) fail(`no golden hashes for generator ${GENERATOR_VERSION}: run with --update-golden`);
  else {
    for (const [key, hash] of Object.entries(fresh)) {
      if (known[key] !== undefined && known[key] !== hash) fail(`${key} changed without a GENERATOR_VERSION bump`);
    }
  }
}
if (flag('update-golden')) {
  golden[String(GENERATOR_VERSION)] = { ...(golden[String(GENERATOR_VERSION)] ?? {}), ...fresh };
  writeFileSync(GOLDEN_FILE, `${JSON.stringify(golden, null, 2)}\n`);
  console.log(`wrote ${Object.keys(fresh).length} golden hashes for generator ${GENERATOR_VERSION}`);
}

const dumpSeed = opt('dump', '');
if (dumpSeed) {
  mkdirSync('dump', { recursive: true });
  for (const length of LENGTHS) {
    const t = generateWithReport({ seed: dumpSeed, length, gen: GENERATOR_VERSION }).track;
    const file = `dump/track-${dumpSeed}-${length}.png`;
    dump(t, file);
    console.log(`${file}: ${t.name} (${t.theme}), ${Math.round(t.lapLength)} m, ${t.pads.length} pads, ${t.ramps.length} ramps, ${t.scenery.length} props`);
  }
}

if (failures) {
  console.log(`\n${failures} problem(s)`);
  process.exit(1);
}
console.log('all tracks fine');
