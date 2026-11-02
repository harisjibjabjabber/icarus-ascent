import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { Course, type Chunk } from '../src/course/course';
import { EndlessCourse, LIBRARY, PHRASES, SPEC, STREAM, buildPhrase, connectorFor, maxTier, maxRequiredRun, netDrop } from '../src/course/endless';
import { Autopilot } from '../src/diag/autopilot';
import { Recorder, replayHeadless } from '../src/diag/recorder';
import { TUNING } from '../src/tuning';
import { PROFILES, rideEndless, describeFail } from './endlessHelpers';
import { densityOf, featureElements } from '../src/course/stats';

const HC = TUNING.movement.hardCap;

/** Generate a route's chunks to `dist` m without riding (streaming pace doesn't matter). */
function generate(seed: number, dist: number, step = 50): Chunk[] {
  const c = new EndlessCourse(seed);
  const seen = new Map<number, Chunk>();
  for (let x = 0; x <= dist; x += step) { c.stream(x); for (const k of c.chunks) seen.set(k.id, k); }
  return [...seen.values()].filter((k) => k.x0 < dist);
}

describe('phrase library', () => {
  it('has 15-34 authored phrases (plus connectors), each declaring entry/exit speed, airtime, receiver and tier', () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(15);
    expect(LIBRARY.length).toBeLessThanOrEqual(34);
    for (const p of PHRASES) {
      expect(p.entry[0]).toBeLessThanOrEqual(p.entry[1]);
      expect(p.exit[0]).toBeLessThanOrEqual(p.exit[1]);
      expect(p.entry[1]).toBeLessThanOrEqual(HC);
      expect(p.airtime).toBeGreaterThanOrEqual(0);
      expect(['flat', 'downslope', 'climb', 'broad']).toContain(p.receiving);
    }
    for (const t of [1, 2, 3]) expect(LIBRARY.filter((p) => p.tier === t).length).toBeGreaterThanOrEqual(3);
    // heavy use of hills and kickers for style air with no gap
    const style = LIBRARY.filter((p) => p.style);
    expect(style.length).toBeGreaterThanOrEqual(7);
    for (const p of LIBRARY.filter((q) => q.style && !q.required)) {
      const b = buildPhrase(p, 0, 0, 0.5, () => 0.5);
      expect(b.chains.length, `${p.id} is gap-free`).toBe(1);
      expect(b.features.some((f) => f.kind === 'crest' || f.kind === 'rollers'), p.id).toBe(true);
    }
  });

  it('every phrase is well formed at all difficulties: flat seamless joins, increasing x, compulsory features with run-ins and recovery', () => {
    for (const p of PHRASES) for (const d of [0, 0.5, 1]) {
      const b = buildPhrase(p, 100, 20, d, () => 0.5);
      const first = b.chains[0].points, last = b.chains[b.chains.length - 1].points;
      expect(first[0]).toEqual({ x: 100, y: 20 });
      // starts and ends flat so any two phrases join without a crest or a kink at the seam
      expect(Math.abs(first[1].y - first[0].y), `${p.id} start`).toBeLessThan(1e-9);
      expect(Math.abs(last[last.length - 1].y - last[last.length - 2].y), `${p.id} end`).toBeLessThan(1e-9);
      for (const ch of b.chains) for (let i = 1; i < ch.points.length; i++) expect(ch.points[i].x).toBeGreaterThan(ch.points[i - 1].x);
      const end = last[last.length - 1].x;
      const req = b.features.filter((f) => f.required && f.approachX !== undefined);
      for (const f of req) expect(f.x - f.approachX!, `${p.id} ${f.kind} run-in`).toBeGreaterThanOrEqual(24);
      if (req.length) expect(req[0].x - req[0].approachX!, `${p.id} first run-in`).toBeGreaterThanOrEqual(42);
      const lastReq = Math.max(...b.features.filter((f) => f.required).map((f) => f.x), -Infinity);
      if (isFinite(lastReq)) expect(end - lastReq, `${p.id} recovery`).toBeGreaterThanOrEqual(10);
      if (p.required) expect(req.length).toBeGreaterThan(0); else expect(b.features.some((f) => f.required)).toBe(false);
    }
  });
});

describe('assembly', () => {
  it('is deterministic per seed and independent of streaming pace', () => {
    const sig = (cs: Chunk[]) => cs.map((c) => `${c.spec}@${c.x0.toFixed(6)},${c.y0.toFixed(6)}`).join('|');
    const a = generate(42, 6000, 50), b = generate(42, 6000, 7), c = generate(43, 6000, 50);
    expect(sig(a)).toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
  });

  it('follows a difficulty curve: tiers unlock with distance, later stretches are harder, combos lengthen', () => {
    const tierAt = (lo: number, hi: number) => { const t: number[] = []; for (let s = 1; s <= 60; s++) for (const c of generate(s, hi)) if (c.x0 >= lo && !c.connector) t.push(c.tier!); return t; };
    const early = tierAt(0, 800), late = tierAt(3500, 5000);
    expect(Math.max(...early)).toBeLessThanOrEqual(2);
    const avg = (q: number[]) => q.reduce((x, y) => x + y, 0) / q.length;
    expect(avg(late)).toBeGreaterThan(avg(early) + 0.5);
    expect(late.filter((t) => t === 3).length).toBeGreaterThan(0);
    for (let s = 1; s <= 60; s++) {
      const cs = generate(s, 5000);
      for (const c of cs) if (!c.connector) expect(c.tier!).toBeLessThanOrEqual(maxTier(c.difficulty!)); // assembled under the wave's difficulty (it may start just into the next phase)
      let run = 0;
      for (const c of cs) { if (c.setPiece) { run = 0; continue; } run = SPEC[c.spec!].required ? run + 1 : 0; expect(run).toBeLessThanOrEqual(maxRequiredRun(c.difficulty!)); }
    }
    expect(maxRequiredRun(1)).toBeGreaterThan(maxRequiredRun(0));
  });

  it('neighbour validation holds for every consecutive pair over 200 seeds x 5 km, with connectors where needed', () => {
    const bad: string[] = [];
    let connectors = 0, phrases = 0;
    for (let s = 1; s <= 200; s++) {
      const cs = generate(s, 5000, 100);
      let run = 0, y0 = 0;
      for (let i = 1; i < cs.length; i++) {
        const a = SPEC[cs[i - 1].spec!], b = SPEC[cs[i].spec!];
        run = a.required ? run + 1 : 0;
        if (cs[i].connector) connectors++; else phrases++;
        if (!cs[i].connector) {
          const c = connectorFor(a, b, { requiredRun: run, d: cs[i].difficulty!, y: cs[i].y0, y0 });
          if (c && c !== 'climb') bad.push(`seed ${s}: ${a.id} -> ${b.id} needs ${c}`);
        }
        expect(cs[i].x0).toBeCloseTo(cs[i - 1].x1, 9); // seamless
        expect(cs[i].y0).toBeCloseTo(cs[i - 1].y1, 9);
        expect(a.id === b.id && !cs[i].connector, `seed ${s}: ${a.id} twice in a row`).toBe(false);
      }
      void y0;
    }
    expect(bad).toEqual([]);
    expect(connectors / (connectors + phrases)).toBeLessThan(0.3);
  });

  it('never leaves an empty stretch of 120 m or more (200 seeds x 5 km)', () => {
    const long: string[] = [];
    for (let s = 1; s <= 200; s++) {
      const xs = generate(s, 5000, 100).flatMap((c) => c.features.map((f) => f.x)).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] >= 120) long.push(`seed ${s}: ${xs[i - 1].toFixed(0)}..${xs[i].toFixed(0)}`);
      expect(xs[0]).toBeLessThan(120);
    }
    expect(long).toEqual([]);
  });

  it('dense: something to do (gap, rail, wall, pot or pillar) >= 1 per 100 m on average, hills fill the rest (< 100 m empty)', () => {
    let n = 0, len = 0;
    const long: string[] = [];
    for (let s = 1; s <= 50; s++) {
      const feats = generate(s, 3000, 100).flatMap((c) => c.features);
      const d = densityOf(featureElements(feats), 300, 3000);
      n += d.elements; len += 2700;
      const xs = feats.map((f) => f.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] >= 105 && xs[i] < 3000) long.push(`seed ${s}: ${xs[i - 1].toFixed(0)}..${xs[i].toFixed(0)}`); // was 100 m; optional activity phrases retired in sky phase 0
    }
    expect((n / len) * 100).toBeGreaterThanOrEqual(1.0);
    expect(long).toEqual([]);
  });

  it('keeps the route within a height band (climbs come back after long descents)', () => {
    for (let s = 1; s <= 40; s++) {
      const cs = generate(s, 10000, 100);
      expect(Math.min(...cs.map((c) => c.y1))).toBeGreaterThan(-260);
    }
    expect(LIBRARY.filter((p) => netDrop(p) < 0).length).toBeGreaterThan(0);
  });
});

describe('adjacency across intended speed ranges', () => {
  it("every library pair completes from the low and high end of the first phrase's entry range, lazy and flat-out", () => {
    const fails: string[] = [];
    const exitSpeeds = new Map<string, number[]>();
    for (const a of LIBRARY) for (const b of LIBRARY) {
      if (a.id === b.id) continue;
      for (const [speed, prof] of [[Math.max(a.entry[0], 8), PROFILES[0]], [Math.min(a.entry[1], 20), PROFILES[2]], [Math.max(a.entry[0], 8), PROFILES[3]]] as const) {
        const course = new EndlessCourse(1, { script: ['start', a.id, b.id], d: 0.8 });
        const ca = course.chunks[1], cb = course.chunks[2];
        const sim = new Simulation(course, TUNING, { x: ca.cpX, speed });
        const ap = new Autopilot(prof);
        let atB = -1;
        for (let i = 0; i < 90 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < cb.x1 + 5; i++) {
          for (const q of ap.next(sim)) sim.enqueue(q);
          sim.step();
          if (atB < 0 && sim.state.x >= cb.x0 && (sim.state.mode === 'grounded' || sim.state.mode === 'heelSkim')) { atB = sim.state.speed; (exitSpeeds.get(a.id) ?? exitSpeeds.set(a.id, []).get(a.id)!).push(atB); }
        }
        if (sim.state.mode === 'failed' || sim.state.x < cb.x1) fails.push(`${a.id} -> ${b.id} from ${speed} m/s ${JSON.stringify(prof)}: ${sim.state.fail?.message ?? 'stalled'} @${sim.state.x.toFixed(0)}`);
      }
    }
    expect(fails).toEqual([]);
    // declared likely exit speeds match what riders actually leave with
    for (const p of LIBRARY) {
      const v = exitSpeeds.get(p.id)!;
      expect(Math.min(...v), `${p.id} exit min`).toBeGreaterThanOrEqual(p.exit[0] - 1);
      expect(Math.max(...v), `${p.id} exit max`).toBeLessThanOrEqual(p.exit[1] + 0.01);
    }
  });
});

describe('streaming, recycling and memory', () => {
  it('content is generated ahead and recycled behind; memory stays bounded over 50 km', () => {
    const c = new EndlessCourse(9);
    let maxChunks = 0, maxSurf = 0, maxPts = 0, maxObs = 0, maxGaps = 0;
    for (let x = 0; x <= 50000; x += 5) {
      c.stream(x);
      expect(c.generatedTo).toBeGreaterThanOrEqual(x + STREAM.ahead);
      expect(c.chunks[0].x1).toBeGreaterThan(x - STREAM.behind - 400);
      expect(c.groundBelow(x, 1e6) ?? c.gapAt(x)).toBeTruthy();
      maxChunks = Math.max(maxChunks, c.chunks.length);
      maxSurf = Math.max(maxSurf, c.surfaces.length);
      maxPts = Math.max(maxPts, c.surfaces.reduce((n, s) => n + s.points.length, 0));
      maxObs = Math.max(maxObs, c.obstacles.length + c.rails.length + c.walls.length);
      maxGaps = Math.max(maxGaps, c.gaps.length + c.markers.length);
    }
    expect(c.built).toBeGreaterThan(150);
    expect(c.recycled).toBeGreaterThan(140);
    expect(maxChunks).toBeLessThan(16);
    expect(maxSurf).toBeLessThan(28);
    expect(maxPts).toBeLessThan(2000);
    expect(maxObs).toBeLessThan(28);
    expect(maxGaps).toBeLessThan(15);
  });

  it('never recycles content the rider is touching, and sim/autopilot state stays bounded on a 20 km ride', () => {
    const r = rideEndless(5, { minSpeed: 15, pots: 'heel', optionalRail: true, styleFlips: true }, 20000, { maxSeconds: 20000 / 7 });
    expect(r.sim.state.mode, describeFail(5, {minSpeed: 15}, r)).not.toBe('failed');
    expect(r.sim.state.x).toBeGreaterThan(20000);
    // A wall tap queued in front of a set piece adds one chunk to the live window.
    expect(r.maxChunks).toBeLessThan(17);
    expect(r.maxBroken).toBeLessThan(12);
    expect(r.maxSurfaces).toBeLessThan(28);
  });

  it('a chunk being ridden (ground, rail or wall contact) is kept even when far behind', () => {
    const c = new EndlessCourse(3);
    const first = c.chunks[0];
    c.stream(first.x1 + STREAM.behind + 50, { surfaceId: first.surfaces[0], railId: -1, wallId: -1 });
    expect(c.chunks[0].id).toBe(first.id);
    c.stream(first.x1 + STREAM.behind + 50);
    expect(c.chunks[0].id).not.toBe(first.id);
  });
});

describe('precision, rebasing and replay', () => {
  it('no coordinate drift: the same route ridden 1000 km from the origin matches to 1e-6 m', () => {
    const script = ['start', 'big-kicker', 'pot-pillar', 'rail-gap', 'wall-gap', 'pop-chain', 'gap-pillar'];
    const ride = (x0: number) => {
      const c = new EndlessCourse(1, { x0, script, d: 0.6 });
      const sim = new Simulation(c);
      const ap = new Autopilot({ minSpeed: 15, styleFlips: true });
      const trace: number[] = [];
      for (let i = 0; i < 60 / sim.dt && sim.state.mode !== 'failed'; i++) { for (const a of ap.next(sim)) sim.enqueue(a); sim.step(); if (i % 60 === 0) trace.push(sim.state.x - x0, sim.state.y, sim.state.speed); }
      return { trace, mode: sim.state.mode };
    };
    const a = ride(0), b = ride(1_000_000);
    expect(a.mode).not.toBe('failed');
    expect(b.trace.length).toBe(a.trace.length);
    for (let i = 0; i < a.trace.length; i++) expect(Math.abs(a.trace[i] - b.trace[i])).toBeLessThan(1e-6);
  });

  it('a 5 km endless run replays bit-for-bit from its trace (fresh course, streamed and recycled again)', () => {
    const rec = new Recorder(77, 'endless');
    const r = rideEndless(77, { minSpeed: 14, styleFlips: true, pots: 'heel' }, 5000, { record: rec, maxSeconds: 900 });
    expect(r.sim.state.mode).not.toBe('failed');
    const end = replayHeadless(rec.finish(r.sim.state.tick));
    expect(end.x).toBe(r.sim.state.x);
    expect(end.y).toBe(r.sim.state.y);
    expect(end.speed).toBe(r.sim.state.speed);
  });

  it('per-phrase checkpoints: a retry from a phrase deep in the run replays on a fresh course and can continue', () => {
    const course = new EndlessCourse(31);
    const r = rideEndless(31, { minSpeed: 13 }, 3200, { course, maxSeconds: 600 });
    expect(r.sim.state.mode).not.toBe('failed');
    const cp = course.chunkAt(r.sim.state.x)!;
    const start = { x: cp.cpX, speed: cp.cpSpeed };
    // the checkpoint lies on the ground of a still-loaded phrase
    expect(course.groundBelow(start.x, 1e6)).toBeTruthy();
    const rec = new Recorder(31, 'endless', start);
    const again = rideEndless(31, { minSpeed: 13 }, 800, { course, start, record: rec, maxSeconds: 200 });
    expect(again.sim.state.mode).not.toBe('failed');
    const end = replayHeadless(rec.finish(again.sim.state.tick));
    expect(end.x).toBe(again.sim.state.x);
  });

  it('checkpoints restart fairly from their declared speed in every phrase', () => {
    const fails: string[] = [];
    for (const p of LIBRARY) {
      const course = new EndlessCourse(1, { script: ['start', p.id], d: 1 });
      const ch = course.chunks[1];
      for (const prof of [PROFILES[0], PROFILES[2]]) {
        const r = rideEndless(1, prof, ch.x1 - ch.cpX + 30, { course, start: { x: ch.cpX, speed: ch.cpSpeed }, maxSeconds: 60 });
        if (r.sim.state.mode === 'failed') fails.push(`${p.id}: ${r.sim.state.fail?.message}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it("a removed chunk's broken-obstacle ids are pruned from sim state", () => {
    const r = rideEndless(12, { minSpeed: 14, pots: 'heel' }, 6000, { maxSeconds: 900 });
    for (const id of r.sim.state.broken) expect(r.course.hasObstacle(id)).toBe(true);
    void Course;
  });
});
