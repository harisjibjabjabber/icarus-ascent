import type { Course, Feature } from './course';

/**
 * Element density of a course (review + tests): what there is to *do* and how long the empty stretches are.
 * Busy intervals: gaps (lip to receiver), rails and walls (their span), pots/pillars (±2 m). An empty stretch is
 * the distance between consecutive busy intervals (and from `from` to the first one, and to `to`).
 */
export interface Element { kind: 'gap' | 'rail' | 'wall' | 'pot' | 'pillar' | 'updraft' | 'bounce'; x0: number; x1: number; required: boolean }

export function courseElements(c: Course, from = -Infinity, to = Infinity): Element[] {
  const e: Element[] = [];
  for (const g of c.gaps) e.push({ kind: 'gap', x0: g.x0, x1: g.x1, required: true });
  for (const r of c.rails) e.push({ kind: 'rail', x0: r.points[0].x, x1: r.points[r.points.length - 1].x, required: !!r.required });
  for (const w of c.walls) e.push({ kind: 'wall', x0: w.x0, x1: w.x1, required: !!w.required });
  for (const o of c.obstacles) e.push({ kind: o.kind, x0: o.x - 2, x1: o.x + 2, required: true });
  for (const u of c.updrafts) e.push({ kind: 'updraft', x0: u.x0, x1: u.corridorX1, required: false });
  for (const b of c.bounces) e.push({ kind: 'bounce', x0: b.x - b.half, x1: b.x + b.half, required: false });
  return e.filter((q) => q.x1 >= from && q.x0 <= to).sort((a, b) => a.x0 - b.x0);
}

export interface Density { elements: number; per100m: number; longestEmpty: number; longestEmptyAt: number; empties: number[] }

export function density(c: Course, from: number, to: number): Density { return densityOf(courseElements(c, from, to), from, to); }

/** Endless chunks only carry point features: count gaps / rails / walls / pots / pillars (±2 m) the same way. */
export function featureElements(features: Feature[]): Element[] {
  return features.filter((f) => f.kind !== 'crest' && f.kind !== 'rollers')
    .map((f) => ({ kind: f.kind === 'rail-optional' || f.kind === 'rail-risky' ? 'rail' : f.kind, x0: f.x - 2, x1: f.x + 2, required: f.required }) as Element)
    .sort((a, b) => a.x0 - b.x0);
}

export function densityOf(all: Element[], from: number, to: number): Density {
  const els = all.filter((q) => q.x1 >= from && q.x0 <= to).sort((a, b) => a.x0 - b.x0);
  let reach = from, longest = 0, at = from;
  const empties: number[] = [];
  for (const q of els) {
    if (q.x0 > reach) { empties.push(q.x0 - reach); if (q.x0 - reach > longest) { longest = q.x0 - reach; at = reach; } }
    reach = Math.max(reach, q.x1);
  }
  if (to > reach) { empties.push(to - reach); if (to - reach > longest) { longest = to - reach; at = reach; } }
  return { elements: els.length, per100m: (els.length / (to - from)) * 100, longestEmpty: longest, longestEmptyAt: at, empties };
}
