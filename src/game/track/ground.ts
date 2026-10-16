import type { TrackBounds } from './types';

/** The ground plane's height: half a metre under the lowest road. Props stand on it; skirts slope down to it. */
export const groundLevel = (b: TrackBounds): number => b.minY - 0.5;
