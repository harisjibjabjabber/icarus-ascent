/**
 * Regression tests from the independent quality review (brief §12 "Fifth").
 * Each block names the finding it guards (H1..H3 high, M1..M6 medium).
 */
import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildOpeningCourse } from '../src/course/opening';
import { PointerRouter } from '../src/input/router';
import { GestureRecognizer } from '../src/input/gesture';
import { TUNING } from '../src/tuning';
import { flatCourse, run } from './helpers';
import { drive, fires, ray, rng, Finger, rideTo, settle, nid, type P } from './reviewHelpers';

const dt = TUNING.sim.dt;
const up = (lean?: number) => ({ type: 'up' as const, strokeId: nid(), source: 'test' as const, ...(lean !== undefined ? { lean } : {}) });

describe('H1: an Up too late for a flip never causes a mid-flip failure', () => {
  it('second Up anywhere from 40 to 450 ms before a flat-jump touchdown: no failure, re-jumps', () => {
    const air = (2 * TUNING.movement.jumpVelocity) / TUNING.movement.airGravity;
    for (let before = 40; before <= 450; before += 10) {
      const sim = new Simulation(flatCourse(), TUNING, { x: 0, speed: 15 });
      sim.enqueue(up()); sim.step();
      run(sim, air - before / 1000);
      sim.drainEvents();
      sim.enqueue(up());
      let buffered = false;
      for (let i = 0; i < 120 && sim.state.mode !== 'failed'; i++) { sim.step(); for (const e of sim.drainEvents()) if (e.type === 'jump' && e.kind === 'buffered') buffered = true; if (buffered) break; }
      for (let i = 0; i < 200 && sim.state.mode === 'airborne'; i++) sim.step();
      expect(sim.state.mode, `${before} ms`).not.toBe('failed');
      // too late for a flip to finish => buffered jump; earlier presses may flip and land cleanly
      if (before <= 400) expect(buffered, `${before} ms`).toBe(true);
    }
  });
  it('an early second Up with enough air is still a backflip that lands cleanly', () => {
    const sim = new Simulation(flatCourse(), TUNING, { x: 0, speed: 15 });
    sim.enqueue(up()); sim.step(); run(sim, 0.08); sim.drainEvents();
    sim.enqueue(up()); sim.step();
    expect(sim.state.air).toBe('flip');
    for (let i = 0; i < 200 && sim.state.mode === 'airborne'; i++) sim.step();
    expect(sim.state.mode).toBe('grounded');
  });
});

describe('H2: hold-aware reversal (a relaxing thumb never ends a hold)', () => {
  it('slow drift back during a right hold does not end it; a fast flick back still reverses', () => {
    for (const drift of [0.03, 0.05, 0.08]) {
      const ev = drive([[0.4, 0.6], [0.52, 0.6], [0.52 - drift, 0.6]], { speed: 0.08 });
      expect(ev.filter((e) => e.kind === 'end').map((e: any) => e.reason), `drift ${drift}`).toEqual(['lift']);
      expect(fires(ev)).toEqual(['right']);
    }
    expect(fires(drive([[0.4, 0.6], [0.52, 0.6], [0.4, 0.6]], { speed: 1.5 }))).toEqual(['right', 'left']);
  });
  it('slow drift up during a down hold (heel skim / rail catch) does not fire up', () => {
    for (const drift of [0.03, 0.05, 0.08]) expect(fires(drive([[0.5, 0.5], [0.5, 0.6], [0.5, 0.6 - drift]], { speed: 0.08 }))).toEqual(['down']);
  });
  it('push -> jump reversal stays reliable over randomised fast traces (>= 99.5%)', () => {
    const r = rng(42); let ok = 0; const N = 1500;
    for (let i = 0; i < N; i++) {
      const s: P = [0.5, 0.5], m = ray(s, 270 + (r() - 0.5) * 40, 0.05 + r() * 0.17), e = ray(m, 90 + (r() - 0.5) * 50, 0.06 + r() * 0.15);
      if (fires(drive([s, m, e], { hz: r() < 0.5 ? 60 : 120, jitter: r() * 0.003, seed: i + 7, speed: 0.8 + r() * 2.5 })).join('+') === 'down+up') ok++;
    }
    expect(ok / N).toBeGreaterThanOrEqual(0.995);
  });
  it('one long stroke never double-fires under jitter', () => {
    const r = rng(9); let bad = 0;
    for (let i = 0; i < 1500; i++) {
      const dir = ['up', 'down', 'right'][i % 3], a = dir === 'up' ? 90 : dir === 'down' ? 270 : 0;
      const f = fires(drive([[0.5, 0.6], ray([0.5, 0.6], a + (r() - 0.5) * 20, 0.12 + r() * 0.3)], { jitter: 0.003, seed: i, speed: 0.5 + r() * 2 }));
      if (f.length !== 1 || f[0] !== dir) bad++;
    }
    expect(bad / 1500).toBeLessThan(0.005);
  });

  const wallSetup = () => {
    const c = buildOpeningCourse(); const L = c.lessons[8]; const w = c.walls[0];
    const sim = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed }); rideTo(sim, w.x0 + 4 - 1.5, 19);
    const f = new Finger(sim); f.press(0.5, 1.2); f.move(0, -0.12, 70); f.lift(); f.idle(120);
    return { sim, f, w };
  };
  it('full pipeline: wall ride survives the thumb easing back 12-25 px (opening lesson 9)', () => {
    for (const drift of [0.032, 0.064]) {
      const { sim, f, w } = wallSetup();
      f.press(0.4, 1.2); f.move(0.12, 0, 80); f.hold(300); f.move(-drift, 0, 250); f.hold(2200); f.lift();
      settle(sim, w.x1 + 8);
      expect(sim.state.mode, `drift ${drift}`).toBe('grounded');
    }
  });
  it('full pipeline: a relaxed right grab never turns into a left grab and a landing failure', () => {
    const sim = new Simulation(flatCourse(), TUNING, { x: 0, speed: 15 }); const f = new Finger(sim);
    f.press(0.5, 1.2); f.move(0, -0.12, 70); f.lift(); f.idle(40);
    f.press(0.4, 1.0); f.move(0.12, 0, 60); f.move(-0.1, 0, 300); f.lift(); run(sim, 1);
    expect(sim.state.mode).toBe('grounded');
  });
  it('full pipeline: required rail still caught when the thumb drifts up 20 px while holding down', () => {
    const c = buildOpeningCourse(); const L = c.lessons[6]; const g = c.gaps.find((q) => q.requires === 'rail')!;
    const sim = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed }); rideTo(sim, g.x0 - 6, 16);
    const f = new Finger(sim); f.press(0.5, 1.2); f.move(0, -0.12, 70); f.lift(); f.idle(60);
    let grind = false; f.press(0.5, 1.0); f.move(0, 0.1, 60); f.move(0, -0.05, 400); // ~50 px/s drift
    for (let i = 0; i < 80; i++) { f.hold(8.4); if (sim.state.mode === 'grinding') grind = true; }
    f.lift(); settle(sim, g.x1 + 10);
    expect(grind).toBe(true);
    expect(sim.state.mode).not.toBe('failed');
  });
  it('failure messages name the real cause: wall let go / rail mid-flip', () => {
    const { sim, w } = wallSetup();
    const id = nid(); sim.enqueue({ type: 'side', side: 'right', held: true, strokeId: id, source: 'test' }); run(sim, 0.5);
    expect(sim.state.mode).toBe('wallRiding');
    sim.drainEvents();
    sim.enqueue({ type: 'side', side: 'right', held: false, strokeId: id, source: 'test' }); settle(sim, w.x1 + 8);
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail!.message).toMatch(/Let go of the wall/);

    const c = buildOpeningCourse(); const L = c.lessons[6]; const g = c.gaps.find((q) => q.requires === 'rail')!;
    const s2 = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed }); rideTo(s2, g.x0 - 5, 16);
    s2.enqueue(up()); s2.step(); run(s2, 0.06); s2.enqueue(up()); s2.step(); // flip
    expect(s2.state.air).toBe('flip');
    // armed mid-flip: the catch waits for the rotation to finish, then locks on (and if the rail had
    // run out first, the failure would say "Reached the rail mid-flip")
    s2.enqueue({ type: 'down', strokeId: nid(), strength: 0.6, fresh: true, source: 'test' });
    let blocked = false, grind = false;
    for (let i = 0; i < 400 && s2.state.mode !== 'failed'; i++) { s2.step(); if (s2.state.railBlockedByFlip) blocked = true; if (s2.state.mode === 'grinding') grind = true; }
    expect(blocked).toBe(true);
    expect(grind).toBe(true);
  });
});

describe('H3: wall gestures never flip', () => {
  it('up-right strokes of any angle 30-80° at a wall give a wall ride (full pipeline)', () => {
    const c0 = buildOpeningCourse(); const w0 = c0.walls[0]; void w0;
    for (const ang of [30, 45, 50, 55, 60, 70, 80]) {
      const c = buildOpeningCourse(); const L = c.lessons[8]; const w = c.walls[0];
      const sim = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed }); rideTo(sim, w.x0 + 4 - 1.5, 19);
      const f = new Finger(sim); f.press(0.5, 1.2); f.move(0, -0.12, 70); f.lift(); f.idle(120);
      const a = (ang * Math.PI) / 180; f.press(0.4, 1.2); f.move(0.14 * Math.cos(a), -0.14 * Math.sin(a), 90);
      let flipped = false, rode = false;
      for (let i = 0; i < 300; i++) { f.hold(8.4); if (sim.state.air === 'flip') flipped = true; if (sim.state.mode === 'wallRiding') rode = true; }
      f.lift(); settle(sim, w.x1 + 8);
      expect(flipped, `${ang}°`).toBe(false);
      expect(rode, `${ang}°`).toBe(true);
      expect(sim.state.mode, `${ang}°`).toBe('grounded');
    }
  });
  it('one-stroke L (up to jump, then right without lifting) wall-rides', () => {
    const c = buildOpeningCourse(); const L = c.lessons[8]; const w = c.walls[0];
    const sim = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed }); rideTo(sim, w.x0 + 4 - 1.5, 19);
    const f = new Finger(sim); f.press(0.5, 1.2); f.move(0, -0.12, 70); f.move(0.15, 0, 120); f.hold(2500); f.lift();
    settle(sim, w.x1 + 8);
    expect(sim.state.mode).toBe('grounded');
  });
  it('recogniser: an up stroke that turns sideways starts a sideways stroke', () => {
    expect(fires(drive([[0.5, 0.7], [0.5, 0.6], [0.65, 0.6]]))).toEqual(['up', 'right']);
    expect(fires(drive([[0.5, 0.7], [0.5, 0.6], [0.35, 0.6]]))).toEqual(['up', 'left']);
    // wobble while moving up is not a turn
    expect(fires(drive([[0.5, 1.2], [0.54, 1.0], [0.47, 0.8], [0.5, 0.815], [0.53, 0.6], [0.49, 0.3]]))).toEqual(['up']);
  });
  it('away from walls an up-right stroke is still a flip; near a wall a straight Up (keys) is too', () => {
    const sim = new Simulation(flatCourse(), TUNING, { x: 0, speed: 15 });
    sim.enqueue(up()); sim.step(); run(sim, 0.05); sim.enqueue(up(0.6)); sim.step();
    expect(sim.state.air).toBe('flip');
  });
});

describe('M1: a push stroke begun just before a crest landing still pushes', () => {
  const atCrestLanding = (leadMs: number) => {
    const c = buildOpeningCourse(); const L = c.lessons[1];
    const sim = new Simulation(c, TUNING, { x: L.cpX, speed: L.cpSpeed });
    let n = 0; while (!(sim.state.mode === 'airborne' && sim.state.leftBy === 'crest') && n++ < 1e5) sim.step();
    const k = sim.predictContact().t / dt;
    for (let i = 0; i < k - Math.round(leadMs / 1000 / dt); i++) sim.step();
    sim.drainEvents();
    return sim;
  };
  it('released within the window: one push, no lingering heel skim', () => {
    for (const lead of [40, 80, 150, 240]) {
      const sim = atCrestLanding(lead); const f = new Finger(sim);
      f.press(0.5, 0.9); f.move(0, 0.15, 160); f.lift(); f.idle(300);
      const ev = sim.drainEvents();
      expect(ev.filter((e) => e.type === 'push').length, `${lead} ms`).toBe(1);
      expect(sim.state.mode, `${lead} ms`).toBe('grounded');
    }
  });
  it('held into the landing it is still a heel skim (jump, hold down near landing)', () => {
    const sim = atCrestLanding(100); const f = new Finger(sim);
    f.press(0.5, 0.9); f.move(0, 0.1, 60); f.hold(700);
    expect(sim.state.mode).toBe('heelSkim');
    f.lift(); f.idle(20);
    expect(sim.state.mode).toBe('grounded');
  });
});

describe('M5/M7: pointer routing', () => {
  it('a second finger never ends the first finger\u2019s hold', () => {
    const r = new PointerRouter(new GestureRecognizer(TUNING, 390, 844), TUNING, 390, 844);
    r.down(1, 150, 400, 0); for (let i = 1; i <= 10; i++) r.move(1, 150 + i * 5, 400, i * 8);
    r.down(2, 250, 600, 100); for (let i = 1; i <= 10; i++) r.move(2, 250, 600 - i * 3, 100 + i * 8); r.up(2, 250, 570, 190);
    const ev = r.drain();
    expect(ev.filter((e) => e.kind === 'fire').map((e: any) => e.dir)).toEqual(['right', 'up']);
    expect(ev.some((e: any) => e.kind === 'end' && e.dir === 'right')).toBe(false);
    r.up(1, 200, 400, 300);
    expect(r.drain().some((e: any) => e.kind === 'end' && e.dir === 'right' && e.reason === 'lift')).toBe(true);
  });
  it('touches starting in the bottom 4% (OS gesture strip) are ignored; mice are not', () => {
    const r = new PointerRouter(new GestureRecognizer(TUNING, 390, 844), TUNING, 390, 844);
    r.down(1, 200, 836, 0); for (let i = 1; i <= 10; i++) r.move(1, 200, 836 - i * 6, i * 8); r.up(1, 200, 776, 90);
    expect(r.drain().filter((e) => e.kind === 'fire')).toEqual([]);
    r.down(2, 200, 836, 200, false); for (let i = 1; i <= 10; i++) r.move(2, 200, 836 - i * 6, 200 + i * 8); r.up(2, 200, 776, 290);
    expect(r.drain().filter((e) => e.kind === 'fire').length).toBe(1);
  });
});

describe('M6: holding 18-20 m/s on flats is not frantic', () => {
  const pushesPerMin = (hold: number) => {
    const sim = new Simulation(flatCourse(1e5), TUNING, { x: 0, speed: hold }); let n = 0;
    for (let i = 0; i < 60 / dt; i++) { if (sim.state.speed < hold - 0.3) { sim.enqueue({ type: 'down', strokeId: nid(), strength: 0.65, fresh: true, source: 'test' }); n++; } sim.step(); }
    return n;
  };
  it('pushes per minute', () => {
    expect(pushesPerMin(15)).toBeLessThanOrEqual(14);
    expect(pushesPerMin(18)).toBeLessThanOrEqual(24);
    expect(pushesPerMin(20)).toBeLessThanOrEqual(85);
  });
  it('pushes still never exceed the soft cap', () => {
    const sim = new Simulation(flatCourse(1e5), TUNING, { x: 0, speed: 5 });
    for (let i = 0; i < 400; i++) { sim.enqueue({ type: 'down', strokeId: nid(), strength: 1, fresh: true, source: 'test' }); sim.step(); expect(sim.state.speed).toBeLessThanOrEqual(TUNING.movement.softCap + 1e-9); }
  });
});
