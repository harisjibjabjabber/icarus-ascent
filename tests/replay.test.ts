import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildLabCourse } from '../src/course/lab';
import { Recorder, replayHeadless } from '../src/diag/recorder';
import type { Action } from '../src/input/actions';
import { mulberry32 } from '../src/rng';

describe('deterministic replay', () => {
  it('recorded input reproduces the exact same run', () => {
    const seed = 777;
    const sim = new Simulation(buildLabCourse(seed));
    const rec = new Recorder(seed);
    const rng = mulberry32(5);
    let id = 0;
    for (let i = 0; i < 120 * 40 && sim.state.mode !== 'failed' && sim.state.mode !== 'finished'; i++) {
      if (rng() < 0.02) {
        const a: Action = rng() < 0.6
          ? { type: 'down', strokeId: ++id, strength: rng(), fresh: true, source: 'test' }
          : { type: 'up', strokeId: ++id, source: 'test' };
        rec.record(sim.state.tick, a);
        sim.enqueue(a);
      }
      sim.step();
    }
    const trace = rec.finish(sim.state.tick);
    const json = JSON.parse(JSON.stringify(trace));
    const replayed = replayHeadless(json);
    expect(replayed).toEqual(sim.state);
  });
});
