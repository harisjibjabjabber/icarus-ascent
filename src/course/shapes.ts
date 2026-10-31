import type { Vec2 } from './course';

export type Ease = (t: number) => number;
export const linear: Ease = (t) => t;
/** Smooth S-curve: zero slope at both ends (good descents/climbs that join flats). */
export const smooth: Ease = (t) => t * t * (3 - 2 * t);
/** Kicker: flat at the start, steepest at the lip. */
export const kicker: Ease = (t) => t * t;
/** Crest/landing: steepest at the start, flat at the end. */
export const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t);

/** Append a curve from the last point of `pts` to (x1, y1), sampled every ~step m. */
export function extend(pts: Vec2[], x1: number, y1: number, ease: Ease = smooth, step = 1.5): Vec2[] {
  const a = pts[pts.length - 1];
  const n = Math.max(1, Math.ceil((x1 - a.x) / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    pts.push({ x: a.x + (x1 - a.x) * t, y: a.y + (y1 - a.y) * ease(t) });
  }
  return pts;
}

/**
 * Crest pop on continuous ground (no gap): a kicker that rises `rise` over `len`,
 * then a down-slope landing that falls `drop` over `backLen`, steepest at the top.
 * With speed the rider separates at the crest (sim crest physics) and lands on the
 * down-slope, which keeps (or adds) speed. Slow riders simply roll over it.
 */
export function crestPop(pts: Vec2[], rise: number, len: number, drop: number, backLen: number): Vec2[] {
  const a = pts[pts.length - 1];
  extend(pts, a.x + len, a.y + rise, kicker, 0.8);
  const top = pts[pts.length - 1];
  return extend(pts, top.x + backLen, top.y - drop, easeOut, 1.2);
}

/**
 * Rolling hills: `count` cosine bumps of height `amp` and length `period`. Each crest's
 * curvature is amp*(2π/period)²/2, so the pop speed is ~sqrt(airGravity / curvature):
 * gentle (amp 0.4, period 30) never pops; amp 1.4, period 18 pops from ~19 m/s.
 */
export function rollingHills(pts: Vec2[], count: number, amp: number, period: number, step = 1): Vec2[] {
  const a = pts[pts.length - 1];
  const n = Math.ceil((count * period) / step);
  for (let i = 1; i <= n; i++) {
    const x = (i / n) * count * period;
    pts.push({ x: a.x + x, y: a.y + (amp / 2) * (1 - Math.cos((2 * Math.PI * x) / period)) });
  }
  return pts;
}
