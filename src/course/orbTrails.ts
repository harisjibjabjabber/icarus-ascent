/**
 * Purpose-built star trails. See docs/orb-placement.md.
 * One readable line at a time, sampled in even time along a ride the autopilot can hold.
 */
import type { Feature, Gap, Obstacle, Rail, Surface, Wall } from './course';
import { Course } from './course';
import type { OrbPlacement, OrbPickup, OrbTier } from './orbs';

export interface OrbTrailContext {
  phraseId: string;
  chunkX0: number;
  chunkX1: number;
  setPiece?: boolean;
  connector?: boolean;
  /** Wave breather: teaching lines only, no street filler. */
  breather?: boolean;
  /** Checkpoint / cruise speed used to space stars in time. */
  speed: number;
  surfaces: Surface[];
  rails: Rail[];
  walls: Wall[];
  gaps: Gap[];
  features: Feature[];
  obstacles: Pick<Obstacle, 'kind' | 'x' | 'halfWidth' | 'height' | 'baseY'>[];
  yAt: (x: number) => number;
  rng: () => number;
  nextTrailId: () => number;
  /** No second gold trail may start before this course x. */
  rhythm: { quietUntil: number };
  /** Next mastery star may appear at or after this course x. */
  nextRareX: { at: number };
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const AIR_G = 30;
const JUMP_VY = 9.2;
/** Seconds between stars along a held line. */
const STAR_DT = 0.3;
const TRAIL_ORBS = { min: 5, max: 8 } as const;
const MIN_ORB_GAP = 1.35;

interface Pt { x: number; y: number; lat: number }
interface Line { purpose: string; pickup: OrbPickup; pts: Pt[]; score: number }

function pushTrail(out: OrbPlacement[], trailId: number, tier: OrbTier, pickup: OrbPickup, pts: Pt[]): void {
  const len = pts.length;
  const min = pickup === 'wall' ? 4 : TRAIL_ORBS.min;
  if (tier !== 'rare' && len < min) return;
  if (tier === 'rare' && len < 1) return;
  for (let i = 0; i < len; i++) {
    out.push({ x: pts[i].x, y: pts[i].y, lateral: pts[i].lat, tier, pickup, trailId, trailIdx: i, trailLen: len });
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

function countFor(duration: number): number {
  return clamp(Math.round(duration / STAR_DT), TRAIL_ORBS.min, TRAIL_ORBS.max);
}

function cruise(ctx: OrbTrailContext): number {
  return clamp(ctx.speed || 13, 10, 18);
}

/** Ballistic hop matching Simulation.jump from flat ground (vy = jumpVelocity). */
function ballistic(x0: number, y0: number, x1: number, speed: number, floorAt: (x: number) => number): Pt[] | null {
  const vx = cruise({ speed } as OrbTrailContext);
  const tEnd = (x1 - x0) / vx;
  if (tEnd < 0.5 || tEnd > 1.7) return null;
  const n = countFor(tEnd * 0.9);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * tEnd * 0.9;
    const x = x0 + vx * t;
    const y = y0 + JUMP_VY * t - 0.5 * AIR_G * t * t;
    if (y < floorAt(x) + 0.3) return null;
    pts.push({ x, y, lat: 0 });
  }
  return pts;
}

function blocked(ctx: OrbTrailContext, x: number, y: number, lat = 0): boolean {
  for (const o of ctx.obstacles) {
    if (Math.abs(o.x - x) > o.halfWidth + 0.45) continue;
    if (Math.abs(lat) > 0.85) continue;
    if (y < o.baseY + o.height + 0.15 && y > o.baseY - 0.3) return true;
  }
  return false;
}

function jumpLine(ctx: OrbTrailContext, g: Gap): Line | null {
  if (g.requires !== 'jump') return null;
  const v = cruise(ctx);
  const pts = ballistic(g.x0, g.yTakeoff, g.x1, v, (x) => {
    const u = (x - g.x0) / Math.max(1e-6, g.x1 - g.x0);
    return g.yTakeoff + (g.yReceive - g.yTakeoff) * u;
  });
  if (!pts) return null;
  return { purpose: 'jump-arc', pickup: 'air', pts, score: 100 };
}

function railLine(r: Rail, ctx: OrbTrailContext): Line | null {
  if (r.risky) return null;
  const x0 = r.points[0].x;
  const x1 = r.points[r.points.length - 1].x;
  const dur = (x1 - x0) / cruise(ctx);
  if (dur < 1.05) return null;
  const use = Math.min(dur, 2.15);
  const n = countFor(use);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * (use / dur) * 0.92;
    const q = railSample(r, t);
    pts.push({ x: q.x, y: q.y, lat: r.lateral });
  }
  return { purpose: r.required ? 'required-rail' : 'optional-rail', pickup: 'grind', pts, score: r.required ? 92 : 74 };
}

/** Gold along a wall ride: flat band at 42% height, just off the face (matches the ride that collects it). */
function wallLine(w: Wall): Line | null {
  const len = w.x1 - w.x0;
  if (len < 6) return null;
  const n = clamp(Math.round(len / 3.4), 4, 9);
  const y = w.yBottom + (w.yTop - w.yBottom) * 0.42;
  const lat = w.lateral - 0.35;
  const masteryRoom = w.required || len >= 22;
  const cover = masteryRoom ? 0.78 : 1;
  const pts: Pt[] = Array.from({ length: n }, (_, i) => {
    const t = ((i + 0.5) / n) * cover;
    return { x: w.x0 + len * t, y, lat };
  });
  return { purpose: 'wall-ride', pickup: 'wall', pts, score: masteryRoom ? 90 : 76 };
}

function potHop(ctx: OrbTrailContext): Line | null {
  const pots = ctx.features.filter((f) => f.kind === 'pot' && f.required).sort((a, b) => a.x - b.x);
  if (!pots.length) return null;
  const a = pots[0].x - 1.1;
  const b = pots[pots.length - 1].x + 1.3;
  const y0 = yAtSurfaces(ctx.surfaces, a);
  const pts = ballistic(a, y0, b, cruise(ctx), (x) => yAtSurfaces(ctx.surfaces, x));
  if (!pts || pts.some((p) => blocked(ctx, p.x, p.y, p.lat))) return null;
  return { purpose: 'pot-hop', pickup: 'air', pts, score: 80 };
}

/** Heel line through a pot row: beside the props, not inside them. */
function potSmash(ctx: OrbTrailContext): Line | null {
  const pots = ctx.obstacles.filter((o) => o.kind === 'pot').sort((a, b) => a.x - b.x);
  if (pots.length < 1) return null;
  const x0 = Math.max(ctx.chunkX0 + 2, ctx.rhythm.quietUntil, pots[0].x - 2);
  const x1 = Math.min(ctx.chunkX1 - 2, pots[pots.length - 1].x + 2.5);
  const span = x1 - x0;
  if (span < 8) return null;
  const n = clamp(Math.round(span / (cruise(ctx) * STAR_DT)), 5, 8);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + span * t;
    const y = yAtSurfaces(ctx.surfaces, x) + 0.32;
    const lat = 0.62 * Math.sin(Math.PI * t);
    if (blocked(ctx, x, y, lat)) return null;
    pts.push({ x, y, lat });
  }
  return { purpose: 'pot-smash', pickup: 'route', pts, score: 72 };
}

const RAMP_IDS = new Set(['big-kicker', 'ramp-flip', 'crest-pop', 'valley-launch', 'double-pop', 'pop-chain']);

/** Grounded lead-in that points at a kicker or crest. */
function rampApproach(ctx: OrbTrailContext): Line | null {
  if (!RAMP_IDS.has(ctx.phraseId) && !ctx.setPiece) return null;
  const v = cruise(ctx);
  const span = v * 1.5;
  const lip = ctx.gaps.length ? Math.min(...ctx.gaps.map((g) => g.x0)) : ctx.chunkX1 - 3;
  const x1 = Math.min(lip - 1.2, ctx.chunkX1 - 2);
  const x0 = Math.max(ctx.chunkX0 + 3, ctx.rhythm.quietUntil, x1 - span);
  if (x1 - x0 < v * 1.15) return null;
  const n = countFor((x1 - x0) / v);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const y = yAtSurfaces(ctx.surfaces, x) + 0.28 + t * 0.15;
    if (blocked(ctx, x, y, 0)) return null;
    pts.push({ x, y, lat: 0.12 * (t - 0.5) });
  }
  return { purpose: 'ramp-approach', pickup: 'route', pts, score: 66 };
}

/** Short street line that aims at an optional rail too brief for its own grind trail. */
function railBreadcrumb(ctx: OrbTrailContext): Line | null {
  const rails = ctx.rails.filter((r) => !r.risky && !railLine(r, ctx));
  const r = rails.sort((a, b) => (b.points[b.points.length - 1].x - b.points[0].x) - (a.points[a.points.length - 1].x - a.points[0].x))[0];
  if (!r) return null;
  const v = cruise(ctx);
  const x1 = r.points[0].x - 0.8;
  const x0 = Math.max(ctx.chunkX0 + 2, ctx.rhythm.quietUntil, x1 - v * 1.45);
  if (x1 - x0 < v * 1.05) return null;
  const n = 5;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t;
    const y = yAtSurfaces(ctx.surfaces, x) + 0.3;
    const lat = r.lateral * t * 0.55;
    if (blocked(ctx, x, y, lat)) return null;
    pts.push({ x, y, lat });
  }
  return { purpose: 'rail-breadcrumb', pickup: 'route', pts, score: 63 };
}

/** Safe street, or a single gentle weave when props sit on the centre line. */
function streetLine(ctx: OrbTrailContext): Line | null {
  if (ctx.connector) return null;
  if (ctx.breather && ctx.chunkX1 - ctx.chunkX0 < 48) return null;
  const v = cruise(ctx);
  const dur = 1.55;
  const span = v * dur;
  let x0 = Math.max(ctx.chunkX0 + 3, ctx.rhythm.quietUntil);
  const limit = ctx.chunkX1 - 2 - span;
  while (x0 <= limit) {
    const straight: Pt[] = [];
    const weave: Pt[] = [];
    let straightOk = true;
    let weaveOk = true;
    const n = countFor(dur);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = x0 + span * t;
      const y = yAtSurfaces(ctx.surfaces, x) + 0.26;
      const lat = 0.7 * Math.sin(Math.PI * t);
      if (blocked(ctx, x, y, 0)) straightOk = false;
      else straight.push({ x, y, lat: 0 });
      if (blocked(ctx, x, y, lat)) weaveOk = false;
      else weave.push({ x, y, lat });
    }
    if (straightOk && straight.length >= TRAIL_ORBS.min) return { purpose: 'safe-street', pickup: 'route', pts: straight, score: ctx.breather ? 40 : 48 };
    if (weaveOk && weave.length >= TRAIL_ORBS.min) return { purpose: 'street-weave', pickup: 'route', pts: weave, score: 58 };
    x0 += 8;
  }
  return null;
}

function goldCandidates(ctx: OrbTrailContext): Line[] {
  const lines: Line[] = [];
  for (const g of ctx.gaps) {
    const q = jumpLine(ctx, g);
    if (q) lines.push(q);
  }
  for (const r of ctx.rails) {
    const q = railLine(r, ctx);
    if (q) lines.push(q);
  }
  for (const w of ctx.walls) {
    const q = wallLine(w);
    if (q) lines.push(q);
  }
  const hop = potHop(ctx);
  if (hop) lines.push(hop);
  const smash = potSmash(ctx);
  if (smash) lines.push(smash);
  const ramp = rampApproach(ctx);
  if (ramp) lines.push(ramp);
  const crumb = railBreadcrumb(ctx);
  if (crumb) lines.push(crumb);
  const street = streetLine(ctx);
  if (street) lines.push(street);
  return lines;
}

function masteryOptions(ctx: OrbTrailContext): { score: number; pickup: OrbPickup; pt: Pt }[] {
  const out: { score: number; pickup: OrbPickup; pt: Pt }[] = [];
  for (const r of ctx.rails) {
    if (!r.risky) continue;
    const q = railSample(r, 0.86);
    out.push({ score: 100, pickup: 'grind', pt: { x: q.x, y: q.y, lat: r.lateral } });
  }
  for (const w of ctx.walls) {
    const len = w.x1 - w.x0;
    if (!w.required && len < 22) continue;
    const y = w.yBottom + (w.yTop - w.yBottom) * 0.42;
    out.push({ score: 90, pickup: 'wall', pt: { x: w.x0 + len * 0.88, y, lat: w.lateral - 0.35 } });
  }
  for (const g of ctx.gaps) {
    if (g.requires !== 'jump' || g.x1 - g.x0 < 4.5) continue;
    const v = cruise(ctx);
    const t = (g.x1 - g.x0) / v * 0.5;
    const x = g.x0 + v * t;
    const y = g.yTakeoff + JUMP_VY * t - 0.5 * AIR_G * t * t;
    if (y > g.yTakeoff + 0.35) out.push({ score: 80, pickup: 'air', pt: { x, y, lat: 0 } });
  }
  for (const r of ctx.rails) {
    if (r.risky) continue;
    const len = r.points[r.points.length - 1].x - r.points[0].x;
    if (len < 8) continue;
    const q = railSample(r, 0.9);
    out.push({ score: 60, pickup: 'grind', pt: { x: q.x, y: q.y, lat: r.lateral } });
  }
  return out;
}

function dedupe(placements: OrbPlacement[]): void {
  const kept: OrbPlacement[] = [];
  for (const p of placements) {
    const clash = kept.find((q) => Math.hypot(p.x - q.x, p.y - q.y) < MIN_ORB_GAP && Math.abs(p.lateral - q.lateral) < 0.7);
    if (!clash) { kept.push(p); continue; }
    if (p.tier === 'rare' && clash.tier !== 'rare') kept.splice(kept.indexOf(clash), 1, p);
  }
  placements.length = 0;
  placements.push(...kept);
}

export function stampOrbTrails(out: OrbPlacement[], ctx: OrbTrailContext): void {
  out.length = 0;
  const tid = () => ctx.nextTrailId();

  for (let n = 0; n < 2; n++) {
    if (ctx.rhythm.quietUntil > ctx.chunkX1 - 16) break;
    const lines = goldCandidates(ctx).filter((l) => l.pts[0].x >= ctx.rhythm.quietUntil - 1);
    const free = lines.filter((l) => !out.some((o) => o.tier === 'common' && Math.abs(o.x - l.pts[0].x) < 12));
    free.sort((a, b) => b.score - a.score);
    const best = free[0];
    if (!best) break;
    pushTrail(out, tid(), 'common', best.pickup, best.pts);
    const end = best.pts[best.pts.length - 1].x;
    ctx.rhythm.quietUntil = end + 30 + ctx.rng() * 14;
    if (ctx.chunkX1 - ctx.rhythm.quietUntil < 34) break;
  }

  const earlyHigh = ctx.phraseId === 'high-line' && ctx.chunkX1 < 120 && ctx.chunkX0 < ctx.nextRareX.at;
  const due = masteryOptions(ctx)
    .filter((o) => o.pt.x >= ctx.nextRareX.at - 25 && o.pt.x <= ctx.chunkX1 + 0.5)
    .sort((a, b) => a.pt.x - b.pt.x || b.score - a.score);
  let rareAt = earlyHigh
    ? masteryOptions(ctx).find((o) => o.pickup === 'grind' && o.score === 100) ?? null
    : due[0] ?? null;
  if (!rareAt && ctx.chunkX0 >= ctx.nextRareX.at - 8) {
    const late = masteryOptions(ctx).filter((o) => o.pt.x >= ctx.chunkX0).sort((a, b) => b.score - a.score);
    rareAt = late[0] ?? null;
  }
  if (rareAt && (earlyHigh || rareAt.pt.x >= ctx.nextRareX.at - 25 || ctx.chunkX0 >= ctx.nextRareX.at - 8)) {
    const clash = out.some((q) => Math.hypot(q.x - rareAt!.pt.x, q.y - rareAt!.pt.y) < MIN_ORB_GAP && Math.abs(q.lateral - rareAt!.pt.lat) < 0.7);
    if (!clash) pushTrail(out, tid(), 'rare', rareAt.pickup, [rareAt.pt]);
    ctx.nextRareX.at = rareAt.pt.x + 160 + ctx.rng() * 50;
  }

  dedupe(out);
}

export function yAtSurfaces(surfaces: Surface[], x: number): number {
  for (const s of surfaces) if (x >= Course.x0(s) && x <= Course.x1(s)) return Course.sample(s, x).y;
  const s = surfaces[surfaces.length - 1];
  return Course.sample(s, Math.min(Math.max(x, Course.x0(s)), Course.x1(s))).y;
}
