import { describe, it, expect } from 'vitest';
import { QualityManager, QUALITY, AUTO } from '../src/render/quality';

const feed = (q: QualityManager, fps: number, seconds: number, paused = false) => { for (let t = 0; t < seconds; t += 1 / fps) q.sample(1 / fps, paused); };

describe('render quality manager', () => {
  it('defaults: desktop high, phone medium, ?q= pins', () => {
    expect(new QualityManager('', false).level.name).toBe('high');
    expect(new QualityManager('', true).level.name).toBe('medium');
    const p = new QualityManager('?q=low', false);
    expect(p.level.name).toBe('low');
    expect(p.pinned).toBe(true);
  });
  it('steps down after sustained low fps, never below low, and not while pinned or paused', () => {
    const q = new QualityManager('', false);
    const seen: string[] = [];
    q.onChange = (l) => seen.push(l.name);
    feed(q, 60, AUTO.warmup + 10);
    expect(q.level.name).toBe('high');
    feed(q, 30, 1, true); // paused: ignored
    expect(q.level.name).toBe('high');
    feed(q, 30, AUTO.window * AUTO.strikes + 0.5);
    expect(q.level.name).toBe('medium');
    feed(q, 20, AUTO.warmup + AUTO.window * AUTO.strikes * 3 + 1);
    expect(q.level.name).toBe('low');
    expect(seen).toEqual(['medium', 'low']);
    const pinned = new QualityManager('?q=high', false);
    feed(pinned, 20, 30);
    expect(pinned.level.name).toBe('high');
  });
  it('levels scale cost monotonically', () => {
    const [l, m, h] = [QUALITY.low, QUALITY.medium, QUALITY.high];
    expect(l.pixelRatio).toBeLessThan(m.pixelRatio);
    expect(m.pixelRatio).toBeLessThan(h.pixelRatio);
    expect(l.shadowMap).toBe(0);
    expect(m.shadowMap).toBeLessThan(h.shadowMap);
    expect(l.cloudOctaves).toBeLessThan(h.cloudOctaves);
  });
});
