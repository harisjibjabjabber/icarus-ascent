import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Course, type Vec2 } from '../src/course/course';
import { extend, linear, smooth, crestPop, rollingHills } from '../src/course/shapes';
import { buildLabCourse } from '../src/course/lab';
import { buildOpeningCourse } from '../src/course/opening';
import { Autopilot } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';
import { up, stepUntil } from './helpers';

const M = TUNING.movement;
function course(build: (p: Vec2[]) => void): Course {
  const p: Vec2[] = [{ x: -10, y: 0 }];
  extend(p, 40, 0, linear, 4);
  build(p);
  extend(p, p[p.length - 1].x + 400, p[p.length - 1].y, linear, 4);
  return new Course(1, [{ id: 0, kind: 'ground', points: p, material: 'stone', thickness: 4 }], [], [], [], 0, 1e9);
}
function run(sim: Simulation, seconds: number, each?: (s: Simulation, ev: SimEvent[]) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < seconds / sim.dt && sim.state.mode !== 'failed'; i++) { each?.(sim, ev); sim.step(); ev.push(...sim.drainEvents()); }
  return ev;
}
const crests = (ev: SimEvent[]) => ev.filter((e): e is Extract<SimEvent, { type: 'leave-edge' }> => e.type === 'leave-edge' && e.crest);

describe('crest separation (no gap needed)', () => {
  const pop = course((p) => crestPop(p, 2.2, 10, 2.0, 18));

  it('launches off a crest above a speed threshold, rolls over it below', () => {
    const launched = (v: number) => crests(run(new Simulation(pop, TUNING, { x: 20, speed: v }), 4)).length > 0;
    expect(launched(4)).toBe(false);
    expect(launched(6)).toBe(false);
    expect(launched(12)).toBe(true);
    expect(launched(20)).toBe(true);
    // monotonic: once it launches at some speed, it launches at every higher speed
    let first = -1;
    for (let v = 2; v <= M.hardCap; v += 0.5) { const l = launched(v); if (l && first < 0) first = v; if (first > 0) expect(l, `v=${v}`).toBe(true); }
    expect(first).toBeGreaterThan(M.crestMinSpeed - 0.01);
  });

  it('a slow rider stays grounded over the crest and never fails', () => {
    const sim = new Simulation(pop, TUNING, { x: 20, speed: 5 });
    const ev = run(sim, 8);
    expect(ev.some((e) => e.type === 'fail')).toBe(false);
    expect(ev.some((e) => e.type === 'leave-edge')).toBe(false);
  });

  it('landing on the down-slope keeps (or adds) speed', () => {
    for (const v of [12, 16, 20, 24]) {
      const sim = new Simulation(pop, TUNING, { x: 20, speed: v });
      const ev = run(sim, 4);
      const leave = crests(ev)[0];
      expect(leave, `v=${v}`).toBeTruthy();
      const land = ev.find((e) => e.type === 'land') as Extract<SimEvent, { type: 'land' }>;
      expect(land).toBeTruthy();
      expect(land.speedAfter, `v=${v}`).toBeGreaterThanOrEqual(sim.state.takeoffSpeed * 0.95);
      expect(ev.some((e) => e.type === 'fail')).toBe(false);
    }
  });

  it('a jump buffered/coyote right at the crest adds pop (higher than the plain launch)', () => {
    const plain = new Simulation(pop, TUNING, { x: 20, speed: 16 });
    let maxPlain = -Infinity;
    run(plain, 3, (s) => { maxPlain = Math.max(maxPlain, s.state.y); });
    const popped = new Simulation(pop, TUNING, { x: 20, speed: 16 });
    let maxPop = -Infinity, sent = false;
    run(popped, 3, (s) => { if (!sent && s.state.mode === 'airborne') { s.enqueue(up()); sent = true; } maxPop = Math.max(maxPop, s.state.y); });
    expect(maxPop).toBeGreaterThan(maxPlain + 0.5);
  });

  it('a backflip is completable off a big kicker with no gap, landing clean on the down-slope', () => {
    const big = course((p) => { extend(p, p[p.length - 1].x + 50, -12, smooth, 1.5); extend(p, p[p.length - 1].x + 10, -12, linear, 4); crestPop(p, 2.2, 10, 2.5, 18); });
    const sim = new Simulation(big, TUNING, { x: 30, speed: 12 });
    let flipSent = false;
    const ev = run(sim, 10, (s) => { if (!flipSent && s.state.mode === 'airborne' && s.state.airTime > M.coyoteTime + 0.01) { s.enqueue(up()); flipSent = true; } });
    expect(crests(ev).length).toBe(1);
    expect(ev.some((e) => e.type === 'fail')).toBe(false);
    expect(ev.some((e) => e.type === 'flip-complete')).toBe(true);
    const land = ev.find((e) => e.type === 'land') as Extract<SimEvent, { type: 'land' }>;
    expect(land.flipped).toBe(true);
  });
});

describe('no false launches', () => {
  it('gentle undulations never pop, even at the hard cap', () => {
    const gentle = course((p) => rollingHills(p, 10, 0.4, 30));
    const ev = run(new Simulation(gentle, TUNING, { x: 20, speed: M.hardCap }), 12);
    expect(ev.some((e) => e.type === 'leave-edge')).toBe(false);
  });

  it('a pronounced rolling-hills chain pops fast riders on each crest, not slow ones', () => {
    const hills = course((p) => rollingHills(p, 4, 1.4, 18));
    expect(crests(run(new Simulation(hills, TUNING, { x: 30, speed: 12 }), 6)).length).toBe(0);
    expect(crests(run(new Simulation(hills, TUNING, { x: 30, speed: 24 }), 6)).length).toBeGreaterThanOrEqual(2);
  });

  it('valleys (concave transitions) never launch; smooth descents never launch', () => {
    const v = course((p) => { extend(p, 100, -12, smooth, 1.5); extend(p, 120, -12, linear, 4); extend(p, 160, -4, smooth, 1.5); });
    const ev = run(new Simulation(v, TUNING, { x: 20, speed: M.hardCap }), 10);
    expect(ev.some((e) => e.type === 'leave-edge')).toBe(false);
  });

  it('on the lab and opening, crest launches happen only at designed crests', () => {
    const op = buildOpeningCourse();
    const designed = [op.lessons[1].featureX];
    for (const c of [op, buildLabCourse(12345), buildLabCourse(7)]) {
      for (const cfg of [{ minSpeed: 13 }, { minSpeed: 30, strength: 1 }]) {
        const sim = new Simulation(c);
        const ap = new Autopilot(cfg);
        const ev: SimEvent[] = [];
        for (let i = 0; i < 200 / sim.dt && sim.state.mode !== 'failed' && sim.state.mode !== 'finished'; i++) { for (const a of ap.next(sim)) sim.enqueue(a); sim.step(); ev.push(...sim.drainEvents()); }
        expect(sim.state.mode).toBe('finished');
        for (const e of crests(ev)) expect(c === op && designed.some((x) => Math.abs(e.x - x) < 3), `unexpected crest launch at ${e.x.toFixed(1)}`).toBe(true);
      }
    }
  });
});

describe('opening crest pop', () => {
  it('after the descent lesson gives style airtime (enough for a flip) at normal speeds, with a clean down-slope landing', () => {
    const op = buildOpeningCourse();
    for (const cfg of [{ minSpeed: 10 }, { minSpeed: 13 }, { minSpeed: 30, strength: 1 }]) {
      const sim = new Simulation(op);
      const ap = new Autopilot(cfg);
      let t0 = -1, air = 0;
      for (let i = 0; i < 40 / sim.dt && air === 0; i++) {
        for (const a of ap.next(sim)) sim.enqueue(a);
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type === 'leave-edge' && e.crest) t0 = sim.state.tick;
          if (e.type === 'land' && t0 >= 0) { air = (sim.state.tick - t0) * sim.dt; expect(e.speedAfter).toBeGreaterThan(14); }
        }
      }
      expect(air, JSON.stringify(cfg)).toBeGreaterThan(TUNING.tricks.flipDuration + 0.1);
    }
  });
});

describe('downhill momentum', () => {
  it('descents pull noticeably harder than climbs cost', () => {
    expect(M.slopeGravityDown).toBeGreaterThan(M.slopeGravityUp * 1.3);
    const down = course((p) => extend(p, 100, -10, smooth, 1.5));
    const sd = new Simulation(down, TUNING, { x: 30, speed: 6 });
    stepUntil(sd, (s) => s.state.x > 110, 20);
    expect(sd.state.speed - 6).toBeGreaterThan(9); // a 10 m drop is a big boost
    const upC = course((p) => extend(p, 100, 10, smooth, 1.5));
    const su = new Simulation(upC, TUNING, { x: 30, speed: 20 });
    stepUntil(su, (s) => s.state.x > 110 || s.state.speed <= 0, 20);
    expect(su.state.speed).toBeGreaterThan(8); // a 10 m climb is a moderate cost
  });

  it('long descents can run past the soft cap, never the hard cap', () => {
    const steep = course((p) => extend(p, 400, -80, linear, 4));
    const sim = new Simulation(steep, TUNING, { x: 30, speed: 15 });
    let max = 0;
    run(sim, 20, (s) => { if (s.state.mode === 'grounded') max = Math.max(max, s.state.speed); });
    expect(max).toBeGreaterThan(M.softCap + 2);
    expect(max).toBeLessThanOrEqual(M.hardCap + 1e-9);
  });

  it('uphill jumping still never causes a false fall or a crest launch on the climb', () => {
    const climb = course((p) => { extend(p, 90, 6, smooth, 1.5); extend(p, 130, 6, linear, 4); });
    for (const v of [8, 14, 20]) {
      const sim = new Simulation(climb, TUNING, { x: 30, speed: v });
      const ev = run(sim, 6, (s) => { if (s.state.mode === 'grounded' && s.state.tick % 40 === 0 && s.state.x < 95) s.enqueue(up()); });
      expect(ev.some((e) => e.type === 'fail'), `v=${v}`).toBe(false);
      for (const e of crests(ev)) expect(e.x).toBeGreaterThan(85); // only at the top transition if at all
    }
  });
});
