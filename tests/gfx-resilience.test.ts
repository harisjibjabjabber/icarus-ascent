import { describe, it, expect } from 'vitest';
import { QualityManager, QUALITY, AUTO, PHONE_ULTRA, tierFor, deviceAnisotropy } from '../src/render/quality';
import { GFX_LOSS_KEY, loadLoss, saveLoss, recordLoss, startCap } from '../src/render/gfxHistory';

/** Feed `seconds` of frames at `fps`; returns the sampled clock at the end (relative to `t0`). */
const feed = (q: QualityManager, fps: number, seconds: number, t0 = 0, onFrame?: (t: number) => void) => {
  let t = t0;
  for (let s = 0; s < seconds; s += 1 / fps) { q.sample(1 / fps, false); t += 1 / fps; onFrame?.(t); }
  return t;
};
const promoteTime = AUTO.warmup + AUTO.window * AUTO.promoteWindows + 0.5;

class MemStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('phone-safe ultra and device anisotropy', () => {
  it('a promoted phone runs ultra at the phone budget; desktops and ?q= pins keep the tier as defined', () => {
    const phone = new QualityManager('', true);
    feed(phone, 60, promoteTime);
    expect(phone.level.name).toBe('ultra');
    expect(phone.level).toBe(PHONE_ULTRA);
    expect(phone.level.shadowMap).toBe(QUALITY.high.shadowMap); // no shadow-map reallocation on promotion
    expect(phone.level.pixelRatio).toBeLessThanOrEqual(2.5);
    expect(phone.level.ao).toBe(true);
    expect(phone.scale).toBe(PHONE_ULTRA.pixelRatio);
    expect(new QualityManager('', false).level).toBe(QUALITY.ultra);
    expect(new QualityManager('?q=ultra', true).level).toBe(QUALITY.ultra);
    expect(tierFor('high', true)).toBe(QUALITY.high);
    expect(PHONE_ULTRA.minPixelRatio).toBeLessThanOrEqual(PHONE_ULTRA.pixelRatio);
  });
  it('anisotropy is one per-device value, clamped to the GPU', () => {
    expect(deviceAnisotropy(16, true)).toBe(8);
    expect(deviceAnisotropy(16, false)).toBe(16);
    expect(deviceAnisotropy(4, false)).toBe(4);
    expect(deviceAnisotropy(0, true)).toBe(1);
  });
});

describe('context-loss policy', () => {
  it('a device with a loss history starts one tier below the tier that lost it and never promotes', () => {
    const q = new QualityManager('', true, { tier: 'ultra', count: 1 });
    expect(q.level.name).toBe('high');
    expect(q.canPromote).toBe(false);
    feed(q, 60, 300);
    expect(q.level.name).toBe('high');
    expect(new QualityManager('', true, { tier: 'high', count: 2 }).level.name).toBe('medium');
    expect(new QualityManager('', false, { tier: 'ultra', count: 1 }).level.name).toBe('high');
    expect(new QualityManager('', true, { tier: 'low', count: 3 }).level.name).toBe('low');
    expect(new QualityManager('', true, { tier: 'ultra', count: 4 }).pastLosses).toBe(4);
    // a ?q= pin is a deliberate test: the history does not override it
    expect(new QualityManager('?q=ultra', true, { tier: 'ultra', count: 1 }).level.name).toBe('ultra');
  });
  it('while the context is lost nothing is judged; a counted restore steps down once and ends promotion', () => {
    const q = new QualityManager('', true);
    const seen: string[] = [];
    q.onChange = (l) => seen.push(l.name);
    feed(q, 60, promoteTime);
    expect(q.level.name).toBe('ultra');
    q.contextLost();
    feed(q, 20, 60); // frames are free (or absurd) while nothing renders: ignored
    expect(q.level.name).toBe('ultra');
    expect(q.contextRestored(true)).toBe('ultra');
    expect(q.level.name).toBe('high');
    expect(q.losses).toBe(1);
    expect(q.canPromote).toBe(false);
    feed(q, 60, 300);
    expect(q.level.name).toBe('high');
    expect(seen).toEqual(['ultra', 'high']);
    expect(q.tierChanges).toBe(2);
  });
  it('a loss the OS caused (page hidden) does not step down or block promotion', () => {
    const q = new QualityManager('', true);
    q.contextLost();
    expect(q.contextRestored(false)).toBeNull();
    expect(q.level.name).toBe('high');
    expect(q.losses).toBe(0);
    feed(q, 60, promoteTime);
    expect(q.level.name).toBe('ultra');
  });
  it('a pinned tier is not stepped down by a restore (but the loss is counted)', () => {
    const q = new QualityManager('?q=ultra', true);
    q.contextLost();
    expect(q.contextRestored(true)).toBe('ultra');
    expect(q.level.name).toBe('ultra');
    expect(q.losses).toBe(1);
  });
});

describe('switch debounce', () => {
  it('resolution changes are at least AUTO.scaleGap apart; requests in between merge', () => {
    const q = new QualityManager('', true);
    const at: number[] = [];
    let now = 0;
    q.onScale = () => at.push(now);
    feed(q, 50, 40, 0, (t) => { now = t; });
    expect(at.length).toBeGreaterThan(1);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(AUTO.scaleGap - 1e-6);
    expect(q.scale).toBe(QUALITY.high.minPixelRatio); // still reaches the floor
  });
  it('no resolution change and no promotion while busy (mid-jump); they land right after', () => {
    const q = new QualityManager('', true);
    let calls = 0;
    q.onScale = () => calls++;
    q.busy = true;
    feed(q, 50, 20);
    expect(calls).toBe(0);
    expect(q.scale).toBe(QUALITY.high.pixelRatio);
    q.busy = false;
    q.sample(1 / 50, false);
    expect(calls).toBe(1);
    expect(q.scale).toBeLessThan(QUALITY.high.pixelRatio - AUTO.step); // merged notches in one resize

    const p = new QualityManager('', true);
    p.busy = true;
    feed(p, 60, promoteTime + 10);
    expect(p.level.name).toBe('high');
    p.busy = false;
    p.sample(1 / 60, false);
    expect(p.level.name).toBe('ultra');
  });
  it('a step-down is never held by busy', () => {
    const q = new QualityManager('', true);
    q.busy = true;
    feed(q, 30, AUTO.warmup + AUTO.window * AUTO.strikes + 0.5);
    expect(q.level.name).toBe('medium');
  });
});

describe('per-device context-loss history (localStorage)', () => {
  it('records the lowest tier that failed and counts losses', () => {
    const a = recordLoss(null, 'ultra', 1000);
    expect(a).toEqual({ tier: 'ultra', count: 1, t: 1000 });
    const b = recordLoss(a, 'high', 2000);
    expect(b).toEqual({ tier: 'high', count: 2, t: 2000 });
    expect(recordLoss(b, 'ultra', 3000).tier).toBe('high');
    expect(startCap(null)).toBeNull();
    expect(startCap(a)).toBe('high');
    expect(startCap({ tier: 'low', count: 1, t: 0 })).toBe('low');
  });
  it('round-trips through storage and survives bad data or a throwing store', () => {
    const s = new MemStore();
    expect(loadLoss(s)).toBeNull();
    saveLoss({ tier: 'ultra', count: 1, t: 5 }, s);
    expect(JSON.parse(s.data.get(GFX_LOSS_KEY)!)).toEqual({ tier: 'ultra', count: 1, t: 5 });
    expect(loadLoss(s)).toEqual({ tier: 'ultra', count: 1, t: 5 });
    s.setItem(GFX_LOSS_KEY, '{not json');
    expect(loadLoss(s)).toBeNull();
    s.setItem(GFX_LOSS_KEY, JSON.stringify({ tier: 'mega', count: 1 }));
    expect(loadLoss(s)).toBeNull();
    const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadLoss(bad)).toBeNull();
    expect(() => saveLoss({ tier: 'high', count: 1, t: 0 }, bad)).not.toThrow();
    expect(loadLoss(null)).toBeNull();
  });
});
