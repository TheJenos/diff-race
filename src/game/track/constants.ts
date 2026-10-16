/*
 * Sizes shared by the generator, the physics and the mesh. Pure data.
 */

/** Barrier box height and thickness (m) */
export const BARRIER_HEIGHT = 1.25;
export const BARRIER_THICK = 0.8;

/** Track samples per drawn chunk: the mesh is split this way for culling, and scenery is grouped with it */
export const TRACK_CHUNK = 64;
