import { describe, it, expect } from 'vitest';
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { Autopilot } from '../src/diag/autopilot';
import { ScoreKeeper, SCORE, charmTouched } from '../src/score/score';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';

/** Ride the high-line phrase from its checkpoint. Collects lanterns the way the game does. */
function ride(opts: ConstructorParameters<typeof Autopilot>[0], speed = 14) {
  const course = new EndlessCourse(1, { script: ['high-line'], d: 0 });
  const chunk = course.chunks[0];
  const sim = new Simulation(course, TUNING, { x: chunk.cpX, speed });
  const ap = new Autopilot(opts);
  const score = new ScoreKeeper();
  const events: SimEvent[] = [];
  let prev = sim.state.x;
  const end = chunk.x1 + 2;
  for (let i = 0; i < 30 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < end; i++) {
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    const ev = sim.drainEvents();
    events.push(...ev);
    score.update(sim.dt, sim.state, ev, course);
    for (const c of course.charms) if (!score.tookCharm(c.id) && charmTouched(c, prev, sim.state)) score.collectCharm(c);
    prev = sim.state.x;
  }
  return { sim, course, chunk, events, score };
}

describe('risky high line', () => {
  it('a lazy rider stays on the street and survives', () => {
    const { sim, chunk, events } = ride({ minSpeed: 10 });
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(sim.state.x).toBeGreaterThanOrEqual(chunk.x1);
    expect(events.some((e) => e.type === 'grind-start')).toBe(false);
  });

  it('a timed high line grinds to the end, pays a line link and the lantern', () => {
    const course = new EndlessCourse(1, { script: ['high-line'], d: 0 });
    const chunk = course.chunks[0];
    const sim = new Simulation(course, TUNING, { x: chunk.cpX, speed: 14 });
    const ap = new Autopilot({ minSpeed: 14, riskyLine: true });
    const score = new ScoreKeeper();
    let prev = sim.state.x;
    let peakKinds = 0, peakPoints = 0, cleared = false;
    for (let i = 0; i < 30 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < chunk.x1 + 2; i++) {
      for (const a of ap.next(sim)) sim.enqueue(a);
      sim.step();
      const ev = sim.drainEvents();
      if (ev.some((e) => e.type === 'grind-end' && e.reason === 'end')) cleared = true;
      score.update(sim.dt, sim.state, ev, course);
      peakKinds = Math.max(peakKinds, score.comboTrickKinds);
      peakPoints = Math.max(peakPoints, score.comboPoints);
      for (const c of course.charms) if (!score.tookCharm(c.id) && charmTouched(c, prev, sim.state)) score.collectCharm(c);
      prev = sim.state.x;
    }
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(cleared).toBe(true);
    // the grind link plus the high-line link: a new kind, so the combo is wider than a plain grind
    expect(peakKinds).toBeGreaterThanOrEqual(2);
    expect(peakPoints).toBeGreaterThanOrEqual(SCORE.grind + SCORE.line);
    expect(score.charmRisk).toBe(1);
    expect(score.drainPopups().some((p) => p.text === 'High line' && p.pts === SCORE.charmRisk)).toBe(true);
  });

  it('a jump with no down-swipe misses, and the message names the street', () => {
    const { sim } = ride({ minSpeed: 14, riskyMistime: 'nodown' });
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail?.kind).toBe('missed-rail');
    expect(sim.state.fail?.message).toMatch(/high line/i);
    expect(sim.state.fail?.message).toMatch(/street/i);
  });
});

describe('double flip in the air', () => {
  it('the stylish autopilot finishes a second rotation off the big kicker', () => {
    const course = new EndlessCourse(1, { script: ['big-kicker'], d: 0.8 });
    const chunk = course.chunks[0];
    const sim = new Simulation(course, TUNING, { x: chunk.cpX, speed: 16 });
    const ap = new Autopilot({ minSpeed: 16, strength: 0.9, styleFlips: true, styleDouble: true });
    let rot2 = false;
    for (let i = 0; i < 25 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < chunk.x1 + 8; i++) {
      for (const a of ap.next(sim)) sim.enqueue(a);
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'flip-complete' && (e.rotation ?? 1) >= 2) rot2 = true;
    }
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(rot2).toBe(true);
  });
});

describe('double flip scoring', () => {
  it('a second rotation is its own kind and pays more than a flip', () => {
    const course = new EndlessCourse(1, { script: ['high-line'], d: 0 });
    const sim = new Simulation(course);
    const k = new ScoreKeeper();
    k.update(sim.dt, { ...sim.state, x: 1, mode: 'airborne' }, [{ type: 'flip-complete', x: 1, y: 1 }], course);
    const flipPts = k.comboPoints;
    expect(k.comboTrickKinds).toBe(1);
    const d = new ScoreKeeper();
    d.update(sim.dt, { ...sim.state, x: 1, mode: 'airborne' }, [{ type: 'flip-complete', x: 1, y: 1, rotation: 2 }], course);
    expect(d.comboPoints).toBe(SCORE.double);
    expect(d.comboPoints).toBeGreaterThan(flipPts);
    expect(d.comboTrickKinds).toBe(1);
    // mixing a flip and a double raises variety above a repeated flip
    d.update(sim.dt, { ...sim.state, x: 2, mode: 'airborne' }, [{ type: 'flip-complete', x: 2, y: 1 }], course);
    expect(d.comboTrickKinds).toBe(2);
    expect(d.variety).toBeGreaterThan(1);
  });
});
