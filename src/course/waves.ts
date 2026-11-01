/**
 * Endless difficulty in waves (vision Page: "a sawtooth curve, not a ramp").
 *
 * After a short warm-up the route runs in waves of WAVE.length metres. Each wave has three phases:
 *  build    – difficulty climbs from the wave's base toward its top
 *  peak     – the wave's top difficulty; the assembler drops a hand-authored set piece in here
 *  breather – style air and recovery only (no compulsory features); zones change here
 * Both the base and the top rise wave by wave, so every peak is harder than the last and the
 * breathers get shorter relative to the action. Pure and deterministic (distance in, numbers out).
 */
export type WavePhase = 'warmup' | 'build' | 'peak' | 'breather';

export const WAVE = {
  /** Warm-up before wave 0 (m). */
  first: 250,
  /** One wave (m): about 45-55 s at a normal riding speed. */
  length: 800,
  /** Phase split of a wave (fractions, sum 1). The peak (288 m) holds the longest set piece
   *  (sp-crest-wall, ~271 m) with room to spare: a set piece never spills into the breather. */
  build: 0.46,
  peak: 0.36,
  breather: 0.18,
  /** Base / top difficulty per wave index. */
  base: (w: number) => Math.min(0.7, 0.12 * w),
  top: (w: number) => Math.min(1, 0.3 + 0.17 * w),
};

export interface WaveInfo {
  /** Wave number (-1 during the warm-up). */
  index: number;
  phase: WavePhase;
  /** Progress through the current phase 0..1. */
  t: number;
  /** Difficulty 0..1 used for tiers, gap lengths and compulsory chains. */
  d: number;
  /** Where the current wave started / its peak starts / its breather starts (distance from the start, m). */
  start: number;
  peakAt: number;
  breatherAt: number;
}

export function waveAt(dist: number): WaveInfo {
  if (dist < WAVE.first) return { index: -1, phase: 'warmup', t: Math.max(0, dist) / WAVE.first, d: 0, start: 0, peakAt: WAVE.first + WAVE.length * WAVE.build, breatherAt: WAVE.first };
  const w = Math.floor((dist - WAVE.first) / WAVE.length);
  const start = WAVE.first + w * WAVE.length;
  const u = (dist - start) / WAVE.length;
  const base = WAVE.base(w), top = WAVE.top(w);
  const peakAt = start + WAVE.length * WAVE.build, breatherAt = peakAt + WAVE.length * WAVE.peak;
  if (u < WAVE.build) { const t = u / WAVE.build; return { index: w, phase: 'build', t, d: base + (top - base) * 0.75 * t, start, peakAt, breatherAt }; }
  if (u < WAVE.build + WAVE.peak) return { index: w, phase: 'peak', t: (u - WAVE.build) / WAVE.peak, d: top, start, peakAt, breatherAt };
  return { index: w, phase: 'breather', t: (u - WAVE.build - WAVE.peak) / WAVE.breather, d: base * 0.5, start, peakAt, breatherAt };
}

/** Wave timeline for stats/review: one entry per phase up to `dist`. */
export function waveTimeline(dist: number): { index: number; phase: WavePhase; from: number; to: number; d: number }[] {
  const out: { index: number; phase: WavePhase; from: number; to: number; d: number }[] = [{ index: -1, phase: 'warmup', from: 0, to: WAVE.first, d: 0 }];
  for (let w = 0; WAVE.first + w * WAVE.length < dist; w++) {
    const s = WAVE.first + w * WAVE.length, L = WAVE.length;
    out.push({ index: w, phase: 'build', from: s, to: s + L * WAVE.build, d: WAVE.top(w) });
    out.push({ index: w, phase: 'peak', from: s + L * WAVE.build, to: s + L * (WAVE.build + WAVE.peak), d: WAVE.top(w) });
    out.push({ index: w, phase: 'breather', from: s + L * (WAVE.build + WAVE.peak), to: s + L, d: WAVE.base(w) * 0.5 });
  }
  return out;
}
