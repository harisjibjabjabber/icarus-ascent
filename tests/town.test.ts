import { describe, it, expect, beforeAll } from 'vitest';
import { Kit } from '../src/render/town/kit';
import { buildTownChunk } from '../src/render/town/town';

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
  it('stays inside the phone triangle budget (near <= 60k, far <= 6k per 40 m chunk)', () => {
    for (let k = 0; k < 30; k++) {
      const c = buildTownChunk(kit, k, 777, slope, { harbourFrom: 880, clockTowers: [300] });
      expect(c.trisNear, `near ${k}`).toBeLessThanOrEqual(60000);
      expect(c.trisFar, `far ${k}`).toBeLessThanOrEqual(6000);
    }
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
