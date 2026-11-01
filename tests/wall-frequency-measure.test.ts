import { describe, expect, it } from 'vitest';
import { EndlessCourse } from '../src/course/endless';
import type { Chunk, Wall } from '../src/course/course';

/** First town span ends at wave 3; the harbour span is the next two waves (see src/zones/harbour.ts). */
const TOWN_END = 250 + 3 * 800;
const HARBOUR_END = TOWN_END + 2 * 800;

function ride(seed: number, dist: number): { chunks: Chunk[]; walls: Map<number, Wall> } {
  const c = new EndlessCourse(seed, { zones: ['town', 'harbour'] });
  const chunks = new Map<number, Chunk>();
  const walls = new Map<number, Wall>();
  for (let x = 0; x <= dist + 200; x += 40) {
    c.stream(x);
    for (const k of c.chunks) chunks.set(k.id, k);
    for (const w of c.walls) walls.set(w.id, w);
  }
  return { chunks: [...chunks.values()].filter((k) => k.x0 < dist).sort((a, b) => a.x0 - b.x0), walls };
}

function gaps(xs: number[]): number[] {
  const g: number[] = [];
  for (let i = 1; i < xs.length; i++) g.push(xs[i] - xs[i - 1]);
  return g;
}

describe('wall-ride frequency', () => {
  it('offers a wall ride about every 150-250 m, with both harbour faces', () => {
    const seeds = [1, 7, 13, 21, 42];
    const rows = [];
    for (const seed of seeds) {
      const { chunks, walls } = ride(seed, 5000);
      const ops = chunks.filter((k) => k.walls.length > 0).map((k) => {
        const ws = k.walls.map((id) => walls.get(id)!).filter(Boolean);
        return {
          x: Math.min(...ws.map((w) => w.x0)),
          spec: k.spec ?? k.title,
          faces: [...new Set(ws.map((w) => w.face ?? 'shop'))],
          lens: ws.map((w) => Math.round(w.x1 - w.x0)),
        };
      });
      const summarise = (list: typeof ops, span: number) => {
        const xs = list.map((w) => w.x);
        const g = gaps(xs);
        const mean = g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
        return {
          n: list.length,
          perKm: Math.round((list.length / span) * 1000),
          meanGap: mean === null ? null : Math.round(mean),
          maxGap: g.length ? Math.round(Math.max(...g)) : null,
          specs: list.map((w) => w.spec),
          faces: list.flatMap((w) => w.faces),
        };
      };
      const town = ops.filter((w) => w.x < TOWN_END);
      const harbour = ops.filter((w) => w.x >= TOWN_END && w.x < HARBOUR_END);
      rows.push({ seed, town: summarise(town, TOWN_END / 1000), harbour: summarise(harbour, (HARBOUR_END - TOWN_END) / 1000) });
      // a regular feature of the town: about one opportunity every 150-250 m
      expect(town.length, `seed ${seed} town walls`).toBeGreaterThanOrEqual(10);
      const tg = gaps(town.map((w) => w.x));
      const mean = tg.reduce((a, b) => a + b, 0) / tg.length;
      expect(mean, `seed ${seed} town mean gap`).toBeGreaterThanOrEqual(150);
      expect(mean, `seed ${seed} town mean gap`).toBeLessThanOrEqual(260);
      expect(Math.max(...tg), `seed ${seed} town max gap`).toBeLessThanOrEqual(520);
      expect(harbour.length, `seed ${seed} harbour walls`).toBeGreaterThanOrEqual(4);
      const hg = gaps(harbour.map((w) => w.x));
      const hMean = hg.reduce((a, b) => a + b, 0) / hg.length;
      expect(hMean, `seed ${seed} harbour mean gap`).toBeLessThanOrEqual(340);
      const faces = new Set(harbour.flatMap((w) => w.faces));
      expect(faces.has('warehouse'), `seed ${seed} warehouse`).toBe(true);
      expect(faces.has('hull'), `seed ${seed} hull`).toBe(true);
      const specs = new Set([...town, ...harbour].map((w) => w.spec));
      const styles = ['wall-tap', 'wall-long', 'wall-transfer', 'wall-line'].filter((id) => specs.has(id));
      expect(styles.length, `seed ${seed} wall variety`).toBeGreaterThanOrEqual(3);
      expect(['wall-gap', 'sp-rail-wall', 'sp-canal', 'sp-crest-wall'].some((id) => specs.has(id)), `seed ${seed} wall over a gap`).toBe(true);
    }
    const kinds = new Set(rows.flatMap((r) => [...r.town.specs, ...r.harbour.specs]));
    for (const id of ['wall-tap', 'wall-long', 'wall-transfer', 'wall-line']) expect(kinds.has(id), id).toBe(true);
  });
});
