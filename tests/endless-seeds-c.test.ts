import { describe, it, expect } from 'vitest';
import { seedBlock } from './endlessHelpers';

// 200 seeds x 5 km with the dev autopilot, split across files so vitest runs them in parallel.
describe('endless seeds 101-150', () => {
  it('each seed is physically completable for 5 km, with enough approach for every compulsory feature', () => {
    const r = seedBlock(101, 150, 5);
    expect(r.fails).toEqual([]);
    expect(r.approach).toEqual([]);
    // A wall tap queued in front of a set piece adds one chunk to the live window.
    expect(r.maxChunks).toBeLessThan(17);
  }, 300000);
});
