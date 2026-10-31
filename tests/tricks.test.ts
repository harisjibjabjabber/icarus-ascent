import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Course, type Vec2 } from '../src/course/course';
import { GestureRecognizer } from '../src/input/gesture';
import { gestureToActions } from '../src/input/mapper';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';
import { push, up, down, releaseDown, side, newId, stepUntil, run, flatCourse, chains } from './helpers';

const K = TUNING.tricks;
const dt = TUNING.sim.dt;

function railCourse(railY = 1.0, rx0 = 20, rx1 = 60, lateral = 2.3): Course {
  return new Course(1, [{ id: 0, kind: 'ground', points: [{ x: -10, y: 0 }, { x: 2000, y: 0 }], material: 'stone', thickness: 4 }],
    [{ id: 0, points: [{ x: rx0, y: railY }, { x: rx1, y: railY - 0.3 }], lateral, required: false }], [], [], 0, 1e9);
}
function wallCourse(): Course {
  return new Course(1, [{ id: 0, kind: 'ground', points: [{ x: -10, y: 0 }, { x: 2000, y: 0 }], material: 'stone', thickness: 4 }],
    [], [{ id: 0, x0: 40, x1: 80, yBottom: -1, yTop: 5, side: 'right', lateral: 2.4, required: false }], [], 0, 1e9);
}
const collect = (sim: Simulation, seconds: number, each?: (s: Simulation) => void): SimEvent[] => {
  const ev: SimEvent[] = [];
  run(sim, seconds, (s) => { each?.(s); });
  ev.push(...sim.drainEvents());
  return ev;
};
/** Step until x passes `x` while grounded, then jump. */
function jumpAt(sim: Simulation, x: number): number {
  stepUntil(sim, (s) => s.state.x >= x);
  const id = newId();
  sim.enqueue({ type: 'up', strokeId: id, source: 'test' });
  sim.step();
  return id;
}

describe('rail grinds', () => {
  it('catches from a range of valid approaches (speeds x jump points x swipe timings)', () => {
    let tried = 0;
    for (const speed of [8, 11, 14, 17, 20]) {
      for (const jx of [6, 10, 14, 18, 24]) {
        for (const delay of [0.05, 0.2, 0.35]) {
          const sim = new Simulation(railCourse());
          sim.state.speed = speed;
          jumpAt(sim, jx);
          run(sim, delay);
          if (sim.state.mode !== 'airborne') continue;
          // only judge approaches whose remaining flight genuinely passes the rail band over the rail
          const probe = new Simulation(sim.course); probe.cloneFrom(sim);
          let passes = false;
          for (let i = 0; i < 200 && probe.state.mode === 'airborne'; i++) {
            const st = probe.state;
            if (st.x >= 20 - K.railCatchBefore && st.x <= 59) {
              const d = st.y - Course.railSample(sim.course.rails[0], Math.max(st.x, 20)).y;
              if (d <= K.railCatchAbove - 0.05 && d >= -K.railCatchBelow + 0.05 && (d >= 0 || st.vy <= K.railCatchMaxRise)) { passes = true; break; }
            }
            probe.step();
          }
          if (!passes) continue;
          tried++;
          const id = newId();
          sim.enqueue(down(id));
          stepUntil(sim, (s) => s.state.mode !== 'airborne', 3);
          expect(sim.state.mode, `speed ${speed} jump@${jx} delay ${delay}`).toBe('grinding');
        }
      }
    }
    expect(tried).toBeGreaterThan(20);
  });

  it('no swipe = no catch: the rider passes the rail', () => {
    const sim = new Simulation(railCourse());
    sim.state.speed = 12;
    jumpAt(sim, 14);
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 3);
    expect(sim.state.mode).toBe('grounded');
  });

  it('a swipe that expired long before the rail does not catch (timing matters)', () => {
    const sim = new Simulation(railCourse(1.0, 40, 80));
    sim.state.speed = 12;
    jumpAt(sim, 2);
    const id = newId();
    sim.enqueue(down(id)); sim.step(); sim.enqueue(releaseDown(id));
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 3);
    expect(sim.state.mode).not.toBe('grinding');
  });

  it('locks to the rail, keeps speed, and releases cleanly upward at its end', () => {
    const sim = new Simulation(railCourse());
    sim.state.speed = 14;
    jumpAt(sim, 14);
    run(sim, 0.15);
    sim.enqueue(down());
    stepUntil(sim, (s) => s.state.mode === 'grinding', 2);
    const v0 = sim.state.speed;
    let maxOff = 0;
    stepUntil(sim, (s) => {
      if (s.state.mode === 'grinding') maxOff = Math.max(maxOff, Math.abs(s.state.y - Course.railSample(s.course.rails[0], s.state.x).y));
      return s.state.mode !== 'grinding';
    }, 6);
    expect(maxOff).toBeLessThan(1e-9);
    expect(sim.state.mode).toBe('airborne');
    expect(sim.state.vy).toBeGreaterThan(0); // readable release pop
    expect(sim.state.speed).toBeGreaterThan(v0 * 0.85);
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 3);
    expect(sim.state.mode).toBe('grounded');
  });

  it('Up while grinding jumps off the rail', () => {
    const sim = new Simulation(railCourse());
    sim.state.speed = 14;
    jumpAt(sim, 14); run(sim, 0.15); sim.enqueue(down());
    stepUntil(sim, (s) => s.state.mode === 'grinding', 2);
    sim.enqueue(up()); sim.step();
    expect(sim.state.mode).toBe('airborne');
    expect(sim.state.vy).toBeGreaterThan(5);
  });
});

describe('backflip', () => {
  it('one long upward swipe = jump only (never jump + flip)', () => {
    const g = new GestureRecognizer(TUNING, 390, 844);
    const sim = new Simulation(flatCourse());
    sim.state.speed = 12;
    let t = 0;
    g.pointerDown(1, 195, 800, t);
    const all: SimEvent[] = [];
    for (let y = 800; y >= 100; y -= 3) {
      t += 6;
      g.pointerMove(1, 195 + Math.sin(y) * 4, y, t);
      for (const e of g.drain()) for (const a of gestureToActions(e)) sim.enqueue(a);
      sim.step(); all.push(...sim.drainEvents());
    }
    g.pointerUp(1, 195, 100, t + 6);
    for (const e of g.drain()) for (const a of gestureToActions(e)) sim.enqueue(a);
    run(sim, 1);
    all.push(...sim.drainEvents());
    expect(all.filter((e) => e.type === 'jump').length).toBe(1);
    expect(all.some((e) => e.type === 'flip-start')).toBe(false);
  });

  it('the jump stroke itself can never trigger the flip (sim-level guard)', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 12;
    sim.enqueue({ type: 'up', strokeId: 777, source: 'test' }); sim.step();
    run(sim, 0.1);
    sim.enqueue({ type: 'up', strokeId: 777, source: 'test' }); sim.step();
    expect(sim.state.air).toBe('none');
    expect(sim.drainEvents().some((e) => e.type === 'reject')).toBe(true);
  });

  it('flip that cannot finish before landing fails with a readable reason', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 12;
    sim.enqueue(up()); sim.step();
    stepUntil(sim, (s) => s.state.vy <= 0); // apex: ~0.3 s left, flip needs 0.46
    sim.enqueue(up());
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 2);
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail?.kind).toBe('unfinished-flip');
    expect(sim.state.fail?.message).toMatch(/mid-flip/);
  });

  it('a flip with enough airtime completes and lands cleanly, keeping momentum', () => {
    const c = chains([{ x: -10, y: 6 }, { x: 10, y: 6 }], [{ x: 14, y: 0 }, { x: 300, y: 0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 12;
    stepUntil(sim, (s) => s.state.x > 8);
    sim.enqueue(up()); sim.step();
    run(sim, 0.08);
    sim.enqueue(up());
    const ev: SimEvent[] = [];
    stepUntil(sim, (s) => { ev.push(...s.drainEvents()); return s.state.mode !== 'airborne'; }, 3);
    ev.push(...sim.drainEvents());
    expect(ev.some((e) => e.type === 'flip-start')).toBe(true);
    expect(ev.some((e) => e.type === 'flip-complete')).toBe(true);
    expect(sim.state.mode).toBe('grounded');
    expect(sim.state.speed).toBeGreaterThan(10.5);
  });

  it('only one flip per jump', () => {
    const c = chains([{ x: -10, y: 12 }, { x: 10, y: 12 }], [{ x: 30, y: 0 }, { x: 300, y: 0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 12;
    stepUntil(sim, (s) => s.state.x > 8);
    sim.enqueue(up()); sim.step(); run(sim, 0.05);
    sim.enqueue(up());
    stepUntil(sim, (s) => s.state.air === 'none' && s.state.flipsThisJump === 1, 2);
    sim.drainEvents();
    sim.enqueue(up()); sim.step();
    expect(sim.drainEvents().some((e) => e.type === 'flip-start')).toBe(false);
  });
});

describe('wall ride vs grab context', () => {
  const airborneAt = (x: number, speed = 14) => {
    const sim = new Simulation(wallCourse());
    sim.state.speed = speed;
    jumpAt(sim, x);
    run(sim, 0.05);
    sim.drainEvents();
    return sim;
  };

  it('right hold beside a valid wall = wall ride', () => {
    const sim = airborneAt(42);
    sim.enqueue(side('right', true, newId())); sim.step();
    expect(sim.state.mode).toBe('wallRiding');
  });

  it('right hold with a wall merely AHEAD = grab, not wall ride', () => {
    const sim = airborneAt(20);
    sim.enqueue(side('right', true, newId())); sim.step();
    expect(sim.state.mode).toBe('airborne');
    expect(sim.state.air).toBe('grabRight');
  });

  it('left hold beside the wall = left grab', () => {
    const sim = airborneAt(42);
    sim.enqueue(side('left', true, newId())); sim.step();
    expect(sim.state.air).toBe('grabLeft');
  });

  it('right hold beside the wall but too slow = grab (no wall ride)', () => {
    const sim = airborneAt(42, 4);
    sim.enqueue(side('right', true, newId())); sim.step();
    expect(sim.state.mode).toBe('airborne');
    expect(sim.state.air).toBe('grabRight');
  });

  it('a right grab still held when the rider reaches the wall becomes a wall ride', () => {
    const sim = airborneAt(34, 16);
    sim.enqueue(side('right', true, newId())); sim.step();
    expect(sim.state.air).toBe('grabRight');
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 2);
    expect(sim.state.mode).toBe('wallRiding');
  });

  it('wall ride carries the rider along the wall and exits into a readable arc; no speed refill', () => {
    const sim = airborneAt(42, 14);
    const id = newId();
    sim.enqueue(side('right', true, id)); sim.step();
    const entry = sim.state.speed;
    let maxSpeed = 0;
    stepUntil(sim, (s) => { maxSpeed = Math.max(maxSpeed, s.state.speed); return s.state.mode !== 'wallRiding'; }, 5);
    expect(maxSpeed).toBeLessThanOrEqual(entry + 1e-9);
    expect(['airborne', 'grounded']).toContain(sim.state.mode); // wall end pop, or ground rising under the ride
    expect(sim.state.x).toBeGreaterThan(50);
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 3);
    expect(sim.state.mode).toBe('grounded'); // the spent hold did not become a grab
  });

  it('a right swipe near a wall never starts a flip (gesture -> sim)', () => {
    for (const path of [[[150, 500], [260, 510]], [[150, 500], [235, 420]]] as [number, number][][]) { // straight right, and a 45 deg up-right diagonal
      const sim = airborneAt(42);
      const g = new GestureRecognizer(TUNING, 390, 844);
      let t = 0;
      g.pointerDown(1, path[0][0], path[0][1], t);
      const [a, b] = path;
      for (let k = 1; k <= 30; k++) { t += 8; g.pointerMove(1, a[0] + ((b[0] - a[0]) * k) / 30, a[1] + ((b[1] - a[1]) * k) / 30, t); }
      for (const e of g.drain()) for (const act of gestureToActions(e)) sim.enqueue(act);
      sim.step();
      const ev = sim.drainEvents();
      expect(ev.some((e) => e.type === 'flip-start')).toBe(false);
      expect(sim.state.mode).toBe('wallRiding');
    }
  });

  it('landing while holding a grab fails; releasing first lands cleanly', () => {
    const a = airborneAt(10, 10);
    a.enqueue(side('left', true, newId()));
    stepUntil(a, (s) => s.state.mode !== 'airborne', 2);
    expect(a.state.fail?.kind).toBe('landed-grabbing');
    const b = airborneAt(10, 10);
    const id = newId();
    b.enqueue(side('left', true, id)); run(b, 0.15); b.enqueue(side('left', false, id));
    stepUntil(b, (s) => s.state.mode !== 'airborne', 2);
    expect(b.state.mode).toBe('grounded');
  });
});

describe('heel skim', () => {
  const skimSim = (speed = 14) => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = speed;
    sim.enqueue(up()); sim.step();
    run(sim, 0.25);
    const id = newId();
    sim.enqueue(down(id));
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 2);
    return { sim, id };
  };

  it('jump + down held into landing = heel skim', () => {
    const { sim } = skimSim();
    expect(sim.state.mode).toBe('heelSkim');
  });

  it('persists while held and slows progressively (decel grows over time)', () => {
    const { sim } = skimSim(16);
    const v0 = sim.state.speed;
    run(sim, 0.5);
    const v1 = sim.state.speed;
    run(sim, 0.5);
    const v2 = sim.state.speed;
    expect(sim.state.mode).toBe('heelSkim');
    expect(v0 - v1).toBeGreaterThan(0.5);
    expect(v1 - v2).toBeGreaterThan(v0 - v1); // progressive
    // compare to plain rolling
    const roll = new Simulation(flatCourse()); roll.state.speed = v0; run(roll, 1);
    expect(v2).toBeLessThan(roll.state.speed - 1);
  });

  it('does not end after an arbitrary time while held', () => {
    const { sim } = skimSim(20);
    run(sim, 1.6);
    expect(sim.state.mode).toBe('heelSkim');
  });

  it('release returns to normal rolling immediately', () => {
    const { sim, id } = skimSim();
    run(sim, 0.3);
    sim.enqueue(releaseDown(id)); sim.step();
    expect(sim.state.mode).toBe('grounded');
  });

  it('a fresh push ends the skim immediately and pushes', () => {
    const { sim } = skimSim();
    run(sim, 0.3);
    const v = sim.state.speed;
    sim.enqueue(push(0.65)); sim.step();
    expect(sim.state.mode).toBe('grounded');
    expect(sim.state.speed).toBeGreaterThan(v + 2);
  });

  it('an early airborne down that was released does not force a skim or freeze the rider', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 14;
    sim.enqueue(up()); sim.step();
    const id = newId();
    sim.enqueue(down(id)); sim.step(); sim.enqueue(releaseDown(id));
    const vx = sim.state.vx;
    run(sim, 0.1);
    expect(sim.state.mode).toBe('airborne');
    expect(sim.state.vx).toBeGreaterThan(vx - 0.2);
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 2);
    expect(sim.state.mode).toBe('grounded');
  });

  it('Up from a heel skim jumps', () => {
    const { sim } = skimSim();
    sim.enqueue(up()); sim.step();
    expect(sim.state.mode).toBe('airborne');
  });
});

describe('lab features are genuine', () => {
  it('required rail gap cannot be cleared by a plain jump even at the hard cap', async () => {
    const { buildLabCourse } = await import('../src/course/lab');
    for (const kind of ['rail', 'wall'] as const) {
      for (let seed = 1; seed <= 10; seed++) {
        const course = buildLabCourse(seed * 977);
        const g = course.gaps.find((q) => q.requires === kind)!;
        const surf = course.surfaces.find((s) => Math.abs(Course.x1(s) - g.x0) < 0.01)!;
        const sim = new Simulation(course);
        const sm = Course.sample(surf, g.x0 - 0.5);
        Object.assign(sim.state, { x: g.x0 - 0.5, y: sm.y, surfaceId: surf.id, seg: sm.seg, angle: Math.atan(sm.slope), speed: TUNING.movement.hardCap });
        sim.enqueue(up());
        stepUntil(sim, (s) => s.state.mode === 'failed' || s.state.mode === 'grounded' && s.state.x > g.x1, 5);
        expect(sim.state.mode, `${kind} seed ${seed}`).toBe('failed');
        expect(sim.state.fail?.kind).toMatch(kind === 'rail' ? /missed-rail/ : /missed-wall/);
      }
    }
  });

  it('optional rail is beside the ordinary route; required rail is on it', async () => {
    const { buildLabCourse } = await import('../src/course/lab');
    const c = buildLabCourse(5);
    expect(c.rails.find((r) => !r.required)!.lateral).toBeGreaterThan(1.5);
    expect(c.rails.find((r) => r.required)!.lateral).toBe(0);
    expect(c.walls[0].required).toBe(true);
    expect(c.walls[0].x1 - c.walls[0].x0).toBeGreaterThan(30);
  });
});

void dt; void ([] as Vec2[]);
