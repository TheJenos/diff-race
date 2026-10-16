import { GROUP, groups, type PhysicsWorld, type RapierBody } from '../physics';
import { quatFromBasis, type Q4 } from '../math/vec3';
import type { TrackData } from '../track/types';
import { BARRIER_HEIGHT, BARRIER_THICK } from '../track/constants';
import { groundLevel } from '../track/ground';
import { frameAt, newFrame } from '../track/sample';

/*
 * The track's static colliders, from its TrackData: the road and verge as one trimesh (the same
 * surface the mesh draws), the barriers as a chain of oriented boxes along each edge, and a ground
 * slab underneath. No three.js: the headless bot sim builds the same thing in Node.
 */

export { BARRIER_HEIGHT, BARRIER_THICK } from '../track/constants';

export interface TrackColliders {
  body: RapierBody;
  /** Handles of barrier colliders, to tell wall hits from car hits in contact reports */
  barriers: Set<number>;
}

export function buildTrackPhysics(physics: PhysicsWorld, t: TrackData): TrackColliders {
  const { R, world } = physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const { n, pos, right, up, halfWidth, verge } = t;

  // Road + verge: two vertices per sample, at the verge's outer edges, wound so normals face up.
  const verts = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const w = (halfWidth[i] as number) + verge;
    for (let side = 0; side < 2; side++) {
      const u = side === 0 ? -w : w;
      const o = (i * 2 + side) * 3;
      for (let k = 0; k < 3; k++) verts[o + k] = (pos[i * 3 + k] as number) + (right[i * 3 + k] as number) * u;
    }
  }
  const tris = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // (left_i, right_i, left_i+1) and (right_i, right_i+1, left_i+1): (b-a)×(c-a) points up.
    tris.set([a, a + 1, b, a + 1, b + 1, b], i * 6);
  }
  const surface = groups(GROUP.WORLD, 0xffff);
  world.createCollider(
    R.ColliderDesc.trimesh(verts, tris, R.TriMeshFlags.FIX_INTERNAL_EDGES).setCollisionGroups(surface).setFriction(0.6),
    body,
  );

  // Barriers: one box per segment per side, from this sample's edge point to the next one's, so
  // the outside of a bend has no gaps (each box spans its own side's actual distance).
  const barriers = new Set<number>();
  const wall = groups(GROUP.BARRIER, GROUP.CAR | GROUP.PUPPET | GROUP.DEBRIS);
  const rot: Q4 = { x: 0, y: 0, z: 0, w: 1 };
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const f = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };
  const u = { x: 0, y: 0, z: 0 };
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edgePoint(t, i, side, a);
      edgePoint(t, j, side, b);
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= len; dy /= len; dz /= len;
      // Up from the road's frame, made perpendicular to this segment.
      u.x = ((up[i * 3] as number) + (up[j * 3] as number)) / 2;
      u.y = ((up[i * 3 + 1] as number) + (up[j * 3 + 1] as number)) / 2;
      u.z = ((up[i * 3 + 2] as number) + (up[j * 3 + 2] as number)) / 2;
      f.x = dx; f.y = dy; f.z = dz;
      // right = f × u, then u = r × f
      r.x = f.y * u.z - f.z * u.y; r.y = f.z * u.x - f.x * u.z; r.z = f.x * u.y - f.y * u.x;
      const rl = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z) || 1;
      r.x /= rl; r.y /= rl; r.z /= rl;
      u.x = r.y * f.z - r.z * f.y; u.y = r.z * f.x - r.x * f.z; u.z = r.x * f.y - r.y * f.x;
      quatFromBasis(r, u, f, rot);
      // Centre: midway, pushed outward by half the thickness and up by half the height.
      const out = side * (BARRIER_THICK / 2);
      const cx = (a.x + b.x) / 2 + r.x * out + u.x * (BARRIER_HEIGHT / 2);
      const cy = (a.y + b.y) / 2 + r.y * out + u.y * (BARRIER_HEIGHT / 2);
      const cz = (a.z + b.z) / 2 + r.z * out + u.z * (BARRIER_HEIGHT / 2);
      const c = world.createCollider(
        R.ColliderDesc.cuboid(BARRIER_THICK / 2, BARRIER_HEIGHT / 2, len / 2 + 0.05)
          .setTranslation(cx, cy, cz)
          .setRotation(rot)
          .setCollisionGroups(wall)
          .setFriction(0.08)
          .setRestitution(0.18),
        body,
      );
      barriers.add(c.handle);
    }
  }

  // Ramps: wedges standing on the road, part of the surface the wheels ride.
  const frame = newFrame();
  const pt = (s: number, u: number, h: number, out: number[]) => {
    frameAt(t, s, frame);
    out.push(
      frame.pos.x + frame.right.x * u + frame.up.x * h,
      frame.pos.y + frame.right.y * u + frame.up.y * h,
      frame.pos.z + frame.right.z * u + frame.up.z * h,
    );
  };
  for (const r of t.ramps) {
    const pts: number[] = [];
    pt(r.s, r.u0, -0.3, pts); pt(r.s, r.u1, -0.3, pts);
    pt(r.s, r.u0, 0.0, pts); pt(r.s, r.u1, 0.0, pts);
    pt(r.s + r.len, r.u0, -0.3, pts); pt(r.s + r.len, r.u1, -0.3, pts);
    pt(r.s + r.len, r.u0, r.h, pts); pt(r.s + r.len, r.u1, r.h, pts);
    const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
    if (desc) world.createCollider(desc.setCollisionGroups(surface).setFriction(0.6), body);
  }

  // Ground under everything: a car that leaves the track lands somewhere and respawns.
  const g = t.bounds;
  const cx = (g.minX + g.maxX) / 2;
  const cz = (g.minZ + g.maxZ) / 2;
  const half = Math.max(g.maxX - g.minX, g.maxZ - g.minZ) / 2 + 400;
  world.createCollider(
    R.ColliderDesc.cuboid(half, 1, half).setTranslation(cx, groundY(t) - 1, cz).setCollisionGroups(surface).setFriction(0.8),
    body,
  );
  // Queries (the wheels' rays) only see new colliders after a step.
  world.step();
  return { body, barriers };
}

/** The height of the ground slab's top */
export const groundY = (t: TrackData): number => groundLevel(t.bounds);

/** The barrier's inner foot at sample i on `side` (-1 left, 1 right) */
export function edgePoint(t: TrackData, i: number, side: number, out: { x: number; y: number; z: number }): void {
  const w = ((t.halfWidth[i] as number) + t.verge) * side;
  out.x = (t.pos[i * 3] as number) + (t.right[i * 3] as number) * w;
  out.y = (t.pos[i * 3 + 1] as number) + (t.right[i * 3 + 1] as number) * w;
  out.z = (t.pos[i * 3 + 2] as number) + (t.right[i * 3 + 2] as number) * w;
}
