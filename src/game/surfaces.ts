import * as THREE from 'three';
import { MEAN, noiseTexture, type TextureName } from './textures';
import { settings } from './settings';

/*
 * Photo-scanned surfaces (Poly Haven's, CC0), built into public/textures/ by
 * scripts/build-textures.mjs: for the road, the verge, the ground, the concrete and the metal, a
 * colour map, a normal map (the grit, cracks and seams catch the light) and an ARM map (occlusion
 * in red, roughness in green). Loaded once, before the first race, with the kit models.
 *
 * Each is tinted so its average comes out the colour the procedural texture it stands in for
 * would give: the themes keep their palettes. Where they aren't there, don't load, or the
 * quality is low (they take video memory a phone may not have), the procedural textures in
 * textures.ts are drawn instead. The e2e tests skip them, as they skip the menu backdrop.
 */

export type SurfaceName = Extract<TextureName, 'asphalt' | 'gravel' | 'ground' | 'concrete' | 'metal'>;

interface Surface {
  color: THREE.Texture;
  normal: THREE.Texture;
  arm: THREE.Texture;
  /** Metres one repeat covers */
  metres: number;
  /** Average colour of the colour map (linear) */
  mean: THREE.Color;
}

interface ManifestSet {
  metres: number;
  mean: [number, number, number];
  color: string;
  normal: string;
  arm: string;
}

const E2E = import.meta.env.VITE_E2E === 'true';
/**
 * How strongly each surface's normal map tilts the light, and how much its occlusion shades it:
 * the aerial ground's relief is metres across and its occlusion heavy, so both are kept soft.
 */
const RELIEF: Record<SurfaceName, number> = { asphalt: 1, gravel: 1, ground: 0.45, concrete: 1, metal: 1 };
const OCCLUSION: Record<SurfaceName, number> = { asphalt: 0.8, gravel: 0.8, ground: 0.35, concrete: 0.8, metal: 0.8 };
const loaded = new Map<SurfaceName, Surface>();
/** Copies of the maps at other repeats (they share the image, and the GPU texture) */
const repeats = new Map<string, THREE.Texture>();
let loading: Promise<void> | null = null;

/** Load the photo surfaces, once; resolves (never rejects) when they're in, or known not to be there */
export function loadSurfaces(): Promise<void> {
  if (E2E || settings.get().quality === 'low') return Promise.resolve();
  loading ??= load().catch((err: unknown) => {
    loaded.clear();
    console.warn('Photo textures not loaded, using the procedural ones', err);
  });
  return loading;
}

/** Whether `name` is drawn from its photo surface (loaded, and the quality's above low) */
export function hasSurface(name: SurfaceName): boolean {
  return settings.get().quality !== 'low' && loaded.has(name);
}

/**
 * Material settings for the photo surface `name` on geometry whose UVs advance one unit every
 * `tileU` × `tileV` metres, tinted as the procedural texture tinted `color` would look; null when
 * it isn't loaded.
 */
export function surfaceParams(name: SurfaceName, color: number, tileU: number, tileV = tileU): THREE.MeshStandardMaterialParameters | null {
  const s = hasSurface(name) ? loaded.get(name)! : null;
  if (!s) return null;
  const tint = new THREE.Color(color).multiplyScalar(MEAN[name]);
  tint.setRGB(tint.r / s.mean.r, tint.g / s.mean.g, tint.b / s.mean.b);
  return {
    color: tint,
    map: repeated(s, 'color', tileU, tileV),
    ...surfaceDetail(name, tileU, tileV),
  };
}

/** Just the surface's relief and roughness (no colour), for paint and decals laid over it; empty when it isn't loaded */
export function surfaceDetail(name: SurfaceName, tileU: number, tileV = tileU): THREE.MeshStandardMaterialParameters {
  const s = hasSurface(name) ? loaded.get(name)! : null;
  if (!s) return {};
  const arm = repeated(s, 'arm', tileU, tileV);
  return {
    normalMap: repeated(s, 'normal', tileU, tileV),
    normalScale: new THREE.Vector2(RELIEF[name], RELIEF[name]),
    roughnessMap: arm,
    roughness: 1,
    aoMap: arm,
    aoMapIntensity: OCCLUSION[name],
  };
}

/**
 * Break up a surface's repeats, so a long straight or a big field of ground doesn't show a grid of
 * the same tile. A slow noise is cut into bands; each band shows the map shifted by its own
 * offset, and neighbouring bands blend at their edges (Inigo Quilez's "texture repetition"), so no
 * two patches line up. The noise's period, `every` repeats of the map, isn't a whole number, so
 * the pattern as a whole never repeats either; the same noise also darkens and lightens it a
 * little. The normal and ARM maps take the same offsets, so the relief stays on its colours (their
 * UVs match the colour map's: surfaceParams repeats them alike).
 */
export function breakUpTiling(m: THREE.MeshStandardMaterial, every: number): THREE.MeshStandardMaterial {
  if (!m.map) return m;
  const macro = noiseTexture();
  const offset = (tex: string, uv: string) =>
    `mix(textureGrad(${tex}, ${uv} + untileA, untileDx, untileDy), textureGrad(${tex}, ${uv} + untileB, untileDx, untileDy), untileT)`;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macro };
    shader.uniforms.macroScale = { value: 1 / every };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;\nuniform float macroScale;')
      .replace('#include <map_fragment>', `
        float untileK = texture2D(macroMap, vMapUv * macroScale).r;
        float untileTone = texture2D(macroMap, vMapUv * macroScale * 0.37 + 0.5).r;
        vec2 untileDx = dFdx(vMapUv);
        vec2 untileDy = dFdy(vMapUv);
        float untileL = untileK * 8.0;
        float untileI = floor(untileL);
        vec2 untileA = sin(vec2(3.0, 7.0) * untileI);
        vec2 untileB = sin(vec2(3.0, 7.0) * (untileI + 1.0));
        vec4 untileCa = textureGrad(map, vMapUv + untileA, untileDx, untileDy);
        vec4 untileCb = textureGrad(map, vMapUv + untileB, untileDx, untileDy);
        float untileT = smoothstep(0.2, 0.8, fract(untileL) - 0.1 * dot(untileCa.rgb - untileCb.rgb, vec3(1.0)));
        diffuseColor *= mix(untileCa, untileCb, untileT);
        diffuseColor.rgb *= mix(0.86, 1.12, untileK * 0.4 + untileTone * 0.6);
      `)
      // Three expands its chunks after this, so the ones to change are put in already expanded.
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', offset('normalMap', 'vNormalMapUv')))
      .replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replaceAll('texture2D( roughnessMap, vRoughnessMapUv )', offset('roughnessMap', 'vRoughnessMapUv')))
      .replace('#include <aomap_fragment>', THREE.ShaderChunk.aomap_fragment.replaceAll('texture2D( aoMap, vAoMapUv )', offset('aoMap', 'vAoMapUv')));
  };
  m.customProgramCacheKey = () => 'diffrace-untile';
  return m;
}

function repeated(s: Surface, map: 'color' | 'normal' | 'arm', tileU: number, tileV: number): THREE.Texture {
  const u = tileU / s.metres;
  const v = tileV / s.metres;
  const key = `${s.color.uuid}:${map}:${u.toFixed(4)}:${v.toFixed(4)}`;
  let t = repeats.get(key);
  if (!t) {
    t = s[map].clone();
    t.repeat.set(u, v);
    repeats.set(key, t);
  }
  return t;
}

async function load(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}textures/`;
  const res = await fetch(`${base}manifest.json`);
  // A dev server answers a missing file with the page itself: only JSON counts.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
  const manifest = (await res.json()) as { sets?: Partial<Record<SurfaceName, ManifestSet>> };
  const loader = new THREE.TextureLoader();
  const get = async (file: string, srgb: boolean) => {
    const t = await loader.loadAsync(`${base}${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  await Promise.all(Object.entries(manifest.sets ?? {}).map(async ([name, set]) => {
    const [color, normal, arm] = await Promise.all([get(set.color, true), get(set.normal, false), get(set.arm, false)]);
    loaded.set(name as SurfaceName, { color, normal, arm, metres: set.metres, mean: new THREE.Color().setRGB(...set.mean) });
  }));
}
