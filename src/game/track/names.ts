import type { Rng } from './rng';
import type { ThemeId } from './spec';

/* A track's name, from its seed: two words that sound like somewhere you'd rather not race. */

const FIRST: Record<ThemeId, readonly string[]> = {
  docks: ['Rust', 'Brine', 'Harbour', 'Crane', 'Anchor', 'Dead Tide', 'Pier', 'Cargo', 'Saltworks', 'Bilge'],
  quarry: ['Red Rock', 'Dust', 'Bone', 'Scorpion', 'Gravel', 'Blast', 'Sulfur', 'Canyon', 'Vulture', 'Shale'],
  foundry: ['Cinder', 'Furnace', 'Slag', 'Ash', 'Black Iron', 'Crucible', 'Ember', 'Soot', 'Anvil', 'Smelter'],
};
const SECOND = ['Run', 'Mile', 'Loop', 'Yard', 'Gauntlet', 'Circuit', 'Pass', 'Ring', 'Strip', 'Bend', 'Pit', 'Grinder', 'Spiral', 'Drop'];

export function trackName(rng: Rng, theme: ThemeId): string {
  return `${rng.pick(FIRST[theme])} ${rng.pick(SECOND)}`;
}
