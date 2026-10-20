import * as THREE from 'three';
import { canvas2d } from '../canvas';
import type { ThemePalette } from '../track/themes';

/*
 * A theme's sky as an environment map, for what reflects it (the realistic car's paint, glass and
 * chrome): the gradient the sky dome draws, and below the horizon the fog fading into the ground.
 * Drawn on a canvas, not rendered, so any renderer can use it: each makes its own prefiltered
 * copy the first time it draws with it.
 */

const cache = new Map<ThemePalette, THREE.CanvasTexture>();

export function skyReflection(p: ThemePalette): THREE.CanvasTexture {
  let t = cache.get(p);
  if (t) return t;
  const w = 128;
  const h = 64;
  const { canvas, g } = canvas2d(w, h);
  const top = new THREE.Color(p.skyTop);
  const horizon = new THREE.Color(p.skyHorizon);
  const fog = new THREE.Color(p.fog);
  const ground = new THREE.Color(p.hemiGround);
  const c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    // 1 straight up, 0 at the horizon, −1 straight down (the same curve as the dome's shader above it).
    const e = 1 - ((y + 0.5) / h) * 2;
    if (e >= 0) c.copy(horizon).lerp(top, e ** 0.55);
    else c.copy(fog).lerp(ground, Math.min(1, -e * 3));
    g.fillStyle = `#${c.getHexString()}`;
    g.fillRect(0, y, w, 1);
  }
  t = new THREE.CanvasTexture(canvas);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(p, t);
  return t;
}
