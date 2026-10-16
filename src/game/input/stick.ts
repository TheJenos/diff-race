/*
 * Stick maths for gamepads and touch: a round deadzone (a square one makes diagonals sticky) and
 * a response curve (fine control near the centre, full lock at the edge). Pure.
 */

/** (x, y) with the centre `dz` of the stick's travel removed and the rest rescaled to 0..1 */
export function radialDeadzone(x: number, y: number, dz: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m <= dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

/** Signed power curve: exponent > 1 softens the middle */
export const curve = (v: number, exponent: number): number => Math.sign(v) * Math.abs(v) ** exponent;

/** A trigger's value with a small deadzone */
export const trigger = (v: number, dz = 0.06): number => (v <= dz ? 0 : Math.min(1, (v - dz) / (1 - dz)));
