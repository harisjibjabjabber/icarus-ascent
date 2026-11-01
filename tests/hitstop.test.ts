import { describe, it, expect } from 'vitest';
import { applyFrameTime } from '../src/game';
import { TUNING } from '../src/tuning';

describe('hitstop frame time', () => {
  const dt = TUNING.sim.dt;
  const max = TUNING.sim.maxStepsPerFrame;

  it('freezes the sim and does not bank the skipped time', () => {
    const frame = 1 / 60;
    const first = applyFrameTime(0, frame, TUNING.feedback.hitstopPot, dt, max);
    expect(first.steps).toBe(0);
    expect(first.acc).toBe(0);
    expect(first.hitstop).toBeCloseTo(TUNING.feedback.hitstopPot - frame, 5);
    const mid = applyFrameTime(0.004, frame, 0.02, dt, max);
    expect(mid.steps).toBe(0);
    expect(mid.acc).toBe(0.004);
  });

  it('the frame after the freeze is a normal frame, not the frozen time plus the new one', () => {
    const frame = 1 / 60;
    const done = applyFrameTime(0, frame, 0, dt, max);
    expect(done.steps).toBe(2); // 120 Hz sim, one 16 ms frame
    expect(done.hitstop).toBe(0);
    // banking the 45 ms freeze into the accumulator would dump a hitch of extra steps
    const banked = applyFrameTime(TUNING.feedback.hitstopPot, frame, 0, dt, max);
    expect(banked.steps).toBeGreaterThan(done.steps);
  });
});
