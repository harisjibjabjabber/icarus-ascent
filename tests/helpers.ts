import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import type { SimEvent } from '../src/sim/types';
import { Course, type Vec2 } from '../src/course/course';
import { Simulation } from '../src/sim/simulation';
import { TUNING } from '../src/tuning';
import type { Action } from '../src/input/actions';

let sid = 1000;
export const push = (strength = 1): Action => ({ type: 'down', strokeId: ++sid, strength, fresh: true, source: 'test' });
export const up = (): Action => ({ type: 'up', strokeId: ++sid, source: 'test' });

export function flatCourse(length = 5000): Course {
  return new Course(1, [{ id: 0, kind: 'ground', points: [{ x: -10, y: 0 }, { x: length, y: 0 }], material: 'stone', thickness: 4 }], [], [], [], 0, length + 100);
}

export function slopeCourse(deg: number, length = 400, segments = 1): Course {
  const pts: Vec2[] = [];
  const k = Math.tan((deg * Math.PI) / 180);
  for (let i = 0; i <= segments; i++) { const x = -10 + ((length + 10) * i) / segments; pts.push({ x, y: x * k }); }
  return new Course(1, [{ id: 0, kind: 'ground', points: pts, material: 'stone', thickness: 4 }], [], [], [], 0, length + 100);
}

export function chains(...pts: Vec2[][]): Course {
  return new Course(1, pts.map((p, id) => ({ id, kind: 'ground' as const, points: p, material: 'stone' as const, thickness: 4 })), [], [], [], 0, 1e9);
}

export function run(sim: Simulation, seconds: number, each?: (sim: Simulation) => void): void {
  const n = Math.round(seconds / TUNING.sim.dt);
  for (let i = 0; i < n; i++) { each?.(sim); sim.step(); }
}

export function stepUntil(sim: Simulation, pred: (s: Simulation) => boolean, maxSeconds = 20): boolean {
  const n = Math.round(maxSeconds / TUNING.sim.dt);
  for (let i = 0; i < n; i++) { if (pred(sim)) return true; sim.step(); }
  return pred(sim);
}

export const down = (strokeId?: number): Action => ({ type: 'down', strokeId: strokeId ?? ++sid, strength: 0.65, fresh: true, source: 'test' });
export const releaseDown = (strokeId: number): Action => ({ type: 'release', dir: 'down', strokeId, source: 'test' });
export const side = (s: 'left' | 'right', held: boolean, strokeId: number): Action => ({ type: 'side', side: s, held, strokeId, source: 'test' });
export const newId = () => ++sid;

/**
 * Scripted "competent" lab rider (the dev autopilot): keeps speed in a band, jumps
 * gaps, catches required rails, wall-rides required walls, clears pots and tricks
 * before pillars.
 */
export function driveLab(sim: Simulation, opts: AutopilotOptions & { maxSeconds?: number }): SimEvent[] {
  const ap = new Autopilot(opts);
  const ev: SimEvent[] = [];
  const maxTicks = Math.round((opts.maxSeconds ?? 150) / TUNING.sim.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (sim.state.mode === 'finished' || sim.state.mode === 'failed') break;
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return ev;
}
