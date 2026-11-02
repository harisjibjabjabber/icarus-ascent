/**
 * Sky-layer templates (workstream C).
 *
 * Distances are metres along the route. Line and cluster heights are absolute:
 * street height at the grate (yBase) plus the authored offset. G is the grate.
 *
 * Ballistic spacing is computed here (rail-jump 9.2×0.9, balloon 10.4, roll-off 2.2,
 * g = 30, governed speed 14). The spec table is this helper's output.
 *
 * Product override: every interactive sits on the lane (lateral 0, within 0.3 m).
 * Lines run straight down the middle of the street. Bracket and mast kinds are art tags.
 *
 * Death holes sit under a grind the skilled line is already on, never under line 1,
 * and never where the gust dumps a passive rider (about G+20). The street rail across
 * the hole is the same shape as `rail-gap`, so a passive rider crosses it and a
 * mistimed one cannot jump it.
 */
import type { Vec2 } from './course';
import type { SkyAnchor, SkySegment, SkyVariant, Tuft } from './skyTypes';
import { TUNING } from '../tuning';

const SKY = TUNING.tricks.sky;

export const SKY_G = TUNING.movement.airGravity;
export const SKY_JUMP_VY = TUNING.movement.jumpVelocity * TUNING.tricks.grindJumpScale;
export const SKY_BALLOON_VY = TUNING.tricks.balloonVy;
export const SKY_ROLL_VY = TUNING.tricks.grindExitPop;
export const SKY_SPEED = SKY.speed;
export const SKY_RUN_IN = 45;
export const SKY_LAND_CLEAR = SKY.landingClear;
export const SKY_LANE = 0;
/** Interactive geometry must stay inside this of the lane. */
export const SKY_LANE_TOL = 0.3;
export const SKY_BAND_MARGIN = 10;

const SAG_PER_8 = 0.08;
const CLUSTER_COUNTS = [5, 4, 6, 5] as const;
/** Rail-gap shape: linear drop, a flat lip, then a hole past a hard-cap jump. */
const GAP_APPROACH = 48;
const GAP_LIP_FLAT = 8;
const GAP_LEN = 22;
const GAP_DROP = -4;
const GAP_RECEIVE = -0.8;

export function isSkyId(id: string): boolean {
  return id === 'sky-intro' || id === 'sky-hop' || id === 'sky-gap' || id === 'sky-gauntlet'
    || id === 'sp-sky-gap' || id === 'sp-sky-gauntlet';
}

/** Fillers are authored beats, not draws from the phrase pool. */
export function isSkyFiller(id: string): boolean {
  return id === 'sky-intro' || id === 'sky-hop';
}

/**
 * Larger root of vy·t − ½gt² = dy: the moment a rider is `dy` metres above the
 * launch on the way back down (the catch). `dy` may be negative.
 */
export function timeAtHeight(vy: number, dy: number, g = SKY_G): number {
  const disc = vy * vy - 2 * g * dy;
  if (disc < 0) throw new Error(`sky ballistics: dy ${dy} is above the apex for vy ${vy}`);
  return (vy + Math.sqrt(disc)) / g;
}

/** How far a governed rider travels while a balloon hop gains `rise` metres. */
export function clusterSpacing(rise = SKY.rungRise, speed = SKY_SPEED): number {
  return speed * timeAtHeight(SKY_BALLOON_VY, rise);
}

/**
 * Extra metres of run between balloon rungs, past the ballistic hop.
 * Largest gap that still lets a governed rider at 13.5, 14 and 14.5 m/s
 * catch every rung. With a 4.5 m envelope that is about 4 m of air between crowns.
 */
const BALLOON_LADDER_GAP = 0.6;

export function rollSpacing(dy: number, speed = SKY_SPEED): number {
  return speed * timeAtHeight(SKY_ROLL_VY, dy);
}

/**
 * Where a rail-jump from `srcY` is descending through `dstY`.
 * The window is the trailing part of the source rail that still lands on the target,
 * and it is at least 0.36 s at the governed speed.
 */
export function jumpWindow(
  srcX0: number, srcX1: number, srcY: number,
  dstX0: number, dstX1: number, dstY: number,
  speed = SKY_SPEED,
): { x0: number; x1: number } {
  const dx = speed * timeAtHeight(SKY_JUMP_VY, dstY - srcY);
  const lead = TUNING.tricks.railCatchBefore;
  let x0 = Math.max(srcX0, dstX0 - lead - dx);
  let x1 = Math.min(srcX1, dstX1 - dx);
  const minW = speed * 0.36;
  if (!(x1 > x0)) { x0 = Math.max(srcX0, srcX1 - minW); x1 = srcX1; }
  else if (x1 - x0 < minW) x0 = Math.max(srcX0, x1 - minW);
  return { x0, x1 };
}

export interface SkyLineDraft {
  anchors: SkyAnchor[];
  points: Vec2[];
  laundry: boolean;
}

export interface SkyClusterDraft {
  x: number;
  y: number;
  count: number;
  seed: number;
  tether: SkyAnchor;
}

export interface SkyHopDraft {
  x0: number;
  x1: number;
  action: 'down' | 'jump' | 'roll';
  /** Index into `lines`. */
  line?: number;
  /** Index into `clusters`. */
  cluster?: number;
}

export interface SkyLayout {
  variant: SkyVariant;
  x0: number;
  gx: number;
  xLand: number;
  x1: number;
  yBase: number;
  tuft: Omit<Tuft, 'id' | 'segmentId'>;
  lines: SkyLineDraft[];
  clusters: SkyClusterDraft[];
  hops: SkyHopDraft[];
  gapBelow: { x0: number; x1: number } | null;
  /** Street drop in the hole's approach (0 when the street stays level). */
  approachDy: number;
  /** Further drop from the lip to the receiving street. */
  receiveDy: number;
  /** Absolute street height the roll-off lands on. */
  streetY: number;
  harbour: boolean;
}

export interface StreetPen {
  readonly x: number;
  readonly y: number;
  flat(len: number): void;
  /** Straight grade. Callers pass a linear ease; a smooth ease would crest. */
  slope(len: number, dy: number): void;
  runIn(): void;
  /** Opens a rail-bridged hole. Returns the takeoff lip. */
  gap(len: number, dy: number): Vec2;
  rail(x: number, len: number, y0: number, y1: number, lateral: number, required: boolean, mid?: number): void;
}

/** True when x lies in a sky segment expanded by the house / bunting margin. */
export function inSkyFrontage(spans: { x0: number; x1: number }[], x: number, margin = SKY_BAND_MARGIN): boolean {
  return spans.some((s) => x >= s.x0 - margin && x <= s.x1 + margin);
}

/** True when a span overlaps a sky segment expanded by the margin. */
export function overlapsSkyBand(spans: { x0: number; x1: number }[], x0: number, x1: number, margin = SKY_BAND_MARGIN): boolean {
  return spans.some((s) => x1 >= s.x0 - margin && x0 <= s.x1 + margin);
}

/**
 * Front-row houses inside a sky band are three storeys (eave 3 × 3.12 = 9.36),
 * so the 6.4 m lines hang under the eaves rather than through a 6.24 m roof.
 * The town renderer (workstream B) reads this; layout publishes the spans on `Course.sky`.
 */
export function skyFrontRowFloors(inBand: boolean, rolled: number): number {
  return inBand ? 3 : rolled;
}

function anchor(x: number, y: number, kind: SkyAnchor['kind']): SkyAnchor {
  return { x, y, lateral: SKY_LANE, kind };
}

function mergeChord(corners: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i];
    const n = Math.max(1, Math.round((b.x - a.x) / 8));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (corners.length === 1) out.push({ ...corners[0] });
  return out;
}

/** Cotton sag: 0.08 m over each ~8 m bay, included in the grind polyline. Anchors stay on the chord. */
function sagPoints(chords: { x: number; y: number }[]): Vec2[] {
  const pts: Vec2[] = [{ x: chords[0].x, y: chords[0].y }];
  for (let i = 1; i < chords.length; i++) {
    const a = chords[i - 1], b = chords[i];
    const sag = SAG_PER_8 * ((b.x - a.x) / 8);
    pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - sag });
    pts.push({ x: b.x, y: b.y });
  }
  return pts;
}

function makeLine(corners: { x: number; y: number }[], harbour: boolean, mast: boolean): SkyLineDraft {
  const chords = mergeChord(corners);
  const kind = (i: number): SkyAnchor['kind'] => {
    if (harbour) return 'ship-mast';
    return mast && i === chords.length - 1 ? 'mast' : 'bracket-right';
  };
  return {
    laundry: true,
    anchors: chords.map((p, i) => anchor(p.x, p.y, kind(i))),
    points: sagPoints(chords),
  };
}

function corner(gx: number, yBase: number, dx: number, h: number): { x: number; y: number } {
  return { x: gx + dx, y: yBase + h };
}

function clusterAt(x: number, y: number, count: number, seed: number, harbour: boolean): SkyClusterDraft {
  return {
    x, y, count, seed,
    tether: anchor(x, y, harbour ? 'ship-mast' : 'bracket-right'),
  };
}

function seedFor(gx: number, i: number): number {
  return (Math.round(gx * 13) + i * 17) >>> 0;
}

interface LineEnd { x: number; y: number }

/** Roll off `from` onto the first rung, then climb `rise` metres per balloon. */
function placeClusters(from: LineEnd, y0: number, n: number, gx: number, harbour: boolean, startSeed: number): SkyClusterDraft[] {
  const out: SkyClusterDraft[] = [];
  let x = from.x + rollSpacing(y0 - from.y);
  let y = y0;
  for (let i = 0; i < n; i++) {
    if (i > 0) { x += clusterSpacing() + BALLOON_LADDER_GAP; y += SKY.rungRise; }
    out.push(clusterAt(x, y, CLUSTER_COUNTS[i] ?? 5, seedFor(gx, startSeed + i), harbour));
  }
  return out;
}

/** Down-arm after the last balloon, wide enough to catch the next grind. */
function ladderCatch(last: SkyClusterDraft, lineIndex: number): SkyHopDraft {
  const arrive = last.x + clusterSpacing();
  const arm = SKY_SPEED * 0.36;
  return { x0: arrive - arm, x1: arrive + 1, action: 'down', line: lineIndex };
}

/**
 * T1 intro, T0 hop, T2 gap and T3 gauntlet.
 * `gx` is the grate. The segment starts 45 m before it on flat empty street.
 */
export function layoutSky(variant: SkyVariant, gx: number, yBase: number, harbour = false): SkyLayout {
  const lines: SkyLineDraft[] = [];
  const hops: SkyHopDraft[] = [];

  const l1 = [10, 18, 26, 34].map((dx) => corner(gx, yBase, dx, SKY.lineY));
  lines.push(makeLine(l1, harbour, false));
  hops.push({ x0: l1[0].x, x1: l1[l1.length - 1].x, action: 'down', line: 0 });

  if (variant === 'sky-hop') {
    const l2a = corner(gx, yBase, 36.5, 7);
    const l2b = corner(gx, yBase, 52, 7);
    const l2c = corner(gx, yBase, 80, 3.6);
    lines.push(makeLine([l2a, l2b, l2c], harbour, true));
    const hop = jumpWindow(l1[0].x, l1[l1.length - 1].x, l1[0].y, l2a.x, l2b.x, l2a.y);
    hops.push({ ...hop, action: 'jump', line: 1 });
    return finish(variant, gx, yBase, harbour, lines, [], hops, null, l2c);
  }

  const l2 = [corner(gx, yBase, 36.5, 7), corner(gx, yBase, 55, 7)];
  lines.push(makeLine(l2, harbour, false));
  const up = jumpWindow(l1[0].x, l1[l1.length - 1].x, l1[0].y, l2[0].x, l2[1].x, l2[0].y);
  hops.push({ ...up, action: 'jump', line: 1 });

  const l3 = [corner(gx, yBase, 59, 6.2), corner(gx, yBase, 79, 6.2)];
  lines.push(makeLine(l3, harbour, false));
  hops.push({ x0: l3[0].x, x1: l3[1].x, action: 'down', line: 2 });

  const clusters = placeClusters(
    { x: l3[1].x, y: l3[1].y },
    yBase + 5.6,
    variant === 'sky-gauntlet' ? 4 : 3,
    gx,
    harbour,
    1,
  );

  if (variant === 'sky-gauntlet') {
    const l4a = corner(gx, yBase, 112, 9.6);
    const l4b = corner(gx, yBase, 130, 9.6);
    lines.push(makeLine([l4a, l4b], harbour, false));
    hops.push(ladderCatch(clusters[clusters.length - 1], 3));
    const l5y = yBase + 8.4;
    const l5x = l4b.x + rollSpacing(l5y - l4b.y);
    // Flat long enough that a 22 m hole sits entirely under the grind, then a short slope home.
    const l5b = { x: l5x + 36, y: l5y };
    const l5c = { x: l5b.x + 20, y: yBase + 3.8 };
    lines.push(makeLine([{ x: l5x, y: l5y }, l5b, l5c], harbour, true));
    hops.push({ x0: l5x, x1: l5b.x, action: 'down', line: 4 });
    // 12 m into the flat grind: the catch on L5 has already happened, and the hole is still under the line.
    const gap = { x0: l5x + 12, x1: l5x + 12 + GAP_LEN };
    return finish(variant, gx, yBase, harbour, lines, clusters, hops, gap, l5c);
  }

  const l4 = [corner(gx, yBase, 104, 8.6), corner(gx, yBase, 118, 8.6), corner(gx, yBase, 146, 3.8)];
  lines.push(makeLine(l4, harbour, true));
  hops.push(ladderCatch(clusters[clusters.length - 1], 3));
  // Hole under the L4 grind, after the catch window (about G+108) and clear of line 1.
  const gap = variant === 'sky-gap' ? { x0: gx + 116, x1: gx + 116 + GAP_LEN } : null;
  return finish(variant, gx, yBase, harbour, lines, clusters, hops, gap, l4[l4.length - 1]);
}

function finish(
  variant: SkyVariant,
  gx: number,
  yBase: number,
  harbour: boolean,
  lines: SkyLineDraft[],
  clusters: SkyClusterDraft[],
  hops: SkyHopDraft[],
  gapBelow: { x0: number; x1: number } | null,
  end: { x: number; y: number },
): SkyLayout {
  const approachDy = gapBelow ? GAP_DROP : 0;
  const receiveDy = gapBelow ? GAP_RECEIVE : 0;
  const streetY = yBase + approachDy + receiveDy;
  const xLand = end.x + rollSpacing(streetY - end.y);
  const x1 = xLand + SKY_LAND_CLEAR;
  return {
    variant,
    x0: gx - SKY_RUN_IN,
    gx,
    xLand,
    x1,
    yBase,
    harbour,
    lines,
    clusters,
    hops,
    gapBelow,
    approachDy,
    receiveDy,
    streetY,
    tuft: {
      x0: gx,
      x1: gx + 3,
      yBase,
      catchH: SKY.gustCatchH,
      exitX: gx + SKY.gustExitDx,
      exitY: yBase + SKY.gustExitDy,
      lateral: SKY_LANE,
      source: 'grate',
    },
  };
}

/**
 * Street under a layout. Flat when the segment has no hole.
 * A hole gets the rail-gap telegraph: flat to 72 m before the lip (the run-in mark),
 * then a linear 48 m drop, 8 m of lip, the hole, and the required street rail.
 * The pen only moves forward.
 */
export function paintSkyStreet(pen: StreetPen, L: SkyLayout): void {
  if (!L.gapBelow) {
    const len = L.x1 - pen.x;
    if (len > 1e-4) pen.flat(len);
    return;
  }
  const lipX = L.gapBelow.x0;
  const slopeStart = lipX - GAP_LIP_FLAT - GAP_APPROACH;
  const runAt = lipX - 72;
  const toRun = runAt - pen.x;
  if (toRun > 1e-4) pen.flat(toRun);
  pen.runIn();
  const toSlope = slopeStart - pen.x;
  if (toSlope > 1e-4) pen.flat(toSlope);
  pen.slope(GAP_APPROACH, L.approachDy);
  pen.flat(GAP_LIP_FLAT);
  const len = L.gapBelow.x1 - L.gapBelow.x0;
  const lip = pen.gap(len, L.receiveDy);
  // Same rail as buildRailGap: starts before the lip, lateral 0, about +1 m.
  pen.rail(lip.x - 3, len + 8, lip.y + 1.0, lip.y + 0.2, SKY_LANE, true, lip.y + 0.55);
  const rest = L.x1 - pen.x;
  if (rest > 1e-4) pen.flat(rest);
}

export function bindSky(
  L: SkyLayout,
  segmentId: number,
  tuftId: number,
  railIds: number[],
  bounceIds: number[],
): { tuft: Tuft; segment: SkySegment } {
  const tuft: Tuft = { ...L.tuft, id: tuftId, segmentId };
  const segment: SkySegment = {
    id: segmentId,
    variant: L.variant,
    x0: L.x0,
    gx: L.gx,
    xLand: L.xLand,
    x1: L.x1,
    yBase: L.yBase,
    tuftId,
    lines: L.lines.map((line, i) => ({ railId: railIds[i], anchors: line.anchors, laundry: line.laundry })),
    clusters: L.clusters.map((c, i) => ({ bounceId: bounceIds[i], count: c.count, tether: c.tether, seed: c.seed })),
    hops: L.hops.map((h) => ({
      x0: h.x0,
      x1: h.x1,
      action: h.action,
      targetRail: h.line !== undefined ? railIds[h.line] : undefined,
      targetBounce: h.cluster !== undefined ? bounceIds[h.cluster] : undefined,
    })),
    gapBelow: L.gapBelow,
  };
  return { tuft, segment };
}
