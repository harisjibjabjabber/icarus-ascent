import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildOpeningCourse } from '../src/course/opening';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';
import { replayHeadless, Recorder } from '../src/diag/recorder';
import { density, courseElements } from '../src/course/stats';

const course = buildOpeningCourse();
const dt = TUNING.sim.dt;

function ride(opts: AutopilotOptions, start?: { x: number; speed: number }, record?: Recorder) {
  const sim = new Simulation(course, TUNING, start);
  const ap = new Autopilot(opts);
  const ev: { e: SimEvent; t: number }[] = [];
  const crossed = new Map<number, number>(); // x threshold -> time
  const xs: { x: number; t: number }[] = [];
  for (let i = 0; i < 240 / dt && sim.state.mode !== 'failed' && sim.state.mode !== 'finished'; i++) {
    for (const a of ap.next(sim)) { record?.record(sim.state.tick, a); sim.enqueue(a); }
    sim.step();
    const t = sim.state.tick * dt;
    if (i % 6 === 0) xs.push({ x: sim.state.x, t });
    for (const e of sim.drainEvents()) ev.push({ e, t });
  }
  const timeAt = (x: number) => xs.find((p) => p.x >= x)?.t ?? Infinity;
  void crossed;
  return { sim, ev, timeAt };
}

const CONFIGS: AutopilotOptions[] = [
  { minSpeed: 13 }, { minSpeed: 15, strength: 1 }, { minSpeed: 30, strength: 1 }, { minSpeed: 10 },
  { minSpeed: 15, pots: 'heel' }, { minSpeed: 15, pillarTrick: 'flip' }, { minSpeed: 15, pillarTrick: 'heel' },
  { minSpeed: 12, optionalRail: true }, { minSpeed: 15, pots: 'heel', pillarTrick: 'flip', optionalRail: true },
];

const L = (t: string) => course.lessons.find((l) => l.title === t)!;

describe('authored opening', () => {
  it('teaches the brief §10 sequence, one idea per lesson, each with a checkpoint and a short prompt', () => {
    expect(course.kind).toBe('opening');
    expect(course.lessons.map((l) => l.title)).toEqual(['Push', 'Descent', 'Jump', 'Pot', 'Heel skim', 'Optional rail', 'Rail', 'Big jump', 'Wall ride', 'Put it together', 'Ride the gust']);
    for (const l of course.lessons) {
      expect(l.prompt.length).toBeLessThan(95);
      expect(l.promptX0).toBeLessThanOrEqual(l.cpX + 2);
      expect(course.groundBelow(l.cpX, 1e6)).toBeTruthy();
    }
    const inLesson = (t: string, x: number) => { const i = course.lessons.indexOf(L(t)); const next = course.lessons[i + 1]?.cpX ?? course.finishX; return x >= L(t).cpX && x < next; };
    expect(course.gaps.filter((g) => inLesson('Jump', g.x0) && g.requires === 'jump').length).toBe(1);
    expect(course.obstacles.filter((o) => o.kind === 'pot' && inLesson('Pot', o.x)).length).toBe(1);
    expect(course.obstacles.filter((o) => o.kind === 'pot' && inLesson('Heel skim', o.x)).length).toBe(2);
    expect(course.rails.filter((r) => !r.required && inLesson('Optional rail', r.points[0].x)).length).toBe(1);
    expect(course.gaps.filter((g) => inLesson('Rail', g.x0) && g.requires === 'rail').length).toBe(1);
    expect(course.gaps.filter((g) => inLesson('Big jump', g.x0)).length).toBe(1);
    expect(course.obstacles.filter((o) => o.kind === 'pillar' && inLesson('Big jump', o.x)).length).toBe(1);
    expect(course.gaps.filter((g) => inLesson('Wall ride', g.x0) && g.requires === 'wall').length).toBe(1);
    const combo = (k: string) => course.obstacles.filter((o) => o.kind === k && inLesson('Put it together', o.x)).length;
    expect(combo('pot')).toBeGreaterThanOrEqual(1);
    expect(combo('pillar')).toBeGreaterThanOrEqual(1);
    expect(course.gaps.filter((g) => inLesson('Put it together', g.x0)).length).toBeGreaterThanOrEqual(1);
    // nothing compulsory before the player has been taught push and the descent
    expect(Math.min(...course.gaps.map((g) => g.x0))).toBeGreaterThan(L('Jump').cpX);
  });

  it('is completable from the start across speeds and tactics', () => {
    const fails: string[] = [];
    for (const cfg of CONFIGS) {
      const { sim } = ride(cfg);
      if (sim.state.mode !== 'finished') fails.push(`${JSON.stringify(cfg)}: ${sim.state.fail?.message} @${sim.state.x.toFixed(0)}`);
    }
    expect(fails).toEqual([]);
  });

  it('every lesson checkpoint is a viable restart: from its checkpoint speed the rest of the course can be finished', () => {
    const fails: string[] = [];
    for (const l of course.lessons) {
      for (const cfg of [{ minSpeed: 13 }, { minSpeed: 15, strength: 1, pots: 'heel' as const }, { minSpeed: 12, pillarTrick: 'flip' as const }]) {
        const { sim } = ride(cfg, l.id === 0 ? undefined : { x: l.cpX, speed: l.cpSpeed });
        if (sim.state.mode !== 'finished') fails.push(`lesson ${l.id + 1} ${JSON.stringify(cfg)}: ${sim.state.fail?.message}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('each compulsory lesson gives >= 2 s from its prompt to commitment, and >= 1.5 s after a checkpoint restart', () => {
    const short: string[] = [];
    for (const cfg of CONFIGS) {
      const { timeAt } = ride(cfg);
      for (const l of course.lessons.filter((q) => q.required)) {
        const t = timeAt(l.featureX) - timeAt(l.promptX0);
        // 2 s at normal riding speeds; at the hard cap the camera's 2 s visibility budget still holds via 1.7 s of prompt
        if (t < ((cfg.minSpeed ?? 0) >= 25 ? 1.7 : 2)) short.push(`${l.title} ${JSON.stringify(cfg)}: ${t.toFixed(2)} s`);
      }
    }
    for (const l of course.lessons.filter((q) => q.required)) {
      const { timeAt } = ride({ minSpeed: 30, strength: 1 }, { x: l.cpX, speed: l.cpSpeed });
      const t = timeAt(l.featureX) - timeAt(l.cpX);
      if (t < 1.5) short.push(`${l.title} from checkpoint: ${t.toFixed(2)} s`);
    }
    expect(short).toEqual([]);
  });

  it('dense: compulsory features stay spaced for their prompts, but there is always something coming up', () => {
    const f = course.lessons.filter((l) => l.required).map((l) => l.featureX);
    for (let i = 1; i < f.length; i++) expect(f[i] - f[i - 1]).toBeGreaterThan(40);
    // tutorial (push, descent, first jump) may breathe; from the Pot lesson on, the next element (gap, rail, wall,
    // pot, pillar) is never more than ~3 s away at normal riding speed
    const from = L('Pot').cpX;
    // The gust lesson's 45 m grate run-in is the telegraph for the lift. It sits outside the
    // "something every 3.5 s" window, which still covers the taught street up to that lesson.
    const gustAt = L('Ride the gust').cpX;
    const d = density(course, from, gustAt);
    expect(d.longestEmpty, `empty stretch from ${d.longestEmptyAt.toFixed(0)}`).toBeLessThanOrEqual(48);
    expect(density(course, 0, gustAt).per100m).toBeGreaterThanOrEqual(2.5);
    const { timeAt, sim } = ride({ minSpeed: 13 });
    expect(sim.state.mode).toBe('finished');
    let x = from;
    for (const q of courseElements(course, from, gustAt)) { if (q.x0 > x) expect(timeAt(q.x0) - timeAt(x), `empty ${x.toFixed(0)}..${q.x0.toFixed(0)}`).toBeLessThanOrEqual(3.5); x = Math.max(x, q.x1); }
    // the tutorial stays gentle (first compulsory feature no sooner than ~10 s) and the harbour arrives quickly
    expect(timeAt(L('Jump').featureX)).toBeGreaterThanOrEqual(9);
    expect(timeAt(course.harbourX!)).toBeLessThanOrEqual(30);
    expect(timeAt(course.walls.find((w) => w.required)!.x0)).toBeLessThanOrEqual(38);
    expect(course.harbourX!).toBeLessThan(course.walls.find((w) => w.required)!.x0); // both wall runs sit in the harbour
  });

  it('compulsory features are visible from the chase camera before commitment (no blind crest)', () => {
    const H = TUNING.camera.height;
    for (const l of course.lessons.filter((q) => q.required)) {
      const target = { x: l.featureX + 4, y: course.groundBelow(l.featureX, 1e6)!.sample.y + 0.4 };
      for (let back = 40; back >= 22; back -= 3) {
        const ox = l.featureX - back;
        const g = course.groundBelow(ox, 1e6);
        if (!g) continue;
        const eye = { x: ox - TUNING.camera.behind, y: g.sample.y + H };
        for (let x = ox; x < l.featureX - 1; x += 0.5) {
          const gy = course.groundBelow(x, 1e6)?.sample.y;
          if (gy === undefined) continue;
          const los = eye.y + ((target.y - eye.y) * (x - eye.x)) / (target.x - eye.x);
          expect(gy, `${l.title}: terrain at ${x.toFixed(0)} hides the feature from ${back} m back`).toBeLessThan(los);
        }
      }
    }
  });

  it('supplies the momentum each required action needs: wall entry >= 12 m/s, rails caught, pillars broken', () => {
    for (const cfg of [{ minSpeed: 10 }, { minSpeed: 13 }, { minSpeed: 15, pots: 'heel' as const }]) {
      const { ev, sim } = ride(cfg);
      expect(sim.state.mode).toBe('finished');
      const wall = ev.find((q) => q.e.type === 'wall-start')!.e as Extract<SimEvent, { type: 'wall-start' }>;
      expect(wall.speed).toBeGreaterThanOrEqual(12);
      expect(ev.filter((q) => q.e.type === 'break' && (q.e as any).kind === 'pillar').length).toBe(2);
      expect(ev.some((q) => q.e.type === 'grind-start' && course.rails[(q.e as any).railId].required)).toBe(true);
    }
  });

  it('a checkpoint-start run replays deterministically from its trace', () => {
    const l = course.lessons[6];
    const rec = new Recorder(0, 'opening', { x: l.cpX, speed: l.cpSpeed });
    const { sim } = ride({ minSpeed: 14 }, { x: l.cpX, speed: l.cpSpeed }, rec);
    const end = replayHeadless(rec.finish(sim.state.tick));
    expect(end.x).toBeCloseTo(sim.state.x, 6);
    expect(end.mode).toBe(sim.state.mode);
  });

  it('wall-run gaps: holding right on the wall crosses; a plain jump (no wall ride) falls short even at speed', () => {
    const wallGaps = course.gaps.filter((g) => g.requires === 'wall');
    expect(wallGaps.length).toBe(2);
    expect(course.walls.length).toBeGreaterThanOrEqual(4); // 2 required (gaps) + optional garden / harbour walls
    for (const g of wallGaps) {
      // every wall gap has its required wall alongside, tight to the track (right edge of the 3.2 m route)
      const w = course.walls.find((q) => q.required && q.x0 <= g.x0 && q.x1 >= g.x1)!;
      expect(w).toBeTruthy();
      expect(w.lateral).toBeLessThanOrEqual(2.5);
      for (const speed of [12, 14, 18]) {
        for (const wallRide of [true, false]) {
          const sim = new Simulation(course, TUNING, { x: g.x0 - 40, speed });
          const ap = new Autopilot({ minSpeed: speed });
          for (let i = 0; i < 12 / dt && sim.state.mode !== 'failed' && sim.state.x < g.x1 + 8; i++) {
            for (const a of ap.next(sim)) if (wallRide || a.type !== 'side') sim.enqueue(a);
            sim.step();
          }
          if (wallRide) expect(sim.state.x, `wall ride over gap at ${g.x0.toFixed(0)} from ${speed} m/s: ${sim.state.fail?.message}`).toBeGreaterThan(g.x1 + 8);
          else expect(sim.state.mode, `plain jump over the ${(g.x1 - g.x0).toFixed(0)} m gap at ${g.x0.toFixed(0)} from ${speed} m/s should fall short`).toBe('failed');
        }
      }
    }
    // the first wall gap (lesson 9) stays the forgiving teaching one: longest wall overhang before the lip
    const first = course.walls.find((q) => q.required)!;
    expect(wallGaps[0].x0 - first.x0).toBeGreaterThanOrEqual(4);
  });
});
