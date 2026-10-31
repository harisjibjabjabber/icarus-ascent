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
