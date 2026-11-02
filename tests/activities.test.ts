import { describe, it, expect } from 'vitest';
import { EndlessCourse } from '../src/course/endless';
import { buildOpeningCourse } from '../src/course/opening';
import { Simulation } from '../src/sim/simulation';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';

const ENGAGED: AutopilotOptions = { minSpeed: 12, bounce: true };

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
  it('balloons in town and boats in harbour bounce once each', () => {
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
  });

  it('a lazy rider still finishes bounce, and a chunk carries at most one activity', () => {
    const { sim, chunk } = ride('bounce', { minSpeed: 10 });
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(sim.state.x).toBeGreaterThanOrEqual(chunk.x1);
    const course = new EndlessCourse(7, { zones: ['town', 'harbour'] });
    course.stream(4000);
    for (const c of course.chunks) {
      const n = (c.bounces?.length ?? 0) > 0 ? 1 : 0;
      expect(n, c.spec).toBeLessThanOrEqual(1);
    }
  });

  it('the opening course teaches bounce and hangs a purple on its hardest point', () => {
    const course = buildOpeningCourse();
    expect(course.lessons.some((l) => l.title === 'Bounce' && !l.required)).toBe(true);
    const rides = course.chunks[0].rides ?? [];
    expect(rides.map((h) => h.activity)).toEqual(['bounce']);
    for (const h of rides) {
      expect(h.path.length).toBeGreaterThan(1);
      expect(course.orbs.some((o) => o.tier === 'rare' && Math.hypot(o.x - h.hardest.x, o.y - h.hardest.y) < 0.4)).toBe(true);
    }
    expect(course.bounces.every((b) => b.kind === 'boat')).toBe(true);
  });
});
