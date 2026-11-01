import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { Chunk, Gap } from '../src/course/course';
import { buildOpeningCourse } from '../src/course/opening';
import { EndlessCourse, SPEC, buildPhrase, isDeath, kickerJumpReach, maxJumpReach } from '../src/course/endless';
import { Autopilot } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import { describeFail, rideEndless } from './endlessHelpers';

const HC = TUNING.movement.hardCap;
const SEEDS = [1, 7, 13, 21, 42];
const BANDS = [
  { name: '0–300', lo: 0, hi: 300 },
  { name: '300–1200', lo: 300, hi: 1200 },
  { name: '1200–2500', lo: 1200, hi: 2500 },
  { name: '2500–5000', lo: 2500, hi: 5000 },
];

/** Flat-lip holes must clear a hard-cap jump; kicker lips (the wall entries) use the kicker reach. */
function lethal(len: number, drop: number, kicker: boolean): boolean {
  const reach = kicker ? kickerJumpReach(HC, 1.2, 10, Math.max(0, drop)) : maxJumpReach(HC, Math.max(0, drop));
  return len > reach + 5;
}

function survey(seed: number, dist = 5000): { chunks: Chunk[]; gaps: Gap[]; origin: number } {
  const c = new EndlessCourse(seed, { zones: ['town', 'harbour'] });
  const chunks = new Map<number, Chunk>();
  const gaps: Gap[] = [];
  const seen = new Set<string>();
  for (let x = 0; x <= dist + 400; x += 25) {
    c.stream(x);
    for (const k of c.chunks) chunks.set(k.id, k);
    for (const g of c.gaps) {
      const key = g.x0.toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push(g);
    }
  }
  const origin = c.originX;
  const route = (x: number) => x - origin;
  return {
    chunks: [...chunks.values()].filter((k) => route(k.x0) < dist).sort((a, b) => a.x0 - b.x0),
    gaps: gaps.filter((g) => route(g.x0) < dist),
    origin,
  };
}

describe('death gaps', () => {
  it('sizes every authored death hole past a hard-cap jump, with the rail or the wall starting before the lip', () => {
    for (const id of ['rail-gap', 'rail-gap-early', 'wall-over', 'wall-gap', 'death-gauntlet'] as const) {
      for (const d of [0, 0.5, 1]) {
        const b = buildPhrase(SPEC[id], 0, 0, d, () => 0.5);
        expect(isDeath(id)).toBe(true);
        const holes = [];
        for (let i = 0; i + 1 < b.chains.length; i++) {
          const a = b.chains[i].points[b.chains[i].points.length - 1];
          const c = b.chains[i + 1].points[0];
          const req = b.requires.find(([x]) => Math.abs(x - a.x) < 0.01)?.[1] ?? 'jump';
          holes.push({ x0: a.x, len: c.x - a.x, drop: a.y - c.y, req });
        }
        const deaths = holes.filter((h) => h.req === 'rail' || h.req === 'wall');
        expect(deaths.length, id).toBeGreaterThan(0);
        for (const h of deaths) {
          expect(lethal(h.len, h.drop, h.req === 'wall'), `${id} d=${d} ${h.req} ${h.len.toFixed(1)} m`).toBe(true);
          if (h.req === 'rail') {
            const rail = b.rails.find((r) => r.required && r.points[0].x < h.x0 && r.points[r.points.length - 1].x > h.x0 + h.len);
            expect(rail, `${id} rail entry`).toBeTruthy();
          } else {
            const wall = b.walls.find((w) => w.required && w.x0 < h.x0 - 2 && w.x1 > h.x0 + h.len);
            expect(wall, `${id} wall entry`).toBeTruthy();
          }
        }
        if (id === 'death-gauntlet') expect(deaths.map((h) => h.req)).toEqual(['rail', 'wall', 'rail']);
      }
    }
  });

  it('the opening rail gap is the one forgiving teaching hole: past a jump, and the autopilot still clears it', () => {
    const course = buildOpeningCourse();
    const lesson = course.lessons.find((l) => l.title === 'Rail')!;
    const next = course.lessons[course.lessons.indexOf(lesson) + 1];
    const gap = course.gaps.find((g) => g.requires === 'rail' && g.x0 >= lesson.cpX && g.x0 < next.cpX)!;
    expect(gap.x1 - gap.x0).toBeGreaterThan(maxJumpReach(HC, gap.yTakeoff - gap.yReceive) + 5);
    const rail = course.rails.find((r) => r.required && r.points[0].x < gap.x0)!;
    expect(rail.points[0].x).toBeLessThan(gap.x0);
    const dt = TUNING.sim.dt;
    const miss = new Simulation(course, TUNING, { x: gap.x0 - 24, speed: HC });
    let jumped = false;
    for (let i = 0; i < 8 / dt && miss.state.mode !== 'failed'; i++) {
      if (!jumped && miss.state.mode === 'grounded' && miss.state.x > gap.x0 - 1.5) {
        miss.enqueue({ type: 'up', strokeId: 1, source: 'test' });
        jumped = true;
      }
      miss.step();
    }
    expect(jumped).toBe(true);
    expect(miss.state.mode).toBe('failed');
    expect(['missed-rail', 'fell-in-gap']).toContain(miss.state.fail?.kind);
    const sim = new Simulation(course, TUNING, { x: lesson.cpX, speed: lesson.cpSpeed });
    const ap = new Autopilot({ minSpeed: 14 });
    for (let i = 0; i < 20 / dt && sim.state.mode !== 'failed' && sim.state.x < gap.x1 + 12; i++) {
      for (const a of ap.next(sim)) sim.enqueue(a);
      sim.step();
    }
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(sim.state.x).toBeGreaterThan(gap.x1 + 8);
  });

  it('a full-speed jump with no down-swipe falls into a rail-only gap; the autopilot grinds across', () => {
    const course = new EndlessCourse(1, { script: ['boost', 'rail-gap'], d: 0 });
    const gap = course.gaps.find((g) => g.requires === 'rail')!;
    expect(lethal(gap.x1 - gap.x0, gap.yTakeoff - gap.yReceive, false)).toBe(true);
    const dt = TUNING.sim.dt;
    const miss = new Simulation(course, TUNING, { x: gap.x0 - 30, speed: HC });
    let jumped = false;
    for (let i = 0; i < 8 / dt && miss.state.mode !== 'failed'; i++) {
      if (!jumped && miss.state.mode === 'grounded' && miss.state.x > gap.x0 - 1.2) {
        miss.enqueue({ type: 'up', strokeId: 1, source: 'test' });
        jumped = true;
      }
      miss.step();
    }
    expect(miss.state.mode).toBe('failed');
    expect(miss.state.fail?.kind).toBe('missed-rail');
    const sim = new Simulation(course, TUNING, { x: gap.x0 - 40, speed: 14 });
    const ap = new Autopilot({ minSpeed: 14 });
    for (let i = 0; i < 12 / dt && sim.state.mode !== 'failed' && sim.state.x < gap.x1 + 16; i++) {
      for (const a of ap.next(sim)) sim.enqueue(a);
      sim.step();
    }
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(sim.state.x).toBeGreaterThan(gap.x1 + 10);
  });

  it('puts stars on each required line and a purple on the gauntlet', () => {
    const course = new EndlessCourse(3, { script: ['boost', 'death-gauntlet'], d: 0.8 });
    const chunk = course.chunks.find((k) => k.spec === 'death-gauntlet')!;
    const rails = course.rails.filter((r) => r.required && r.points[0].x >= chunk.x0 - 1);
    const walls = course.walls.filter((w) => w.required && w.x0 >= chunk.x0 - 1);
    expect(rails.length).toBe(2);
    expect(walls.length).toBe(1);
    for (const r of rails) {
      const gold = course.orbs.filter((o) => o.tier === 'common' && o.x >= r.points[0].x - 1 && o.x <= r.points[r.points.length - 1].x + 1);
      expect(gold.length, 'rail stars').toBeGreaterThanOrEqual(3);
    }
    for (const w of walls) {
      const gold = course.orbs.filter((o) => o.tier === 'common' && o.pickup === 'wall' && o.x >= w.x0 && o.x <= w.x1);
      expect(gold.length, 'wall stars').toBeGreaterThanOrEqual(3);
    }
    expect(course.orbs.some((o) => o.tier === 'rare' && o.x >= chunk.x0 && o.x <= chunk.x1)).toBe(true);
  });

  it('keeps the first 300 m clear, then spaces death challenges, and the ideal autopilot clears every seed', () => {
    const rows: { seed: number; perKm: number[]; challenges: number; cleared: boolean }[] = [];
    let early = 0, mid = 0, late = 0, earlyWalls = 0, gapWalls = 0, gauntlets = 0;
    let earlyTier = 0, earlyTierN = 0, lateTier = 0, lateTierN = 0;
    for (const seed of SEEDS) {
      const { chunks, origin } = survey(seed);
      const along = (x: number) => x - origin;
      const deaths = chunks.filter((k) => k.spec && isDeath(k.spec));
      expect(deaths.filter((k) => along(k.x0) < 300).length, `seed ${seed} teaching stretch`).toBe(0);
      expect(deaths.some((k) => k.spec === 'death-gauntlet' && along(k.x0) < 1400), `seed ${seed} early gauntlet`).toBe(false);
      gauntlets += deaths.filter((k) => k.spec === 'death-gauntlet').length;
      const perKm = BANDS.map((band) => {
        const n = deaths.filter((k) => along(k.x0) >= band.lo && along(k.x0) < band.hi).length;
        return n / ((band.hi - band.lo) / 1000);
      });
      early += perKm[1]; mid += perKm[2]; late += perKm[3];
      for (const k of deaths) {
        if (along(k.x0) >= 300 && along(k.x0) < 1200) { earlyTier += k.tier ?? 0; earlyTierN++; }
        if (along(k.x0) >= 2500 && along(k.x0) < 5000) { lateTier += k.tier ?? 0; lateTierN++; }
      }
      const walls = chunks.filter((k) => along(k.x0) >= 800 && k.walls.length > 0);
      earlyWalls += walls.length;
      gapWalls += walls.filter((k) => k.spec && isDeath(k.spec)).length;
      const ride = rideEndless(seed, { minSpeed: 14 }, 4200, {
        course: new EndlessCourse(seed, { zones: ['town', 'harbour'] }),
        maxSeconds: 700,
      });
      const cleared = ride.sim.state.mode !== 'failed' && ride.sim.state.x > 4200;
      if (!cleared) expect.fail(describeFail(seed, { minSpeed: 14 }, ride));
      rows.push({ seed, perKm, challenges: deaths.length, cleared });
    }
    const mean = (n: number) => n / SEEDS.length;
    const table = {
      seeds: SEEDS.length,
      perKm: {
        '0–300': 0,
        '300–1200': Number(mean(early).toFixed(2)),
        '1200–2500': Number(mean(mid).toFixed(2)),
        '2500–5000': Number(mean(late).toFixed(2)),
      },
      metresPerChallenge: {
        '300–1200': Number((1000 / mean(early)).toFixed(0)),
        '1200–2500': Number((1000 / mean(mid)).toFixed(0)),
        '2500–5000': Number((1000 / mean(late)).toFixed(0)),
      },
      gapWallShareAfter800m: Number((gapWalls / earlyWalls).toFixed(2)),
      gauntletsOnSeeds: gauntlets,
      meanTier: {
        '300–1200': Number((earlyTier / earlyTierN).toFixed(2)),
        '2500–5000': Number((lateTier / lateTierN).toFixed(2)),
      },
      autopilotClear: `${rows.filter((r) => r.cleared).length}/${rows.length}`,
    };
    console.log(`death-gap metrics ${JSON.stringify(table)}`);
    // Town bands sit inside one hole per 250-400 m (300 m, then 325 m). Two builds fall in the
    // first 900 m, so that band is the tightest. The harbour band is wider, about 430 m: each of
    // those waves also spends its build on a zone gate or the gauntlet. The holes themselves get
    // harder, and every seed carries a gauntlet after 1.4 km.
    expect(mean(early), 'early per km').toBeGreaterThanOrEqual(3);
    expect(mean(early), 'early per km').toBeLessThanOrEqual(3.6);
    expect(mean(mid), 'mid per km').toBeGreaterThanOrEqual(2.8);
    expect(mean(mid), 'mid per km').toBeLessThanOrEqual(3.4);
    expect(mean(late), 'late per km').toBeGreaterThanOrEqual(2.1);
    expect(mean(late), 'late per km').toBeLessThanOrEqual(2.8);
    expect(lateTier / lateTierN, 'late holes are harder').toBeGreaterThan(earlyTier / earlyTierN + 0.4);
    expect(gapWalls / earlyWalls, 'walls over gaps').toBeGreaterThanOrEqual(0.22);
    expect(gauntlets, 'gauntlets across seeds').toBeGreaterThanOrEqual(SEEDS.length);
    expect(rows.every((r) => r.cleared)).toBe(true);
  });
});
