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

const untilX = (sim: Simulation, x: number) => stepUntil(sim, (s) => s.state.x >= x, 60);

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
  /** Flat: jump at x=150, optional trick, pillar at 150 + dist. */
  function attempt(trick: (sim: Simulation) => void, pillarDist = 22, v = 14) {
    const sim = new Simulation(flatWith(['pillar', 150 + pillarDist]));
    approach(sim, v, 150);
    sim.enqueue(up());
    sim.step();
    trick(sim);
    const ev = stepCollect(sim, 900);
    return { sim, ev, brk: ev.find((e) => e.type === 'break') };
  }

  it('breaks with a completed backflip; flow kept', () => {
    const { sim, ev, brk } = attempt((s) => { s.step(); s.enqueue(up()); });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(ev.some((e) => e.type === 'flip-complete')).toBe(true);
    expect(brk && brk.type === 'break' && brk.by).toBe('flip');
    expect(sim.state.x).toBeGreaterThan(180);
  });

  it('breaks with a grab that was released before landing', () => {
    const { sim, brk } = attempt((s) => {
      const id = newId();
      s.enqueue(side('left', true, id));
      for (let i = 0; i < 30; i++) s.step(); // 0.25 s hold
      s.enqueue(side('left', false, id));
    });
    expect(sim.state.fail?.message ?? '').toBe('');
    expect(brk && brk.type === 'break' && brk.by).toBe('grab');
  });

  it('a token grab (shorter than the minimum hold) does not count', () => {
    const { sim } = attempt((s) => {
      const id = newId();
      s.enqueue(side('left', true, id));
      s.step(); s.step();
      s.enqueue(side('left', false, id));
    });
    expect(sim.state.fail?.kind).toBe('hit-pillar');
  });

  it('hitting it plain fails, and the reason names the trick', () => {
    const { sim } = attempt(() => {});
    expect(sim.state.fail?.kind).toBe('hit-pillar');
    expect(sim.state.fail?.message).toMatch(/backflip|grab/);
  });

  it('rolling into it fails', () => {
    const sim = new Simulation(flatWith(['pillar', 120]));
    approach(sim, 10, 125);
    expect(sim.state.fail?.kind).toBe('hit-pillar');
  });

  it('hitting it in the air while still grabbing, or mid-flip, fails with that reason', () => {
    const grab = attempt((s) => s.enqueue(side('left', true, newId())), 5, 14);
    expect(grab.sim.state.fail?.kind).toBe('hit-pillar');
    expect(grab.sim.state.fail?.message).toMatch(/grab/);
    const flip = attempt((s) => { s.step(); s.enqueue(up()); }, 3.5, 14);
    expect(flip.sim.state.fail?.kind).toBe('hit-pillar');
    expect(flip.sim.state.fail?.message).toMatch(/mid-flip/);
  });

  it('the trick credit expires after the credit distance and is cleared by a new plain jump', () => {
    const far = attempt((s) => { s.step(); s.enqueue(up()); }, O.pillarCreditDistance + 25);
    expect(far.sim.state.fail?.kind).toBe('hit-pillar');
    // flip, land, then a plain jump before the pillar: needs a new trick
    const sim = new Simulation(flatWith(['pillar', 190]));
    approach(sim, 14, 150); sim.enqueue(up()); sim.step(); sim.step(); sim.enqueue(up());
    stepUntil(sim, (q) => q.state.mode === 'grounded', 3);
    expect(sim.state.trickCredit).toBe('flip');
    untilX(sim, 175); sim.enqueue(up());
    stepCollect(sim, 400);
    expect(sim.state.fail?.kind).toBe('hit-pillar');
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

  it('every pillar follows a jump within the credit distance that has airtime for its trick', () => {
    for (const seed of seeds) {
      const c = buildLabCourse(seed);
      for (const p of c.obstacles.filter((q) => q.kind === 'pillar')) {
        const launch = [...c.gaps].reverse().find((g) => g.x1 < p.x);
        expect(launch, `seed ${seed}: no launch before pillar`).toBeTruthy();
        // landing area to pillar leaves room inside the credit distance
        expect(p.x - launch!.x1, `seed ${seed}`).toBeLessThan(O.pillarCreditDistance - 2);
        expect(p.x - launch!.x1).toBeGreaterThan(8); // readable after landing
        // no other gap/rail/wall between the launch and the pillar
        expect(c.gaps.some((g) => g.x0 > launch!.x1 && g.x0 < p.x)).toBe(false);
      }
    }
  });

  it('is completable on every seed both ways (flip / grab for pillars, jump / heel for pots), across speeds', () => {
    const fails: string[] = [];
    for (const seed of seeds) {
      for (const cfg of [
        { minSpeed: 13 }, { minSpeed: 15, strength: 1 }, { minSpeed: 30, strength: 1 },
        { minSpeed: 15, pots: 'heel' as const }, { minSpeed: 15, pillarTrick: 'grab' as const }, { minSpeed: 15, pillarTrick: 'flip' as const, pots: 'heel' as const },
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

  it('a pillar is never placed where the run-in only allows a plain roll (no launch)', () => {
    // sanity: removing the jump (rolling off the edge without a trick) at each pillar's launch must fail
    for (const seed of seeds.slice(0, 5)) {
      const sim = new Simulation(buildLabCourse(seed));
      const ev = driveLab(sim, { minSpeed: 15, pillarTrick: 'flip' });
      for (const e of ev) if (e.type === 'break' && e.kind === 'pillar') expect(['flip', 'grab']).toContain(e.by);
    }
  });
});
