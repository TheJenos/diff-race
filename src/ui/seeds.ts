/* Track seeds the menus offer. */

const SEED_WORDS = ['rust', 'iron', 'ash', 'bone', 'slag', 'grit', 'chrome', 'diesel', 'venom', 'havoc', 'wreck', 'scrap'];

/** A short, readable random seed, like "havoc-417" */
export function randomSeed(): string {
  return `${SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
}

/** Today's track: the same for everyone on the same day */
export function seedOfTheDay(): string {
  const d = new Date();
  return `day-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
