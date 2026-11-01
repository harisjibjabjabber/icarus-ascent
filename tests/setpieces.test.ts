import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { EndlessCourse, SET_PIECES, buildPhrase } from '../src/course/endless';
import { Autopilot } from '../src/diag/autopilot';
import { TUNING } from '../src/tuning';
import { PROFILES, rideEndless, approachIssues } from './endlessHelpers';
import { ZONES } from '../src/zones/registry';

describe('set pieces', () => {
  it('6-8 hand-authored set pieces, all used by some zone, each well formed (run-ins, receivers, recovery)', () => {
    expect(SET_PIECES.length).toBeGreaterThanOrEqual(6);
    expect(SET_PIECES.length).toBeLessThanOrEqual(8);
    const used = new Set(Object.values(ZONES).flatMap((z) => z.setPieces));
    for (const p of SET_PIECES) {
      expect(used.has(p.id), p.id).toBe(true);
      for (const d of [0, 0.5, 1]) {
        const b = buildPhrase(p, 100, 20, d, () => 0.5);
        const first = b.chains[0].points, last = b.chains[b.chains.length - 1].points;
        expect(Math.abs(first[1].y - first[0].y), `${p.id} start flat`).toBeLessThan(1e-9);
        expect(Math.abs(last[last.length - 1].y - last[last.length - 2].y), `${p.id} end flat`).toBeLessThan(1e-9);
        for (const ch of b.chains) for (let i = 1; i < ch.points.length; i++) expect(ch.points[i].x).toBeGreaterThan(ch.points[i - 1].x);
        const req = b.features.filter((f) => f.required && f.approachX !== undefined);
        expect(req.length, `${p.id} is a chain`).toBeGreaterThanOrEqual(2);
        for (const f of req) expect(f.x - f.approachX!, `${p.id} ${f.kind}@${f.x.toFixed(0)} run-in`).toBeGreaterThanOrEqual(24);
        expect(req[0].x - req[0].approachX!, `${p.id} first run-in`).toBeGreaterThanOrEqual(42);
        const end = last[last.length - 1].x, lastReq = Math.max(...b.features.filter((f) => f.required).map((f) => f.x));
        expect(end - lastReq, `${p.id} recovery`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('every set piece is clearable by every autopilot profile from the low and high end of its entry speeds (d = 0, 0.6, 1)', () => {
    const fails: string[] = [];
    for (const p of SET_PIECES) for (const d of [0, 0.6, 1]) for (const prof of PROFILES) for (const speed of [Math.max(p.entry[0], 9), 20]) {
      const course = new EndlessCourse(1, { script: ['start', 'recovery', p.id], d });
      const ch = course.chunks[2];
      const sim = new Simulation(course, TUNING, { x: course.chunks[1].cpX, speed });
      const ap = new Autopilot(prof);
      for (let i = 0; i < 120 / sim.dt && sim.state.mode !== 'failed' && sim.state.x < ch.x1 + 20; i++) { for (const a of ap.next(sim)) sim.enqueue(a); sim.step(); }
      if (sim.state.mode === 'failed' || sim.state.x < ch.x1 + 20) fails.push(`${p.id} d=${d} ${speed} m/s ${JSON.stringify(prof)}: ${sim.state.fail?.message ?? `stalled at ${sim.state.speed.toFixed(1)} m/s`} @${(sim.state.x - ch.x0).toFixed(0)} m in`);
    }
    expect(fails).toEqual([]);
  }, 300000);

  it('every set piece restarts fairly from its checkpoint, and keeps the 2 s prompt rule for its first feature', () => {
    const fails: string[] = [];
    for (const p of SET_PIECES) {
      const course = new EndlessCourse(1, { script: ['start', p.id], d: 1 });
      const ch = course.chunks[1];
      for (const prof of [PROFILES[0], PROFILES[2], PROFILES[3]]) {
        const r = rideEndless(1, prof, ch.x1 - ch.cpX + 30, { course, start: { x: ch.cpX, speed: ch.cpSpeed }, maxSeconds: 90 });
        if (r.sim.state.mode === 'failed') fails.push(`${p.id}: ${r.sim.state.fail?.message}`);
        fails.push(...approachIssues(r, 1).filter((s) => s.includes(p.id)));
      }
    }
    expect(fails).toEqual([]);
  }, 120000);
});
