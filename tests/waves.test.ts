import { describe, it, expect } from 'vitest';
import { WAVE, waveAt, waveTimeline } from '../src/course/waves';
import { EndlessCourse, SPEC, maxTier } from '../src/course/endless';
import { ZoneSequence } from '../src/zones/sequence';
import { ZONES, zonesFromSearch, DEFAULT_ZONES } from '../src/zones/registry';
import type { Chunk, Rail, Wall } from '../src/course/course';
import { rideEndless, PROFILES } from './endlessHelpers';
import { densityOf, featureElements } from '../src/course/stats';

function generate(seed: number, dist: number, zones?: string[]): Chunk[] {
  const c = new EndlessCourse(seed, { zones });
  const seen = new Map<number, Chunk>();
  for (let x = 0; x <= dist; x += 50) { c.stream(x); for (const k of c.chunks) seen.set(k.id, k); }
  return [...seen.values()].filter((k) => k.x0 < dist).sort((a, b) => a.x0 - b.x0);
}

/** generate() plus the route origin (distance = x - originX) and every rail / wall seen while streaming. */
function generateAt(seed: number, dist: number): { chunks: Chunk[]; originX: number; walls: Wall[]; rails: Rail[] } {
  const c = new EndlessCourse(seed);
  const seen = new Map<number, Chunk>(), walls = new Map<number, Wall>(), rails = new Map<number, Rail>();
  for (let x = 0; x <= dist; x += 50) {
    c.stream(x);
    for (const k of c.chunks) seen.set(k.id, k);
    for (const w of c.walls) walls.set(w.id, w);
    for (const r of c.rails) rails.set(r.id, r);
  }
  return { chunks: [...seen.values()].filter((k) => k.x0 < dist).sort((a, b) => a.x0 - b.x0), originX: c.originX, walls: [...walls.values()], rails: [...rails.values()] };
}

describe('waves', () => {
  it('build -> peak -> breather; every peak is higher than the last until the cap, breathers drop back down', () => {
    const peaks: number[] = [];
    for (let w = 0; w < 8; w++) {
      const s = WAVE.first + w * WAVE.length;
      const b0 = waveAt(s + 1), b1 = waveAt(s + WAVE.length * WAVE.build - 1), p = waveAt(s + WAVE.length * (WAVE.build + 0.1)), br = waveAt(s + WAVE.length * 0.95);
      expect([b0.phase, p.phase, br.phase]).toEqual(['build', 'peak', 'breather']);
      expect(b1.d).toBeGreaterThan(b0.d);
      expect(p.d).toBeGreaterThan(b1.d - 1e-9);
      expect(br.d).toBeLessThan(p.d);
      peaks.push(p.d);
    }
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThanOrEqual(peaks[i - 1]);
    expect(peaks[0]).toBeLessThan(0.35); // wave 0 peaks below tier 3
    expect(peaks[peaks.length - 1]).toBe(1);
    expect(waveAt(100).phase).toBe('warmup');
    expect(waveTimeline(3000).filter((p) => p.phase === 'peak').length).toBe(Math.ceil((3000 - WAVE.first) / WAVE.length));
  });

  it('set pieces lie wholly inside their wave\'s peak, at most one per wave, nearly every peak has one (200 seeds x 5 km, real positions)', () => {
    let peaks = 0, withSp = 0;
    for (let s = 1; s <= 200; s++) {
      const { chunks: cs, originX } = generateAt(s, 5000);
      const perWave = new Map<number, number>();
      for (const c of cs.filter((q) => q.setPiece)) {
        const a = waveAt(c.x0 - originX), b = waveAt(c.x1 - originX - 1e-6);
        expect(a.index, `seed ${s} ${c.spec} starts and ends in the same wave`).toBe(b.index);
        expect(c.x0 - originX, `seed ${s} ${c.spec} starts at or after the peak`).toBeGreaterThanOrEqual(a.peakAt - 1e-6);
        expect(c.x1 - originX, `seed ${s} ${c.spec} ends by the breather`).toBeLessThanOrEqual(a.breatherAt + 1e-6);
        expect(c.wave, `seed ${s} label is the real phase`).toEqual({ index: a.index, phase: a.phase });
        perWave.set(a.index, (perWave.get(a.index) ?? 0) + 1);
      }
      for (const n of perWave.values()) expect(n, `seed ${s}: one set piece per wave`).toBe(1);
      for (let w = 0; WAVE.first + (w + 1) * WAVE.length <= 4800; w++) { peaks++; if (perWave.has(w)) withSp++; }
      for (const c of cs) if (!c.connector) expect(c.tier!).toBeLessThanOrEqual(maxTier(c.difficulty!));
    }
    expect(withSp / peaks).toBeGreaterThanOrEqual(0.8);
  });

  it('breathers are calm: no pot, pillar, required gap, rail or wall lies in a breather window (200 seeds x 5 km, real positions)', () => {
    const bad: string[] = [];
    for (let s = 1; s <= 200; s++) {
      const { chunks: cs, originX, walls, rails } = generateAt(s, 5000);
      const inBreather = (x: number) => { const w = waveAt(x - originX); return w.index >= 0 && w.phase === 'breather'; };
      for (const c of cs) {
        if (c.wave?.phase === 'breather' && !c.connector) expect(SPEC[c.spec!].required, `seed ${s} ${c.spec} in a breather`).toBe(false);
        for (const f of c.features) if (f.required && inBreather(f.x)) bad.push(`seed ${s} ${c.spec} ${f.kind}@${(f.x - originX).toFixed(0)}`);
      }
      // compulsory rails and walls: their whole span stays out of the breather
      for (const w of walls) if (w.required) for (let x = w.x0; x <= w.x1; x += 1) if (inBreather(x)) { bad.push(`seed ${s} wall ${w.id}@${(x - originX).toFixed(0)}`); break; }
      for (const r of rails) if (r.required) for (const p of r.points) if (inBreather(p.x)) { bad.push(`seed ${s} rail ${r.id}@${(p.x - originX).toFixed(0)}`); break; }
    }
    expect(bad).toEqual([]);
  });

  it('density rises with the wave: peaks carry far more compulsory features per 100 m than breathers', () => {
    let peak = 0, peakLen = 0, br = 0, brLen = 0;
    for (let s = 1; s <= 40; s++) for (const c of generate(s, 5000)) {
      const n = c.features.filter((f) => f.required).length, len = c.x1 - c.x0;
      if (c.wave?.phase === 'peak') { peak += n; peakLen += len; } else if (c.wave?.phase === 'breather') { br += n; brLen += len; }
    }
    expect((peak / peakLen) * 100).toBeGreaterThan(2 * (br / brLen) * 100);
    const all = generate(7, 5000).flatMap((c) => c.features);
    expect(densityOf(featureElements(all), 300, 5000).per100m).toBeGreaterThanOrEqual(1.0);
  });

  it('the hard moments are fair: 60 more seeds x 5 km of waves and set pieces are completable by the autopilot profiles', () => {
    const fails: string[] = [];
    for (let s = 300; s < 360; s++) {
      const prof = PROFILES[s % PROFILES.length];
      const r = rideEndless(s, prof, 5000, { maxSeconds: 5000 / 7 });
      if (r.sim.state.mode === 'failed' || r.sim.state.x < 5000) fails.push(`seed ${s} ${JSON.stringify(prof)}: ${r.sim.state.fail?.message ?? 'stalled'} in ${r.course.chunkAt(r.sim.state.x)?.spec}`);
    }
    expect(fails).toEqual([]);
  }, 300000);
});

describe('zone sequencing', () => {
  it('the default run is the town only, with no gates; experimental zones join only by URL', () => {
    expect(DEFAULT_ZONES).toEqual(['town']);
    expect(zonesFromSearch('')).toEqual(['town']);
    expect(zonesFromSearch('?zone=hills')).toEqual(['town', 'hills']);
    expect(zonesFromSearch('?zones=hills,town')).toEqual(['hills', 'town']);
    expect(zonesFromSearch('?zones=nope')).toEqual(['town']);
    for (const id of DEFAULT_ZONES) expect(ZONES[id].experimental).toBeFalsy();
    expect(generate(5, 6000).every((c) => c.zone === 'town' && !c.gate)).toBe(true);
  });

  it("zones change only at wave ends, through one gate chunk each, and every chunk uses its zone's phrases", () => {
    const seq = new ZoneSequence(['town', 'hills']);
    const b = seq.boundaries(10000);
    expect(b[0]).toEqual({ at: WAVE.first + ZONES.town.waves * WAVE.length, from: 'town', to: 'hills' });
    expect(b[1]).toEqual({ at: b[0].at + ZONES.hills.waves * WAVE.length, from: 'hills', to: 'town' });
    for (const x of b.map((q) => q.at)) expect((x - WAVE.first) % WAVE.length).toBe(0);
    expect(seq.zoneAt(b[0].at - 1).id).toBe('town');
    expect(seq.zoneAt(b[0].at + 1).id).toBe('hills');
    for (let s = 1; s <= 60; s++) {
      const cs = generate(s, 10000, ['town', 'hills']);
      const gates = cs.filter((c) => c.gate);
      for (const q of b.filter((q) => q.at < 9000)) {
        const g = gates.filter((c) => c.x0 >= q.at - 10 && c.x0 < q.at + 700);
        expect(g.length, `seed ${s} gate within 700 m after ${q.at} (the queued phrases finish first)`).toBe(1);
        expect(g[0].gate).toEqual({ from: q.from, to: q.to });
      }
      for (const c of cs) {
        if (c.connector || !c.spec) continue;
        const z = ZONES[c.zone!];
        expect(z.phrases.includes(c.spec) || z.setPieces.includes(c.spec), `seed ${s}: ${c.spec} in ${c.zone}`).toBe(true);
      }
      const g0 = gates[0];
      expect(cs.filter((c) => c.x1 <= g0.x0).every((c) => c.zone === 'town')).toBe(true);
      const originX = new EndlessCourse(s).originX; // chunk x is a course coordinate; b[].at is a distance from the route origin
      expect(cs.filter((c) => c.x0 >= g0.x0 && c.x0 - originX < b[1].at).every((c) => c.zone === 'hills')).toBe(true);
    }
  });

  it('a town -> hills run stays completable through the gate', () => {
    for (const s of [3, 4, 5]) {
      const course = new EndlessCourse(s, { zones: ['town', 'hills'] });
      const r = rideEndless(s, PROFILES[s % PROFILES.length], 4200, { course, maxSeconds: 700 });
      expect(r.sim.state.mode, `seed ${s}`).not.toBe('failed');
      expect([...r.chunks.values()].some((c) => c.gate)).toBe(true);
    }
  });
});
