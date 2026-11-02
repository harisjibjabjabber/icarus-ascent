import { describe, it, expect } from 'vitest';
import { EndlessCourse } from '../src/course/endless';
import { buildOpeningCourse } from '../src/course/opening';
import { Simulation } from '../src/sim/simulation';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';

const ENGAGED: AutopilotOptions = { minSpeed: 12, washLine: true, swing: true, flight: true, bounce: true };

function ride(id: string, opts: AutopilotOptions, zones: string[] = ['town'], speed = 14) {
  const course = new EndlessCourse(1, { script: [id], d: 0.4, zones });
  const chunk = course.chunks.find((c) => c.spec === id)!;
  const sim = new Simulation(course, TUNING, { x: chunk.cpX, speed });
  const ap = new Autopilot(opts);
  const events: SimEvent[] = [];
  const end = chunk.x1 + 4;
  for (let i = 0; i < 40 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < end; i++) {
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, course, chunk, events };
}

describe('activity set pieces', () => {
  it('a flat rider never catches the washing line; a crest jump does, and the purple sits on the hardest point', () => {
    const lazy = ride('wash-line', { minSpeed: 12 });
    expect(lazy.sim.state.mode, lazy.sim.state.fail?.message).not.toBe('failed');
    expect(lazy.events.some((e) => e.type === 'grind-start')).toBe(false);
    const go = ride('wash-line', ENGAGED);
    expect(go.sim.state.mode, go.sim.state.fail?.message).not.toBe('failed');
    expect(go.events.some((e) => e.type === 'grind-start')).toBe(true);
    const rideHook = go.chunk.rides?.find((h) => h.activity === 'wash');
    expect(rideHook?.path.length).toBeGreaterThan(2);
    const rare = go.course.orbs.find((o) => o.tier === 'rare' && Math.hypot(o.x - rideHook!.hardest.x, o.y - rideHook!.hardest.y) < 0.4);
    expect(rare?.pickup).toBe('grind');
  });

  it('holding down at the rope hooks it, and releasing on the way up leaves the street', () => {
    const lazy = ride('swing-hook', { minSpeed: 12 });
    expect(lazy.events.some((e) => e.type === 'swing-start')).toBe(false);
    expect(lazy.sim.state.mode).not.toBe('failed');
    const go = ride('swing-hook', ENGAGED);
    expect(go.sim.state.mode, go.sim.state.fail?.message).not.toBe('failed');
    expect(go.events.some((e) => e.type === 'swing-start')).toBe(true);
    expect(go.events.some((e) => e.type === 'swing-end')).toBe(true);
    const hook = go.chunk.rides?.find((h) => h.activity === 'swing');
    expect(hook?.path.length).toBeGreaterThan(3);
    expect(go.course.orbs.some((o) => o.tier === 'rare' && o.pickup === 'air' && Math.abs(o.x - hook!.hardest.x) < 0.5)).toBe(true);
    const harbour = ride('swing-hook', ENGAGED, ['harbour']);
    expect(harbour.course.swings[0]?.anchor).toBe('crane');
  });

  it('a crest does not lift; a jump into the column flies, then comes back to the street', () => {
    const lazy = ride('updraft', { minSpeed: 14 });
    expect(lazy.events.some((e) => e.type === 'flight-start')).toBe(false);
    expect(lazy.sim.state.mode).not.toBe('failed');
    const go = ride('updraft', ENGAGED);
    expect(go.sim.state.mode, go.sim.state.fail?.message).not.toBe('failed');
    expect(go.events.some((e) => e.type === 'flight-start')).toBe(true);
    expect(go.events.some((e) => e.type === 'flight-end' || e.type === 'land')).toBe(true);
    expect(go.sim.state.mode === 'grounded' || go.sim.state.mode === 'heelSkim' || go.sim.state.x >= go.chunk.x1).toBe(true);
    const hook = go.chunk.rides?.find((h) => h.activity === 'flight');
    expect(hook?.hardest.pickup).toBe('air');
    expect(go.course.updrafts[0]?.source).toBe('chimney');
    expect(ride('updraft', ENGAGED, ['harbour']).course.updrafts[0]?.source).toBe('vent');
  });

  it('balloons and awnings bounce once each; harbour boats are the same phrase on the water', () => {
    const lazy = ride('bounce', { minSpeed: 12 });
    expect(lazy.events.filter((e) => e.type === 'bounce').length).toBe(0);
    const go = ride('bounce', ENGAGED);
    const hits = go.events.filter((e) => e.type === 'bounce');
    expect(go.sim.state.mode, go.sim.state.fail?.message).not.toBe('failed');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hits.map((e) => (e as Extract<SimEvent, { type: 'bounce' }>).bounceId)).size).toBe(hits.length);
    expect(go.course.bounces.every((b) => b.kind === 'balloon')).toBe(true);
    const hook = go.chunk.rides?.find((h) => h.activity === 'bounce');
    expect(hook?.path.length).toBe(go.course.bounces.length);
    const boats = ride('bounce', ENGAGED, ['harbour']);
    expect(boats.course.bounces.every((b) => b.kind === 'boat')).toBe(true);
    expect(boats.events.some((e) => e.type === 'bounce')).toBe(true);
    const awning = ride('awning', ENGAGED);
    expect(awning.sim.state.mode, awning.sim.state.fail?.message).not.toBe('failed');
    expect(awning.events.some((e) => e.type === 'bounce' && (e as Extract<SimEvent, { type: 'bounce' }>).kind === 'awning')).toBe(true);
  });

  it('a lazy rider still finishes every activity, and a chunk carries at most one', () => {
    for (const id of ['wash-line', 'swing-hook', 'updraft', 'bounce', 'awning']) {
      const { sim, chunk } = ride(id, { minSpeed: 10 });
      expect(sim.state.mode, `${id}: ${sim.state.fail?.message}`).not.toBe('failed');
      expect(sim.state.x).toBeGreaterThanOrEqual(chunk.x1);
    }
    const course = new EndlessCourse(7, { zones: ['town', 'harbour'] });
    course.stream(4000);
    for (const c of course.chunks) {
      const n = (c.rails.some((id) => course.rail(id).wash) ? 1 : 0) + ((c.swings?.length ?? 0) > 0 ? 1 : 0) + ((c.bounces?.length ?? 0) > 0 ? 1 : 0) + ((c.updrafts?.length ?? 0) > 0 ? 1 : 0);
      expect(n, c.spec).toBeLessThanOrEqual(1);
    }
  });

  it('the opening course teaches each move and hangs a purple on its hardest point', () => {
    const course = buildOpeningCourse();
    for (const title of ['Washing line', 'Swing', 'Updraft', 'Bounce']) expect(course.lessons.some((l) => l.title === title && !l.required)).toBe(true);
    const rides = course.chunks[0].rides ?? [];
    expect(rides.map((h) => h.activity).sort()).toEqual(['bounce', 'flight', 'swing', 'wash']);
    for (const h of rides) {
      expect(h.path.length).toBeGreaterThan(1);
      expect(course.orbs.some((o) => o.tier === 'rare' && Math.hypot(o.x - h.hardest.x, o.y - h.hardest.y) < 0.4)).toBe(true);
    }
    expect(course.swings[0]?.anchor).toBe('crane');
    expect(course.updrafts[0]?.source).toBe('vent');
    expect(course.bounces.every((b) => b.kind === 'boat')).toBe(true);
  });
});
