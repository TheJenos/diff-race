import { q } from './dmath';
import type { GridSlot } from './types';

/*
 * The starting grid and the sector checkpoints: the same rules for every track.
 */

/** Cars on the grid (the most a room can race) */
export const GRID_SLOTS = 12;
/** Metres behind the start line to the first row */
const FIRST_ROW = 10;
/** Metres between rows */
const ROW_GAP = 9;
/** Lateral offset of the two columns (m); the right column is staggered half a row back */
const COLUMN = 3.6;

export function gridSlots(): GridSlot[] {
  const slots: GridSlot[] = [];
  for (let j = 0; j < GRID_SLOTS; j++) {
    const row = Math.floor(j / 2);
    const right = j % 2 === 1;
    slots.push({ s: q(-(FIRST_ROW + row * ROW_GAP + (right ? ROW_GAP / 2 : 0))), u: right ? COLUMN : -COLUMN });
  }
  return slots;
}

/** How far behind the start line the grid reaches (m): the start straight must be clear for this long */
export const GRID_DEPTH = FIRST_ROW + (GRID_SLOTS / 2) * ROW_GAP + 6;

/** Sector checkpoints for lap splits: 8 equal sectors */
export function checkpointsFor(lapLength: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 8; k++) out.push(q((lapLength * k) / 8));
  return out;
}
