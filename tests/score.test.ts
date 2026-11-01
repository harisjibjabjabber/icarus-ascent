import { describe, it, expect } from 'vitest';
import { ScoreKeeper, SCORE } from '../src/score/score';
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { Autopilot } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { RiderState, SimEvent } from '../src/sim/types';

const course = new EndlessCourse(1);
const dt = TUNING.sim.dt;
const base = (): RiderState => ({ ...new Simulation(course).state });
const st = (o: Partial<RiderState>): RiderState => ({ ...base(), ...o });

describe('score keeper', () => {
  it('chains tricks into a combo whose multiplier grows x1 -> x5, banks after plain rolling, and pays distance', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0, mode: 'grounded' }), [], course);
    const air = st({ x: 10, mode: 'airborne', tick: 10 });
    k.update(dt, air, [{ type: 'jump', kind: 'ground', x: 10, y: 0, vx: 1, vy: 1 }, { type: 'flip-start', x: 10, y: 0 }, { type: 'flip-complete', x: 10, y: 0 }], course);
    expect(k.chain).toBe(1); expect(k.mult).toBe(1);
    k.update(dt, st({ x: 11, mode: 'airborne', tick: 11 }), [{ type: 'grab-start', side: 'right' }, { type: 'grab-end', side: 'right', held: 0.5 }], course);
    expect(k.mult).toBe(2);
    for (let i = 0; i < 12; i++) k.update(dt, st({ x: 12 + i, mode: 'airborne', tick: 12 + i }), [{ type: 'flip-complete', x: 0, y: 0 }], course);
    expect(k.mult).toBe(SCORE.maxMult); // capped
    const pending = k.comboPoints;
    expect(k.total).toBe(k.banked + Math.round(pending * SCORE.maxMult));
    // land and roll plain: the combo banks after SCORE.idle seconds
    let x = 30;
    k.update(dt, st({ x, mode: 'grounded', tick: 100 }), [{ type: 'land', x, y: 0, impact: 1, speedBefore: 10, speedAfter: 10, material: 'stone', flipped: false }], course);
    for (let i = 0; i < SCORE.idle / dt + 2; i++) k.update(dt, st({ x: (x += 0.1), mode: 'grounded', tick: 101 + i }), [], course);
    expect(k.chain).toBe(0);
    expect(k.best.mult).toBe(SCORE.maxMult);
    expect(k.best.points).toBeGreaterThanOrEqual(Math.round(pending * SCORE.maxMult));
    expect(k.banked).toBeGreaterThan(k.best.points); // + distance
    expect(k.drainPopups().some((p) => p.kind === 'bank')).toBe(true);
  });

  it('a bail loses the combo in progress, but never the banked score', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0 }), [], course);
    k.update(dt, st({ x: 50, mode: 'airborne' }), [{ type: 'flip-complete', x: 0, y: 0 }, { type: 'flip-complete', x: 0, y: 0 }], course);
    const banked = k.banked;
    expect(k.comboPoints).toBeGreaterThan(0);
    const fail: SimEvent = { type: 'fail', info: { kind: 'fell-in-gap', message: '', x: 50, y: 0 } };
    k.update(dt, st({ x: 50, mode: 'failed' }), [fail], course);
    expect(k.chain).toBe(0); expect(k.comboPoints).toBe(0);
    expect(k.banked).toBe(banked);
    expect(k.drainPopups().some((p) => p.kind === 'bail')).toBe(true);
    // a retry from an earlier checkpoint doesn't pay distance twice
    k.respawn();
    k.update(dt, st({ x: 20 }), [], course);
    k.update(dt, st({ x: 40 }), [], course);
    expect(k.banked).toBe(banked);
  });

  it('near misses: a landing right at the far lip, a late wall catch and a pot cleared by a hair', () => {
    const c = new EndlessCourse(1, { script: ['start', 'hop', 'wall-gap', 'pot'], d: 0.5 });
    const k = new ScoreKeeper();
    const gap = c.gaps.find((g) => g.requires === 'jump')!;
    k.update(dt, st({ x: gap.x0 - 1, mode: 'grounded' }), [], c);
    k.update(dt, st({ x: gap.x0 + 0.5, mode: 'airborne', tick: 1 }), [{ type: 'jump', kind: 'ground', x: gap.x0, y: 0, vx: 1, vy: 1 }], c);
    k.update(dt, st({ x: gap.x1 + 0.3, mode: 'grounded', tick: 30 }), [{ type: 'land', x: gap.x1 + 0.3, y: 0, impact: 1, speedBefore: 10, speedAfter: 10, material: 'stone', flipped: false }], c);
    const w = c.walls[0];
    k.update(dt, st({ x: w.x0 + 7, mode: 'wallRiding' }), [{ type: 'wall-start', wallId: w.id, x: w.x0 + 7, y: 0, speed: 12 }], c);
    const pot = c.obstacles.find((o) => o.kind === 'pot')!;
    k.update(dt, st({ x: pot.x - 0.2, mode: 'airborne', y: pot.baseY + pot.height + 0.2 }), [], c);
    k.update(dt, st({ x: pot.x + 0.2, mode: 'airborne', y: pot.baseY + pot.height + 0.2 }), [], c);
    const near = k.drainPopups().filter((p) => p.kind === 'near').map((p) => p.text);
    expect(near).toEqual(['Close call!', 'Late catch!', 'Close!']);
    expect(k.nearMisses).toBe(3);
  });

  it('a real autopilot ride of 3 km scores tricks, banks combos of x3 or more and is deterministic', () => {
    const ride = () => {
      const c = new EndlessCourse(21);
      const sim = new Simulation(c);
      const ap = new Autopilot({ minSpeed: 15, styleFlips: true, optionalRail: true, pots: 'heel', pillarTrick: 'flip' });
      const k = new ScoreKeeper();
      for (let i = 0; i < 400 / dt && sim.state.x < 3000 && sim.state.mode !== 'failed'; i++) { for (const a of ap.next(sim)) sim.enqueue(a); sim.step(); k.update(dt, sim.state, sim.drainEvents(), c); }
      k.bank();
      return { k, mode: sim.state.mode };
    };
    const a = ride(), b = ride();
    expect(a.mode).not.toBe('failed');
    expect(a.k.tricks).toBeGreaterThan(20);
    expect(a.k.best.mult).toBeGreaterThanOrEqual(3);
    expect(a.k.banked).toBeGreaterThan(3000 * SCORE.perMetre);
    expect(b.k.banked).toBe(a.k.banked);
  });
});
