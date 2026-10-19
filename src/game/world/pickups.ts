import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { placeOnTrack } from '../race/placement';
import type { PadKind, TrackData } from '../track/types';

/*
 * The pads as pickups you can see coming, the way Arena FPS shows its abilities: over each pad a
 * glowing ring on the road and a beam of light, and above them the pickup itself, hovering,
 * bobbing and turning (a machine gun, a missile, a shield, a skull). Drive through it to take it.
 * Each pad works for each car on its own cooldown (combat.ts): while it's charging for the
 * player, its pickup is gone from view and its ring dims, and it fades back in when it's ready.
 *
 * One instanced mesh per kind for the pickups, one for the rings and one for the beams: twelve
 * draw calls however many pads a track has.
 */

const KINDS: readonly PadKind[] = ['gun', 'sword', 'shield', 'skull'];
export const PAD_COLOR: Record<PadKind, number> = { gun: 0xffb020, sword: 0xff3a20, shield: 0x2a7bff, skull: 0x9cff3a };

/** How high the pickup floats (m), how far it bobs, how fast it turns (rad/s), and how long it takes to come back (s) */
const HOVER = 2.4;
const BOB = 0.22;
/** The pickups are drawn this much bigger than their shapes (about 1.8 m across) */
const ICON_SCALE = 1.5;
const SPIN = 1.6;
const FADE_IN = 0.35;

/** A part of a pickup in one colour, ready to merge with the others */
function part(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** The pickup's shape, about a metre and a bit across, centred on its middle */
function pickupGeometry(kind: PadKind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'gun') {
    // A twin machine gun with an ammo drum, lying level.
    parts.push(part(new THREE.BoxGeometry(0.55, 0.42, 0.9).translate(0, 0, 0.1), 0xffb020));
    for (const x of [-0.13, 0.13]) parts.push(part(new THREE.CylinderGeometry(0.075, 0.075, 1.0, 10).rotateX(Math.PI / 2).translate(x, 0.05, -0.8), 0x5a4a38));
    parts.push(part(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16).rotateZ(Math.PI / 2).translate(0.4, -0.04, 0.15), 0xffd070));
    parts.push(part(new THREE.BoxGeometry(0.12, 0.3, 0.3).translate(0, -0.3, 0.3), 0x5a4a38));
  } else if (kind === 'sword') {
    // A missile, nose up and leaning.
    const missile = [
      part(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 14), 0xff4a2a),
      part(new THREE.ConeGeometry(0.16, 0.4, 14).translate(0, 0.75, 0), 0xffd2c4),
      part(new THREE.CylinderGeometry(0.12, 0.14, 0.1, 12).translate(0, -0.6, 0), 0x3a1a14),
      ...[0, 1, 2, 3].map((k) => part(new THREE.BoxGeometry(0.03, 0.3, 0.26).translate(0, -0.42, 0.24).rotateY((k * Math.PI) / 2), 0x8a1c10)),
    ];
    parts.push(...missile.map((g) => g.rotateZ(0.6)));
  } else if (kind === 'shield') {
    // A heater shield with a cross on its face.
    const s = new THREE.Shape();
    s.moveTo(-0.46, 0.5);
    s.lineTo(0.46, 0.5);
    s.lineTo(0.46, 0.05);
    s.quadraticCurveTo(0.44, -0.4, 0, -0.62);
    s.quadraticCurveTo(-0.44, -0.4, -0.46, 0.05);
    s.closePath();
    const body = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 10 });
    body.translate(0, 0, -0.06);
    parts.push(part(body, 0x2a7bff));
    parts.push(part(new THREE.BoxGeometry(0.13, 0.7, 0.06).translate(0, -0.02, 0.12), 0xe8f0ff));
    parts.push(part(new THREE.BoxGeometry(0.55, 0.13, 0.06).translate(0, 0.14, 0.12), 0xe8f0ff));
  } else {
    // A skull: dome, jaw, dark eyes and nose.
    parts.push(part(new THREE.SphereGeometry(0.42, 18, 14).scale(1, 0.95, 0.95).translate(0, 0.12, 0), 0x9cff3a));
    parts.push(part(new THREE.BoxGeometry(0.46, 0.24, 0.34).translate(0, -0.3, 0.06), 0x86e02c));
    for (const x of [-0.15, 0.15]) parts.push(part(new THREE.SphereGeometry(0.11, 10, 8).translate(x, 0.1, 0.34), 0x0c1408));
    parts.push(part(new THREE.ConeGeometry(0.06, 0.12, 3).rotateX(Math.PI).translate(0, -0.08, 0.4), 0x0c1408));
  }
  return mergeGeometries(parts);
}

/** The ring on the road (bright edge, faint middle), flat in the pad's own plane */
function ringGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    part(new THREE.RingGeometry(1.5, 1.85, 48).rotateX(-Math.PI / 2), 0xffffff),
    part(new THREE.CircleGeometry(1.5, 48).rotateX(-Math.PI / 2), 0x303030),
  ]);
}

/** The beam: bright at the road, gone by the top (additive, so black is nothing) */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.04, 0.14, 9, 8, 1, true).translate(0, 4.5, 0);
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - pos.getY(i) / 9;
    colors.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

interface KindView {
  pads: { index: number; base: THREE.Matrix4; phase: number }[];
  icon: THREE.InstancedMesh;
  ring: THREE.InstancedMesh;
  beam: THREE.InstancedMesh;
}

export class PadPickups {
  readonly group = new THREE.Group();
  private readonly kinds: KindView[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly lift = new THREE.Matrix4();
  private readonly turn = new THREE.Matrix4();
  private readonly size = new THREE.Matrix4();
  private readonly tint = new THREE.Color();

  constructor(track: TrackData) {
    this.group.name = 'pickups';
    const ring = ringGeometry();
    const beam = beamGeometry();
    this.disposables.push(ring, beam);
    const pos = { x: 0, y: 0, z: 0 };
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    for (const kind of KINDS) {
      const pads = track.pads.flatMap((p, index) => {
        if (p.kind !== kind) return [];
        placeOnTrack(track, p.s, p.u, pos, rot, 0.06);
        const base = new THREE.Matrix4().compose(new THREE.Vector3(pos.x, pos.y, pos.z), new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w), new THREE.Vector3(1, 1, 1));
        return [{ index, base, phase: index * 1.37 }];
      });
      if (!pads.length) continue;
      const color = PAD_COLOR[kind];
      const geo = pickupGeometry(kind);
      const iconMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: color, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.25 });
      const glow = { color, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true } as const;
      const ringMat = new THREE.MeshBasicMaterial({ ...glow, opacity: 0.85, side: THREE.DoubleSide });
      const beamMat = new THREE.MeshBasicMaterial({ ...glow, opacity: 0.22, side: THREE.DoubleSide });
      this.disposables.push(geo, iconMat, ringMat, beamMat);
      const make = (g: THREE.BufferGeometry, mat: THREE.Material) => {
        const inst = new THREE.InstancedMesh(g, mat, pads.length);
        inst.frustumCulled = false;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(inst);
        return inst;
      };
      const view: KindView = { pads, icon: make(geo, iconMat), ring: make(ring, ringMat), beam: make(beam, beamMat) };
      pads.forEach((p, i) => {
        view.ring.setMatrixAt(i, p.base);
        view.ring.setColorAt(i, this.tint.setRGB(1, 1, 1));
      });
      this.kinds.push(view);
    }
    this.update(0, null);
  }

  /**
   * Turn and bob the pickups. `cooldowns`: the player's (pad index → when it works again, s on the
   * same clock as `now`); a pad charging for them is hidden, and fades back in when it's ready.
   */
  update(now: number, cooldowns: ReadonlyMap<number, number> | null): void {
    for (const k of this.kinds) {
      k.pads.forEach((p, i) => {
        const until = cooldowns?.get(p.index);
        const shown = until === undefined ? 1 : Math.max(0, Math.min(1, (now - until) / FADE_IN));
        const s = Math.max(0.0001, shown) * ICON_SCALE;
        this.lift.makeTranslation(0, HOVER + Math.sin(now * 2 + p.phase) * BOB, 0);
        this.turn.makeRotationY(now * SPIN + p.phase);
        this.size.makeScale(s, s, s);
        k.icon.setMatrixAt(i, this.m.copy(p.base).multiply(this.lift).multiply(this.turn).multiply(this.size));
        this.size.makeScale(1, Math.max(0.0001, shown), 1);
        k.beam.setMatrixAt(i, this.m.copy(p.base).multiply(this.size));
        const glow = 0.3 + 0.7 * shown;
        k.ring.setColorAt(i, this.tint.setRGB(glow, glow, glow));
      });
      k.icon.instanceMatrix.needsUpdate = true;
      k.beam.instanceMatrix.needsUpdate = true;
      if (k.ring.instanceColor) k.ring.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const k of this.kinds) for (const inst of [k.icon, k.ring, k.beam]) inst.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
