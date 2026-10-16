import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { requestTrack } from '../game/track/client';
import { specKey, type TrackSpec } from '../game/track/spec';
import type { TrackData } from '../game/track/types';
import { loadModels } from '../game/models';
import { buildTrackScene, styleRenderer } from './trackScene';

/** The track a spec makes (built in the worker; the same spec is built once), or null while it's coming */
export function useTrack(spec: TrackSpec | null): TrackData | null {
  const [track, setTrack] = useState<TrackData | null>(null);
  const key = spec ? specKey(spec) : '';
  useEffect(() => {
    if (!spec) {
      setTrack(null);
      return;
    }
    let live = true;
    requestTrack(spec).then((t) => { if (live) setTrack(t); }, () => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return track && spec && specKey(track.spec) === key ? track : null;
}

/*
 * Thumbnails: the track in 3D, small and still (room cards, the launch card). Each is drawn once
 * by a renderer of their own, copied into an image and kept (by track and size), so a list of
 * rooms costs one WebGL context however long it is; the renderer goes once they're all drawn.
 * Without WebGL, the track's outline from above instead.
 */

const cache = new Map<string, string>();
let queue: Promise<void> = Promise.resolve();
let renderer: THREE.WebGLRenderer | null | undefined;
let idle = 0;

function thumbRenderer(): THREE.WebGLRenderer | null {
  clearTimeout(idle);
  if (renderer !== undefined) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: import.meta.env.VITE_E2E !== 'true' });
    styleRenderer(renderer);
  } catch {
    renderer = null;
  }
  return renderer;
}

/** Done drawing for now: let the context go a moment after the last thumbnail */
function release(): void {
  clearTimeout(idle);
  idle = window.setTimeout(() => {
    if (!renderer) return;
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = undefined;
  }, 4000);
}

/** The thumbnail of `track` at `size` CSS px, as an image URL (drawn in turn with any others asked for) */
function thumbnail(track: TrackData, size: number): Promise<string> {
  const key = `${specKey(track.spec)}@${size}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = queue.then(async () => {
    const again = cache.get(key);
    if (again) return again;
    await loadModels();
    const r = thumbRenderer();
    // Drawn at twice the size at least, and shown smaller: smooth edges at any pixel density.
    const px = Math.round(size * Math.max(2, Math.min(3, window.devicePixelRatio || 1)));
    let url: string;
    if (r) {
      r.setPixelRatio(1);
      r.setSize(px, px, false);
      // No scenery at this size (it's noise): the road's shape, seen steeply, the whole loop in view.
      const view = buildTrackScene(track, { scenery: null, markers: false });
      const camera = new THREE.PerspectiveCamera(34, 1, 1, 10000);
      view.aim(camera, Math.PI / 5, 1.15, 1.3);
      r.render(view.scene, camera);
      // Copied in the same task as the draw (the canvas isn't kept between frames).
      url = r.domElement.toDataURL('image/png');
      view.dispose();
    } else {
      url = outline(track, px);
    }
    cache.set(key, url);
    release();
    return url;
  });
  queue = job.then(() => {}, () => {});
  return job;
}

/** The track's line from above, on a dark square (no WebGL) */
function outline(track: TrackData, px: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#1a1d22';
  g.fillRect(0, 0, px, px);
  const b = track.bounds;
  const pad = px * 0.1;
  const k = (px - pad * 2) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const ox = pad + ((px - pad * 2) - (b.maxX - b.minX) * k) / 2;
  const oz = pad + ((px - pad * 2) - (b.maxZ - b.minZ) * k) / 2;
  g.beginPath();
  for (let i = 0; i <= track.n; i += 2) {
    const j = i % track.n;
    const x = ox + ((track.pos[j * 3] as number) - b.minX) * k;
    const z = oz + ((track.pos[j * 3 + 2] as number) - b.minZ) * k;
    if (i === 0) g.moveTo(x, z);
    else g.lineTo(x, z);
  }
  g.closePath();
  g.strokeStyle = '#d9dde4';
  g.lineWidth = px / 26;
  g.stroke();
  return c.toDataURL('image/png');
}

/** A track in 3D, small and still: room cards and the launch card */
export function TrackThumb({ spec, size = 64 }: { spec: TrackSpec | null; size?: number }) {
  const track = useTrack(spec);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!track) return;
    let live = true;
    thumbnail(track, size).then((u) => { if (live) setUrl(u); }, () => {});
    return () => { live = false; };
  }, [track, size]);
  if (!url) return <span className="track-thumb loading" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img className="track-thumb" src={url} width={size} height={size} alt="" aria-hidden="true" />;
}
