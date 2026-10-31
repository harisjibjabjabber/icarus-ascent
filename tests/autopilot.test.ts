import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildLabCourse } from '../src/course/lab';
import { Autopilot } from '../src/diag/autopilot';
import type { SimEvent } from '../src/sim/types';

function ride(seed: number, opts: ConstructorParameters<typeof Autopilot>[0]) {
  const sim = new Simulation(buildLabCourse(seed));
  const ap = new Autopilot(opts);
  const ev: SimEvent[] = [];
  for (let i = 0; i < 150 * 120 && sim.state.mode !== 'finished' && sim.state.mode !== 'failed'; i++) {
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return { sim, ev };
}

describe('dev autopilot (drives screenshots)', () => {
  for (const seed of [12345, 7, 99]) {
    it(`finishes lab seed ${seed} using both rails, the wall and a ramp backflip`, () => {
      const { sim, ev } = ride(seed, { minSpeed: 15, strength: 1, optionalRail: true, flipAtFirstGap: true });
      const fail = ev.find((e) => e.type === 'fail');
      expect(fail && fail.type === 'fail' ? fail.info.message : '').toBe('');
      expect(sim.state.mode).toBe('finished');
      expect(ev.filter((e) => e.type === 'grind-start').length).toBe(2);
      expect(ev.some((e) => e.type === 'wall-start')).toBe(true);
      expect(ev.some((e) => e.type === 'flip-complete')).toBe(true);
    });
  }
});
