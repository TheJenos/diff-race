import type { TrackData } from './types';

/** A fingerprint of a track's content: two clients with the same spec must get the same one. */
export function trackHash(t: Omit<TrackData, 'hash'>): number {
  let h = 2166136261;
  const num = (n: number) => {
    // Centimetres as an integer, so float noise below that doesn't count.
    let v = Math.round(n * 100) | 0;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ (v & 0xff), 16777619) >>> 0;
      v >>= 8;
    }
  };
  const fine = (n: number) => num(n * 100); // unit vectors and curvature: to 1/10000
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  str(t.name);
  str(t.theme);
  num(t.n); num(t.ds); num(t.verge); num(t.killY);
  for (let i = 0; i < t.pos.length; i++) num(t.pos[i] as number);
  for (let i = 0; i < t.right.length; i++) fine(t.right[i] as number);
  for (let i = 0; i < t.n; i++) {
    num(t.halfWidth[i] as number);
    num(t.line[i] as number);
  }
  for (const g of t.grid) { num(g.s); num(g.u); }
  for (const c of t.checkpoints) num(c);
  for (const p of t.pads) { num(p.s); num(p.u); str(p.kind); }
  for (const r of t.ramps) { num(r.s); num(r.len); num(r.h); num(r.u0); num(r.u1); }
  for (const k of t.kerbs) { num(k.i0); num(k.i1); num(k.side); }
  for (const s of t.scenery) { str(s.kind); num(s.x); num(s.y); num(s.z); fine(s.fx); fine(s.fz); num(s.scale); num(s.chunk); }
  return h >>> 0;
}
