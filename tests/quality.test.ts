import { describe, it, expect } from 'vitest';
import { QualityManager, QUALITY, AUTO, ORDER } from '../src/render/quality';

const feed = (q: QualityManager, fps: number, seconds: number, paused = false) => { for (let t = 0; t < seconds; t += 1 / fps) q.sample(1 / fps, paused); };

describe('render quality manager', () => {
  it('defaults: desktop ultra, phone high (modern flagships), ?q= pins', () => {
    expect(new QualityManager('', false).level.name).toBe('ultra');
    expect(new QualityManager('', true).level.name).toBe('high');
    const p = new QualityManager('?q=low', false);
    expect(p.level.name).toBe('low');
    expect(p.pinned).toBe(true);
    const u = new QualityManager('?q=ultra', true);
    expect(u.level.name).toBe('ultra');
    expect(u.scale).toBe(QUALITY.ultra.pixelRatio);
  });
  it('steps the tier down after sustained low fps, never below low, and not while pinned or paused', () => {
    const q = new QualityManager('', false);
    const seen: string[] = [];
    q.onChange = (l) => seen.push(l.name);
    feed(q, 60, AUTO.warmup + 10);
    expect(q.level.name).toBe('ultra');
    feed(q, 30, 1, true); // paused: ignored
    expect(q.level.name).toBe('ultra');
    feed(q, 30, AUTO.window * AUTO.strikes + 0.5);
    expect(q.level.name).toBe('high');
    feed(q, 20, (AUTO.warmup + AUTO.window * AUTO.strikes + 1) * 4);
    expect(q.level.name).toBe('low');
    expect(seen).toEqual(['high', 'medium', 'low']);
    const pinned = new QualityManager('?q=high', false);
    feed(pinned, 20, 30);
    expect(pinned.level.name).toBe('high');
    expect(pinned.scale).toBe(QUALITY.high.pixelRatio);
  });
  it('dynamic resolution: mild dips lower the pixel ratio (not the tier), a steady cap brings it back', () => {
    const q = new QualityManager('', true);
    const scales: number[] = [];
    q.onScale = (s) => scales.push(s);
    feed(q, 52, AUTO.warmup + AUTO.window * 3 + 0.5);
    expect(q.level.name).toBe('high');
    expect(q.scale).toBeCloseTo(QUALITY.high.pixelRatio - 3 * AUTO.step);
    feed(q, 52, 30);
    expect(q.scale).toBe(QUALITY.high.minPixelRatio); // floor, still high
    expect(q.level.name).toBe('high');
    feed(q, 60, 40);
    expect(q.scale).toBe(QUALITY.high.pixelRatio); // recovered, never above the tier
    expect(q.level.name).toBe('high');
    expect(Math.max(...scales)).toBeLessThanOrEqual(QUALITY.high.pixelRatio);
  });
  it('a phone that holds 60 fps at full resolution earns ultra; never after a step down', () => {
    const q = new QualityManager('', true);
    feed(q, 60, AUTO.warmup + AUTO.window * AUTO.promoteWindows + 0.5);
    expect(q.level.name).toBe('ultra');
    const w = new QualityManager('', true);
    feed(w, 30, AUTO.warmup + AUTO.window * AUTO.strikes + 0.5);
    expect(w.level.name).toBe('medium');
    feed(w, 60, 200);
    expect(w.level.name).toBe('medium');
    const pinned = new QualityManager('?q=high', true);
    feed(pinned, 60, 200);
    expect(pinned.level.name).toBe('high');
  });
  it('levels scale cost monotonically', () => {
    for (let i = 1; i < ORDER.length; i++) {
      const a = QUALITY[ORDER[i - 1]], b = QUALITY[ORDER[i]];
      expect(a.pixelRatio).toBeLessThan(b.pixelRatio);
      expect(a.shadowMap).toBeLessThan(b.shadowMap);
      expect(a.anisotropy).toBeLessThan(b.anisotropy);
      expect(a.lodScale).toBeLessThanOrEqual(b.lodScale);
      expect(a.textures).toBeLessThanOrEqual(b.textures);
      expect(b.minPixelRatio).toBeLessThanOrEqual(b.pixelRatio);
    }
    expect(QUALITY.low.shadowMap).toBe(0);
    expect(QUALITY.low.cloudOctaves).toBeLessThan(QUALITY.high.cloudOctaves);
  });
});
