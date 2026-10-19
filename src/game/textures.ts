import * as THREE from 'three';
import { canvas2d } from './canvas';

/*
 * Procedural textures, drawn once into canvases and cached for the lifetime of the page. Patterns
 * use tileable value noise (the lattice wraps), so every texture repeats without seams. Most are
 * drawn in light neutral tones so each theme's palette tints them (material.color).
 */

export type TextureName = 'asphalt' | 'gravel' | 'ground' | 'concrete' | 'stripes' | 'kerb' | 'checker' | 'metal' | 'spikes';

/** Metres covered by one repeat of each, along and across */
export const TILE: Record<TextureName, number> = {
  asphalt: 8, gravel: 4, ground: 16, concrete: 3, stripes: 2, kerb: 2, checker: 2, metal: 2, spikes: 1,
};

// ---------------------------------------------------------------- noise

/** Small deterministic PRNG so every client draws identical textures. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATTICE = 256;
const lattice = (() => {
  const rand = rng(1337);
  return Float32Array.from({ length: LATTICE * LATTICE }, () => rand());
})();

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise in 0..1 that repeats every `period` units on both axes. */
function noise(x: number, y: number, period: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = (n: number) => (((n % period) + period) % period) % LATTICE;
  const at = (ix: number, iy: number) => lattice[wrap(iy) * LATTICE + wrap(ix)] ?? 0;
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise: `octaves` layers, each twice the frequency and half the weight. Tileable. */
function fbm(x: number, y: number, period: number, octaves = 4): number {
  let sum = 0;
  let weight = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 1 << o;
    sum += noise(x * f, y * f, period * f) * weight;
    norm += weight;
    weight /= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- painters

type Painter = (g: CanvasRenderingContext2D, size: number) => void;

/** Fill pixel by pixel from a 0..255 grey (or rgb) function of the texel's position (0..1). */
function pixels(g: CanvasRenderingContext2D, size: number, fn: (u: number, v: number) => [number, number, number]): void {
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, gg, b] = fn(x / size, y / size);
      const o = (y * size + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

const grey = (v: number): [number, number, number] => {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return [c, c, c];
};

const PAINTERS: Partial<Record<TextureName, { size: number; paint: Painter }>> = {
  asphalt: {
    size: 512,
    paint: (g, size) => pixels(g, size, (u, v) => {
      const base = fbm(u * 8, v * 8, 8, 4);
      const grit = noise(u * 160, v * 160, 160);
      const fine = noise(u * 320, v * 320, 320);
      // Gently darker tar patches where low-frequency noise dips, faded in (no hard edges).
      const low = fbm(u * 3, v * 3, 3, 3);
      const patch = -Math.max(0, 0.42 - low) * 90;
      return grey(150 + base * 34 + grit * 30 + fine * 22 + patch);
    }),
  },
  gravel: {
    size: 256,
    paint: (g, size) => pixels(g, size, (u, v) => {
      const stones = noise(u * 64, v * 64, 64);
      const base = fbm(u * 6, v * 6, 6, 3);
      return grey(150 + base * 60 + (stones > 0.62 ? 50 : stones < 0.25 ? -40 : 0));
    }),
  },
  ground: {
    size: 512,
    paint: (g, size) => pixels(g, size, (u, v) => {
      const base = fbm(u * 6, v * 6, 6, 5);
      const ruts = noise(u * 40, v * 3, 40);
      return grey(140 + base * 80 + ruts * 20);
    }),
  },
  concrete: {
    size: 256,
    paint: (g, size) => pixels(g, size, (u, v) => {
      const base = fbm(u * 5, v * 5, 5, 4);
      // Grime running down from the top (v = 0 is the top edge of a barrier face).
      const grime = (1 - v) * 0 + v * v * 40 * fbm(u * 12, v * 2, 12, 2);
      const seam = Math.abs(u - 0.5) < 0.006 ? -60 : 0;
      return grey(205 + base * 40 - grime + seam);
    }),
  },
  stripes: {
    size: 128,
    paint: (g, size) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#1a1a1a';
      // Diagonal hazard bands, two per repeat, tileable.
      for (let k = -2; k < 4; k++) {
        g.beginPath();
        const x = k * (size / 2);
        g.moveTo(x, 0);
        g.lineTo(x + size / 4, 0);
        g.lineTo(x + size / 4 + size, size);
        g.lineTo(x + size, size);
        g.closePath();
        g.fill();
      }
    },
  },
  kerb: {
    size: 128,
    paint: (g, size) => {
      g.fillStyle = '#e8e8e8';
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#c3221a';
      g.fillRect(0, 0, size, size / 2);
    },
  },
  checker: {
    size: 128,
    paint: (g, size) => {
      const n = 8;
      const c = size / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
          g.fillRect(x * c, y * c, c, c);
        }
      }
    },
  },
  metal: {
    size: 256,
    paint: (g, size) => pixels(g, size, (u, v) => {
      const brushed = noise(u * 200, v * 6, 200);
      const rust = fbm(u * 4, v * 4, 4, 4);
      // Rivets on a grid.
      const ru = (u * 4) % 1;
      const rv = (v * 4) % 1;
      const rivet = (ru - 0.5) ** 2 + (rv - 0.5) ** 2 < 0.004 ? 40 : 0;
      return grey(150 + brushed * 30 - (rust < 0.35 ? 45 : 0) + rivet);
    }),
  },
};

const cache = new Map<TextureName, THREE.CanvasTexture>();

/** The texture, drawn on first use. Repeats in both directions; the caller sets .repeat if needed. */
export function texture(name: TextureName): THREE.CanvasTexture {
  let t = cache.get(name);
  if (!t) {
    const { size, paint } = PAINTERS[name]!;
    const { canvas, g } = canvas2d(size);
    paint(g, size);
    t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    cache.set(name, t);
  }
  return t;
}
