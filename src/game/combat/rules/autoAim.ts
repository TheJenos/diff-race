/*
 * Auto aim: which car the player's turret locks onto by itself. The one nearest the middle of the
 * view (and, less, the nearest), within the guns' reach and in sight, with some loyalty to the
 * one it's already on so it doesn't flick between two cars side by side. Nothing outside a cone
 * round the camera's view: the player still chooses by looking (and looking back), and fires. Pure.
 */

export const AUTO_AIM = {
  /** Half-angle of the cone round the view it locks within (rad): about 26° */
  cone: 0.45,
  /** Furthest it locks (m): the guns are down to half damage by 150 */
  range: 110,
  /** Nearer than this it's right beside the camera: not a target worth swinging round for (m) */
  near: 3,
  /** Its current target's score is multiplied by this, so another must be clearly better */
  loyalty: 0.7,
  /** How long it holds a target that's gone out of sight (behind a pillar, into smoke) before letting go (s) */
  hold: 0.4,
};

export interface AimCandidate {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Line of sight is clear, it isn't in smoke, and it can be hurt (not ghosted) */
  visible: boolean;
}

export interface AutoAimState {
  target: string | null;
  /** Seconds the target has been out of sight */
  lostFor: number;
}

export const newAutoAim = (): AutoAimState => ({ target: null, lostFor: 0 });

type V3 = { x: number; y: number; z: number };

/**
 * How good a lock `c` would be from `eye` looking along `fwd` (a unit vector): lower is better,
 * null if it's out of the cone, out of range or too near.
 */
export function aimScore(eye: V3, fwd: V3, c: V3): number | null {
  const dx = c.x - eye.x;
  const dy = c.y - eye.y;
  const dz = c.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > AUTO_AIM.range || d < AUTO_AIM.near) return null;
  const cos = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle > AUTO_AIM.cone) return null;
  return angle / AUTO_AIM.cone + (d / AUTO_AIM.range) * 0.5;
}

/** This frame's lock: the best candidate in sight, else the last one for a moment after it's lost */
export function updateAutoAim(st: AutoAimState, eye: V3, fwd: V3, candidates: readonly AimCandidate[], dt: number): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  let currentInView = false;
  for (const c of candidates) {
    const s = aimScore(eye, fwd, c);
    if (s === null) continue;
    if (c.id === st.target) currentInView = true;
    if (!c.visible) continue;
    const score = c.id === st.target ? s * AUTO_AIM.loyalty : s;
    if (score < bestScore) {
      bestScore = score;
      best = c.id;
    }
  }
  if (best !== null) {
    st.target = best;
    st.lostFor = 0;
  } else if (st.target !== null && currentInView && st.lostFor + dt < AUTO_AIM.hold) {
    // Hidden for a moment, still where we're looking: hold on.
    st.lostFor += dt;
  } else {
    st.target = null;
    st.lostFor = 0;
  }
  return st.target;
}
