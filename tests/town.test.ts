import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Kit } from '../src/render/town/kit';
import { buildTownChunk, startTownChunk } from '../src/render/town/town';
import { Environment } from '../src/render/environment';
import { frameDt } from '../src/game';

const loadKit = async () => {
  const nodeFs = 'node:fs'; const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync(p: string, enc?: string): Uint8Array & string };
  const b = fs.readFileSync('public/town/kit.bin');
  const j = JSON.parse(fs.readFileSync('public/town/kit.json', 'utf8'));
  return Kit.fromBuffers(j, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const slope = (x: number) => ({ y: -x * 0.045, gap: false });

describe('witch town chunks', () => {
  let kit: Kit;
  beforeAll(async () => { kit = await loadKit(); });
  it('loads the baked kit with the pieces the layout uses', () => {
    for (const p of ['wallWin', 'wallDoor', 'shutWide', 'roof44lite', 'roof46lite', 'door', 'lantern', 'roofTower', 'dock', 'ship']) expect(kit.pieces.has(p), p).toBe(true);
  });
  it('is deterministic per seed and chunk', () => {
    const a = buildTownChunk(kit, 4, 12345, slope), b = buildTownChunk(kit, 4, 12345, slope);
    expect(a.trisNear).toBe(b.trisNear); expect(a.trisFar).toBe(b.trisFar);
  });
  it('slices a chunk across many pumps and still matches a one-shot build', () => {
    const once = buildTownChunk(kit, 9, 12345, slope, { harbourFrom: 200, clockTowers: [360] });
    const job = startTownChunk(kit, 9, 12345, slope, { harbourFrom: 200, clockTowers: [360] });
    let sliced = null, pumps = 0;
    while (!sliced && pumps++ < 500) sliced = job.pump(0);
    expect(pumps).toBeGreaterThan(12); // one house (or thinner) per slice, not the whole chunk
    expect(sliced!.trisNear).toBe(once.trisNear);
    expect(sliced!.trisFar).toBe(once.trisFar);
    const sum = (g: THREE.BufferGeometry | null) => {
      const p = g?.getAttribute('position')?.array as ArrayLike<number> | undefined;
      if (!p) return 0;
      let s = 0; for (let i = 0; i < p.length; i += 7) s += p[i];
      return s;
    };
    expect(sum(sliced!.near)).toBeCloseTo(sum(once.near), 3);
    expect(sum(sliced!.far)).toBeCloseTo(sum(once.far), 3);
    expect(job.pump(0)).toBeNull();
  });
  it('stays inside the phone triangle budget (near <= 60k, far <= 6k per 40 m chunk)', () => {
    for (let k = 0; k < 30; k++) {
      const c = buildTownChunk(kit, k, 777, slope, { harbourFrom: 880, clockTowers: [300] });
      expect(c.trisNear, `near ${k}`).toBeLessThanOrEqual(60000);
      expect(c.trisFar, `far ${k}`).toBeLessThanOrEqual(6000);
    }
  });
  it('streams a new town chunk across frames instead of building it inside one', () => {
    const env = new Environment(new THREE.Scene());
    env.buildScenery(3, Infinity, () => 0, 0, true, () => ({ y: 0, gap: false }));
    env.setKit(kit);
    env.streamScenery(0); // load-veil fill: the whole window, synchronously
    const n0 = env.townChunkCount;
    expect(n0).toBeGreaterThan(8);
    env.sliceMs = 0; // one slice per call
    env.streamScenery(40); // drops the chunk behind; the new one has only had a single slice
    expect(env.townChunkCount).toBe(n0 - 1);
    let calls = 0;
    while (env.townChunkCount < n0 && calls++ < 400) env.streamScenery(40);
    expect(env.townChunkCount).toBe(n0);
    expect(calls).toBeGreaterThan(8);
  });
});

describe('frame clock', () => {
  it('clamps hitches and ignores a backwards timestamp', () => {
    expect(frameDt(1000, 0)).toBeCloseTo(1 / 60);
    expect(frameDt(1016, 1000)).toBeCloseTo(0.016);
    expect(frameDt(900, 1000)).toBe(0);
    expect(frameDt(2000, 1000)).toBeCloseTo(0.1);
  });
});

describe('town LOD / streaming fades (anti pop-in)', async () => {
  const { townFade, TOWN_LOD } = await import('../src/render/environment');
  const old = 300; // previous streaming horizon: chunks used to appear here, well inside the visible haze
  it('streams chunks in deep in the haze and dissolves them in instead of appearing at once', () => {
    expect(TOWN_LOD.ahead).toBeGreaterThan(old + 100);
    expect(townFade(TOWN_LOD.ahead - 5, 99).far[1]).toBeLessThan(0.05); // just built: nearly invisible
    expect(townFade(TOWN_LOD.ahead - TOWN_LOD.spawnFade, 99).far[1]).toBeCloseTo(1, 5);
    expect(townFade(200, 0).far[1]).toBe(0); // brand-new chunk fades in over time too
    expect(townFade(200, TOWN_LOD.spawnTime).far[1]).toBe(1);
  });
  it('crossfades near/far over distance with complementary dither ranges (never both, never neither)', () => {
    for (let d = -30; d < TOWN_LOD.ahead; d += 3.7) {
      const f = townFade(d, 99);
      expect(f.near[0]).toBe(0);
      expect(f.near[1]).toBeCloseTo(f.far[0], 9);
      if (d < TOWN_LOD.ahead - TOWN_LOD.spawnFade) expect(f.far[1]).toBeCloseTo(1, 9);
    }
    expect(townFade(20, 99).near[1]).toBe(1);
    expect(townFade(TOWN_LOD.nearFadeEnd + 1, 99).near[1]).toBe(0);
    const mid = townFade((TOWN_LOD.nearFull + TOWN_LOD.nearFadeEnd) / 2, 99).near[1];
    expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.7);
    expect(TOWN_LOD.nearFadeEnd - TOWN_LOD.nearFull).toBeGreaterThanOrEqual(30); // a long blend, not a switch
  });
});
