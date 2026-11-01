/**
 * Sonic-style orb trails: gold lines along good riding paths, purple rewards on hard lines.
 */
import type { Feature, Gap, Rail, Surface, Wall } from './course';
import { Course } from './course';
import type { OrbPlacement, OrbPickup, OrbTier } from './orbs';

export interface OrbTrailContext {
  phraseId: string;
  chunkX0: number;
  chunkX1: number;
  setPiece?: boolean;
  surfaces: Surface[];
  rails: Rail[];
  walls: Wall[];
  gaps: Gap[];
  features: Feature[];
  yAt: (x: number) => number;
  rng: () => number;
  nextTrailId: () => number;
  nextRareX: { at: number };
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function pushTrail(
  out: OrbPlacement[],
  trailId: number,
  tier: OrbTier,
  pickup: OrbPickup,
  pts: { x: number; y: number; lat: number }[],
): void {
  const len = pts.length;
  if (!len) return;
  for (let i = 0; i < len; i++) {
    out.push({ x: pts[i].x, y: pts[i].y, lateral: pts[i].lat, tier, pickup, trailId, trailIdx: i, trailLen: len });
  }
}

function streetTrail(
  out: OrbPlacement[],
  id: number,
  x0: number,
  x1: number,
  yAt: (x: number) => number,
): void {
  const span = x1 - x0;
  if (span < 12) return;
  const n = clamp(Math.round(span / 4.2), 5, 12);
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const x = x0 + span * t;
    return { x, y: yAt(x) + 1.05 + Math.sin(i * 0.7) * 0.08, lat: 0 };
  });
  pushTrail(out, id, 'common', 'route', pts);
}

function streetTrails(ctx: OrbTrailContext, out: OrbPlacement[], tid: () => number): void {
  for (const s of ctx.surfaces) {
    const x0 = Course.x0(s) + 2;
    const x1 = Course.x1(s) - 2;
    if (x1 - x0 < 12) continue;
    streetTrail(out, tid(), x0, x1, (x) => Course.sample(s, x).y);
  }
}

function railSample(r: Rail, t: number): { x: number; y: number } {
  const p = r.points;
  if (p.length < 2) return p[0] ?? { x: 0, y: 0 };
  const x = p[0].x + (p[p.length - 1].x - p[0].x) * t;
  for (let i = 1; i < p.length; i++) {
    if (p[i].x >= x) {
      const a = p[i - 1], b = p[i];
      const u = (x - a.x) / Math.max(1e-6, b.x - a.x);
      return { x, y: a.y + (b.y - a.y) * u };
    }
  }
  return p[p.length - 1];
}

function railTrail(out: OrbPlacement[], id: number, r: Rail): void {
  const len = r.points[r.points.length - 1].x - r.points[0].x;
  if (len < 10 || (!r.risky && len < 14 && !r.required)) return;
  const n = clamp(Math.round(len / 3.2), 5, 10);
  const pts = Array.from({ length: n }, (_, i) => {
    const q = railSample(r, (i + 0.5) / n);
    return { x: q.x, y: q.y, lat: r.lateral };
  });
  pushTrail(out, id, 'common', 'grind', pts);
}

function jumpArc(out: OrbPlacement[], id: number, g: Gap): void {
  if (g.requires !== 'jump') return;
  const dx = g.x1 - g.x0;
  if (dx < 3) return;
  const n = clamp(Math.round(dx / 1.4), 6, 12);
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const x = g.x0 + dx * t;
    const y = g.yTakeoff + (g.yReceive - g.yTakeoff) * t + Math.sin(Math.PI * t) * (1.2 + dx * 0.04);
    return { x, y, lat: 0 };
  });
  pushTrail(out, id, 'common', 'air', pts);
}

function crestArc(ctx: OrbTrailContext, out: OrbPlacement[], id: number, fx: Feature): void {
  const xC = fx.x;
  const y0 = yAtSurfaces(ctx.surfaces, xC - 2);
  const peak = yAtSurfaces(ctx.surfaces, xC + 2) + 1.6;
  const n = 8;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const x = xC - 3 + 6 * t;
    const y = y0 + (peak - y0) * Math.sin(Math.PI * t);
    return { x, y: y + 0.45, lat: 0 };
  });
  pushTrail(out, id, 'common', 'air', pts);
}

function wallTrail(out: OrbPlacement[], id: number, w: Wall): void {
  const len = w.x1 - w.x0;
  if (len < 8) return;
  const n = clamp(Math.round(len / 4), 5, 9);
  const pts = Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    const x = w.x0 + len * t;
    const y = w.yBottom + (w.yTop - w.yBottom) * (0.25 + 0.55 * t);
    return { x, y, lat: w.lateral };
  });
  pushTrail(out, id, 'common', 'wall', pts);
}

function rareOnRail(out: OrbPlacement[], id: number, r: Rail, t: number): void {
  const q = railSample(r, t);
  pushTrail(out, id, 'rare', 'grind', [{ x: q.x, y: q.y, lat: r.lateral }]);
}

function rarePoint(out: OrbPlacement[], id: number, x: number, y: number, lat: number, pickup: OrbPickup): void {
  pushTrail(out, id, 'rare', pickup, [{ x, y, lat }]);
}

export function stampOrbTrails(out: OrbPlacement[], ctx: OrbTrailContext): void {
  out.length = 0;
  const tid = () => ctx.nextTrailId();

  streetTrails(ctx, out, tid);
  for (const g of ctx.gaps) jumpArc(out, tid(), g);
  for (const r of ctx.rails) {
    if (r.risky) {
      rareOnRail(out, tid(), r, 0.78);
      railTrail(out, tid(), r);
    } else railTrail(out, tid(), r);
  }
  for (const w of ctx.walls) {
    wallTrail(out, tid(), w);
    if (w.required) {
      const x = w.x0 + (w.x1 - w.x0) * 0.88;
      const y = w.yBottom + (w.yTop - w.yBottom) * 0.72;
      rarePoint(out, tid(), x, y, w.lateral, 'wall');
    }
  }
  for (const f of ctx.features) if (f.kind === 'crest') crestArc(ctx, out, tid(), f);

  const midX = (ctx.chunkX0 + ctx.chunkX1) * 0.5;
  const hardPhrase = ctx.setPiece || ['high-line', 'big-kicker', 'ramp-flip', 'wall-gap', 'ramp-pillar'].includes(ctx.phraseId);
  if (hardPhrase || midX >= ctx.nextRareX.at) {
    if (ctx.phraseId === 'big-kicker' || ctx.phraseId === 'ramp-flip') {
      rarePoint(out, tid(), midX, yAtSurfaces(ctx.surfaces, midX) + 3.4, 0, 'air');
    } else if (!ctx.rails.some((r) => r.risky) && ctx.setPiece) {
      rarePoint(out, tid(), ctx.chunkX1 - 8, yAtSurfaces(ctx.surfaces, ctx.chunkX1 - 8) + 2.2, 0, 'air');
    } else if (midX >= ctx.nextRareX.at && !ctx.rails.some((r) => r.risky)) {
      rarePoint(out, tid(), midX + 6, yAtSurfaces(ctx.surfaces, midX + 6) + 2.6, 0, 'air');
    }
    ctx.nextRareX.at = midX + 150 + ctx.rng() * 100;
  }
}

export function yAtSurfaces(surfaces: Surface[], x: number): number {
  for (const s of surfaces) if (x >= Course.x0(s) && x <= Course.x1(s)) return Course.sample(s, x).y;
  const s = surfaces[surfaces.length - 1];
  return Course.sample(s, Math.min(Math.max(x, Course.x0(s)), Course.x1(s))).y;
}
