/*
 * What a track is made from. Only this travels over the network: every client builds the same
 * track from it (see generate.ts), and a hash of the result catches any that didn't.
 */

export type TrackLength = 's' | 'm' | 'l';
export type ThemeId = 'docks' | 'quarry' | 'foundry';

export const THEME_IDS: readonly ThemeId[] = ['docks', 'quarry', 'foundry'];
export const TRACK_LENGTHS: readonly TrackLength[] = ['s', 'm', 'l'];

/**
 * Bumped whenever the generator would build a different track from the same spec. Clients with a
 * different version refuse to play a room's track (they'd race on another one) and ask for a refresh.
 */
export const GENERATOR_VERSION = 3;
/*
 * History:
 *   1 — first
 *   2 — skull trap pads
 *   3 — more bends: notches, chicanes, sometimes two hairpins, bigger swings in and out, a long
 *       start straight; tight spots relaxed faster, in rounds
 */

export interface TrackSpec {
  /** Up to 16 characters; anything goes */
  seed: string;
  length: TrackLength;
  /** Omitted: the seed picks one */
  theme?: ThemeId;
  /** GENERATOR_VERSION the track was made with */
  gen: number;
}

export const SEED_MAX = 16;

/** A key that's the same for the same track, for caches and de-duplicating requests. */
export const specKey = (s: TrackSpec): string => `${s.gen}:${s.length}:${s.theme ?? '-'}:${s.seed}`;

export function isTrackSpec(v: unknown): v is TrackSpec {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.seed === 'string' && s.seed.length <= SEED_MAX
    && TRACK_LENGTHS.includes(s.length as TrackLength)
    && (s.theme === undefined || THEME_IDS.includes(s.theme as ThemeId))
    && typeof s.gen === 'number';
}

/** Whether this client can build the spec's track (the same generator version made it). */
export const isPlayableSpec = (s: TrackSpec): boolean => s.gen === GENERATOR_VERSION;
