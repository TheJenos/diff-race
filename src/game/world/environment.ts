import * as THREE from 'three';
import type { ThemePalette } from '../track/themes';
import type { Quality } from '../settings';

/*
 * Light, sky and fog for a theme. One sun casts shadows, its shadow camera a tight box that
 * follows the player's car (shadows matter close up; far away nobody sees them). Lower quality
 * tiers draw no shadows and shorten the fog, which also hides the scenery that isn't drawn.
 */

const SHADOW_SIZE: Record<Quality, number> = { low: 0, medium: 1024, high: 2048 };
const FOG_SCALE: Record<Quality, number> = { low: 0.55, medium: 0.8, high: 1 };
/** Half the side of the shadow camera's box (m) */
const SHADOW_REACH = 45;

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly sunDir: THREE.Vector3;

  constructor(private readonly scene: THREE.Scene, private readonly palette: ThemePalette, quality: Quality) {
    this.sunDir = new THREE.Vector3(palette.sunDir.x, palette.sunDir.y, palette.sunDir.z).normalize();
    this.hemi = new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, palette.hemiIntensity);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(palette.sun, palette.sunIntensity);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_REACH;
    cam.right = cam.top = SHADOW_REACH;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    // Sky: a gradient dome that moves with the camera, drawn behind everything.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { top: { value: new THREE.Color(palette.skyTop) }, horizon: { value: new THREE.Color(palette.skyHorizon) } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float h = clamp(normalize(vDir).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    );
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.sky = sky;
    scene.add(sky);
    scene.background = new THREE.Color(palette.skyHorizon);
    this.setQuality(quality);
  }

  setQuality(q: Quality): void {
    const size = SHADOW_SIZE[q];
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const far = this.palette.fogFar * FOG_SCALE[q];
    this.scene.fog = new THREE.Fog(this.palette.fog, far * 0.12, far);
  }

  /** Keep the sun's shadow box on `target` (the player's car) and the sky round the camera. */
  follow(target: THREE.Vector3, camera: THREE.Camera): void {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 150);
    this.sun.target.updateMatrixWorld();
    this.sky.position.copy(camera.position);
  }

  dispose(): void {
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
  }
}
