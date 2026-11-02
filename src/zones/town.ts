import type { Zone } from './zone';

/** Zone #1: the seaside witch town (the original look; nothing changes visually or in play). */
export const TOWN: Zone = {
  id: 'town',
  name: 'Seaside Town',
  tagline: 'Terracotta roofs, cobbles and the harbour below',
  phrases: [
    'crest-pop', 'rollers', 'valley-launch', 'pop-chain', 'big-kicker', 'double-pop', 'high-line',
    'hop', 'pot', 'skim-pair', 'pot-pillar', 'stepdowns', 'ramp-flip', 'rail-launch', 'rail-gap', 'rail-gap-early',
    'wall-over', 'wall-gap', 'death-gauntlet', 'wall-tap', 'wall-long', 'wall-transfer', 'wall-line',
    'ramp-pillar', 'crest-pillar', 'gap-pillar',
  ],
  setPieces: ['sp-pot-gauntlet', 'sp-quay', 'sp-stepdown-flip', 'sp-rooftops', 'sp-rail-wall', 'sp-bell-tower', 'sp-canal', 'sp-crest-wall'],
  weights: {
    'wall-tap': 2.6,
    'wall-long': 2.2,
    'wall-transfer': 2.2,
    'wall-line': 2.2,
    'wall-gap': 3.2,
    'wall-over': 2.4,
    'death-gauntlet': 1.8,
    'rail-gap': 1.7,
  },
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
