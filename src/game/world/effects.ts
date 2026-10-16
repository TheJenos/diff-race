import * as THREE from 'three';
import type { CarBody } from '../car/carBody';
import type { Quality } from '../settings';

/*
 * Effects shared by every car on screen: skid marks (one ring-buffer mesh: the oldest marks fade
 * away as new ones are laid), and a particle system for tyre smoke, verge dust and sparks (one
 * draw call, points with a soft round falloff). Lower quality tiers keep fewer particles.
 */

const MARKS = 2400;
const MARK_WIDTH = 0.28;
const PARTICLES: Record<Quality, number> = { low: 160, medium: 360, high: 600 };

interface WheelTrail {
  x: number;
  y: number;
  z: number;
  /** Laying marks now (the last point is valid) */
  on: boolean;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly marks: THREE.Mesh;
  private readonly markPos: Float32Array;
  private readonly markAlpha: Float32Array;
  private markHead = 0;
  private readonly trails = new Map<CarBody, WheelTrail[]>();

  private readonly points: THREE.Points;
  private readonly pPos: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pLife: Float32Array;
  private readonly pMax: Float32Array;
  private readonly pSize: Float32Array;
  private readonly pAlpha: Float32Array;
  private readonly pColor: Float32Array;
  private readonly pGrow: Float32Array;
  private pHead = 0;
  private readonly count: number;

  constructor(quality: Quality) {
    this.group.name = 'effects';
    // Skid marks: quads (4 vertices, 2 triangles each), written round a ring.
    this.markPos = new Float32Array(MARKS * 4 * 3);
    this.markAlpha = new Float32Array(MARKS * 4);
    const idx = new Uint32Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('alpha', new THREE.BufferAttribute(this.markAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.marks = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: 'attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(0.04, 0.04, 0.04, vA * 0.55); }',
    }));
    this.marks.frustumCulled = false;
    this.group.add(this.marks);

    // Particles.
    const n = PARTICLES[quality];
    this.count = n;
    this.pPos = new Float32Array(n * 3).fill(-9999);
    this.pVel = new Float32Array(n * 3);
    this.pLife = new Float32Array(n);
    this.pMax = new Float32Array(n).fill(1);
    this.pSize = new Float32Array(n);
    this.pAlpha = new Float32Array(n);
    this.pColor = new Float32Array(n * 3);
    this.pGrow = new Float32Array(n);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float scale; varying float vA; varying vec3 vC;
        void main() {
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = vA * smoothstep(1.0, 0.25, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vC, a);
        }`,
    }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
  }

  /** The renderer's height in pixels, so particles keep their size on any screen */
  setViewport(height: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.scale!.value = height * 0.9;
  }

  /** Marks and smoke from one car's wheels this frame */
  fromCar(car: CarBody, dt: number): void {
    let trails = this.trails.get(car);
    if (!trails) {
      trails = car.wheels.map(() => ({ x: 0, y: 0, z: 0, on: false }));
      this.trails.set(car, trails);
    }
    const speed = Math.abs(car.speed);
    const v = car.body.linvel();
    for (let k = 0; k < car.wheels.length; k++) {
      const w = car.wheels[k]!;
      const trail = trails[k]!;
      const sliding = w.grounded && w.slide > 0.3 && speed > 5;
      if (sliding) {
        const c = w.contact;
        if (trail.on) this.addMark(trail, c.x, c.y + 0.02, c.z, Math.min(1, w.slide));
        trail.x = c.x;
        trail.y = c.y + 0.02;
        trail.z = c.z;
        trail.on = true;
        // Smoke: thicker the harder the slide.
        if (Math.random() < w.slide * dt * 40) this.emit(c.x, c.y + 0.25, c.z, v.x * 0.15, 0.8, v.z * 0.15, 0.85, 0.82, 0.78, 0.9 + w.slide, 1.2, 0.32, 2.0);
      } else {
        trail.on = false;
      }
      if (w.grounded && w.surface === 'verge' && speed > 7 && Math.random() < dt * speed * 0.5) {
        const c = w.contact;
        this.emit(c.x, c.y + 0.2, c.z, -v.x * 0.1 + (Math.random() - 0.5) * 2, 1.2, -v.z * 0.1 + (Math.random() - 0.5) * 2, 0.62, 0.5, 0.36, 0.9, 1.0, 0.5, 1.6);
      }
    }
  }

  /** A shower of sparks (scrapes, hits) */
  sparks(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 8;
      this.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 5, Math.sin(a) * s, 1, 0.75, 0.3, 0.22, 0.35, 1, 0);
    }
  }

  private addMark(from: WheelTrail, x: number, y: number, z: number, strength: number): void {
    const dx = x - from.x;
    const dz = z - from.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 4) return;
    const px = (-dz / len) * MARK_WIDTH * 0.5;
    const pz = (dx / len) * MARK_WIDTH * 0.5;
    const i = this.markHead;
    this.markHead = (this.markHead + 1) % MARKS;
    this.markPos.set([from.x - px, from.y, from.z - pz, from.x + px, from.y, from.z + pz, x - px, y, z - pz, x + px, y, z + pz], i * 12);
    this.markAlpha.fill(strength, i * 4, i * 4 + 4);
    const geo = this.marks.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** One particle: position, velocity, colour, size (m), life (s), opacity, growth (m/s; 0: a falling spark) */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number,
    r: number, g: number, b: number, size: number, life: number, alpha: number, grow: number): void {
    const i = this.pHead;
    this.pHead = (this.pHead + 1) % this.count;
    this.pPos.set([x, y, z], i * 3);
    this.pVel.set([vx, vy, vz], i * 3);
    this.pColor.set([r, g, b], i * 3);
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pSize[i] = size;
    this.pAlpha[i] = alpha;
    this.pGrow[i] = grow;
  }

  update(dt: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const life = this.pLife[i]!;
      if (life <= 0) continue;
      const left = life - dt;
      this.pLife[i] = left;
      const k = i * 3;
      if (left <= 0) {
        this.pAlpha[i] = 0;
        this.pPos[k + 1] = -9999;
        continue;
      }
      // Smoke rises and slows; sparks fall.
      const spark = this.pGrow[i] === 0;
      this.pVel[k + 1] = this.pVel[k + 1]! + (spark ? -14 : 0.6) * dt;
      const drag = spark ? 1 : Math.exp(-1.6 * dt);
      this.pVel[k] = this.pVel[k]! * drag;
      this.pVel[k + 2] = this.pVel[k + 2]! * drag;
      this.pPos[k] = this.pPos[k]! + this.pVel[k]! * dt;
      this.pPos[k + 1] = this.pPos[k + 1]! + this.pVel[k + 1]! * dt;
      this.pPos[k + 2] = this.pPos[k + 2]! + this.pVel[k + 2]! * dt;
      this.pSize[i] = this.pSize[i]! + this.pGrow[i]! * dt;
      const t = left / this.pMax[i]!;
      this.pAlpha[i] = (spark ? 1 : 0.5) * t;
    }
    const geo = this.points.geometry;
    for (const name of ['position', 'size', 'alpha', 'color']) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  forget(car: CarBody): void {
    this.trails.delete(car);
  }

  dispose(): void {
    this.marks.geometry.dispose();
    (this.marks.material as THREE.Material).dispose();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
