import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { TrackData } from '../game/track/types';
import { loadModels } from '../game/models';
import { reducedMotion, settings } from '../game/settings';
import { buildTrackScene, styleRenderer } from './trackScene';

interface Props {
  track: TrackData | null;
  /** Fill its container (the race setup's big stage) instead of its own fixed size */
  fill?: boolean;
}

/** Seconds per full turn when nobody is dragging */
const ORBIT_PERIOD = 48;
const FRAME_MS = 1000 / 30;
/** The e2e tests run on software WebGL, many at once: there the preview is the road alone, drawn plainly */
const E2E = import.meta.env.VITE_E2E === 'true';

/**
 * One renderer for every preview (as Arena FPS's map previews share one): its canvas moves into
 * whichever preview is showing, so changing the seed doesn't make (and leak) a new WebGL context
 * each time.
 */
let shared: THREE.WebGLRenderer | null | undefined;
function previewRenderer(): THREE.WebGLRenderer | null {
  if (shared !== undefined) return shared;
  try {
    shared = new THREE.WebGLRenderer({ antialias: !E2E });
    styleRenderer(shared);
    shared.domElement.className = 'track-preview-gl';
  } catch {
    shared = null;
  }
  return shared;
}

/**
 * The track in 3D before racing it, as it's drawn in the race (TrackScene: road, barriers, pads,
 * scenery, the theme's light), with posts over the start and the pads. It turns slowly on its own
 * (unless motion is reduced); drag to turn it, the wheel to come closer. When it isn't turning it
 * draws only when something changes.
 */
export function TrackPreview({ track, fill = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el || !track) return;
    const renderer = previewRenderer();
    if (!renderer) {
      setFailed(true);
      return;
    }
    let disposed = false;
    let teardown = () => {};
    // The Kenney props, if there are any, before the scenery is built (it's what the race shows).
    void loadModels().then(() => {
      if (disposed) return;
      teardown = show(el, renderer, track);
    });
    return () => {
      disposed = true;
      teardown();
    };
  }, [track]);
  const cls = ['track-preview', fill ? 'fill' : '', failed ? 'failed' : ''].filter(Boolean).join(' ');
  return (
    <div id="track-preview" className={cls} ref={host} role="img"
      aria-label={track ? `${track.name} in 3D: posts mark the start and the pads. Drag to turn it.` : 'Building the track'} />
  );
}

/** Show `track` in `el` with the shared renderer; returns the teardown */
function show(el: HTMLElement, renderer: THREE.WebGLRenderer, track: TrackData): () => void {
  const view = buildTrackScene(track, { scenery: E2E ? null : settings.get().quality === 'high' ? 'medium' : 'low', markers: true });
  const camera = new THREE.PerspectiveCamera(36, 1, 1, 10000);
  let yaw = Math.PI / 5;
  let pitch = 0.82;
  let zoom = 1;
  let dragging: { x: number; y: number } | null = null;
  const spinning = () => !E2E && !dragging && !reducedMotion();
  let frame = 0;
  let last = 0;
  const draw = (now: number) => {
    frame = 0;
    // Another preview took the canvas: this one stops drawing.
    if (renderer.domElement.parentElement !== el) return;
    if (spinning()) {
      frame = requestAnimationFrame(draw);
      if (last && now - last < FRAME_MS) return;
      if (last) yaw += (Math.min(0.1, (now - last) / 1000) * Math.PI * 2) / ORBIT_PERIOD;
      last = now;
    } else {
      last = 0;
    }
    view.aim(camera, yaw, pitch, zoom);
    renderer.render(view.scene, camera);
  };
  /** Draw on the next frame (at most once a frame, however many changes come in) */
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const size = () => {
    const w = el.clientWidth || 300;
    const h = el.clientHeight || 200;
    renderer.setPixelRatio(E2E ? 1 : Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    redraw();
  };
  el.appendChild(renderer.domElement);
  size();

  const canvas = renderer.domElement;
  const down = (e: PointerEvent) => {
    dragging = { x: e.clientX, y: e.clientY };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Not captured: moves outside the canvas are missed.
    }
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - dragging.x) * 0.008;
    pitch = Math.max(0.3, Math.min(1.45, pitch + (e.clientY - dragging.y) * 0.008));
    dragging = { x: e.clientX, y: e.clientY };
    redraw();
  };
  // Letting go starts the orbit again.
  const up = () => { dragging = null; redraw(); };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    zoom = Math.max(0.45, Math.min(1.6, zoom * (1 + Math.sign(e.deltaY) * 0.1)));
    redraw();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  const resize = new ResizeObserver(size);
  resize.observe(el);
  // Motion allowed again (the setting, or the system's): the orbit picks up where it stopped.
  const unsubscribe = settings.subscribe(redraw);
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  motion?.addEventListener('change', redraw);
  document.addEventListener('visibilitychange', redraw);

  return () => {
    if (frame) cancelAnimationFrame(frame);
    unsubscribe();
    motion?.removeEventListener('change', redraw);
    document.removeEventListener('visibilitychange', redraw);
    resize.disconnect();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('wheel', wheel);
    if (canvas.parentElement === el) el.removeChild(canvas);
    view.dispose();
  };
}
