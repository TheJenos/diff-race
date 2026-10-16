import * as THREE from 'three';
import { canvas2d } from '../canvas';

/*
 * A floating label over a car: its name and an armour bar. A canvas texture on a sprite, redrawn
 * only when the numbers change.
 */

const W = 256;
const H = 64;

export class NameTag {
  readonly sprite: THREE.Sprite;
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private last = -1;

  constructor(private readonly name: string) {
    const { canvas, g } = canvas2d(W, H);
    this.g = g;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: true, transparent: true }));
    this.sprite.scale.set(3.2, 0.8, 1);
    this.sprite.position.set(0, 2.6, 0);
    this.sprite.renderOrder = 5;
    this.draw(1);
  }

  /** Armour as a fraction (0..1) */
  draw(armour: number): void {
    const k = Math.round(armour * 40);
    if (k === this.last) return;
    this.last = k;
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.font = 'bold 26px Bahnschrift, "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(this.name, W / 2, 28);
    g.fillStyle = '#f2efe8';
    g.fillText(this.name, W / 2, 28);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(48, 40, W - 96, 12);
    g.fillStyle = armour > 0.5 ? '#5ce08a' : armour > 0.25 ? '#ffb547' : '#ff4d3d';
    g.fillRect(50, 42, (W - 100) * Math.max(0, armour), 8);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.sprite.material as THREE.Material).dispose();
  }
}
