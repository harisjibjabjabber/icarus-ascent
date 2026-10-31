import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildLabCourse } from '../src/course/lab';
import { TUNING } from '../src/tuning';
import { Course } from '../src/course/course';
import type { SimEvent } from '../src/sim/types';
import { push, up, down, releaseDown, side, newId, driveLab, stepUntil } from './helpers';

const O = TUNING.obstacles;

function flatWith(...obs: ['pot' | 'pillar', number][]): Course {
  const c = new Course(1, [{ id: 0, kind: 'ground', points: [{ x: -10, y: 0 }, { x: 3000, y: 0 }], material: 'stone', thickness: 4 }], [], [], [], 0, 2900);
  for (const [k, x] of obs) c.addObstacle(k, x, k === 'pot' ? O.potHalfWidth : O.pillarHalfWidth, k === 'pot' ? O.potHeight : O.pillarHeight);
  return c;
}

/** Push up to about `v` m/s, stop pushing 40 m out, then roll until x >= X - speed*k - extra. */
function approach(sim: Simulation, v: number, X: number, k = 0, extra = 0): number {
  let t = 0;
  while (sim.state.x < X - 40 && t++ < 120 * 120) {
    if (t % 30 === 0 && sim.state.speed < v) sim.enqueue(push(0.5));
    sim.step();
  }
  stepUntil(sim, (q) => q.state.x >= X - q.state.speed * k - extra, 20);
  sim.drainEvents();
  return sim.state.speed;
}

function stepCollect(sim: Simulation, ticks: number, ev: SimEvent[] = []): SimEvent[] {
  for (let i = 0; i < ticks && sim.state.mode !== 'failed'; i++) { sim.step(); ev.push(...sim.drainEvents()); }
  return ev;
}


describe('pots', () => {
  it('can be jumped: rider clears it, nothing breaks, no fail', () => {
    const sim = new Simulation(flatWith(['pot', 200]));
    approach(sim, 12, 200, 0.3);
    sim.enqueue(up());
    const ev = stepCollect(sim, 240);
    expect(sim.state.mode).toBe('grounded');
    expect(sim.state.x).toBeGreaterThan(205);
    expect(ev.some((e) => e.type === 'break')).toBe(false);
  });

  it('breaks under a heel skim, and the rider carries through at speed', () => {
    const sim = new Simulation(flatWith(['pot', 200]));
    const v = approach(sim, 12, 200, 0.613, 1.5); // land a metre or two before the pot
    sim.enqueue(up());
    sim.step();
    const hold = newId();
    sim.enqueue(down(hold));
    const ev: SimEvent[] = [];
    stepUntil(sim, (s) => { ev.push(...s.drainEvents()); return s.state.x > 201 || s.state.mode === 'failed'; }, 5);
    expect(sim.state.fail?.message ?? '').toBe('');
    const brk = ev.find((e) => e.type === 'break');
    expect(brk && brk.type === 'break' && brk.by).toBe('heel');
    const skim = ev.find((e) => e.type === 'skim-start');
    expect(skim).toBeTruthy();
    expect(sim.state.mode).toBe('heelSkim'); // the skim is not interrupted by the break
    // flow: the break itself costs ~1.5%, not a stop
    const before = sim.state.speed;
    expect(before).toBeGreaterThan(v * 0.75);
    sim.enqueue(releaseDown(hold));
    stepCollect(sim, 60);
    expect(sim.state.mode).toBe('grounded');
  });

  it('breaks when the rider comes down onto it with the downward commit held', () => {
    const sim = new Simulation(flatWith(['pot', 200]));
    const v = approach(sim, 12, 200, 0.55); // descending onto the pot
    sim.enqueue(up());
    sim.step();
    stepUntil(sim, (s) => s.state.vy < 0, 2);
    sim.enqueue(down(newId()));
    const ev = stepCollect(sim, 120);
    expect(sim.state.fail?.message ?? '').toBe('');
    const brk = ev.find((e) => e.type === 'break');
    expect(brk).toBeTruthy();
    if (brk?.type === 'break') expect(brk.speed).toBeGreaterThan(v * 0.9);
  });

  it('rolling into it fails with a clear reason', () => {
    const sim = new Simulation(flatWith(['pot', 120]));
    approach(sim, 10, 125);
    expect(sim.state.mode).toBe('failed');
    expect(sim.state.fail?.kind).toBe('hit-pot');
    expect(sim.state.fail?.message).toMatch(/jump it|heel/);
  });

  it('a jump that comes down on it without the heel commit fails', () => {
    const sim = new Simulation(flatWith(['pot', 200]));
    approach(sim, 12, 200, 0.58);
    sim.enqueue(up());
    stepCollect(sim, 120);
    expect(sim.state.fail?.kind).toBe('hit-pot');
  });
});

describe('pillars', () => {
  const P = 200;
  /** Approach on flat ground, jump `lead(v)` before the pillar, then run `trick`. */
  function into(lead: (v: number) => number, trick: (sim: Simulation, ev: SimEvent[]) => void, v = 14) {
    const sim = new Simulation(flatWith(['pillar', P]));
    let t = 0;
    while (sim.state.x < P - 40 && t++ < 120 * 120) { if (t % 30 === 0 && sim.state.speed < v) sim.enqueue(push(0.5)); sim.step(); }
    stepUntil(sim, (q) => q.state.x >= P - lead(q.state.speed), 20);
    sim.drainEvents();
    sim.enqueue(up());
    sim.step();
    const ev: SimEvent[] = [...sim.drainEvents()];
    trick(sim, ev);
    stepCollect(sim, 600, ev);
    return { sim, ev, brk: ev.find((e) => e.type === 'break') };
  }
  const apex = (v: number) => Math.max(1.5, v * 0.3);

  it('breaks while a grab is held at contact (no release needed), then a clean landing after letting go', () => {
    const id = newId();
    const { sim, brk } = into(apex, (s, ev) => {
      s.enqueue(side('left', true, id));
      stepUntil(s, (q) => { ev.push(...q.drainEvents()); return q.state.broken.length > 0 || q.state.mode !== 'airborne'; }, 2);
      expect(s.state.air).toBe('grabLeft'); // still grabbing right after the break
      s.enqueue(side('left', false, id));
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('grab');
    expect(sim.state.x).toBeGreaterThan(P + 5);
  });

  it('breaking through mid-grab does not excuse the landing rule: still holding at touchdown fails as landed-grabbing', () => {
    const { sim, brk } = into(apex, (s) => s.enqueue(side('left', true, newId())));
    expect(brk).toBeTruthy();
    expect(sim.state.fail?.kind).toBe('landed-grabbing');
  });

  it('breaks mid-flip; the flip then finishes and lands clean', () => {
    let flipAtBreak = -1;
    const { sim, ev, brk } = into(apex, (s, evs) => {
      s.step(); s.enqueue(up());
      stepUntil(s, (q) => { evs.push(...q.drainEvents()); if (q.state.broken.length && flipAtBreak < 0) flipAtBreak = q.state.flip; return q.state.broken.length > 0 || q.state.mode !== 'airborne'; }, 2);
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('flip');
    expect(flipAtBreak).toBeGreaterThan(0);
    expect(flipAtBreak).toBeLessThan(1);
    expect(ev.some((e) => e.type === 'flip-complete')).toBe(true);
  });

  it('breaks under a heel skim, skim continues', () => {
    const hold = newId();
    const { sim, brk } = into((v) => v * 0.613 + 1.5, (s) => {
      stepUntil(s, (q) => q.state.vy < 0, 2);
      s.enqueue(down(hold));
      stepUntil(s, (q) => q.state.broken.length > 0 || q.state.mode === 'failed', 3);
      expect(s.state.mode).toBe('heelSkim');
      s.enqueue(releaseDown(hold));
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('heel');
  });

  it('a plain jump into it fails, and the reason names the tricks', () => {
    const { sim } = into(apex, () => {});
    expect(sim.state.fail?.kind).toBe('hit-pillar');
    expect(sim.state.fail?.message).toMatch(/grab/);
    expect(sim.state.fail?.message).toMatch(/flip/);
  });

  it('rolling into it fails', () => {
    const sim = new Simulation(flatWith(['pillar', 120]));
    approach(sim, 10, 125);
    expect(sim.state.fail?.kind).toBe('hit-pillar');
  });

  it('a brief grab already released before contact (any duration) still breaks it on that jump', () => {
    const { sim, brk } = into((v) => v * 0.45, (s) => {
      const id = newId();
      s.enqueue(side('left', true, id)); s.step(); s.step();
      s.enqueue(side('left', false, id));
      s.step();
      expect(s.state.air).toBe('none');
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('grab');
  });

  it('a grab-and-release in the same instant (one-tick flick) counts too', () => {
    const { sim, brk } = into(apex, (s) => {
      const id = newId();
      s.enqueue(side('right', true, id)); s.enqueue(side('right', false, id));
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('grab');
  });

  it('a grab on an earlier jump does not carry into a plain jump into the pillar', () => {
    const sim = new Simulation(flatWith(['pillar', 240]));
    approach(sim, 14, 150); sim.enqueue(up()); sim.step();
    const id = newId(); sim.enqueue(side('left', true, id)); sim.step(); sim.enqueue(side('left', false, id));
    stepUntil(sim, (q) => q.state.mode === 'grounded', 3);
    stepUntil(sim, (q) => q.state.x >= 240 - q.state.speed * 0.3, 20);
    sim.enqueue(up());
    stepCollect(sim, 400);
    expect(sim.state.fail?.kind).toBe('hit-pillar');
  });

  it('hitbox is forgiving with a trick: the break triggers up to the reach distance early', () => {
    const { brk } = into(apex, (s) => s.enqueue(side('left', true, newId())));
    expect(brk && brk.type === 'break' && brk.x).toBeLessThan(P - O.pillarHalfWidth + 0.01);
    expect(brk && brk.type === 'break' && brk.x).toBeGreaterThanOrEqual(P - O.pillarHalfWidth - O.pillarBreakReach - 1e-6);
  });

  it('(lenient extra) a trick completed on the jump just before still counts for a short distance', () => {
    const sim = new Simulation(flatWith(['pillar', 175]));
    approach(sim, 14, 150); sim.enqueue(up()); sim.step(); sim.step(); sim.enqueue(up());
    stepUntil(sim, (q) => q.state.mode === 'grounded', 3);
    expect(sim.state.trickCredit).toBe('flip');
    const ev = stepCollect(sim, 600);
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(ev.some((e) => e.type === 'break')).toBe(true);
  });
});

describe('lab breakables are fair and genuine', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => (i + 1) * 7919);

  it('has pots and pillars on every seed', () => {
    for (const seed of seeds) {
      const c = buildLabCourse(seed);
      expect(c.obstacles.filter((o) => o.kind === 'pot').length).toBeGreaterThanOrEqual(2);
      expect(c.obstacles.filter((o) => o.kind === 'pillar').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('pots stand on flat ground with a run-up, clear of gaps, rails and walls', () => {
    for (const seed of seeds) {
      const c = buildLabCourse(seed);
      for (const o of c.obstacles.filter((q) => q.kind === 'pot')) {
        for (const dx of [-2, 0, 2]) {
          const g = c.groundBelow(o.x + dx, 1e6)!;
          expect(Math.abs(g.sample.slope), `seed ${seed} pot@${o.x.toFixed(0)}`).toBeLessThan(0.03);
        }
        for (const g of c.gaps) expect(Math.min(Math.abs(o.x - g.x0), Math.abs(o.x - g.x1))).toBeGreaterThan(10);
        for (const r of c.rails) expect(o.x < Course.railX0(r) - 5 || o.x > Course.railX1(r) + 5).toBe(true);
        for (const w of c.walls) expect(o.x < w.x0 - 5 || o.x > w.x1 + 5).toBe(true);
      }
    }
  });

  it('every pillar has a flat run-up and room after it to release a grab / finish a flip', () => {
    for (const seed of seeds) {
      const c = buildLabCourse(seed);
      for (const p of c.obstacles.filter((q) => q.kind === 'pillar')) {
        for (const dx of [-6, -3, 0, 3, 6, 10]) {
          const g = c.groundBelow(p.x + dx, 1e6)!;
          expect(g, `seed ${seed}`).toBeTruthy();
          expect(Math.abs(g.sample.slope), `seed ${seed} pillar@${p.x.toFixed(0)} dx ${dx}`).toBeLessThan(0.03);
        }
        for (const g of c.gaps) expect(p.x < g.x0 - 15 || p.x > g.x1 + 8, `seed ${seed}`).toBe(true);
        for (const o of c.obstacles) if (o !== p) expect(Math.abs(o.x - p.x)).toBeGreaterThan(12);
      }
    }
  });

  it('is completable on every seed with each tactic (grab / flip / heel for pillars, jump / heel for pots), across speeds', () => {
    const fails: string[] = [];
    for (const seed of seeds) {
      for (const cfg of [
        { minSpeed: 13 }, { minSpeed: 15, strength: 1 }, { minSpeed: 30, strength: 1 },
        { minSpeed: 15, pots: 'heel' as const }, { minSpeed: 15, pillarTrick: 'grab' as const }, { minSpeed: 15, pillarTrick: 'flip' as const, pots: 'heel' as const },
        { minSpeed: 15, pillarTrick: 'heel' as const }, { minSpeed: 30, strength: 1, pillarTrick: 'flip' as const }, { minSpeed: 13, pillarTrick: 'heel' as const },
      ]) {
        const sim = new Simulation(buildLabCourse(seed));
        const ev = driveLab(sim, cfg);
        if (sim.state.mode !== 'finished') fails.push(`seed ${seed} ${JSON.stringify(cfg)}: ${sim.state.fail?.message}`);
        else if (ev.filter((e) => e.type === 'break' && e.kind === 'pillar').length !== 2) fails.push(`seed ${seed}: pillars not broken`);
        if (cfg.pots === 'heel' && sim.state.mode === 'finished' && ev.filter((e) => e.type === 'break' && e.kind === 'pot').length !== 3) fails.push(`seed ${seed} ${JSON.stringify(cfg)}: pots not heel-broken`);
      }
    }
    expect(fails).toEqual([]);
  });

});
