import type { SkySegment } from './skyTypes';

/** Template T1 `sky-intro` at G = 110, yS = 0 (§3). Workstreams A–C test against this before C lands segments. */
const G = 110;
const yS = 0;

export const SKY_FIXTURE_INTRO: SkySegment = {
  id: 0,
  variant: 'sky-intro',
  x0: G - 45,
  gx: G,
  xLand: G + 153,
  x1: G + 175,
  yBase: yS,
  tuftId: 0,
  lines: [
    {
      railId: 1,
      laundry: true,
      anchors: [
        { x: G + 10, y: yS + 6.4, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 18, y: yS + 6.4, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 26, y: yS + 6.4, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 34, y: yS + 6.4, lateral: 1.1, kind: 'bracket-right' },
      ],
    },
    {
      railId: 2,
      laundry: true,
      anchors: [
        { x: G + 36.5, y: yS + 7.0, lateral: -1.1, kind: 'bracket-left' },
        { x: G + 55, y: yS + 7.0, lateral: -1.1, kind: 'bracket-left' },
      ],
    },
    {
      railId: 3,
      laundry: true,
      anchors: [
        { x: G + 59, y: yS + 6.2, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 79, y: yS + 6.2, lateral: 1.1, kind: 'bracket-right' },
      ],
    },
    {
      railId: 4,
      laundry: true,
      anchors: [
        { x: G + 104, y: yS + 8.6, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 118, y: yS + 8.6, lateral: 1.1, kind: 'bracket-right' },
        { x: G + 146, y: yS + 3.8, lateral: 2.0, kind: 'mast' },
      ],
    },
  ],
  clusters: [
    { bounceId: 1, count: 5, seed: 101, tether: { x: G + 83, y: yS + 5.6, lateral: 0, kind: 'bracket-left' } },
    { bounceId: 2, count: 4, seed: 102, tether: { x: G + 91.1, y: yS + 6.6, lateral: 0, kind: 'bracket-left' } },
    { bounceId: 3, count: 6, seed: 103, tether: { x: G + 99.2, y: yS + 7.6, lateral: 0, kind: 'bracket-left' } },
  ],
  hops: [
    { x0: G + 10, x1: G + 34, action: 'down', targetRail: 1 },
    { x0: G + 28.9, x1: G + 34, action: 'jump', targetRail: 2 },
    { x0: G + 59, x1: G + 79, action: 'down', targetRail: 3 },
    { x0: G + 102.9, x1: G + 108.3, action: 'down', targetRail: 4 },
  ],
  gapBelow: null,
};
