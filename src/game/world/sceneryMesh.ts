import * as THREE from 'three';
import { CONTAINER_COLORS, propGeometry } from './props';
import type { Quality } from '../settings';
import type { SceneryItem, TrackData } from '../track/types';

/*
 * The track's scenery, instanced: one InstancedMesh per prop kind per group of track chunks (so
 * the far side of the circuit is culled), plus one for the kind's glowing parts. Lower quality
 * tiers keep only part of the scatter; floodlights, tyre walls and the grandstand always stay.
 */

/** Track chunks per scenery group: fewer, bigger instanced meshes */
const CHUNKS_PER_GROUP = 4;
const KEEP: Record<Quality, number> = { low: 0.35, medium: 0.7, high: 1 };
const ALWAYS = new Set(['floodlight', 'tyres', 'grandstand']);

export interface SceneryMesh {
  group: THREE.Group;
  /** Floodlight head positions, for the night lights */
  floodlights: THREE.Vector3[];
  dispose(): void;
}

/** A stable 0..1 number from a prop's position, for thinning and tinting the same way every time */
const hash01 = (s: SceneryItem) => {
  let h = Math.imul(Math.round(s.x * 10) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(s.z * 10), 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) % 10_000) / 10_000;
};

export function buildScenery(t: TrackData, quality: Quality, shadows: boolean): SceneryMesh {
  const group = new THREE.Group();
  group.name = 'scenery';
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.15 });
  const glow = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 1 });
  // Emissive takes the vertex colour: three multiplies emissive by the diffuse map only, so tint it per vertex instead.
  glow.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
  };
  const buckets = new Map<string, SceneryItem[]>();
  const floodlights: THREE.Vector3[] = [];
  for (const s of t.scenery) {
    if (s.kind === 'floodlight') {
      // The head is 12.5 m up, leaning toward the road.
      floodlights.push(new THREE.Vector3(s.x + s.fx * 0.6, s.y + 12.5, s.z + s.fz * 0.6));
    }
    if (!ALWAYS.has(s.kind) && hash01(s) > KEEP[quality]) continue;
    const key = `${s.kind}|${Math.floor(s.chunk / CHUNKS_PER_GROUP)}`;
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const meshes: THREE.InstancedMesh[] = [];
  for (const [key, items] of buckets) {
    const kind = key.split('|')[0] as string;
    const geo = propGeometry(kind);
    const parts: [THREE.BufferGeometry, THREE.Material][] = [[geo.body, body]];
    if (geo.glow) parts.push([geo.glow, glow]);
    for (const [g, mat] of parts) {
      const inst = new THREE.InstancedMesh(g, mat, items.length);
      items.forEach((s, i) => {
        q.setFromAxisAngle(up, Math.atan2(-s.fx, -s.fz));
        m.compose(v.set(s.x, s.y, s.z), q, scale.setScalar(s.scale));
        inst.setMatrixAt(i, m);
        if (geo.tinted) inst.setColorAt(i, color.setHex(CONTAINER_COLORS[Math.floor(hash01(s) * 997) % CONTAINER_COLORS.length] as number));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = shadows && mat === body;
      inst.receiveShadow = mat === body;
      inst.matrixAutoUpdate = false;
      group.add(inst);
      meshes.push(inst);
    }
  }
  return {
    group,
    floodlights,
    dispose() {
      for (const inst of meshes) inst.dispose();
      body.dispose();
      glow.dispose();
    },
  };
}

/**
 * At night, a few real lights follow the camera from floodlight to floodlight: the nearest
 * `count` heads each get a point light (a fixed number, so shaders never recompile).
 */
export class NightLights {
  private readonly lights: THREE.PointLight[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly heads: readonly THREE.Vector3[], count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffe2b8, 900, 70, 1.6);
      l.position.set(0, -1000, 0);
      scene.add(l);
      this.lights.push(l);
    }
  }

  update(focus: THREE.Vector3): void {
    if (!this.heads.length) return;
    const near = [...this.heads].sort((a, b) => a.distanceToSquared(focus) - b.distanceToSquared(focus));
    this.lights.forEach((l, i) => {
      const h = near[i];
      if (h) l.position.set(h.x, h.y - 1, h.z);
    });
  }

  dispose(): void {
    for (const l of this.lights) {
      this.scene.remove(l);
      l.dispose();
    }
  }
}
