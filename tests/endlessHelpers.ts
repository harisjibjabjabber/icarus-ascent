import { Simulation } from '../src/sim/simulation';
import { EndlessCourse } from '../src/course/endless';
import { Autopilot, type AutopilotOptions } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';
import type { Recorder } from '../src/diag/recorder';
import type { Chunk } from '../src/course/course';

/** Rider profiles the endless suite cycles through (lazy .. flat-out, all tactics). */
export const PROFILES: AutopilotOptions[] = [
  { minSpeed: 10 },
  { minSpeed: 12, styleFlips: true },
  { minSpeed: 30, strength: 1, styleFlips: true },
  { minSpeed: 15, pots: 'heel', pillarTrick: 'flip', optionalRail: true },
  { minSpeed: 13, pillarTrick: 'heel', styleGrabs: true },
  { minSpeed: 10, pots: 'heel', optionalRail: true },
  { minSpeed: 18, styleGrabs: true, pillarTrick: 'flip' },
];

export interface RideResult {
  sim: Simulation;
  course: EndlessCourse;
  events: { e: SimEvent; t: number; x: number }[];
  /** time at which the rider first reached x (sampled every 6 ticks) */
  timeAt: (x: number) => number;
  maxChunks: number;
  maxSurfaces: number;
  maxObstacles: number;
  maxBroken: number;
  /** Every chunk seen during the ride (captured before recycling). */
  chunks: Map<number, Chunk>;
}

/** Ride an endless course with the autopilot until `distance` past the start, a fail, or a timeout. */
export function rideEndless(seed: number, profile: AutopilotOptions, distance: number, opts: { start?: { x: number; speed: number }; course?: EndlessCourse; record?: Recorder; maxSeconds?: number } = {}): RideResult {
  const course = opts.course ?? new EndlessCourse(seed);
  const sim = new Simulation(course, TUNING, opts.start);
  const ap = new Autopilot(profile);
  const dt = TUNING.sim.dt;
  const events: RideResult['events'] = [];
  const xs: number[] = [], ts: number[] = [];
  const x0 = sim.state.x;
  let maxChunks = 0, maxSurfaces = 0, maxObstacles = 0, maxBroken = 0;
  const chunks = new Map<number, Chunk>();
  const capture = () => { for (const c of course.chunks) if (!chunks.has(c.id)) chunks.set(c.id, c); };
  capture();
  const maxTicks = Math.round((opts.maxSeconds ?? distance / 6) / dt);
  for (let i = 0; i < maxTicks && sim.state.mode !== 'failed' && sim.state.x - x0 < distance; i++) {
    for (const a of ap.next(sim)) { opts.record?.record(sim.state.tick, a); sim.enqueue(a); }
    sim.step();
    const t = sim.state.tick * dt;
    if (i % 6 === 0 && (xs.length === 0 || sim.state.x > xs[xs.length - 1])) { xs.push(sim.state.x); ts.push(t); }
    for (const e of sim.drainEvents()) events.push({ e, t, x: sim.state.x });
    if (i % 120 === 0) {
      capture();
      maxChunks = Math.max(maxChunks, course.chunks.length);
      maxSurfaces = Math.max(maxSurfaces, course.surfaces.length);
      maxObstacles = Math.max(maxObstacles, course.obstacles.length);
      maxBroken = Math.max(maxBroken, sim.state.broken.length);
    }
  }
  const timeAt = (x: number) => {
    let lo = 0, hi = xs.length - 1;
    if (hi < 0 || xs[hi] < x) return Infinity;
    while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] >= x) hi = m; else lo = m + 1; }
    return ts[lo];
  };
  return { sim, course, events, timeAt, maxChunks, maxSurfaces, maxObstacles, maxBroken, chunks };
}

export function describeFail(seed: number, profile: AutopilotOptions, r: RideResult): string {
  const c = r.course.chunkAt(r.sim.state.x);
  return `seed ${seed} ${JSON.stringify(profile)} in "${c?.spec}" (d=${c?.difficulty?.toFixed(2)}): ${r.sim.state.fail?.message ?? `stalled at speed ${r.sim.state.speed.toFixed(1)}`} @x=${r.sim.state.x.toFixed(0)}`;
}

/** Run a block of seeds over `km` km each; returns failure descriptions. Also checks per-seed invariants. */
export function seedBlock(from: number, to: number, km = 5): { fails: string[]; approach: string[]; maxChunks: number; maxBroken: number } {
  const fails: string[] = [], approach: string[] = [];
  let maxChunks = 0, maxBroken = 0;
  for (let seed = from; seed <= to; seed++) {
    const profile = PROFILES[seed % PROFILES.length];
    const r = rideEndless(seed, profile, km * 1000, { maxSeconds: km * 1000 / 7 });
    maxChunks = Math.max(maxChunks, r.maxChunks);
    maxBroken = Math.max(maxBroken, r.maxBroken);
    if (r.sim.state.mode === 'failed' || r.sim.state.x < km * 1000) { fails.push(describeFail(seed, profile, r)); continue; }
    approach.push(...approachIssues(r, seed));
  }
  return { fails, approach, maxChunks, maxBroken };
}

/** Required features: enough approach time from their run-in start to commitment. */
const APPROACH = { first: 2.0, combo: 1.2 };
export function approachIssues(r: RideResult, seed: number): string[] {
  const out: string[] = [];
  for (const c of r.chunks.values()) {
    let first = true;
    for (const f of c.features) {
      if (!f.required || f.approachX === undefined) continue;
      const commit = f.kind === 'pot' || f.kind === 'pillar' ? f.x - 3 : f.kind === 'rail' ? f.x - 2.2 : f.x - 0.8;
      const ta = r.timeAt(f.approachX), tc = r.timeAt(commit);
      if (!isFinite(tc)) continue; // not reached
      const need = first ? APPROACH.first : APPROACH.combo;
      if (tc - ta < need) out.push(`seed ${seed} ${c.spec} ${f.kind}@${f.x.toFixed(0)}: ${(tc - ta).toFixed(2)} s < ${need}`);
      first = false;
    }
  }
  return out;
}
