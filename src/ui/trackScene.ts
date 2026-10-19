import * as THREE from 'three';
import type { TrackData } from '../game/track/types';
import { THEMES } from '../game/track/themes';
import { buildTrackMesh } from '../game/world/trackMesh';
import { buildScenery } from '../game/world/sceneryMesh';
import { Environment } from '../game/world/environment';
import { placeOnTrack } from '../game/race/placement';

/*
 * A track as the menus show it from above (the big preview and the thumbnails): the real thing,
 * as it's drawn in the race (road, kerbs, barriers, pads, the ground, the scenery, the theme's
 * light and sky), with the fog pushed back for a view from outside, and markers standing up over
 * the start and the pads so they read from up there. The camera orbits its middle.
 */

/** At night the lights are on: this many floodlights lit (spread round the loop), and a moon over it all */
const FLOODLIGHTS = 8;

/** Marker colours: the start, gun pads, sword pads, shield pads, skull traps, ramps */
const MARK = { start: 0xffffff, gun: 0xffb020, sword: 0xff3a20, shield: 0x2a7bff, skull: 0x9cff3a, ramp: 0xff9a1a };

export interface TrackScene {
  scene: THREE.Scene;
  /** The middle of the track, and how far its far corners reach from it (m) */
  centre: THREE.Vector3;
  radius: number;
  /** Put the camera `yaw` round, `pitch` up (rad), `zoom` × the distance that frames the track, looking at the middle */
  aim(camera: THREE.PerspectiveCamera, yaw: number, pitch: number, zoom?: number): void;
  dispose(): void;
}

export function buildTrackScene(track: TrackData, opts: { scenery: 'low' | 'medium' | null; markers: boolean }): TrackScene {
  const scene = new THREE.Scene();
  const palette = THEMES[track.theme];
  const env = new Environment(scene, palette, 'low');
  env.sun.castShadow = false;
  const road = buildTrackMesh(track, false);
  scene.add(road.group);
  const scenery = opts.scenery ? buildScenery(track, opts.scenery, false) : null;
  if (scenery) scene.add(scenery.group);

  const b = track.bounds;
  const centre = new THREE.Vector3((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2);
  const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5 + track.verge + 20;

  const disposables: { dispose(): void }[] = [];
  // A night track, seen from up here, is lit the way the race lights it near the car: the
  // floodlights on (a warm pool under each), and moonlight and a fill so the whole loop reads.
  if (palette.night) {
    const moon = new THREE.DirectionalLight(0xb8c6ff, 1.8);
    moon.position.set(centre.x + radius * 0.4, centre.y + radius, centre.z + radius * 0.6);
    moon.target.position.copy(centre);
    const fill = new THREE.HemisphereLight(0x6a78a8, 0x2a1a10, 1.3);
    scene.add(moon, moon.target, fill);
    disposables.push(moon, fill);
    // The floodlights' heads, as the scenery stands them (sceneryMesh.ts): 12.5 m up, leaning to the road.
    const heads = track.scenery.filter((p) => p.kind === 'floodlight');
    const lit = Math.min(FLOODLIGHTS, heads.length);
    for (let i = 0; i < lit; i++) {
      const h = heads[Math.floor((i * heads.length) / lit)]!;
      const l = new THREE.PointLight(0xffd9a0, 2200, 130, 1.4);
      l.position.set(h.x + h.fx * 0.6, h.y + 11.5, h.z + h.fz * 0.6);
      scene.add(l);
      disposables.push(l);
    }
  }

  // Markers: a glowing post over each pad and ramp, a taller one over the start line.
  if (opts.markers) {
    const posts = new THREE.Group();
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const scale = radius / 300;
    const post = (s: number, u: number, color: number, height: number) => {
      const geo = new THREE.CylinderGeometry(1.4 * scale, 1.4 * scale, height * scale, 8).translate(0, (height * scale) / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color, fog: false });
      disposables.push(geo, mat);
      placeOnTrack(track, s, u, pos, rot, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(pos.x, pos.y, pos.z);
      posts.add(m);
    };
    post(0, 0, MARK.start, 36);
    for (const p of track.pads) post(p.s, p.u, MARK[p.kind], 18);
    for (const r of track.ramps) post(r.s, (r.u0 + r.u1) / 2, MARK.ramp, 22);
    scene.add(posts);
  }

  const look = new THREE.Vector3();
  const fog = new THREE.Fog(palette.fog, 1, 2);
  return {
    scene,
    centre,
    radius,
    aim(camera, yaw, pitch, zoom = 1) {
      // Far enough that the whole loop fits the narrower side of the view.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const fit = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
      const dist = (radius / Math.sin(fit)) * 0.74 * zoom;
      camera.position.set(
        centre.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        centre.y + Math.sin(pitch) * dist,
        centre.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      look.copy(centre);
      camera.lookAt(look);
      camera.far = dist * 4;
      camera.updateProjectionMatrix();
      // Seen from outside: the fog only softens the far edge.
      fog.near = dist * 0.9;
      fog.far = dist * 2.6;
      scene.fog = fog;
      env.follow(centre, camera);
    },
    dispose() {
      road.dispose();
      scenery?.dispose();
      env.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

/** The game's look: tone mapped as the race is (renderer.ts) */
export function styleRenderer(r: THREE.WebGLRenderer): void {
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.4;
  r.shadowMap.enabled = false;
}
