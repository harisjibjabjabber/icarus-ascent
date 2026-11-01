import { describe, it, expect } from 'vitest';
import { ScoreKeeper, SCORE, orbTouched, type TrickKind } from '../src/score/score';
import { ORB, orbPoints } from '../src/course/orbs';
import { Challenges, CHALLENGE_STALL, challengeOrder } from '../src/score/challenges';
import { failHeadline, retryNote } from '../src/score/run';
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { PROFILES } from './endlessHelpers';
import { TUNING } from '../src/tuning';
import type { RiderState, SimEvent } from '../src/sim/types';
import type { Orb } from '../src/course/orbs';

const course = new EndlessCourse(1, { script: ['recovery'], d: 0 });
const dt = TUNING.sim.dt;
const st = (o: Partial<RiderState>): RiderState => ({ ...new Simulation(course).state, ...o });

function feed(kinds: TrickKind[]): ScoreKeeper {
  const k = new ScoreKeeper();
  let x = 0;
  k.update(dt, st({ x }), [], course);
    for (const kind of kinds) {
    x += 1;
    // a fresh jump, so a second flip is another single rotation and not a stacked one
    if (kind === 'flip') k.update(dt, st({ x, mode: 'airborne' }), [{ type: 'jump', kind: 'ground', x, y: 0, vx: 10, vy: 6 }], course);
    const ev: SimEvent[] = kind === 'flip' ? [{ type: 'flip-complete', x, y: 1 }]
      : kind === 'grab' ? [{ type: 'grab-end', side: 'left', held: 0.5 }]
      : kind === 'grind' ? [{ type: 'grind-start', railId: 1, x, y: 1, speed: 12 }]
      : kind === 'wall' ? [{ type: 'wall-start', wallId: 1, x, y: 1, speed: 12 }]
      : kind === 'skim' ? [{ type: 'skim-start', x, y: 0 }]
      : kind === 'pot' ? [{ type: 'break', obstacleId: 1, kind: 'pot', by: 'heel', x, y: 0, vx: 1, vy: 0, speed: 10 }]
      : [{ type: 'break', obstacleId: 2, kind: 'pillar', by: 'flip', x, y: 1, vx: 1, vy: 0, speed: 12 }];
    k.update(dt, st({ x, mode: 'airborne' }), ev, course);
  }
  return k;
}

describe('trick variety and flow', () => {
  it('a mixed combo reaches ×5 and outscores the same number of repeated flips; four repeats still reach ×3', () => {
    const mixed = feed(['flip', 'grab', 'grind', 'wall', 'skim', 'pot', 'pillar', 'flip']);
    const spam = feed(['flip', 'flip', 'flip', 'flip', 'flip', 'flip', 'flip', 'flip']);
    const four = feed(['flip', 'flip', 'flip', 'flip']);
    expect(mixed.mult).toBe(SCORE.maxMult);
    expect(spam.mult).toBeLessThan(SCORE.maxMult);
    expect(spam.mult).toBeLessThan(mixed.mult);
    expect(mixed.comboPoints).toBeGreaterThan(spam.comboPoints);
    expect(four.mult).toBeGreaterThanOrEqual(3);
    expect(mixed.comboTrickKinds).toBeGreaterThan(spam.comboTrickKinds);
  });

  it('a repeated link pays less and lowers flow; flow scales the bank, never the distance', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0, speed: 0, vx: 0, vy: 0 }), [], course);
    k.update(dt, st({ x: 1, mode: 'airborne', speed: 0, vx: 0, vy: 0 }), [{ type: 'jump', kind: 'ground', x: 1, y: 0, vx: 1, vy: 1 }, { type: 'flip-complete', x: 1, y: 1 }], course);
    const freshFlow = k.flow;
    expect(freshFlow).toBeCloseTo(SCORE.flowPerFresh, 5);
    k.update(dt, st({ x: 2, mode: 'airborne', speed: 0, vx: 0, vy: 0 }), [{ type: 'jump', kind: 'ground', x: 2, y: 0, vx: 1, vy: 1 }, { type: 'flip-complete', x: 2, y: 1 }], course);
    expect(k.flow).toBeLessThan(freshFlow);
    expect(k.comboPoints).toBe(SCORE.flip + Math.round(SCORE.flip * SCORE.staleScale));
    const before = k.banked;
    k.update(dt, st({ x: 2.4, mode: 'grounded', speed: 0 }), [], course);
    expect(k.banked - before).toBeCloseTo(0.4 * SCORE.perMetre, 5);
    const pay = Math.round(k.comboPoints * k.mult * k.flowPay);
    const banked = k.banked;
    k.bank();
    expect(k.banked - banked).toBe(pay);
    expect(k.flowPay).toBeGreaterThan(1);
  });

  it('a closer lip landing pays more than one at the edge of the same window', () => {
    const c = new EndlessCourse(1, { script: ['start', 'hop'], d: 0 });
    const gap = c.gaps.find((g) => g.requires === 'jump')!;
    const pay = (landX: number) => {
      const k = new ScoreKeeper();
      const s = (o: Partial<RiderState>) => st({ ...o });
      k.update(dt, s({ x: gap.x0 - 1, mode: 'grounded' }), [], c);
      k.update(dt, s({ x: gap.x0 + 0.4, mode: 'airborne' }), [{ type: 'jump', kind: 'ground', x: gap.x0, y: 0, vx: 10, vy: 6 }], c);
      k.update(dt, s({ x: landX, mode: 'grounded' }), [{ type: 'land', x: landX, y: 0, impact: 2, speedBefore: 10, speedAfter: 10, material: 'stone', flipped: false }], c);
      return k.comboPoints;
    };
    expect(pay(gap.x1 + 0.15)).toBeGreaterThan(pay(gap.x1 + SCORE.edgeWithin - 0.05));
  });
});

describe('orbs', () => {
  const orb = (pickup: Orb['pickup'], y: number, tier: Orb['tier'] = 'common'): Orb => ({
    id: 1, x: 10, y, lateral: pickup === 'grind' ? 1.2 : 0, tier, pickup,
  });

  it('an air orb needs the arc, a grind orb needs a grind, and a teleport collects nothing', () => {
    const airOrb = orb('air', 5);
    const grindOrb = orb('grind', 1);
    const air = st({ x: 10.2, y: 5.2, mode: 'airborne' });
    const low = st({ x: 10.2, y: 2, mode: 'airborne' });
    const ground = st({ x: 10.2, y: 5.2, mode: 'grounded' });
    const grind = st({ x: 10.2, y: 1, mode: 'grinding' });
    expect(orbTouched(airOrb, 9.9, air)).toBe(true);
    expect(orbTouched(airOrb, 9.9, low)).toBe(false);
    expect(orbTouched(airOrb, 9.9, ground)).toBe(false);
    expect(orbTouched(grindOrb, 9.9, grind)).toBe(true);
    expect(orbTouched(grindOrb, 9.9, air)).toBe(false);
    expect(orbTouched(airOrb, 0, air)).toBe(false); // jumped the whole course
  });

  it('pays an orb once, and a scripted line puts crest and rail orbs where a real ride can take them', () => {
    const k = new ScoreKeeper();
    const o = orb('air', 5);
    expect(k.collectOrb(o)).toBe(true);
    expect(k.collectOrb(o)).toBe(false);
    expect(k.orbCommon).toBe(1);
    expect(k.banked).toBe(ORB.common);

    const ride = (id: string, profile: AutopilotOptions) => {
      const course = new EndlessCourse(4, { script: ['start', id], d: 0.7 });
      const chunk = course.chunks.find((q) => q.spec === id)!;
      const sim = new Simulation(course, TUNING, { x: chunk.cpX, speed: 14 });
      const ap = new Autopilot(profile);
      const score = new ScoreKeeper();
      for (let i = 0; i < 40 / dt && sim.state.x < chunk.x1 + 5 && sim.state.mode !== 'failed'; i++) {
        for (const a of ap.next(sim)) sim.enqueue(a);
        const prevX = sim.state.x;
        sim.step();
        const s = sim.state;
        score.update(dt, s, sim.drainEvents(), course);
        for (const q of course.orbs) if (orbTouched(q, prevX, s)) score.collectOrb(q);
      }
      const here = course.orbs.filter((q) => q.x >= chunk.x0 && q.x <= chunk.x1);
      return { sim, score, here };
    };
    const kicker = ride('big-kicker', { minSpeed: 16, styleFlips: true });
    expect(kicker.here.some((c) => c.pickup === 'air')).toBe(true);
    expect(kicker.here.some((c) => c.pickup === 'grind')).toBe(true);
    expect(kicker.sim.state.mode).not.toBe('failed');
    expect(kicker.score.orbCommon).toBeGreaterThan(0);
    const grind = ride('crest-pop', { minSpeed: 14, optionalRail: true, pots: 'jump' });
    const plain = ride('crest-pop', { minSpeed: 12 });
    expect(grind.sim.state.mode).not.toBe('failed');
    expect(plain.sim.state.mode).not.toBe('failed');
    expect(grind.score.orbCommon).toBeGreaterThan(0);
    expect(plain.score.orbCommon).toBeGreaterThan(0);
    expect(grind.score.orbCommon).toBeGreaterThan(plain.score.orbCommon);
    const rollers = ride('rollers', PROFILES[0]);
    expect(rollers.here).toHaveLength(0);
    expect(rollers.sim.state.mode).not.toBe('failed');
  });

  it('streams with the chunk and stays bounded over 20 km', () => {
    const c = new EndlessCourse(3);
    let max = 0;
    for (let x = 0; x <= 20000; x += 25) {
      c.stream(x);
      max = Math.max(max, c.orbs.length);
      const ids = new Set(c.chunks.flatMap((k) => k.orbs ?? []));
      for (const q of c.orbs) expect(ids.has(q.id)).toBe(true);
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(40);
  });

  it('rare orbs pay more than common ones', () => {
    expect(orbPoints('rare')).toBeGreaterThan(orbPoints('common'));
  });
});

describe('challenges', () => {
  const rider = st({ x: 0, mode: 'grounded' });
  const seedFor = (id: string) => {
    for (let s = 1; s < 40; s++) if (new Challenges(s).current.id === id) return s;
    throw new Error(id);
  };

  it('is deterministic per seed and offers a different goal after one is met', () => {
    expect(challengeOrder(9)).toEqual(challengeOrder(9));
    expect(challengeOrder(9)).not.toEqual(challengeOrder(10));
    const ch = new Challenges(seedFor('flip'));
    expect(ch.update(rider, [{ type: 'land', x: 1, y: 0, impact: 1, speedBefore: 10, speedAfter: 10, material: 'stone', flipped: true }], { nearMisses: 0, comboTrickKinds: 0, distance: 30 })).toEqual({ text: 'Land a backflip', pts: 700 });
    expect(ch.done).toBe(1);
    expect(ch.current.id).not.toBe('flip');
  });

  it('counts pots to the goal, ignores a fail, and swaps when nothing happens for a stretch', () => {
    const ch = new Challenges(seedFor('pots'));
    const ctx = { nearMisses: 0, comboTrickKinds: 0, distance: 10 };
    const pot: SimEvent = { type: 'break', obstacleId: 1, kind: 'pot', by: 'heel', x: 1, y: 0, vx: 1, vy: 0, speed: 10 };
    expect(ch.update(rider, [pot], ctx)).toBeNull();
    expect(ch.current.progress).toBe(1);
    expect(ch.update(rider, [pot, { type: 'fail', info: { kind: 'hit-pot', message: 'Pot', x: 1, y: 0 } }], ctx)).toBeNull();
    expect(ch.done).toBe(0);
    expect(ch.update(rider, [pot], ctx)?.text).toBe('Smash 2 pots');
    const stall = new Challenges(seedFor('grind'));
    const before = stall.current.id;
    expect(stall.update(rider, [], { nearMisses: 0, comboTrickKinds: 0, distance: CHALLENGE_STALL + 5 })).toBeNull();
    expect(stall.current.id).not.toBe(before);
  });

  it('a mix goal completes from three kinds in the combo, and a snapshot restores', () => {
    const ch = new Challenges(1);
    // mix is gated until 400 m: a quiet stretch swaps goals until it is the one on offer
    let guard = 0;
    let distance = 0;
    while (ch.current.id !== 'mix' && guard++ < 10) {
      distance += CHALLENGE_STALL;
      ch.update(rider, [], { nearMisses: 0, comboTrickKinds: 0, distance });
    }
    expect(ch.current.id).toBe('mix');
    expect(ch.update(rider, [], { nearMisses: 0, comboTrickKinds: 3, distance: distance + 10 })?.text).toBe('Mix 3 tricks');
    const again = new Challenges(1);
    const snap = ch.serialize();
    expect(again.restore(snap)).toBe(true);
    expect(again.done).toBe(ch.done);
    expect(again.current.id).toBe(ch.current.id);
    expect(again.restore({ v: 1, order: ['flip'] })).toBe(false);
  });
});

describe('run summary note', () => {
  it('names the failure and the combo, and a close score is a reason to retry the same route', () => {
    expect(failHeadline('Missed the required rail — jump, then swipe down as you reach it')).toBe('Missed the required rail');
    const close = retryNote({ newBest: false, personalBest: 10000, score: 9400, newDistanceBest: false, bailedMult: 4, fail: 'Hit a pot — jump it', challenge: 'Catch a rail' });
    expect(close).toContain('600');
    expect(close).toContain('×4');
    expect(close).toContain('pot');
    const fresh = retryNote({ newBest: true, personalBest: 100, score: 100, newDistanceBest: true, bailedMult: 0, fail: '', challenge: '' });
    expect(fresh).toContain('New best');
    const open = retryNote({ newBest: false, personalBest: 5000, score: 1000, newDistanceBest: false, bailedMult: 0, fail: '', challenge: 'Land a backflip' });
    expect(open).toContain('Land a backflip');
  });
});
