import type { Action } from '../input/actions';
import { Simulation } from '../sim/simulation';
import { buildLabCourse } from '../course/lab';
import { buildOpeningCourse } from '../course/opening';
import type { RiderState } from '../sim/types';

/** Input trace: everything needed to replay a run bit-for-bit. */
export interface Trace {
  version: 1;
  course: 'lab' | 'opening';
  seed: number;
  /** Checkpoint start (opening retries), if not the course start. */
  start?: { x: number; speed: number };
  entries: { tick: number; action: Action }[];
  endTick: number;
}

export class Recorder {
  trace: Trace;
  constructor(seed: number, course: 'lab' | 'opening' = 'lab', start?: { x: number; speed: number }) {
    this.trace = { version: 1, course, seed, entries: [], endTick: 0, ...(start ? { start } : {}) };
  }
  record(tick: number, action: Action): void { this.trace.entries.push({ tick, action: { ...action } }); }
  finish(tick: number): Trace { this.trace.endTick = tick; return this.trace; }
}

/** Feeds a trace into a fresh simulation, tick by tick. */
export class Replayer {
  private i = 0;
  constructor(readonly trace: Trace) {}
  actionsFor(tick: number): Action[] {
    const out: Action[] = [];
    const e = this.trace.entries;
    while (this.i < e.length && e[this.i].tick <= tick) out.push({ ...e[this.i++].action, source: 'replay' } as Action);
    return out;
  }
  get done(): boolean { return this.i >= this.trace.entries.length; }
}

/** Headless replay (tests, bug repro): returns the final state. */
export function replayHeadless(trace: Trace, extraTicks = 0): RiderState {
  const sim = new Simulation(trace.course === 'opening' ? buildOpeningCourse() : buildLabCourse(trace.seed), undefined, trace.start);
  const rp = new Replayer(trace);
  const end = trace.endTick + extraTicks;
  while (sim.state.tick < end) {
    for (const a of rp.actionsFor(sim.state.tick)) sim.enqueue(a);
    sim.step();
  }
  return sim.state;
}
