import { describe, it, expect, beforeAll } from 'vitest';
import { Kit, MergeBuffer } from '../src/render/town/kit';
import { buildTownChunk, startTownChunk } from '../src/render/town/town';
import { buildOpeningCourse } from '../src/course/opening';
import { EndlessCourse } from '../src/course/endless';
import { ZoneSequence } from '../src/zones/sequence';
import { ZONES, DEFAULT_ZONES } from '../src/zones/registry';
import { WAVE } from '../src/course/waves';
import type { Chunk } from '../src/course/course';
import { PROFILES, rideEndless, describeFail } from './endlessHelpers';

const loadKit = async () => {
  const nodeFs = 'node:fs';
  const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync(p: string, enc?: string): Uint8Array & string };
  const b = fs.readFileSync('public/town/kit.bin');
  const j = JSON.parse(fs.readFileSync('public/town/kit.json', 'utf8'));
  return Kit.fromBuffers(j, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};
const slope = (x: number) => ({ y: -x * 0.02, gap: false });

/** piece() calls. Docks, boats and ships are placed on both LODs, so placements are half the calls. Crates are near-only. */
function countPieces(kit: Kit, ks: number[], opts: { harbourFrom?: number; harbourAt?: (x: number) => boolean }, seed = 7): Record<string, number> {
  const orig = MergeBuffer.prototype.piece;
  const counts = new Map<string, number>();
  MergeBuffer.prototype.piece = function (this: MergeBuffer, ...args: Parameters<MergeBuffer['piece']>) {
    counts.set(args[1], (counts.get(args[1]) ?? 0) + 1);
    return orig.apply(this, args);
  };
  try {
    for (const k of ks) buildTownChunk(kit, k, seed, slope, opts);
  } finally { MergeBuffer.prototype.piece = orig; }
  return Object.fromEntries(counts);
}

function generate(seed: number, dist: number, zones: string[]): Chunk[] {
  const c = new EndlessCourse(seed, { zones });
  const seen = new Map<number, Chunk>();
  for (let x = 0; x <= dist; x += 50) { c.stream(x); for (const k of c.chunks) seen.set(k.id, k); }
  return [...seen.values()].filter((k) => k.x0 - c.originX < dist).sort((a, b) => a.x0 - b.x0);
}

describe('harbour zone', () => {
  it('is the stretch after the town: 2650 m in, 1600 m long, then the town again', () => {
    expect(DEFAULT_ZONES).toEqual(['town', 'harbour']);
    expect(ZONES.harbour.experimental).toBeFalsy();
    expect(ZONES.harbour.theme.scenery).toBe('harbour');
    expect(ZONES.harbour.waves).toBe(2);
    const seq = new ZoneSequence(DEFAULT_ZONES);
    const enter = WAVE.first + ZONES.town.waves * WAVE.length;
    const leave = enter + ZONES.harbour.waves * WAVE.length;
    expect(enter).toBe(2650);
    expect(leave - enter).toBe(1600);
    expect(seq.boundaries(leave + 1)).toEqual([
      { at: enter, from: 'town', to: 'harbour' },
      { at: leave, from: 'harbour', to: 'town' },
    ]);
    expect(seq.zoneAt(enter - 1).id).toBe('town');
    expect(seq.zoneAt(enter).theme.scenery).toBe('harbour');
    expect(seq.zoneAt(leave - 1).id).toBe('harbour');
    expect(seq.zoneAt(leave).id).toBe('town');
    // default origin (-10) puts both boundaries on a 40 m scenery chunk edge
    expect((enter - 10) % 40).toBe(0);
    expect((leave - 10) % 40).toBe(0);
  });

  it('the route passes through the harbour and back, and every chunk there uses harbour phrases', () => {
    const seq = new ZoneSequence(['town', 'harbour']);
    const [enter, leave] = [seq.boundaries(8000)[0], seq.boundaries(8000)[1]];
    for (let s = 1; s <= 20; s++) {
      const cs = generate(s, leave.at + 900, ['town', 'harbour']);
      const originX = new EndlessCourse(s, { zones: ['town', 'harbour'] }).originX;
      const gIn = cs.filter((c) => c.gate?.to === 'harbour');
      const gOut = cs.filter((c) => c.gate?.from === 'harbour');
      expect(gIn.length, `seed ${s} one gate into the harbour`).toBe(1);
      expect(gOut.length, `seed ${s} one gate back to town`).toBe(1);
      expect(gIn[0].x0 - originX).toBeGreaterThanOrEqual(enter.at - 1);
      expect(gIn[0].x0 - originX).toBeLessThan(enter.at + 700);
      const harbour = cs.filter((c) => c.x0 >= gIn[0].x0 && c.x1 <= gOut[0].x0);
      expect(harbour.length).toBeGreaterThan(3);
      expect(harbour.every((c) => c.zone === 'harbour')).toBe(true);
      for (const c of harbour) {
        if (c.connector || !c.spec) continue;
        expect(ZONES.harbour.phrases.includes(c.spec) || ZONES.harbour.setPieces.includes(c.spec), `seed ${s} ${c.spec}`).toBe(true);
      }
      expect(cs.filter((c) => c.x1 <= gIn[0].x0).every((c) => c.zone === 'town')).toBe(true);
    }
  });

  it('the autopilot rides into the harbour and out the far side', () => {
    const leave = new ZoneSequence(['town', 'harbour']).boundaries(8000)[1].at;
    const dist = leave + 500;
    const fails: string[] = [];
    for (const s of [2, 7, 11, 18]) {
      const course = new EndlessCourse(s, { zones: ['town', 'harbour'] });
      const r = rideEndless(s, PROFILES[s % PROFILES.length], dist, { course, maxSeconds: dist / 6 });
      if (r.sim.state.mode === 'failed' || r.sim.state.x - course.startX < dist - 30) fails.push(describeFail(s, PROFILES[s % PROFILES.length], r));
      expect([...r.chunks.values()].some((c) => c.zone === 'harbour')).toBe(true);
      expect([...r.chunks.values()].some((c) => c.gate?.from === 'harbour')).toBe(true);
    }
    expect(fails).toEqual([]);
  }, 120000);
});

describe('harbour props', () => {
  let kit: Kit;
  beforeAll(async () => { kit = await loadKit(); });

  it('thins the quay to a few framed props and keeps crates off the pavement (opening and endless)', () => {
    // 1.6 km, the length of one harbour zone. Before the thin-out this was ~147 docks, ~147 boats, ~18 ships, 14 crates, 7 barrels (piece calls: docks 294, boats 294, ships 36).
    const span = Array.from({ length: 40 }, (_, i) => 20 + i);
    const harbourAt = (x: number) => x >= 20 * 40 && x < 60 * 40;
    const h = countPieces(kit, span, { harbourAt });
    const placements = (name: string) => (h[name] ?? 0) / 2;
    expect(placements('dock'), 'docks').toBeLessThanOrEqual(20);
    expect(placements('boatSmall') + placements('boatLarge'), 'boats').toBeLessThanOrEqual(24);
    expect(placements('ship'), 'ships').toBeLessThanOrEqual(10);
    expect((h.crate ?? 0) + (h.barrel ?? 0), 'no pavement crates or barrels').toBe(0);
    expect(placements('dock')).toBeGreaterThan(0);
    expect(placements('ship')).toBeGreaterThan(0);
    // a town stretch of the same chunks has none of the quay props
    const town = countPieces(kit, span, {});
    expect((town.dock ?? 0) + (town.ship ?? 0) + (town.boatSmall ?? 0)).toBe(0);

    const course = buildOpeningCourse();
    const k0 = Math.floor(course.harbourX! / 40);
    const k1 = Math.ceil(course.finishX / 40);
    const openingKs = Array.from({ length: k1 - k0 }, (_, i) => k0 + i);
    const opening = countPieces(kit, openingKs, { harbourFrom: course.harbourX }, 1);
    // opening harbour is ~10 chunks. Before: 35 docks, 35 boats, 4 ships, 2 barrels.
    expect((opening.dock ?? 0) / 2).toBeLessThanOrEqual(8);
    expect((opening.ship ?? 0) / 2).toBeLessThanOrEqual(3);
    expect((opening.crate ?? 0) + (opening.barrel ?? 0)).toBe(0);
    // the chunk before the quay is still the town
    const before = countPieces(kit, [k0 - 1], { harbourFrom: course.harbourX }, 1);
    expect((before.dock ?? 0) + (before.ship ?? 0) + (before.boatSmall ?? 0) + (before.boatLarge ?? 0)).toBe(0);
  });

  it('a harbour chunk still slices, and a 2 ms pump does not run long', () => {
    const once = buildTownChunk(kit, 15, 7, slope, { harbourAt: () => true });
    const job = startTownChunk(kit, 15, 7, slope, { harbourAt: () => true });
    let sliced = null, pumps = 0;
    while (!sliced && pumps++ < 500) sliced = job.pump(0);
    expect(pumps).toBeGreaterThan(12);
    expect(sliced!.trisNear).toBe(once.trisNear);
    let max = 0, n = 0, done = null as ReturnType<typeof job.pump>;
    const paced = startTownChunk(kit, 25, 7, slope, { harbourAt: () => true });
    while (!done && n < 40) {
      const t = performance.now();
      done = paced.pump(2);
      max = Math.max(max, performance.now() - t);
      n++;
    }
    expect(done).toBeTruthy();
    expect(max).toBeLessThan(8); // budget is 2 ms; one slice may finish over it, it must not become a hitch
    expect(n).toBeGreaterThan(2);
  });
});
