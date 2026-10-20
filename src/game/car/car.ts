import * as THREE from 'three';
import { CarBody } from './carBody';
import { CarMesh } from './carMesh';
import type { PhysicsWorld } from '../physics';
import type { CarInput } from '../input/carInput';
import type { Q4, V3 } from '../math/vec3';

/*
 * A car this client simulates, drawn: the physics body (carBody.ts) and its mesh (carMesh.ts).
 * Physics runs at a fixed 120 Hz and the screen at whatever it runs at, so the mesh is drawn
 * between the last two physics poses (alpha from PhysicsWorld.update).
 */

export class Car {
  readonly body: CarBody;
  readonly view: CarMesh;
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevRot = new THREE.Quaternion();
  private readonly currRot = new THREE.Quaternion();
  private braking = false;

  constructor(physics: PhysicsWorld, color: number, stripe: number) {
    this.body = new CarBody(physics);
    this.view = new CarMesh(color, stripe);
  }

  /** Headlights for night tracks: one spot light, no shadows (only the player's car gets them) */
  addHeadlights(): void {
    const light = new THREE.SpotLight(0xfff0d0, 90, 90, 0.5, 0.55, 1.4);
    light.position.set(0, 0.15, -2.3);
    light.target.position.set(0, -2, -24);
    this.view.group.add(light, light.target);
  }

  /** Before the physics step */
  fixed(input: CarInput, dt: number): void {
    this.braking = input.brake > 0 && this.body.speed > 0.5;
    this.body.fixed(input, dt);
  }

  /** After the physics step: remember the pose to draw between */
  afterStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
    const t = this.body.body.translation();
    const r = this.body.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currRot.set(r.x, r.y, r.z, r.w);
  }

  /** Teleport (spawn, respawn): no interpolation from the old place */
  place(pos: V3, rot: Q4): void {
    this.body.place(pos, rot);
    this.currPos.set(pos.x, pos.y, pos.z);
    this.currRot.set(rot.x, rot.y, rot.z, rot.w);
    this.prevPos.copy(this.currPos);
    this.prevRot.copy(this.currRot);
  }

  /** Draw at `alpha` (0..1) of the way from the previous physics pose to the latest */
  render(alpha: number): void {
    const g = this.view.group;
    g.position.lerpVectors(this.prevPos, this.currPos, alpha);
    g.quaternion.slerpQuaternions(this.prevRot, this.currRot, alpha);
    this.view.updateWheels(this.body.wheels, this.body.steer);
    this.view.flushDents();
    if (this.body.puppet) return;
    this.view.setBraking(this.braking);
    this.view.setNitro(this.body.nitroActive);
  }

  /** The drawn position (after render) */
  get position(): THREE.Vector3 {
    return this.view.group.position;
  }

  dispose(): void {
    this.body.dispose();
    this.view.dispose();
  }
}
