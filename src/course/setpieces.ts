import type { PhraseSpec } from './endless';
import { easeOut, linear } from './shapes';
import { TUNING } from '../tuning';

/**
 * Hand-authored set pieces (vision Page: "hand-built set pieces"): 15-25 s chains of compulsory
 * features with a name, dropped in at a wave's peak (see waves.ts) after a recovery, and always
 * followed by a recovery. Built from the same proven pieces as the phrase library (the run-in,
 * receiver and recovery rules of tests/endless.test.ts hold for every set piece), and each one is
 * ridden by the autopilot profiles at the low and high end of its entry speeds (tests/setpieces.test.ts).
 *
 * `minWave`: the first wave a set piece may appear in (harder ones later).
 */
export interface SetPieceSpec extends PhraseSpec { minWave: number; blurb: string }

const HC = TUNING.movement.hardCap;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const base = { style: false, required: true, airtime: 0.6 } as const;

export const SET_PIECES: SetPieceSpec[] = [
  {
    ...base, id: 'sp-pot-gauntlet', title: 'Pot gauntlet', blurb: 'Five pots back to back: hop or heel-smash them all', minWave: 0, tier: 2,
    entry: [8, HC], exit: [8, HC], receiving: 'flat', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear);
      const gapM = lerp(38, 35, d);
      b.pot(b.cur().x); b.flat(gapM); b.pot(b.cur().x); b.flat(gapM);
      const x = b.cur().x; b.flat(gapM + 4); b.pot(x); b.pot(x + 4, true); b.pot(b.cur().x); b.flat(16);
    },
  },
  {
    ...base, id: 'sp-rooftops', title: 'Rooftop descent', blurb: 'Drop down three roofs, then smash the chimney stack', minWave: 1, tier: 3,
    entry: [8, HC], exit: [10, HC], receiving: 'broad', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().railSlope(30, -5).flat(16);
      // (17 m flats at d = 1 keep the 1.2 s combo approach for a flat-out rider arriving off a climb)
      b.gap(5 + d, -1.6); b.slope(10, -0.6, easeOut).flat(lerp(18, 17, d));
      b.gap(5.5 + d, -1.8); b.slope(10, -0.6, easeOut).flat(lerp(18, 17, d));
      b.gap(6 + d, -2.0); b.slope(12, -0.8, easeOut).flat(46);
      b.pillar(b.cur().x - 16); b.flat(4);
    },
  },
  {
    ...base, id: 'sp-rail-wall', title: 'Rail → wall-run chain', blurb: 'Grind over the gap and straight into a wall run', minWave: 1, tier: 3,
    entry: [10, HC], exit: [10, HC], receiving: 'climb', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, -3, linear);
      const y = b.cur().y, len = 18 + 3 * d;
      const lip = b.gap(len, -0.8, 'rail');
      b.rail(lip.x, len + 5, y + 1.0, y - 0.1, 0, true, y + 0.7);
      b.flat(6).railSlope(40, -11).flat(8).kicker(10, 1.2);
      const wl = 30 + 4 * d;
      const w = b.gap(wl, -1.4, 'wall');
      b.wall({ x0: w.x - 4, x1: w.x + wl + 3, yBottom: w.y - 4.5, yTop: w.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(8).slope(26, 2.5).flat(10);
    },
  },
  {
    ...base, id: 'sp-canal', title: 'Double wall-run canal', blurb: 'Two canal walls back to back', minWave: 2, tier: 3,
    entry: [10, HC], exit: [10, HC], receiving: 'climb', cpSpeed: 12,
    build: (b, d) => {
      for (let k = 0; k < 2; k++) {
        b.flat(4).runIn().railSlope(44, -12).flat(8).kicker(10, 1.2);
        const len = 30 + 5 * d;
        const lip = b.gap(len, -1.4, 'wall');
        b.wall({ x0: lip.x - 4, x1: lip.x + len + 3, yBottom: lip.y - 4.5, yTop: lip.y + 4.5, side: 'right', lateral: 2.4, required: true });
        b.flat(8);
      }
      b.slope(26, 2.5).flat(10);
    },
  },
  {
    ...base, id: 'sp-bell-tower', title: 'Bell-tower run', blurb: 'Big jump, smash the tower pillar, then grind the gap', minWave: 1, tier: 3,
    entry: [8, HC], exit: [10, HC], receiving: 'broad', cpSpeed: 13,
    build: (b) => {
      b.flat(4).runIn().railSlope(36, -8).flat(8).kicker(10, 2.4);
      const lip = b.gap(8, -1.8); b.slope(16, -2.2, easeOut).flat(46);
      b.pillar(lip.x + 8 + 30); b.flat(6).runIn().slope(40, -3, linear);
      const y = b.cur().y;
      const r = b.gap(18, -0.8, 'rail');
      b.rail(r.x, 23, y + 1.0, y - 0.1, 0, true, y + 0.7);
      b.flat(24);
    },
  },
  {
    ...base, id: 'sp-quay', title: 'Quay gauntlet', blurb: 'Pot, gap, pot, gap along the quay', minWave: 0, tier: 2,
    entry: [8, HC], exit: [9, HC], receiving: 'broad', cpSpeed: 14,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear);
      b.pot(b.cur().x); b.flat(6).slope(lerp(36, 30, d), -2.5, linear);
      b.gap(5 + d, -0.5); b.slope(10, -0.6, easeOut).flat(lerp(22, 20, d));
      b.pot(b.cur().x); b.flat(6).slope(lerp(36, 30, d), -2.5, linear);
      b.gap(5.5 + d, -0.6); b.slope(10, -0.6, easeOut).flat(20);
    },
  },
  {
    ...base, id: 'sp-crest-wall', title: 'Crest flip → pillar → wall', blurb: 'Flip the crest to smash the pillar, then catch the wall', minWave: 2, tier: 3, style: true,
    entry: [8, HC], exit: [10, HC], receiving: 'climb', cpSpeed: 12,
    build: (b, d) => {
      b.flat(4).railSlope(40, -10, true).flat(6).crest(2.2, 10, 2.2, 18, true).runIn().flat(46);
      b.pillar(b.cur().x); b.flat(6).runIn().railSlope(44, -12).flat(8).kicker(10, 1.2);
      const len = 30 + 5 * d;
      const lip = b.gap(len, -1.4, 'wall');
      b.wall({ x0: lip.x - 4, x1: lip.x + len + 3, yBottom: lip.y - 4.5, yTop: lip.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(8).slope(26, 2.5).flat(10);
    },
  },
  {
    ...base, id: 'sp-stepdown-flip', title: 'Step-downs → launch', blurb: 'Two step-down gaps into a big flip launch', minWave: 0, tier: 2,
    entry: [8, HC], exit: [12, HC], receiving: 'broad', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear);
      b.gap(5 + d, -1.2); b.slope(10, -0.6, easeOut).flat(lerp(30, 26, d));
      b.gap(6 + d, -1.4); b.slope(10, -0.6, easeOut).flat(8).railSlope(30, -7).flat(6).kicker(10, 2.4);
      b.gap(7 + 2 * d, -1.8); b.slope(16, -2.2, easeOut).flat(24);
    },
  },
];
