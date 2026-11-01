/**
 * Ride 5 seeds on the ideal autopilot and score trail collectability.
 * Run: npx tsx scripts/orb-placement-verify.ts
 */
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { Autopilot } from '../src/diag/autopilot';
import { orbTouched, type Orb } from '../src/course/orbs';
import { TUNING } from '../src/tuning';

const SEEDS = [1, 7, 42, 99, 777];
const DIST = 2500;

function ride(seed: number) {
  const course = new EndlessCourse(seed);
  const sim = new Simulation(course, TUNING, { x: course.originX + 8, speed: 14 });
  const ap = new Autopilot({ minSpeed: 14, optionalRail: true, riskyLine: true, styleFlips: true, pots: 'jump' });
  const seen = new Map<number, Orb>();
  const got = new Set<number>();
  let prev = sim.state.x;
  const limit = course.originX + DIST;
  for (let i = 0; i < 120 * 400 && sim.state.mode !== 'failed' && sim.state.x < limit; i++) {
    for (const a of ap.next(sim)) sim.enqueue(a);
    sim.step();
    for (const o of course.orbs) {
      if (!seen.has(o.id)) seen.set(o.id, o);
      if (got.has(o.id)) continue;
      if (orbTouched(o, prev, sim.state)) got.add(o.id);
    }
    prev = sim.state.x;
  }
  const span = Math.max(1, sim.state.x - course.originX);
  const orbs = [...seen.values()].filter((o) => o.x >= course.originX && o.x <= course.originX + DIST);
  const groups = new Map<number, Orb[]>();
  for (const o of orbs) {
    if (o.trailLen <= 1 && o.tier !== 'rare') continue;
    const id = o.trailId || -o.id;
    const g = groups.get(id) ?? [];
    g.push(o);
    groups.set(id, g);
  }
  const gold = [...groups.values()].filter((g) => g[0].tier === 'common' && g.length >= (g[0].pickup === 'wall' ? 4 : 5));
  const full = gold.filter((g) => g.every((o) => got.has(o.id))).length;
  const rares = orbs.filter((o) => o.tier === 'rare').sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 1; i < rares.length; i++) gaps.push(rares[i].x - rares[i - 1].x);
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  return {
    seed,
    ridden: +span.toFixed(0),
    failed: sim.state.mode === 'failed',
    goldTrails: gold.length,
    trailsPer100m: +((gold.length / span) * 100).toFixed(2),
    fullyCollectablePct: gold.length ? Math.round((full / gold.length) * 100) : 0,
    rareCount: rares.length,
    purpleGapMeanM: +mean.toFixed(0),
    purpleGapMinM: gaps.length ? +Math.min(...gaps).toFixed(0) : 0,
  };
}

const rows = SEEDS.map(ride);
console.log(JSON.stringify(rows, null, 2));
