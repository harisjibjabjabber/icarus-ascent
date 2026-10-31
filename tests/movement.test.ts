import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Course } from '../src/course/course';
import { buildLabCourse } from '../src/course/lab';
import { TUNING } from '../src/tuning';
import { flatCourse, slopeCourse, chains, push, up, run, stepUntil, driveLab } from './helpers';

const M = TUNING.movement;

describe('push', () => {
  it('one push from rest makes a noticeable speed change', () => {
    const sim = new Simulation(flatCourse());
    sim.enqueue(push(0)); // even the shortest accepted stroke
    sim.step();
    expect(sim.state.speed).toBeGreaterThanOrEqual(2.5);
    const sim2 = new Simulation(flatCourse());
    sim2.enqueue(push(1));
    sim2.step();
    expect(sim2.state.speed).toBeGreaterThan(5.5);
  });

  it('one push at cruising speed is still clearly felt', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 10;
    sim.enqueue(push(0.65)); sim.step();
    expect(sim.state.speed - 10).toBeGreaterThan(2.5);
  });

  it('longer strokes give more impulse (forgiving curve)', () => {
    const sim = new Simulation(flatCourse());
    const i0 = sim.pushImpulse(0), ih = sim.pushImpulse(0.5), i1 = sim.pushImpulse(1);
    expect(ih).toBeGreaterThan(i0);
    expect(i1).toBeGreaterThan(ih);
    // forgiving: half a stroke gives more than half of the extra impulse
    expect((ih - i0) / (i1 - i0)).toBeGreaterThan(0.6);
  });

  it('repeated pushes approach but never exceed the soft cap', () => {
    for (const strength of [0, 0.65, 1]) {
      const sim = new Simulation(flatCourse(100000));
      let max = 0;
      for (let i = 0; i < 300; i++) {
        sim.enqueue(push(strength));
        run(sim, 0.25, (s) => { max = Math.max(max, s.state.speed); });
      }
      expect(max).toBeLessThanOrEqual(M.softCap + 1e-9);
      expect(max).toBeGreaterThan(M.softCap * 0.9);
    }
  });

  it('speed builds controllably: ~4 relaxed pushes reach 75% of cap', () => {
    const sim = new Simulation(flatCourse());
    for (let i = 0; i < 4; i++) { sim.enqueue(push(0.65)); run(sim, 0.4); }
    expect(sim.state.speed).toBeGreaterThan(M.softCap * 0.75);
  });

  it('a growing touch stroke never adds more than its full-length impulse', () => {
    const sim = new Simulation(flatCourse());
    sim.enqueue({ type: 'down', strokeId: 1, strength: 0, fresh: true, source: 'test' });
    for (let s = 0.1; s <= 1.0001; s += 0.1) sim.enqueue({ type: 'down', strokeId: 1, strength: s, fresh: false, source: 'test' });
    sim.step();
    const single = new Simulation(flatCourse());
    single.enqueue(push(1)); single.step();
    expect(sim.state.speed).toBeLessThanOrEqual(single.state.speed + 1e-9);
    expect(sim.state.speed).toBeGreaterThan(single.state.speed * 0.93);
  });

  it('coasting keeps momentum for a while (no constant pushing needed)', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 14;
    run(sim, 3);
    expect(sim.state.speed).toBeGreaterThan(10.5);
  });

  it('hard cap is never exceeded on a long steep descent', () => {
    const sim = new Simulation(slopeCourse(-30, 3000));
    let max = 0;
    run(sim, 30, (s) => { max = Math.max(max, s.state.speed, Math.hypot(s.state.vx, s.state.vy) * 0); });
    expect(max).toBeLessThanOrEqual(M.hardCap);
    expect(max).toBeGreaterThan(M.softCap); // descents can exceed the soft cap
  });
});

describe('slopes', () => {
  it('descents accelerate, climbs consume momentum', () => {
    const down = new Simulation(slopeCourse(-10));
    down.state.speed = 8; run(down, 1);
    expect(down.state.speed).toBeGreaterThan(9.3);
    const upS = new Simulation(slopeCourse(10));
    upS.state.speed = 8; run(upS, 1);
    expect(upS.state.speed).toBeLessThan(6.6);
  });
  it('a small uphill is not exhausting: 5 deg for 1 s costs < 1.5 m/s', () => {
    const sim = new Simulation(slopeCourse(5));
    sim.state.speed = 10; run(sim, 1);
    expect(10 - sim.state.speed).toBeLessThan(1.5);
  });
});

describe('jump', () => {
  it('push followed immediately by jump jumps (same tick and next tick)', () => {
    for (const gap of [0, 1, 3]) {
      const sim = new Simulation(flatCourse());
      sim.enqueue(push(1));
      for (let i = 0; i < gap; i++) sim.step();
      sim.enqueue(up());
      sim.step();
      expect(sim.state.mode).toBe('airborne');
      expect(sim.state.vy).toBeGreaterThan(M.jumpVelocity * 0.9);
      expect(sim.state.vx).toBeGreaterThan(5);
    }
  });

  it('jump from rest still jumps', () => {
    const sim = new Simulation(flatCourse());
    sim.enqueue(up()); sim.step();
    expect(sim.state.mode).toBe('airborne');
  });

  it('jump inherits forward momentum', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 12;
    sim.enqueue(up()); sim.step();
    expect(sim.state.vx).toBeCloseTo(12, 0);
  });

  it('landing preserves momentum (flat and downslope)', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 12;
    sim.enqueue(up());
    sim.step();
    expect(stepUntil(sim, (s) => s.state.mode === 'grounded')).toBe(true);
    expect(sim.state.speed).toBeGreaterThan(11.5);

    // jump off a lip onto a downslope that matches the arc: should gain speed, never reset
    const c = chains(
      [{ x: -10, y: 0 }, { x: 20, y: 0 }],
      [{ x: 22, y: -0.5 }, { x: 60, y: -14 }, { x: 200, y: -14 }],
    );
    const s2 = new Simulation(c);
    s2.state.speed = 12;
    stepUntil(s2, (s) => s.state.mode === 'airborne');
    stepUntil(s2, (s) => s.state.mode === 'grounded');
    expect(s2.state.speed).toBeGreaterThan(11);
  });

  it('repeated uphill jumping never falls through the route', () => {
    for (const deg of [3, 8, 15, 25, 35]) {
      for (const startSpeed of [0, 4, 10, 16]) {
        for (const segments of [1, 37]) {
          const course = slopeCourse(deg, 600, segments);
          const sim = new Simulation(course);
          sim.state.speed = startSpeed;
          let jumps = 0;
          run(sim, 12, (s) => {
            if (s.state.mode === 'grounded') { s.enqueue(up()); jumps++; if (jumps % 3 === 0) s.enqueue(push(1)); }
            const h = Course.sample(course.surfaces[0], s.state.x).y;
            expect(s.state.y).toBeGreaterThanOrEqual(h - 1e-6);
            expect(s.state.mode).not.toBe('failed');
          });
          expect(jumps).toBeGreaterThan(5);
        }
      }
    }
  });

  it('coyote time: Up just after rolling off a ledge still jumps; later it does not', () => {
    const mk = () => {
      const sim = new Simulation(chains([{ x: -10, y: 0 }, { x: 5, y: 0 }], [{ x: 40, y: -30 }, { x: 80, y: -30 }]));
      sim.state.speed = 10;
      stepUntil(sim, (s) => s.state.mode === 'airborne');
      return sim;
    };
    const a = mk(); run(a, 0.05); a.enqueue(up()); a.step();
    expect(a.drainEvents().some((e) => e.type === 'jump' && e.kind === 'coyote')).toBe(true);
    const b = mk(); run(b, 0.25); b.drainEvents(); b.enqueue(up()); b.step();
    expect(b.drainEvents().some((e) => e.type === 'jump')).toBe(false);
  });

  it('jump buffer: Up shortly before touchdown jumps on contact', () => {
    const sim = new Simulation(flatCourse());
    sim.state.speed = 10;
    sim.enqueue(up()); sim.step();
    // wait until ~0.06 s before landing (descending, low)
    stepUntil(sim, (s) => s.state.vy < 0 && s.state.y < 0.35);
    sim.drainEvents();
    sim.enqueue(up());
    stepUntil(sim, (s) => s.state.mode === 'grounded' || s.state.vy > 0, 1);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'land')).toBe(true);
    expect(ev.some((e) => e.type === 'jump' && e.kind === 'buffered')).toBe(true);
    expect(sim.state.mode).toBe('airborne');
  });

  it('a high airborne Up is a backflip, not a buffered jump', () => {
    const sim = new Simulation(flatCourse());
    sim.enqueue(up()); sim.step();
    run(sim, 0.05); // early in a flat jump: ~0.56 s of air left, a flip (0.46 s) fits
    sim.drainEvents();
    sim.enqueue(up()); sim.step();
    expect(sim.drainEvents().some((e) => e.type === 'flip-start')).toBe(true);
    expect(sim.state.jumpBuffer).toBe(0);
  });

  it('an airborne Up too late for a flip to finish is a buffered jump (review H1)', () => {
    const sim = new Simulation(flatCourse());
    sim.enqueue(up()); sim.step();
    stepUntil(sim, (s) => s.state.vy <= 0); // apex: ~0.3 s left
    sim.drainEvents();
    sim.enqueue(up());
    stepUntil(sim, (s) => s.state.mode === 'grounded' || (s.state.vy > 0 && s.state.airTime < 0.1), 1);
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'flip-start')).toBe(false);
    expect(ev.some((e) => e.type === 'jump' && e.kind === 'buffered')).toBe(true);
    expect(sim.state.mode).toBe('airborne');
  });
});

describe('contact and failure', () => {
  it('swept contact: very fast fall onto a thin plateau does not tunnel', () => {
    const c = chains([{ x: -10, y: 50 }, { x: 0, y: 50 }], [{ x: 0.5, y: 0 }, { x: 1000, y: 0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 20;
    stepUntil(sim, (s) => s.state.mode === 'airborne');
    sim.state.vy = -200; // absurd speed: 1.67 m per tick
    stepUntil(sim, (s) => s.state.mode !== 'airborne', 5);
    expect(sim.state.mode).toBe('grounded');
    expect(sim.state.y).toBeCloseTo(0, 5);
  });

  it('lands on the surface where it actually arrives, not the takeoff height', () => {
    const c = chains([{ x: -10, y: 0 }, { x: 10, y: 0 }], [{ x: 14, y: 1.0 }, { x: 40, y: 1.0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 12;
    stepUntil(sim, (s) => s.state.x > 8);
    sim.enqueue(up());
    stepUntil(sim, (s) => s.state.mode === 'grounded' && s.state.x > 14, 3);
    expect(sim.state.surfaceId).toBe(1);
    expect(sim.state.y).toBeCloseTo(1.0, 5);
  });

  it('missing a gap fails with a readable reason', () => {
    const c = chains([{ x: -10, y: 0 }, { x: 5, y: 0 }], [{ x: 30, y: 0 }, { x: 80, y: 0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 6;
    stepUntil(sim, (s) => s.state.mode === 'failed', 10);
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail?.message).toMatch(/short|ledge/i);
  });

  it('falling short into a higher far ledge = ledge face failure', () => {
    const c = chains([{ x: -10, y: 0 }, { x: 5, y: 0 }], [{ x: 8, y: 0.5 }, { x: 80, y: 0.5 }]);
    const sim = new Simulation(c);
    sim.state.speed = 12;
    stepUntil(sim, (s) => s.state.mode === 'failed' || s.state.x > 13, 10);
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail?.kind).toBe('hit-ledge-face');
  });

  it('reaching the lip of the far ledge slightly low still counts (lip catch)', () => {
    const c = chains([{ x: -10, y: 0 }, { x: 5, y: 0 }], [{ x: 6, y: 0 }, { x: 80, y: 0 }]);
    const sim = new Simulation(c);
    sim.state.speed = 12;
    stepUntil(sim, (s) => s.state.x > 10, 10);
    expect(sim.state.mode).toBe('grounded');
  });
});

describe('lab course', () => {
  it('same seed => identical course; different seed => different course', () => {
    const a = buildLabCourse(42), b = buildLabCourse(42), c = buildLabCourse(43);
    expect(JSON.stringify(a.surfaces)).toBe(JSON.stringify(b.surfaces));
    expect(JSON.stringify(a.surfaces)).not.toBe(JSON.stringify(c.surfaces));
  });

  it('is completable across seeds by a competent scripted line (jump, rail, wall)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Simulation(buildLabCourse(seed * 7919));
      driveLab(sim, { minSpeed: 15 });
      expect(sim.state.mode, `seed ${seed * 7919}: ${sim.state.fail?.message}`).toBe('finished');
    }
  });

  it('first gap cannot be cleared by rolling slowly (it must be jumped or attacked with speed)', () => {
    const course = buildLabCourse(1234);
    const sim = new Simulation(course);
    sim.enqueue(push(0.65));
    const done = stepUntil(sim, (s) => {
      if (s.state.mode === 'grounded' && s.state.speed < 2) s.enqueue(push(0));
      return s.state.mode === 'failed' || s.state.x > course.gaps[0].x1 + 5;
    }, 120);
    expect(done).toBe(true);
    expect(sim.state.mode).toBe('failed');
  });
});

describe('speedy tuning', () => {
  it('lab is completable at full speed (push to the cap) across seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Simulation(buildLabCourse(seed * 104729));
      let peak = 0;
      const orig = sim.step.bind(sim);
      sim.step = () => { orig(); peak = Math.max(peak, sim.state.speed); };
      driveLab(sim, { minSpeed: M.softCap * 0.97, strength: 1 });
      expect(sim.state.mode, `seed ${seed * 104729}: ${sim.state.fail?.message}`).toBe('finished');
      expect(peak).toBeGreaterThan(M.softCap * 0.9);
      expect(peak).toBeLessThanOrEqual(M.hardCap);
    }
  });

  it('lab is completable by a moderate rider (keeps ~13 m/s; the wall needs ~12 m/s entry)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new Simulation(buildLabCourse(seed * 31337));
      driveLab(sim, { minSpeed: 13 });
      expect(sim.state.mode, `seed ${seed * 31337}: ${sim.state.fail?.message}`).toBe('finished');
    }
  });

  it('push impulse stays within cap-safe bounds (falloff can never overshoot)', () => {
    expect(M.pushImpulseMax).toBeLessThanOrEqual(M.softCap / 2);
    expect(M.hardCap).toBeGreaterThan(M.softCap);
  });
});
