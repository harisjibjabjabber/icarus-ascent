import { describe, expect, it } from 'vitest';
import { EndlessCourse } from '../src/course/endless';
import type { SkySegment } from '../src/course/skyTypes';
import { SKY_LANE_TOL, SKY_LAND_CLEAR, SKY_RUN_IN, layoutSky } from '../src/course/sky';
import { Simulation } from '../src/sim/simulation';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';

const SEEDS = [1, 7, 13, 21, 42];

function collect(seed: number, dist = 4200, zones?: string[]): { course: EndlessCourse; sky: SkySegment[] } {
  const course = new EndlessCourse(seed, zones ? { zones } : {});
  const sky = new Map<number, SkySegment>();
  for (let x = 0; x <= dist + 200; x += 40) {
    course.stream(x);
    for (const s of course.sky) sky.set(s.id, { ...s, lines: s.lines, clusters: s.clusters, hops: s.hops });
  }
  return { course, sky: [...sky.values()].sort((a, b) => a.gx - b.gx) };
}

function laterals(seg: SkySegment): number[] {
  const out: number[] = [];
  for (const line of seg.lines) for (const a of line.anchors) out.push(a.lateral);
  for (const c of seg.clusters) out.push(c.tether.lateral);
  return out;
}

describe('sky templates', () => {
  it('keeps every interactive on the lane and the hole off line 1', () => {
    for (const variant of ['sky-intro', 'sky-hop', 'sky-gap', 'sky-gauntlet'] as const) {
      const L = layoutSky(variant, 110, 0, variant === 'sky-gauntlet');
      const segLaterals = [
        ...L.lines.flatMap((ln) => ln.anchors.map((a) => a.lateral)),
        ...L.clusters.map((c) => c.tether.lateral),
        L.tuft.lateral,
      ];
      for (const lat of segLaterals) expect(Math.abs(lat), variant).toBeLessThanOrEqual(SKY_LANE_TOL);
      expect(L.gx - L.x0, variant).toBeGreaterThanOrEqual(SKY_RUN_IN - 1e-6);
      expect(L.x1 - L.xLand, variant).toBeGreaterThanOrEqual(SKY_LAND_CLEAR - 1e-6);
      const line1 = L.lines[0].anchors;
      const l1End = line1[line1.length - 1].x;
      if (L.gapBelow) {
        expect(L.gapBelow.x0, variant).toBeGreaterThanOrEqual(l1End + 25);
        expect(L.gapBelow.x0, variant).toBeGreaterThan(line1[0].x);
        expect(L.gapBelow.x1 - L.gapBelow.x0, variant).toBeGreaterThan(19);
      }
    }
  });
});

describe('sky placement', () => {
  it('puts the first grate in the intro and at least five segments on each seed', () => {
    const bands = [
      { name: '0–300', lo: 0, hi: 300 },
      { name: '300–1400', lo: 300, hi: 1400 },
      { name: '1400–2650', lo: 1400, hi: 2650 },
      { name: '2650–4200', lo: 2650, hi: 4200 },
    ];
    const report: Record<string, number[]> = {};
    for (const band of bands) report[band.name] = [];
    for (const seed of SEEDS) {
      const { course, sky } = collect(seed);
      expect(sky.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      const first = sky[0];
      expect(first.variant, `seed ${seed}`).toBe('sky-intro');
      expect(Math.abs(first.gx - course.originX - 110), `seed ${seed} grate`).toBeLessThanOrEqual(5);
      for (const seg of sky) {
        for (const lat of laterals(seg)) expect(Math.abs(lat), `${seed} ${seg.variant}`).toBeLessThanOrEqual(SKY_LANE_TOL);
        expect(seg.gx - seg.x0).toBeGreaterThanOrEqual(SKY_RUN_IN - 1e-6);
        expect(seg.x1 - seg.xLand).toBeGreaterThanOrEqual(SKY_LAND_CLEAR - 1e-6);
        const l1 = seg.lines[0];
        const l1x0 = l1.anchors[0].x, l1x1 = l1.anchors[l1.anchors.length - 1].x;
        if (seg.gapBelow) {
          expect(seg.gapBelow.x0).toBeGreaterThanOrEqual(l1x1 + 25);
          expect(seg.gapBelow.x1).toBeGreaterThan(l1x0);
          expect(seg.gapBelow.x0).toBeGreaterThan(l1x1);
        }
        const route = seg.gx - course.originX;
        for (const band of bands) if (route >= band.lo && route < band.hi) report[band.name].push(1);
      }
    }
    const perKm: Record<string, number> = {};
    for (const band of bands) {
      const km = (band.hi - band.lo) / 1000;
      perKm[band.name] = Number(((report[band.name].length / SEEDS.length) / km).toFixed(2));
    }
    console.log(`sky segments per km ${JSON.stringify(perKm)}`);
    expect(perKm['0–300']).toBeGreaterThan(0);
  });
});

function rideScript(id: string, opts: AutopilotOptions) {
  const course = new EndlessCourse(1, { script: [id], d: 0.5 });
  const chunk = course.chunks.find((c) => c.spec === id)!;
  const sim = new Simulation(course, TUNING, { x: chunk.x0 + 8, speed: 14 });
  const ap = new Autopilot(opts);
  const end = chunk.x1 + 30;
  for (let i = 0; i < 80 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < end; i++) {
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    sim.drainEvents();
  }
  return sim;
}

describe('sky fairness on a scripted segment', () => {
  for (const id of ['sky-intro', 'sky-hop', 'sp-sky-gap', 'sp-sky-gauntlet']) {
    it(`ideal clears ${id} and passive does not die on it`, () => {
      const ideal = rideScript(id, { minSpeed: 14 });
      expect(ideal.state.mode, ideal.state.fail?.message).not.toBe('failed');
      const passive = rideScript(id, { minSpeed: 14, sky: false });
      expect(passive.state.mode, passive.state.fail?.message).not.toBe('failed');
    });
  }

  it('mistiming the gap is a real death', () => {
    const late = rideScript('sp-sky-gap', { minSpeed: 14, skyMistime: 'drop-over-gap' });
    expect(late.state.mode).toBe('failed');
  });
});
