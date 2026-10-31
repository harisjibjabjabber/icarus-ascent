import { describe, it, expect } from 'vitest';
import { seedBlock } from './endlessHelpers';

// 200 seeds x 5 km with the dev autopilot, split across files so vitest runs them in parallel.
describe('endless seeds 151-200', () => {
  it('each seed is physically completable for 5 km, with enough approach for every compulsory feature', () => {
    const r = seedBlock(151, 200, 5);
    expect(r.fails).toEqual([]);
    expect(r.approach).toEqual([]);
    expect(r.maxChunks).toBeLessThan(16);
  }, 300000);
});
