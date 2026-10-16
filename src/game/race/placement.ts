import { frameAt, newFrame } from '../track/sample';
import type { TrackData } from '../track/types';
import { quatFromBasis, type Q4, type V3 } from '../math/vec3';

/*
 * Where to put a car: on the road at (s, u), facing along the track, a little above the surface
 * so the suspension settles it. Grid slots and respawns both go through this. Pure.
 */

/** Height of the chassis centre above the road when dropped in (m) */
export const DROP_HEIGHT = 0.85;

const frame = newFrame();

export function placeOnTrack(t: TrackData, s: number, u: number, pos: V3, rot: Q4, height = DROP_HEIGHT): void {
  frameAt(t, s, frame);
  pos.x = frame.pos.x + frame.right.x * u + frame.up.x * height;
  pos.y = frame.pos.y + frame.right.y * u + frame.up.y * height;
  pos.z = frame.pos.z + frame.right.z * u + frame.up.z * height;
  quatFromBasis(frame.right, frame.up, frame.fwd, rot);
}
