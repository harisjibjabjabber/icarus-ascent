import { describe, it, expect } from 'vitest';
import { ScoreKeeper, SCORE } from '../src/score/score';
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { Autopilot } from '../src/diag/autopilot';
import { PROFILES } from './endlessHelpers';
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

const land = (x: number): SimEvent => ({ type: 'land', x, y: 0, impact: 1, speedBefore: 10, speedAfter: 10, material: 'stone', flipped: false });
/** Feed `seconds` of ticks in `mode`, moving forward from x (returns the new x). */
function ride(k: ScoreKeeper, x: number, seconds: number, mode: RiderState['mode'], first: SimEvent[] = [], c = course): number {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) { x += 0.1; k.update(dt, st({ x, mode }), i === 0 ? first : [], c); }
  return x;
}

describe('score keeper: air, banking and re-ridden ground', () => {
  it('air pays real airborne time only: jump -> grind 2 s -> hop off -> land pays the last flight, not the grind', () => {
    const k = new ScoreKeeper();
    let x = ride(k, 0, 0.2, 'grounded');
    x = ride(k, x, 0.4, 'airborne', [{ type: 'jump', kind: 'ground', x, y: 0, vx: 10, vy: 5 }]);
    x = ride(k, x, 2, 'grinding', [{ type: 'grind-start', railId: 0, x, y: 1, speed: 12 }]);
    const beforeHop = k.comboPoints;
    x = ride(k, x, 0.8, 'airborne', [{ type: 'grind-end', railId: 0, x, y: 1, reason: 'jump' }, { type: 'jump', kind: 'rail', x, y: 1, vx: 10, vy: 5 }]);
    k.update(dt, st({ x: x + 0.1, mode: 'grounded' }), [land(x + 0.1)], course);
    // 0.8 s of air (not 0.4 + 2 + 0.8 = 3.2 s), riding the grind's combo
    expect(k.comboPoints - beforeHop).toBe(Math.round(0.8 * SCORE.airPerSec));
    // and a flight shorter than airMin pays nothing
    const k2 = new ScoreKeeper();
    let x2 = ride(k2, 0, 0.2, 'grounded');
    x2 = ride(k2, x2, SCORE.airMin + 0.3, 'airborne', [{ type: 'jump', kind: 'ground', x: x2, y: 0, vx: 10, vy: 5 }], course);
    x2 = ride(k2, x2, 0.5, 'grinding', [{ type: 'grind-start', railId: 0, x: x2, y: 1, speed: 12 }]);
    const b2 = k2.banked, c2 = k2.comboPoints;
    x2 = ride(k2, x2, SCORE.airMin - 0.2, 'airborne', [{ type: 'grind-end', railId: 0, x: x2, y: 1, reason: 'end' }]);
    k2.update(dt, st({ x: x2 + 0.1, mode: 'grounded' }), [land(x2 + 0.1)], course);
    expect(k2.comboPoints).toBe(c2);
    expect(k2.banked - b2).toBeCloseTo(0.1 * Math.round((SCORE.airMin - 0.2) / dt) + 0.1, 6); // distance only
  });

  it('air with no combo running is banked at once: it is never stuck, multiplied by a later combo or lost on a bail', () => {
    const k = new ScoreKeeper();
    let x = ride(k, 0, 0.2, 'grounded');
    x = ride(k, x, 1.0, 'airborne', [{ type: 'jump', kind: 'ground', x, y: 0, vx: 10, vy: 5 }]);
    const before = k.banked;
    x += 0.1; k.update(dt, st({ x, mode: 'grounded' }), [land(x)], course);
    expect(k.chain).toBe(0);
    expect(k.comboPoints).toBe(0);
    expect(k.banked - before).toBeCloseTo(Math.round(1.0 * SCORE.airPerSec) + 0.1, 6);
    expect(k.total).toBe(k.banked);
    // a combo then a bail: the air stays banked
    const banked = k.banked;
    k.update(dt, st({ x, mode: 'airborne' }), [{ type: 'flip-complete', x, y: 0 }, { type: 'flip-complete', x, y: 0 }], course);
    k.update(dt, st({ x, mode: 'failed' }), [{ type: 'fail', info: { kind: 'fell-in-gap', message: '', x, y: 0 } }], course);
    expect(k.banked).toBe(banked);
  });

  it('counts only tricks and near misses that were banked: a bail takes the lost combo off the summary counts', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0 }), [], course);
    k.update(dt, st({ x: 1, mode: 'airborne' }), [{ type: 'flip-complete', x: 1, y: 0 }, { type: 'grab-end', side: 'left', held: 0.5 }], course);
    for (let i = 0; i < SCORE.idle / dt + 2; i++) k.update(dt, st({ x: 2 + i * 0.01, mode: 'grounded' }), [], course);
    expect(k.chain).toBe(0);
    expect(k.tricks).toBe(2);
    k.update(dt, st({ x: 10, mode: 'airborne' }), [{ type: 'flip-complete', x: 10, y: 0 }, { type: 'flip-complete', x: 10, y: 0 }, { type: 'flip-complete', x: 10, y: 0 }], course);
    expect(k.tricks).toBe(5);
    k.update(dt, st({ x: 10, mode: 'failed' }), [{ type: 'fail', info: { kind: 'fell-in-gap', message: '', x: 10, y: 0 } }], course);
    expect(k.tricks).toBe(2);
    expect(k.nearMisses).toBe(0);
  });

  it('ground re-ridden after a checkpoint retry pays no tricks again, and a set piece bonus is paid once per run', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0 }), [], course);
    k.update(dt, st({ x: 100, mode: 'airborne' }), [{ type: 'flip-complete', x: 100, y: 0 }], course);
    k.bonus('Set piece cleared', SCORE.setPiece, 7);
    k.update(dt, st({ x: 120, mode: 'failed' }), [{ type: 'fail', info: { kind: 'fell-in-gap', message: '', x: 120, y: 0 } }], course);
    const banked = k.banked;
    k.respawn(); // back to a checkpoint at x = 50
    k.update(dt, st({ x: 50 }), [], course);
    k.update(dt, st({ x: 100, mode: 'airborne' }), [{ type: 'flip-complete', x: 100, y: 0 }, { type: 'break', obstacleId: 0, kind: 'pot', by: 'heel', x: 100, y: 0, vx: 1, vy: 0, speed: 1 }], course);
    k.bonus('Set piece cleared', SCORE.setPiece, 7);
    expect(k.chain).toBe(0);
    expect(k.banked).toBe(banked);
    // past the furthest point reached, tricks pay again
    k.update(dt, st({ x: 130, mode: 'airborne' }), [{ type: 'flip-complete', x: 130, y: 0 }], course);
    expect(k.chain).toBe(1);
    expect(k.banked).toBeCloseTo(banked + 10 * SCORE.perMetre, 6);
  });

  it('serialize / restore round-trips a run through JSON (distance and bonuses stay paid), and rejects junk', () => {
    const k = new ScoreKeeper();
    k.update(dt, st({ x: 0 }), [], course);
    k.update(dt, st({ x: 80, mode: 'airborne' }), [{ type: 'flip-complete', x: 80, y: 0 }, { type: 'grab-end', side: 'left', held: 0.6 }], course);
    for (let i = 0; i < SCORE.idle / dt + 2; i++) k.update(dt, st({ x: 80 + i * 0.01, mode: 'grounded' }), [], course);
    k.update(dt, st({ x: 90, mode: 'airborne' }), [{ type: 'flip-complete', x: 90, y: 0 }], course);
    k.bonus('cleared', SCORE.setPiece, 3);
    const snap = JSON.parse(JSON.stringify(k.serialize()));
    const r = new ScoreKeeper();
    expect(r.restore(snap)).toBe(true);
    expect(r.serialize()).toEqual(k.serialize());
    expect([r.total, r.banked, r.chain, r.comboPoints, r.mult, r.tricks, r.nearMisses, r.furthestX]).toEqual([k.total, k.banked, k.chain, k.comboPoints, k.mult, k.tricks, k.nearMisses, k.furthestX]);
    expect(r.best).toEqual(k.best);
    // after the reload the rider restarts behind the furthest point: nothing is paid twice
    r.update(dt, st({ x: 60 }), [], course);
    r.update(dt, st({ x: 90.5 }), [], course);
    r.bonus('cleared', SCORE.setPiece, 3);
    expect(r.banked).toBeCloseTo(k.banked + 0.5 * SCORE.perMetre, 6); // only the new half metre past x = 90
    for (const junk of [null, {}, { v: 1, banked: 'x' }, { ...snap, best: null }, { ...snap, maxX: 'far' }]) {
      const j = new ScoreKeeper();
      expect(j.restore(junk)).toBe(false);
      expect(j.total).toBe(0);
    }
  });
});

describe('near misses', () => {
  it('fire on roughly 5-15% of the relevant events over autopilot rides (14 seeds x 4 km), each kind at least once', () => {
    let landings = 0, walls = 0, pots = 0, pillars = 0;
    const kinds: Record<string, number> = {};
    for (let seed = 1; seed <= 14; seed++) {
      const c = new EndlessCourse(seed);
      const sim = new Simulation(c);
      const ap = new Autopilot(PROFILES[seed % PROFILES.length]);
      const k = new ScoreKeeper();
      let prevX = sim.state.x, takeoffX = -Infinity, wasAir = false;
      for (let i = 0; i < 4000 / 6 / dt && sim.state.x < 4000 && sim.state.mode !== 'failed'; i++) {
        for (const a of ap.next(sim)) sim.enqueue(a);
        sim.step();
        const s = sim.state, ev = sim.drainEvents();
        if (s.mode === 'airborne' && !wasAir) takeoffX = prevX;
        for (const e of ev) {
          if (e.type === 'wall-start') walls++;
          if (e.type === 'break' && e.kind === 'pillar') pillars++;
          if (e.type === 'land' && c.gaps.some((g) => g.requires === 'jump' && g.x1 <= e.x && g.x0 >= takeoffX - 0.5)) landings++;
        }
        if (s.mode === 'airborne') for (const o of c.obstacles) if (o.kind === 'pot' && !s.broken.includes(o.id) && prevX < o.x && s.x >= o.x) pots++;
        k.update(dt, s, ev, c);
        for (const p of k.drainPopups()) if (p.kind === 'near') kinds[p.text] = (kinds[p.text] ?? 0) + 1;
        wasAir = s.mode === 'airborne'; prevX = s.x;
      }
      expect(sim.state.mode, `seed ${seed}`).not.toBe('failed');
    }
    const total = Object.values(kinds).reduce((a, b) => a + b, 0), relevant = landings + walls + pots + pillars;
    expect(total / relevant).toBeGreaterThanOrEqual(0.05);
    expect(total / relevant).toBeLessThanOrEqual(0.15);
    for (const [kind, n] of [['Close call!', landings], ['Late catch!', walls], ['Close!', pots]] as const) {
      expect(kinds[kind] ?? 0, kind).toBeGreaterThan(0);
      expect((kinds[kind] ?? 0) / n, kind).toBeLessThan(0.2);
    }
  }, 60000);

  it('clipping a pillar edge: a trick that comes on with the rider already inside the smash reach is a near miss, one on time is not', () => {
    const smash = (lateGrab: boolean) => {
      const c = new EndlessCourse(1, { script: ['start', 'recovery', 'crest-pillar'], d: 0.5 });
      const p = c.obstacles.find((o) => o.kind === 'pillar')!;
      const sim = new Simulation(c, TUNING, { x: p.x - 30, speed: 14 });
      const k = new ScoreKeeper();
      let jumped = false, grabbed = false, id = 1;
      const near: string[] = [];
      for (let i = 0; i < 6 / dt && !sim.state.broken.includes(p.id) && sim.state.mode !== 'failed'; i++) {
        const s = sim.state;
        if (!jumped && s.mode === 'grounded' && s.x > p.x - Math.max(1.5, s.speed * 0.3)) { sim.enqueue({ type: 'up', strokeId: ++id, source: 'test' }); jumped = true; }
        const grabAt = lateGrab ? p.x - p.halfWidth - 0.3 : p.x - 4;
        if (jumped && !grabbed && s.mode === 'airborne' && s.x + s.vx * dt >= grabAt) { sim.enqueue({ type: 'side', side: 'left', held: true, strokeId: ++id, source: 'test' }); grabbed = true; }
        sim.step();
        k.update(dt, sim.state, sim.drainEvents(), c);
        for (const q of k.drainPopups()) if (q.kind === 'near') near.push(q.text);
      }
      return { broken: sim.state.broken.includes(p.id), mode: sim.state.mode, near };
    };
    const late = smash(true), onTime = smash(false);
    expect(late.broken).toBe(true);
    expect(late.near).toEqual(['Clipped it!']);
    expect(onTime.broken).toBe(true);
    expect(onTime.near).toEqual([]);
  });
});
