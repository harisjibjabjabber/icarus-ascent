import type { Zone } from './zone';

/**
 * Stub zone #2 (ROUGH): Ghibli rolling hills. Proves the zone interface end to end; behind
 * `?zones=town,hills` (or `?zone=hills`) only. Fewer walls (no buildings to ride), more crests
 * and rollers; scenery from the CC0 Quaternius Stylized Nature MegaKit (spike/vision mock).
 */
export const HILLS: Zone = {
  id: 'hills',
  name: 'Rolling Hills',
  tagline: 'Wildflowers, big skies and long crests (rough stub)',
  phrases: ['crest-pop', 'rollers', 'valley-launch', 'pop-chain', 'big-kicker', 'double-pop', 'high-line', 'hop', 'pot', 'skim-pair', 'stepdowns', 'ramp-flip', 'rail-launch', 'crest-pillar'],
  setPieces: ['sp-pot-gauntlet', 'sp-stepdown-flip', 'sp-quay'],
  weights: { rollers: 1.6, 'pop-chain': 1.4, 'double-pop': 1.3 },
  waves: 2,
  theme: {
    scenery: 'hills',
    palette: { ground: '#8fbf4f', accent: '#f2c14e', sky: '#f6d8a8' },
    fog: { color: '#f3dcb4', near: 70, far: 460 },
    timeOfDay: 'golden',
    props: ['CommonTree_1', 'CommonTree_3', 'Bush_Common_Flowers', 'Rock_Medium_1'],
  },
  experimental: true,
};
