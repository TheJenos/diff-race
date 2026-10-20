import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { texture, TILE } from '../textures';
import { surfaceParams } from '../surfaces';
import { CAR, type CarParams } from './params';
import type { WheelState } from './carBody';
import type { Zone } from './damage';
import { dentSize, dentVertices, landing, renormal, type Bounds, type Dent } from './deform';
import { carModelFor, realCarMaterials, type CarModel } from '../models';
import { skyReflection } from '../world/sky';
import type { ThemePalette } from '../track/themes';

/*
 * The procedural armoured muscle car: a body extruded from a side profile, a dark glass
 * greenhouse with a roof slab, a window grille,
 * a spoiler, lights, a roof turret and four wheels. Geometry is shared between all cars;
 * materials are per paint colour. A kit model (models.ts) can stand in for the body and wheels;
 * the realistic one keeps its own materials, in a clear-coated paint that reflects the sky.
 *
 * Car space as in params.ts: forward -z, right +x, up +y, origin at the chassis centre.
 */

/** Side profile of the body below the windows, as (forward, up) points from the rear bumper round the nose */
const BODY_PROFILE: readonly [number, number][] = [
  [-2.25, -0.3], [-2.25, 0.18], [-1.7, 0.31], [1.2, 0.34], [2.0, 0.27], [2.25, 0.12], [2.25, -0.22], [2.0, -0.3],
];
const BODY_WIDTH = 1.86;
const GLASS_PROFILE: readonly [number, number][] = [[-1.45, 0.31], [-0.55, 0.86], [0.4, 0.86], [1.1, 0.34]];
const GLASS_WIDTH = 1.5;

/** A profile in (forward, up) extruded `width` across and centred, as car-space geometry */
function extrude(profile: readonly [number, number][], width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([f, u]) => new THREE.Vector2(f, u)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1,
  });
  // Shape x is forward (-z), the extrusion runs across (x).
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

let shared: ReturnType<typeof buildShared> | null = null;
let flameGeo: THREE.BufferGeometry | null = null;
let flameMat: THREE.MeshBasicMaterial | null = null;

/** A cone pointing backward (+z) from the exhaust tip */
function flameGeometry(): THREE.BufferGeometry {
  flameGeo ??= new THREE.ConeGeometry(0.09, 0.8, 8).rotateX(Math.PI / 2).translate(0, 0, 0.4);
  return flameGeo;
}

function flameMaterial(): THREE.MeshBasicMaterial {
  flameMat ??= new THREE.MeshBasicMaterial({ color: 0x6fc8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  return flameMat;
}

/** Copies of `geo` moved (and turned about x) into place, merged into one geometry */
function placed(geo: THREE.BufferGeometry, at: readonly (readonly [number, number, number, number?, number?])[]): THREE.BufferGeometry {
  return mergeGeometries(at.map(([x, y, z, rx = 0, sz = 1]) => {
    const g = geo.clone();
    g.scale(1, 1, sz);
    g.rotateX(rx);
    g.translate(x, y, z);
    return g;
  }));
}

/** Vertex colours over a whole geometry (for parts merged across materials) */
function tinted(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/*
 * Every part that never moves on its own is merged per material, so a car is about a dozen draw
 * calls rather than forty. Parts that do move or come off (the body, which dents; the wing; the
 * turret; the wheels) stay their own meshes.
 */
function buildShared() {
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  // Armour: UVs in metres (one unit per TILE.metal) on every face, so the plate's tread keeps its size.
  const plate = (w: number, h: number, d: number) => {
    const g = box(w, h, d);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] as const;
    faces.forEach(([a, b], f) => {
      for (let k = f * 4; k < f * 4 + 4; k++) uv.setXY(k, (uv.getX(k) * a) / TILE.metal, (uv.getY(k) * b) / TILE.metal);
    });
    return g;
  };
  const tire = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.34, 20).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(CAR.wheelRadius * 0.6, CAR.wheelRadius * 0.6, 0.36, 10).rotateZ(Math.PI / 2);
  const wheel = mergeGeometries([tinted(tire, 0x141414), tinted(rim, 0xb8bcc2)]);
  const barrel = new THREE.CylinderGeometry(0.045, 0.05, 0.9, 8).rotateX(Math.PI / 2);
  const exhaust = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8).rotateX(Math.PI / 2);
  const stripe = box(0.34, 0.012, 1);
  const post = box(0.06, 0.24, 0.08);
  return {
    body: extrude(BODY_PROFILE, BODY_WIDTH, 0.05),
    glass: extrude(GLASS_PROFILE, GLASS_WIDTH, 0),
    roof: box(GLASS_WIDTH + 0.04, 0.06, 0.98).translate(0, 0.89, 0.075),
    stripes: placed(stripe, [[-0.22, 0.345, -1.6, 0, 0.75], [0.22, 0.345, -1.6, 0, 0.75], [-0.22, 0.925, 0.075], [0.22, 0.925, 0.075]]),
    grille: placed(box(1.2, 0.04, 0.04), [0, 1, 2].map((k) => [0, 0.42 + k * 0.13, -1.12 + k * 0.17, -0.65] as const)),
    wing: mergeGeometries([box(1.76, 0.05, 0.36).translate(0, 0.56, 2.02), post.clone().translate(-0.6, 0.42, 2.02), post.clone().translate(0.6, 0.42, 2.02)]),
    heads: placed(box(0.36, 0.12, 0.04), [[-0.62, 0.04, -2.26], [0.62, 0.04, -2.26]]),
    tails: placed(box(0.5, 0.1, 0.04), [[-0.62, 0.12, 2.26], [0.62, 0.12, 2.26]]),
    exhausts: placed(exhaust, [[-0.98, -0.27, 0.2], [0.98, -0.27, 0.2]]),
    wheel,
    // All four at rest, in one piece: what a car far away rolls on.
    farWheels: placed(wheel, CAR.wheels.map((w) => [w.x, w.y - CAR.restLength * 0.5, w.z] as const)),
    turretBase: new THREE.CylinderGeometry(0.34, 0.4, 0.16, 12).translate(0, 0.08, 0),
    turretBody: plate(0.5, 0.26, 0.62),
    barrels: placed(barrel, [[-0.12, 0.02, -0.66], [0.12, 0.02, -0.66]]),
    // Five cones pointing forward out of the nose.
    spikes: placed(new THREE.ConeGeometry(0.07, 0.42, 6).rotateX(-Math.PI / 2), [-0.8, -0.4, 0, 0.4, 0.8].map((x) => [x, 0, -0.18] as const)),
  };
}

const paints = new Map<number, THREE.MeshStandardMaterial>();
const realPaints = new Map<number, THREE.MeshPhysicalMaterial>();
/** What the realistic car reflects: the race's sky */
let sky: THREE.Texture | null = null;

/** The realistic car's paint in `color`: clear-coated metallic, with the model's flakes (its normal map) */
function realPaint(color: number, model: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  let m = realPaints.get(color);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06,
      normalMap: model.normalMap, normalScale: model.normalScale, aoMap: model.aoMap, envMap: sky, envMapIntensity: 0.9,
    });
    realPaints.set(color, m);
  }
  return m;
}

/**
 * The realistic car reflects this theme's sky from now on (its paint, glass and chrome; its rough
 * parts take a little of it, as light from all round)
 */
export function useReflections(palette: ThemePalette): void {
  sky = skyReflection(palette);
  for (const m of realPaints.values()) {
    m.envMap = sky;
    m.needsUpdate = true;
  }
  for (const m of realCarMaterials()) {
    m.envMap = sky;
    m.envMapIntensity = m.metalness > 0.5 || m.roughness < 0.4 ? 1 : 0.35;
    m.needsUpdate = true;
  }
}
const outlines = new Map<number, THREE.MeshBasicMaterial>();

function outlineMaterial(color: number): THREE.MeshBasicMaterial {
  let m = outlines.get(color);
  if (!m) {
    // Brightened a little so dark stripes still read; inside out, so only the rim shows past the body.
    const c = new THREE.Color(color);
    c.lerp(new THREE.Color(0xffffff), 0.25);
    m = new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide, fog: false });
    outlines.set(color, m);
  }
  return m;
}
let fixedMats: Record<'glass' | 'armour' | 'dark' | 'wheel' | 'chrome' | 'head' | 'tail' | 'trim', THREE.MeshStandardMaterial> | null = null;

function paint(color: number): THREE.MeshStandardMaterial {
  let m = paints.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 });
    paints.set(color, m);
  }
  return m;
}

function mats() {
  fixedMats ??= {
    glass: new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.15, metalness: 0.6 }),
    // Tread plate, photo-scanned where it's loaded (surfaces.ts).
    armour: new THREE.MeshStandardMaterial({ metalness: 0.6, ...(surfaceParams('metal', 0x5b5d61, TILE.metal) ?? { color: 0x5b5d61, map: texture('metal'), roughness: 0.6, metalness: 0.7 }) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.7, metalness: 0.4 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.35 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.25, metalness: 0.9 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff0c8, emissiveIntensity: 1.6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 1.2 }),
  };
  return fixedMats;
}

export interface WheelView {
  /** Moves up and down with the suspension; turns for steering */
  pivot: THREE.Group;
  /** Rolls */
  spinner: THREE.Group;
}

export class CarMesh {
  readonly group = new THREE.Group();
  readonly wheels: WheelView[] = [];
  /** Turns the turret (yaw) and its guns (pitch) */
  readonly turret = new THREE.Group();
  readonly guns = new THREE.Group();
  /** Brake lights brighten when braking */
  private readonly tail: THREE.MeshStandardMaterial;
  /** Exhaust flames, shown on nitro */
  private readonly flames: THREE.Mesh[] = [];
  /** Ram spikes on the nose, shown while fitted */
  private readonly spikes: THREE.Mesh;
  /** Small parts dropped at a distance (level of detail): nobody sees a grille at 80 m */
  private readonly details: THREE.Object3D[] = [];
  /** The wheels in one mesh, standing in for the four moving ones at a distance */
  private readonly farWheels: THREE.Mesh;
  private near = true;
  /** The high-visibility outline (a slightly bigger copy of the body, inside out), made on first use */
  private outline: THREE.Group | null = null;
  private readonly outlineColor: number;
  /** The body: its box is where blows land */
  private readonly body: THREE.Mesh;
  private readonly box: Bounds;
  /** The shell: the body and what's fixed on it (glass, trim), which dents as one */
  private readonly shell: THREE.Mesh[] = [];
  /** Once dented: each shell mesh's own copy of its geometry, its shared clean one, where its vertices started, which moved */
  private dents: { mesh: THREE.Mesh; clean: THREE.BufferGeometry; rest: Float32Array; moved: Uint8Array }[] | null = null;
  /** Dents waiting to be pushed in (a few times a second at most: bullets come ten a second) */
  private readonly pending: Dent[] = [];
  private lastDent = -Infinity;
  /** A kit model's body and wheels (models.ts), or null for the procedural car */
  private readonly kit: CarModel | null;
  /** Panels that hang loose (level 2) and come off (level 3), per zone, with where they sit intact */
  private readonly panels: Record<Zone, { mesh: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler }[]> = {
    front: [], rear: [], left: [], right: [], roof: [],
  };
  /** Panels knocked off, falling and spinning until they're gone */
  readonly debris: { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];

  constructor(color: number, stripe: number, readonly params: CarParams = CAR) {
    shared ??= buildShared();
    const g = shared;
    const m = mats();
    /** A mesh: `shadow` casts one (only the big parts do; small ones aren't worth a shadow pass) */
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.group) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    this.outlineColor = stripe;
    const body = paint(color);
    const kit = carModelFor(color);
    this.kit = kit;
    const detail = <T extends THREE.Object3D>(o: T): T => {
      this.details.push(o);
      return o;
    };
    // Brake lights: each car has its own, to light when it brakes (the realistic car's are its own material).
    const brake = kit?.parts?.trim.find((p) => p.material.name === 'Brakelight')?.material;
    this.tail = (brake ?? m.tail).clone();
    if (kit?.parts) {
      // The realistic body: glass, lights, grilles and trim in their own materials; only the body casts a shadow.
      this.body = part(kit.paint, realPaint(color, kit.parts.paint), true);
      for (const p of kit.parts.trim) this.shell.push(part(p.geometry, p.material.name === 'Brakelight' ? this.tail : p.material, false));
    } else if (kit) {
      // A kit body: its own glass and lights; the armour below is bolted on where its sides end.
      this.body = part(kit.paint, body, true);
      if (kit.trim) this.shell.push(part(kit.trim, m.trim, true));
    } else {
      this.body = part(g.body, body, true);
      this.shell.push(part(g.glass, m.glass, true), part(g.roof, body, true), detail(part(g.stripes, paint(stripe), false)));
      detail(part(g.grille, m.dark, false));
      detail(part(g.heads, m.head, false));
      detail(part(g.tails, this.tail, false));
      detail(part(g.exhausts, m.chrome, false));
    }
    this.shell.unshift(this.body);
    const bb = new THREE.Box3().setFromBufferAttribute(this.body.geometry.getAttribute('position') as THREE.BufferAttribute);
    this.box = { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
    // Armour that can hang loose and come off: just the wing (the front and sides just dent).
    const panel = (zone: Zone, mesh: THREE.Object3D) => this.panels[zone].push({ mesh, pos: mesh.position.clone(), rot: mesh.rotation.clone() });
    // Ram spikes (a sword pad's) on the nose, their bases just inside it.
    this.spikes = part(g.spikes, m.chrome, false, 0, -0.06, (kit ? kit.front : -2.26) + 0.04);
    this.spikes.visible = false;
    // The wing's geometry sits on the procedural body's tail (z 2.24): moved to the kit's.
    panel('rear', part(g.wing, m.dark, true, 0, 0, kit ? kit.rear - 2.24 : 0));
    // Nitro flames: out of the procedural car's side pipes, or out of a kit body's tail.
    const exhausts = kit ? [[-0.45, -0.2, kit.rear], [0.45, -0.2, kit.rear]] : [[-0.98, -0.27, 0.85], [0.98, -0.27, 0.85]];
    for (const [x, y, z] of exhausts as [number, number, number][]) {
      const flame = new THREE.Mesh(flameGeometry(), flameMaterial());
      flame.position.set(x, y, z);
      flame.visible = false;
      this.group.add(flame);
      this.flames.push(flame);
    }

    // Roof turret: yaw on the base, pitch on the guns.
    this.turret.position.set(0, kit ? kit.roof : 0.92, 0.1);
    this.group.add(this.turret);
    detail(part(g.turretBase, m.dark, false, 0, 0, 0, this.turret));
    this.guns.position.set(0, 0.26, 0);
    this.turret.add(this.guns);
    part(g.turretBody, m.armour, true, 0, 0, 0, this.guns);
    detail(part(g.barrels, m.dark, false, 0, 0, 0, this.guns));

    this.params.wheels.forEach((mount, k) => {
      const at = kit?.wheels[k];
      const pivot = new THREE.Group();
      pivot.position.set(at ? at.x : mount.x, mount.y - this.params.restLength * 0.5 + (at?.lift ?? 0), at ? at.z : mount.z);
      const spinner = new THREE.Group();
      pivot.add(spinner);
      if (kit?.parts) for (const p of mount.x < 0 ? kit.parts.wheelLeft : kit.parts.wheelRight) part(p.geometry, p.material, false, 0, 0, 0, spinner);
      else part(kit ? (mount.x < 0 ? kit.wheelLeft : kit.wheelRight) : g.wheel, m.wheel, false, 0, 0, 0, spinner);
      detail(pivot);
      this.group.add(pivot);
      this.wheels.push({ pivot, spinner });
    });
    // Far away, the realistic car's wheels are plain shapes (no vertex colours): dark rubber.
    this.farWheels = part(kit ? kit.farWheels : g.farWheels, kit?.parts ? m.dark : m.wheel, false);
    this.farWheels.visible = false;
  }

  /** Wheels from the simulation: travel, steering and roll */
  updateWheels(states: readonly WheelState[], steer: number): void {
    const p = this.params;
    for (let k = 0; k < this.wheels.length; k++) {
      const view = this.wheels[k] as WheelView;
      const s = states[k] as WheelState;
      const mount = p.wheels[k]!;
      view.pivot.position.y = mount.y - (p.restLength - s.compression) + (this.kit?.wheels[k]?.lift ?? 0);
      view.pivot.rotation.y = mount.front ? -steer : 0;
      view.spinner.rotation.x = -s.spin;
    }
  }

  /** How high the guns are above the car's centre: where its shots start */
  get gunHeight(): number {
    return this.turret.position.y + this.guns.position.y;
  }

  setBraking(on: boolean): void {
    this.tail.emissiveIntensity = on ? 3.2 : 1.2;
  }

  /**
   * A blow from (x, y, z) along (dx, dy, dz), car space, `depth` and `radius` deep and wide
   * (deform.ts): the shell dents where it lands, soon (flushDents).
   */
  impact(x: number, y: number, z: number, dx: number, dy: number, dz: number, depth: number, radius: number): void {
    const l = Math.hypot(dx, dy, dz);
    if (!(l > 1e-6) || this.pending.length > 64) return;
    const [px, py, pz] = landing(x, y, z, dx / l, dy / l, dz / l, this.box);
    this.pending.push({ x: px, y: py, z: pz, dx: dx / l, dy: dy / l, dz: dz / l, depth, radius });
  }

  /**
   * A zone took `amount` more damage, with no point to go on (another client's car, whose own
   * client knows where it was hit): a dent somewhere on that side, placed by `seed`.
   */
  zoneImpact(zone: Zone, amount: number, seed: number): void {
    const size = dentSize('ram', amount);
    if (!size) return;
    const b = this.box;
    const r1 = (Math.sin(seed * 91.7) + 1) / 2;
    const r2 = (Math.sin(seed * 47.3 + 1.3) + 1) / 2;
    const mid = (k: number) => (b.min[k]! + b.max[k]!) / 2;
    const span = (k: number, t: number) => b.min[k]! + (b.max[k]! - b.min[k]!) * (0.15 + 0.7 * t);
    const y = span(1, 0.3 + 0.4 * r2);
    if (zone === 'front') this.impact(span(0, r1), y, b.min[2] - 1, 0, 0, 1, size.depth, size.radius);
    else if (zone === 'rear') this.impact(span(0, r1), y, b.max[2] + 1, 0, 0, -1, size.depth, size.radius);
    else if (zone === 'left') this.impact(b.min[0] - 1, y, span(2, r1), 1, 0, 0, size.depth, size.radius);
    else if (zone === 'right') this.impact(b.max[0] + 1, y, span(2, r1), -1, 0, 0, size.depth, size.radius);
    else this.impact(span(0, r1), b.max[1] + 1, mid(2) + (r2 - 0.5) * 1.5, 0, -1, 0, size.depth, size.radius);
  }

  /**
   * Push the waiting dents into the shell (each car gets its own copy of the geometry the first
   * time; the shared one stays clean for a fresh car). From render, at most ten times a second.
   */
  flushDents(): void {
    if (!this.pending.length) return;
    const now = performance.now() / 1000;
    if (now - this.lastDent < 0.1) return;
    this.lastDent = now;
    this.dents ??= this.shell.map((mesh) => {
      const clean = mesh.geometry;
      mesh.geometry = clean.clone();
      const rest = Float32Array.from((clean.getAttribute('position') as THREE.BufferAttribute).array);
      return { mesh, clean, rest, moved: new Uint8Array(rest.length / 3) };
    });
    for (const d of this.dents) {
      const geo = d.mesh.geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      d.moved.fill(0);
      let any = false;
      for (const dent of this.pending) any = dentVertices(pos.array as Float32Array, d.rest, dent, d.moved) || any;
      if (!any) continue;
      pos.needsUpdate = true;
      const normal = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
      if (normal) {
        renormal(pos.array, normal.array as Float32Array, geo.getIndex()?.array ?? null, d.moved);
        normal.needsUpdate = true;
      }
    }
    this.pending.length = 0;
  }

  /** A zone reached a new damage level: at level 2 its panel (the wing, at the rear) hangs loose, at level 3 it comes off */
  loosen(zone: Zone, level: number): void {
    for (const p of this.panels[zone]) {
      if (level === 2) {
        // Hanging off at an angle.
        p.mesh.rotation.set(p.rot.x + (zone === 'front' ? 0.25 : zone === 'rear' ? -0.3 : 0), p.rot.y + 0.08, p.rot.z + (zone === 'left' ? 0.2 : zone === 'right' ? -0.2 : 0));
        p.mesh.position.y = p.pos.y - 0.08;
      } else if (level >= 3 && p.mesh.visible) {
        p.mesh.visible = false;
        const flying = p.mesh.clone();
        flying.visible = true;
        flying.position.copy(p.pos).applyMatrix4(this.group.matrixWorld);
        flying.quaternion.copy(this.group.quaternion);
        const out = zone === 'left' ? -1 : zone === 'right' ? 1 : 0;
        this.debris.push({
          mesh: flying,
          vel: new THREE.Vector3(out * 4, 4, zone === 'front' ? -3 : zone === 'rear' ? 3 : 0).applyQuaternion(this.group.quaternion),
          spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
          life: 3,
        });
      }
    }
  }

  /** A fresh car (after a wreck): no dents, every panel back on */
  repair(): void {
    if (this.dents) {
      for (const d of this.dents) {
        d.mesh.geometry.dispose();
        d.mesh.geometry = d.clean;
      }
      this.dents = null;
    }
    this.pending.length = 0;
    for (const zone of Object.keys(this.panels) as Zone[]) {
      for (const p of this.panels[zone]) {
        p.mesh.visible = true;
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.copy(p.rot);
      }
    }
  }

  /** Ghosted after a respawn: flicker */
  setGhost(on: boolean, now: number): void {
    this.group.visible = !on || Math.floor(now * 12) % 2 === 0;
  }

  /** Near: every part. Far: just the big shapes (about a third of the draw calls). */
  setDetail(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    for (const o of this.details) o.visible = near;
    this.farWheels.visible = !near;
  }

  setSpikes(on: boolean): void {
    this.spikes.visible = on;
  }

  /**
   * High-visibility outlines: every car ringed in its stripe colour, so it stands out against busy
   * scenery and in the dark (and the field is told apart by more than paint).
   */
  setOutline(on: boolean): void {
    if (on && !this.outline && shared) {
      const mat = outlineMaterial(this.outlineColor);
      const o = new THREE.Group();
      const hull = this.kit ? [this.kit.paint, this.kit.trim] : [shared.body, shared.glass, shared.roof];
      for (const geo of hull) {
        if (!geo) continue;
        const m = new THREE.Mesh(geo, mat);
        m.scale.setScalar(1.07);
        m.position.y = -0.02;
        o.add(m);
      }
      this.group.add(o);
      this.outline = o;
    }
    if (this.outline) this.outline.visible = on;
  }

  /** Nitro flames out of the exhausts, flickering */
  setNitro(on: boolean): void {
    for (const f of this.flames) {
      f.visible = on;
      if (on) f.scale.set(1, 1, 0.7 + Math.random() * 0.7);
    }
  }

  dispose(): void {
    this.tail.dispose();
    for (const d of this.dents ?? []) d.mesh.geometry.dispose();
  }
}
