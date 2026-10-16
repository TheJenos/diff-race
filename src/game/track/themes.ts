import type { ThemeId } from './spec';

/*
 * How each theme looks: the Death Race circuits are industrial ruins, each with its own light.
 * Pure data (colours as 0xRRGGBB numbers), shared by the renderer and the lobby previews.
 */

export interface ThemePalette {
  name: string;
  /** Sky gradient: overhead and at the horizon */
  skyTop: number;
  skyHorizon: number;
  fog: number;
  /** Fog end distance on high quality (m); lower tiers shorten it */
  fogFar: number;
  sun: number;
  sunIntensity: number;
  /** Direction the sunlight comes from (toward the sun), roughly normalised */
  sunDir: { x: number; y: number; z: number };
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Tints over the neutral procedural textures */
  road: number;
  verge: number;
  ground: number;
  barrier: number;
  /** Hazard stripes along the barrier tops */
  stripe: number;
  /** Night: floodlights and glowing fires matter */
  night: boolean;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  docks: {
    name: 'Terminal Docks',
    skyTop: 0x3d4a5a, skyHorizon: 0xc39a72, fog: 0x8f8476, fogFar: 520,
    sun: 0xffd2a0, sunIntensity: 2.4, sunDir: { x: -0.55, y: 0.42, z: -0.72 },
    hemiSky: 0xb4c4d8, hemiGround: 0x5a4c3c, hemiIntensity: 1.7,
    road: 0x6e6e70, verge: 0x8a7a64, ground: 0x6b6152, barrier: 0xb8b4ab, stripe: 0xf2b21b,
    night: false,
  },
  quarry: {
    name: 'Red Quarry',
    skyTop: 0x5f8dc0, skyHorizon: 0xe9d1a6, fog: 0xd3bf98, fogFar: 640,
    sun: 0xfff1d8, sunIntensity: 3.0, sunDir: { x: 0.4, y: 0.75, z: -0.5 },
    hemiSky: 0xbcd4f0, hemiGround: 0x8a5a3a, hemiIntensity: 1.6,
    road: 0x7a7066, verge: 0xb07a52, ground: 0xa66f48, barrier: 0xc9c0b0, stripe: 0xe0451f,
    night: false,
  },
  foundry: {
    name: 'Black Foundry',
    skyTop: 0x07080d, skyHorizon: 0x3b2018, fog: 0x1e140f, fogFar: 380,
    sun: 0x9fb4ff, sunIntensity: 0.9, sunDir: { x: 0.3, y: 0.6, z: 0.7 },
    hemiSky: 0x4a5478, hemiGround: 0x3a1c0c, hemiIntensity: 1.1,
    road: 0x5a5a5e, verge: 0x4a3a30, ground: 0x2e241e, barrier: 0x8d8a85, stripe: 0xff8a1a,
    night: true,
  },
};
