/** Builds tracks off the main thread (see client.ts). */

import { generate } from './generate';
import type { TrackSpec } from './spec';
import { TRACK_ARRAYS } from './types';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; spec: TrackSpec }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, spec } = e.data;
  try {
    const track = generate(spec);
    // The sample arrays move to the page instead of being copied.
    ctx.postMessage({ id, track }, TRACK_ARRAYS.map((k) => track[k].buffer as ArrayBuffer));
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
