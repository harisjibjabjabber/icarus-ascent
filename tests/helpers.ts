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
 * Scripted "competent" lab rider: keeps speed in a band by pushing, jumps every
 * gap, swipes down for required rails and holds right for required walls.
 */
export function driveLab(sim: Simulation, opts: { minSpeed: number; pushEvery?: number; strength?: number; maxSeconds?: number; jumpEarly?: number }): void {
  const course = sim.course;
  const every = opts.pushEvery ?? 36;
  let t = 0, prepDone = false, wallStroke = -1;
  const maxTicks = Math.round((opts.maxSeconds ?? 150) / TUNING.sim.dt);
  for (let i = 0; i < maxTicks; i++) {
    const st = sim.state;
    if (st.mode === 'finished' || st.mode === 'failed') return;
    t++;
    if (st.mode === 'grounded') {
      prepDone = false;
      if (wallStroke !== -1) { sim.enqueue(side('right', false, wallStroke)); wallStroke = -1; }
      if (t % every === 0 && st.speed < opts.minSpeed) sim.enqueue(push(opts.strength ?? 0.65));
      for (const g of course.gaps) {
        const early = g.requires === 'rail' ? 2.2 : (opts.jumpEarly ?? 0.8);
        if (st.x > g.x0 - early && st.x < g.x0 - early + 0.6) sim.enqueue(up());
      }
    } else if (st.mode === 'airborne') {
      const g = course.gaps.find((q) => st.x > q.x0 - 4 && st.x < q.x1);
      if (g?.requires === 'rail' && !prepDone) { sim.enqueue(down()); prepDone = true; }
      if (g?.requires === 'wall' && wallStroke === -1 && st.lastContact !== 'wall') {
        const w = course.walls[0];
        if (st.x >= w.x0) { wallStroke = newId(); sim.enqueue(side('right', true, wallStroke)); }
      }
    }
    sim.step();
  }
}
