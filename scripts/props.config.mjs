/*
 * Which scenery kinds (src/game/world/props.ts) `npm run build:props` takes from Kenney kit models.
 *
 *   files   model names to look for under assets-src/kenney/, the first found wins.
 *           `npm run build:props -- --list` prints every model it can see, to pick from.
 *   height  metres tall once built, or
 *   size    metres along the longest side across the ground (x or z), matching the procedural prop.
 *   turn    quarter turns about y, so the side that should face the road faces −z.
 *           Kenney models face +z, hence the default of 2.
 *   tint    its main colour turns white, so each instance takes a colour of its own (containers).
 *   copies  more of it, offset by these [x, y, z] metres once sized: a stack, or a row of sections.
 *
 * A kind with no model found stays procedural, and so does any kind not listed. From City Kit
 * Industrial and Racing Kit, these have nothing that fits: cranes, pipes, tyre walls, barrels,
 * rocks, fire barrels, furnaces and floodlights (whose glowing heads the night lighting uses).
 */
export const PROPS = {
  container: { files: ['shipping-container-a'], size: 6.1, tint: true },
  containerStack: {
    files: ['shipping-container-b', 'shipping-container-a'],
    size: 6.1,
    tint: true,
    copies: [[0, 0, 0], [0.15, 2.6, 0.4], [-0.1, 5.2, -0.3]],
  },
  warehouse: { files: ['building-q'], size: 26 },
  smokestack: { files: ['chimney-medium'], height: 34 },
  silo: { files: ['water-tower'], height: 15.6 },
  grandstand: {
    files: ['grandStandCovered'],
    height: 10,
    // One 8.4 m section of the kit's, four across.
    copies: [[-12.6, 0, 0], [-4.2, 0, 0], [4.2, 0, 0], [12.6, 0, 0]],
  },
};
