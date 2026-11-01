import type { Zone } from './zone';

/** Zone #1: the seaside witch town (the original look; nothing changes visually or in play). */
export const TOWN: Zone = {
  id: 'town',
  name: 'Seaside Town',
  tagline: 'Terracotta roofs, cobbles and the harbour below',
  phrases: [
    'crest-pop', 'rollers', 'valley-launch', 'pop-chain', 'big-kicker', 'double-pop',
    'hop', 'pot', 'skim-pair', 'pot-pillar', 'stepdowns', 'ramp-flip', 'rail-launch', 'rail-gap',
    'wall-gap', 'ramp-pillar', 'crest-pillar', 'gap-pillar',
  ],
  setPieces: ['sp-pot-gauntlet', 'sp-quay', 'sp-stepdown-flip', 'sp-rooftops', 'sp-rail-wall', 'sp-bell-tower', 'sp-canal', 'sp-crest-wall'],
  weights: {},
  waves: 3,
  theme: {
    scenery: 'town',
    palette: { ground: '#c9a27a', accent: '#d9673b', sky: '#9fd3ea' },
    backdrop: ['town/sky-sea.webp', 'town/far-town.webp'],
    fog: { color: '#cfe4e8', near: 60, far: 420 },
    timeOfDay: 'day',
    props: ['pots', 'signs', 'lamps', 'bunting'],
  },
  audio: {},
};
