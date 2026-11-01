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

describe('endless traces carry their zones', () => {
  it('a run recorded on a town -> hills route replays bit-for-bit headless; traces without zones use the default order', async () => {
    const { EndlessCourse } = await import('../src/course/endless');
    const { Autopilot } = await import('../src/diag/autopilot');
    const { ZoneSequence } = await import('../src/zones/sequence');
    const { buildCourseFor } = await import('../src/diag/recorder');
    const zones = ['town', 'hills'];
    const seed = 4, gateAt = new ZoneSequence(zones).boundaries(10000)[0].at;
    const course = new EndlessCourse(seed, { zones });
    const sim = new Simulation(course);
    const rec = new Recorder(seed, 'endless', undefined, zones);
    const ap = new Autopilot({ minSpeed: 15, styleFlips: true });
    for (let i = 0; i < 400 / sim.dt && sim.state.x - course.originX < gateAt + 300 && sim.state.mode !== 'failed'; i++) {
      for (const a of ap.next(sim)) { rec.record(sim.state.tick, a); sim.enqueue(a); }
      sim.step();
    }
    expect(sim.state.mode).not.toBe('failed');
    expect(sim.state.x - course.originX).toBeGreaterThan(gateAt + 300); // rode into the hills
    const trace = JSON.parse(JSON.stringify(rec.finish(sim.state.tick)));
    expect(trace.zones).toEqual(zones);
    expect(replayHeadless(trace)).toEqual(sim.state);
    // an older trace (no zones field) builds the default route
    const { zones: _z, ...old } = trace;
    void _z;
    const dflt = buildCourseFor(old) as InstanceType<typeof EndlessCourse>;
    expect(dflt.zones.zones.map((z) => z.id)).toEqual(['town']);
    expect((buildCourseFor(trace) as InstanceType<typeof EndlessCourse>).zones.zones.map((z) => z.id)).toEqual(zones);
  }, 60000);
});
