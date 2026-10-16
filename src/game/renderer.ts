import * as THREE from 'three';
import type { Quality } from './settings';

/*
 * The WebGL renderer and what each quality tier asks of it. MSAA can't change on a live renderer,
 * so a change of tier toggles it from the next race; the rest (resolution, shadows) applies live.
 */

/** Highest pixel ratio per tier (phones at 3x would draw nine times the pixels for little gain) */
export const PIXEL_RATIO: Record<Quality, number> = { low: 1, medium: 1.5, high: 1.5 };

export function createRenderer(quality: Quality): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[quality]));
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.domElement.id = 'game-canvas';
  return renderer;
}

export function applyQuality(renderer: THREE.WebGLRenderer, quality: Quality): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[quality]));
  renderer.shadowMap.enabled = quality !== 'low';
}
