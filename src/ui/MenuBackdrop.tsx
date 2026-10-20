import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { requestTrack } from '../game/track/client';
import { GENERATOR_VERSION, THEME_IDS, type TrackSpec } from '../game/track/spec';
import { THEMES } from '../game/track/themes';
import type { TrackData } from '../game/track/types';
import { buildTrackMesh } from '../game/world/trackMesh';
import { buildScenery } from '../game/world/sceneryMesh';
import { Environment } from '../game/world/environment';
import { loadModels } from '../game/models';
import { loadSurfaces } from '../game/surfaces';
import { reducedMotion, settings } from '../game/settings';
import { TOUCH } from '../game/device';
import { randomSeed } from './seeds';

/*
 * Behind the menus: a slow flight along a real generated track, as it looks in the race (its sky,
 * light, barriers and scenery), low over the road and weaving a little. Kept cheap, as Arena FPS's
 * is: below full resolution, at most 30 frames a second, nothing while the tab is hidden. On touch
 * screens, on low quality and with reduced motion it's a single still frame; with no WebGL at all
 * (and in the e2e tests, many at once on software WebGL) the gradient behind it shows. It waits its
 * turn: the track is built only once the page has been idle a moment (`delay`), so the menu's first
 * moments never wait on it.
 */

/** Speed along the road (m/s), height over it (m), and how far ahead it looks (m) */
const SPEED = 24;
const HEIGHT = 6;
const LOOK_AHEAD = 48;
const FRAME_MS = 1000 / 30;
const E2E = import.meta.env.VITE_E2E === 'true';
/** Daylight themes only: a night track behind a dark menu is just dark */
const DAY_THEMES = THEME_IDS.filter((id) => !THEMES[id].night);

/** A point on the track `s` metres round, `u` metres right of the centre and `h` up */
function along(t: TrackData, s: number, u: number, h: number, out: THREE.Vector3): THREE.Vector3 {
  const L = t.lapLength;
  const f = ((((s % L) + L) % L) / t.ds);
  const i = Math.floor(f) % t.n;
  const j = (i + 1) % t.n;
  const k = f - Math.floor(f);
  const lerp = (a: Float32Array | number[], c: number) => (a[i * 3 + c] as number) * (1 - k) + (a[j * 3 + c] as number) * k;
  return out.set(lerp(t.pos, 0) + lerp(t.right, 0) * u, lerp(t.pos, 1) + h, lerp(t.pos, 2) + lerp(t.right, 2) * u);
}

/** @param delay ms before the track is built (it waits for an idle moment after that, too) */
export function MenuBackdrop({ delay = 1200 }: { delay?: number }) {
  // A new track each visit to the menus (the same while they're open).
  const spec = useMemo<TrackSpec>(() => ({
    seed: randomSeed(), length: 'm', gen: GENERATOR_VERSION,
    theme: DAY_THEMES[Math.floor(Math.random() * DAY_THEMES.length)] ?? 'docks',
  }), []);
  const hostRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (E2E) return;
    let idle = 0;
    const timer = setTimeout(() => {
      if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else setReady(true);
    }, delay);
    return () => {
      clearTimeout(timer);
      if (idle) cancelIdleCallback(idle);
    };
  }, [delay]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([requestTrack(spec), loadModels(), loadSurfaces()]).then(([track]) => {
      if (disposed) return;
      cleanup = fly(host, track, () => {
        setShown(true);
        setName(track.name);
      });
    }, () => { /* no track: the gradient stays */ });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [ready, spec]);

  return (
    <div className="menu-backdrop" aria-hidden="true">
      <div ref={hostRef} className={shown ? 'menu-backdrop-host shown' : 'menu-backdrop-host'} />
      <div className="menu-backdrop-shade" />
      {shown && name && <span className="menu-backdrop-caption">{name}</span>}
    </div>
  );
}

/** Build the scene in `host` and fly along `track`; returns the teardown */
function fly(host: HTMLElement, track: TrackData, onShown: () => void): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  } catch {
    return () => {};
  }
  const quality = settings.get().quality;
  const still = () => TOUCH || reducedMotion() || settings.get().quality === 'low';
  renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1) * (quality === 'high' ? 1 : 0.75));
  renderer.domElement.className = 'menu-backdrop-gl';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const env = new Environment(scene, THEMES[track.theme], 'low');
  const road = buildTrackMesh(track, false);
  const scenery = buildScenery(track, quality === 'high' ? 'medium' : 'low', false);
  scene.add(road.group, scenery.group);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2500);
  const look = new THREE.Vector3();

  let t = Math.random() * (track.lapLength / SPEED);
  let last = 0;
  let frame = 0;
  let shown = false;
  const place = () => {
    const s = t * SPEED;
    // Weaving gently across the road, rising and falling a little.
    along(track, s, Math.sin(t * 0.13) * 4, HEIGHT + Math.sin(t * 0.07) * 1.5, camera.position);
    along(track, s + LOOK_AHEAD, Math.sin(t * 0.13 + 0.6) * 2, 1.5, look);
    camera.lookAt(look);
    env.follow(look, camera);
  };
  const render = () => {
    place();
    renderer.render(scene, camera);
    if (!shown) {
      shown = true;
      onShown();
    }
  };
  const loop = (now: number) => {
    frame = 0;
    if (document.hidden || still()) return;
    frame = requestAnimationFrame(loop);
    if (now - last < FRAME_MS) return;
    if (last) t += Math.min(0.1, (now - last) / 1000);
    last = now;
    render();
  };
  let compiled = false;
  const start = () => {
    if (!compiled) return;
    if (still()) {
      render();
      return;
    }
    last = 0;
    if (!frame) frame = requestAnimationFrame(loop);
  };
  const size = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (still()) render();
  };
  let disposed = false;
  place();
  // Shaders compiled in the background where the browser can (the first frame otherwise compiles them all at once).
  renderer.compileAsync(scene, camera).catch(() => {}).then(() => {
    if (disposed) return;
    compiled = true;
    size();
    start();
  });
  const resize = new ResizeObserver(() => { if (compiled) size(); });
  resize.observe(host);
  document.addEventListener('visibilitychange', start);
  const unsubscribe = settings.subscribe(start);
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    resize.disconnect();
    document.removeEventListener('visibilitychange', start);
    unsubscribe();
    road.dispose();
    scenery.dispose();
    env.dispose();
    renderer.dispose();
    // Hand the context back now: the race is about to want its own.
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
