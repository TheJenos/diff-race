/*
 * Who's where: finished cars by finish time, then the rest by race distance. Pure.
 * Also the "diffs": the gap in seconds to the car ahead and behind (distance over speed).
 */

export interface Standing {
  id: string;
  D: number;
  finishTime: number | null;
  /** m/s, for turning distance gaps into time */
  speed: number;
  /** Elimination: when this car was knocked out (race time, s), or absent while it's in */
  outAt?: number | null;
}

/**
 * Ids in race order (best first): finished cars by time, then cars still racing by distance, then
 * (Elimination) the knocked-out, the last out first. Ties keep the earlier order, so places don't flicker.
 */
export function rank(cars: readonly Standing[], previous: readonly string[] = []): string[] {
  const prev = new Map(previous.map((id, i) => [id, i]));
  return [...cars].sort((a, b) => {
    const ao = a.outAt ?? null;
    const bo = b.outAt ?? null;
    if (ao !== null || bo !== null) {
      if (ao === null) return -1;
      if (bo === null) return 1;
      return bo - ao;
    }
    if (a.finishTime !== null || b.finishTime !== null) {
      if (a.finishTime === null) return 1;
      if (b.finishTime === null) return -1;
      return a.finishTime - b.finishTime;
    }
    // Half a metre of hysteresis: a car has to really pass to change places.
    if (Math.abs(a.D - b.D) > 0.5) return b.D - a.D;
    return (prev.get(a.id) ?? 99) - (prev.get(b.id) ?? 99);
  }).map((c) => c.id);
}

/** Seconds between two cars at race distances a and b (behind's speed, at least 8 m/s) */
export function gapSeconds(ahead: Standing, behind: Standing): number {
  return (ahead.D - behind.D) / Math.max(8, behind.speed);
}
