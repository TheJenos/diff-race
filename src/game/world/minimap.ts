import type { TrackData } from '../track/types';

/*
 * The minimap: the track outline drawn once into a path, then the cars, pads and start line over
 * it about 15 times a second. Engine-owned (the HUD gives it a host element), north-up.
 */

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  /** The player: drawn as an arrow pointing (fx, fz) */
  self?: boolean;
  fx?: number;
  fz?: number;
}

const SIZE = 168;
const REDRAW_MS = 66;

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly road = new Path2D();
  private readonly scale: number;
  private readonly cx: number;
  private readonly cz: number;
  private last = 0;

  constructor(private readonly t: TrackData) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.id = 'minimap';
    this.canvas.setAttribute('aria-hidden', 'true');
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas is not supported');
    g.scale(dpr, dpr);
    this.g = g;
    const b = t.bounds;
    this.scale = (SIZE - 16) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.cx = (b.minX + b.maxX) / 2;
    this.cz = (b.minZ + b.maxZ) / 2;
    for (let i = 0; i <= t.n; i++) {
      const k = (i % t.n) * 3;
      const [x, y] = this.toPx(t.pos[k] as number, t.pos[k + 2] as number);
      if (i === 0) this.road.moveTo(x, y);
      else this.road.lineTo(x, y);
    }
  }

  private toPx(x: number, z: number): [number, number] {
    return [SIZE / 2 + (x - this.cx) * this.scale, SIZE / 2 + (z - this.cz) * this.scale];
  }

  /** Redraw (throttled) with these dots */
  draw(now: number, dots: readonly MinimapDot[]): void {
    if (now - this.last < REDRAW_MS) return;
    this.last = now;
    const g = this.g;
    g.clearRect(0, 0, SIZE, SIZE);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 9;
    g.stroke(this.road);
    g.strokeStyle = 'rgba(220,220,220,0.85)';
    g.lineWidth = 4.5;
    g.stroke(this.road);
    // Start line
    const t = this.t;
    const [sx, sy] = this.toPx(t.pos[0] as number, t.pos[2] as number);
    g.fillStyle = '#fff';
    g.fillRect(sx - 3, sy - 3, 6, 6);
    for (const p of t.pads) {
      const i = Math.floor(p.s / t.ds) % t.n;
      const [x, y] = this.toPx(t.pos[i * 3] as number, t.pos[i * 3 + 2] as number);
      g.fillStyle = p.kind === 'sword' ? '#ff4a2a' : p.kind === 'shield' ? '#3a8bff' : '#9cff3a';
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const d of dots) {
      const [x, y] = this.toPx(d.x, d.z);
      g.fillStyle = d.color;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      if (d.self && d.fx !== undefined && d.fz !== undefined) {
        const l = Math.hypot(d.fx, d.fz) || 1;
        const fx = d.fx / l;
        const fy = d.fz / l;
        g.beginPath();
        g.moveTo(x + fx * 7, y + fy * 7);
        g.lineTo(x - fx * 4 - fy * 4.5, y - fy * 4 + fx * 4.5);
        g.lineTo(x - fx * 4 + fy * 4.5, y - fy * 4 - fx * 4.5);
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        g.beginPath();
        g.arc(x, y, 3.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
  }
}
