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
