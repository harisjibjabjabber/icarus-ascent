import type { Zone } from './zone';

/**
 * Zone #2: the harbour the town drops into (VISION: one day's journey, old town then harbour).
 * Same phrase vocabulary as the town, weighted toward canal walls, pier gaps and rails.
 * Cliffs and updrafts are not in yet. Scenery is the town builder's quay stretch
 * (src/render/town/town.ts), streamed on the same 40 m chunks.
 *
 * Two waves = 1.6 km (WAVE.length 800). With the town's three waves the first harbour
 * span is distance 2650–4250 from the route origin, and the boundaries land on chunk edges.
 */
export const HARBOUR: Zone = {
  id: 'harbour',
  name: 'Harbour',
  tagline: 'The quay, the turquoise water and a few sails',
  phrases: [
    'crest-pop', 'rollers', 'valley-launch', 'pop-chain', 'big-kicker', 'double-pop',
    'hop', 'pot', 'skim-pair', 'pot-pillar', 'stepdowns', 'ramp-flip', 'rail-launch', 'rail-gap',
    'wall-gap', 'ramp-pillar', 'crest-pillar', 'gap-pillar',
  ],
  setPieces: ['sp-quay', 'sp-canal', 'sp-rail-wall', 'sp-stepdown-flip', 'sp-pot-gauntlet', 'sp-crest-wall'],
  weights: {
    'wall-gap': 1.7,
    'rail-gap': 1.4,
    'rail-launch': 1.3,
    'gap-pillar': 1.25,
    stepdowns: 1.2,
    'sp-quay': 1.6,
    'sp-canal': 1.5,
    'sp-rail-wall': 1.3,
  },
  waves: 2,
  theme: {
    scenery: 'harbour',
    palette: { ground: '#c4b39a', accent: '#2f8f9a', sky: '#9fd4ea' },
    backdrop: ['town/sky-sea.webp', 'town/far-town.webp'],
    fog: { color: '#c5e3ea', near: 70, far: 460 },
    timeOfDay: 'morning',
    props: ['dock', 'boatSmall', 'ship'],
  },
};
