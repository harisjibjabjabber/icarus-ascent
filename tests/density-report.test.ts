import { it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { buildOpeningCourse } from '../src/course/opening';
import { Autopilot } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import { density, courseElements, densityOf, featureElements } from '../src/course/stats';
import { rideEndless } from './endlessHelpers';

/**
 * Course density report for review (obstacles per 100 m, longest empty stretch in m and s, time to the harbour).
 * Only writes when DENSITY_OUT is set: `DENSITY_OUT=review/dense/density-after.json npx vitest run tests/density-report.test.ts`.
 * Elements: gaps, rails (incl. optional handrails), walls (incl. optional), pots, pillars; style hills are listed apart.
 */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

it('density report (opening + endless)', async () => {
  const out = env.DENSITY_OUT;
  if (!out) return;
  const c = buildOpeningCourse();
  const sim = new Simulation(c, TUNING);
  const ap = new Autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true }); // the review clips' rider
  const xs: [number, number][] = [];
  for (let i = 0; i < 300 / TUNING.sim.dt && sim.state.mode !== 'finished' && sim.state.mode !== 'failed'; i++) { for (const a of ap.next(sim)) sim.enqueue(a); sim.step(); xs.push([sim.state.x, sim.state.tick * TUNING.sim.dt]); }
  const tAt = (x: number) => xs.find((p) => p[0] >= x)?.[1] ?? NaN;
  const harbourX = (c as { harbourX?: number }).harbourX ?? Math.floor((c.finishX - 220) / 40) * 40;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const stretch = (from: number, to: number) => {
    const d = density(c, from, to);
    return { from: Math.round(from), to: Math.round(to), elements: d.elements, per100m: +d.per100m.toFixed(2), longestEmptyM: r1(d.longestEmpty), longestEmptyS: r1(tAt(d.longestEmptyAt + d.longestEmpty) - tAt(d.longestEmptyAt)), longestEmptyAt: Math.round(d.longestEmptyAt) };
  };
  const tut = c.lessons[2].featureX + 6; // tutorial = push, descent, first jump
  const opening = {
    finishX: Math.round(c.finishX), finishTimeS: r1(tAt(c.finishX)), harbourX, timeToHarbourS: r1(tAt(harbourX)),
    firstWallRunX: Math.round(c.walls.find((w) => w.required)!.x0), timeToFirstWallRunS: r1(tAt(c.walls.find((w) => w.required)!.x0)),
    firstGapTimeS: r1(tAt(c.gaps[0].x0)),
    whole: stretch(0, c.finishX), afterTutorial: stretch(tut, c.finishX),
    elements: courseElements(c, 0, c.finishX).map((e) => `${e.kind}${e.required ? '' : '(opt)'} ${Math.round(e.x0)}-${Math.round(e.x1)} @${r1(tAt(e.x0))}s`),
  };
  const endless = [];
  for (const seed of [1, 2, 3, 7, 42]) {
    const r = rideEndless(seed, { minSpeed: 13 }, 3000, { maxSeconds: 400 });
    const feats = [...r.chunks.values()].flatMap((k) => k.features);
    const d = densityOf(featureElements(feats), 300, 3000);
    const all = densityOf(feats.map((f) => ({ kind: 'pot' as const, x0: f.x - 2, x1: f.x + 2, required: false })), 300, 3000);
    endless.push({ seed, range: '300-3000', per100m: +d.per100m.toFixed(2), styleHillsPer100m: +((feats.filter((f) => (f.kind === 'crest' || f.kind === 'rollers') && f.x >= 300 && f.x < 3000).length / 27)).toFixed(2), longestEmptyM: Math.round(d.longestEmpty), longestEmptyS: r1(r.timeAt(d.longestEmptyAt + d.longestEmpty) - r.timeAt(d.longestEmptyAt)), longestEmptyInclHillsM: Math.round(all.longestEmpty) });
  }
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { writeFileSync(p: string, s: string): void };
  fs.writeFileSync(out, JSON.stringify({ opening, endless }, null, 1));
});
