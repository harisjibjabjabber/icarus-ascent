import { Course, type Bounce, type Chunk, type Feature, type Gap, type Obstacle, type OrbPlacement, type Rail, type RideHook, type Surface, type Swing, type Updraft, type Vec2, type Wall } from './course';
import type { Orb } from './orbs';
import { addOrb } from './orbs';
import { stampOrbTrails } from './orbTrails';
import { extend, kicker, smooth, easeOut, linear, crestPop, rollingHills, type Ease } from './shapes';
import { TUNING } from '../tuning';
import { mulberry32 } from '../rng';
import { SET_PIECES, type SetPieceSpec } from './setpieces';
import { WAVE, waveAt, type WaveInfo } from './waves';
import { ZoneSequence } from '../zones/sequence';
import type { Zone } from '../zones/zone';

/**
 * Endless assembly (brief §10, §12 "Fourth").
 *
 * The course is a seeded, deterministic sequence of authored *phrases*: each one is a
 * purposeful movement sequence (descent -> crest pop -> landing, pot -> pillar,
 * compression -> wall ride -> receiving climb, ...), not a scattering of objects.
 * Every phrase declares the entry speed it is built for, its likely exit speed, the
 * airtime it offers, what receives the rider, and a difficulty tier. The assembler
 * picks phrases with a seeded RNG under a difficulty curve, validates each neighbour
 * pair and inserts connectors (speed boost, speed bleed, recovery, climb) where a pair
 * would not work on its own.
 *
 * Contract between phrases: every phrase starts and ends on flat ground (slope 0), so
 * consecutive phrases join seamlessly (no gap, no crest at the seam). Compulsory
 * features sit at the end of long flat run-ins (readable before commitment) and are
 * followed by broad receivers and a recovery stretch.
 *
 * Streaming: phrases are generated a fixed distance ahead of the rider and recycled
 * once safely behind with no active contact. Phrase i is built from its own RNG
 * (seed, i), so content never depends on when it was generated.
 */

export type Receiving = 'flat' | 'downslope' | 'climb' | 'broad';
export type Tier = 0 | 1 | 2 | 3;

export interface PhraseSpec {
  id: string;
  title: string;
  /** 0 = start/connector, 1..3 = difficulty tier. */
  tier: Tier;
  /** Style air: hills/kickers to flip or grab off with no gap and nothing compulsory. */
  style: boolean;
  /** Contains a compulsory action (gap, required rail/wall, pot, pillar). */
  required: boolean;
  /** Speeds (m/s) at the phrase start it is built for. */
  entry: [number, number];
  /** Likely speed at the phrase end (measured with the dev autopilot across seeds). */
  exit: [number, number];
  /** Typical airtime offered (s) at a normal riding speed. */
  airtime: number;
  /** What receives the rider after the phrase's main action. */
  receiving: Receiving;
  /** Checkpoint speed for a retry from this phrase. */
  cpSpeed: number;
  build(b: PhraseBuilder, d: number, r: () => number): void;
}

/** Collects one phrase's geometry relative to its start point. */
export class PhraseBuilder {
  pts: Vec2[];
  material: Surface['material'];
  readonly chains: { points: Vec2[]; material: Surface['material'] }[] = [];
  readonly rails: Omit<Rail, 'id'>[] = [];
  readonly walls: Omit<Wall, 'id'>[] = [];
  readonly swings: Omit<Swing, 'id'>[] = [];
  readonly bounces: Omit<Bounce, 'id'>[] = [];
  readonly updrafts: Omit<Updraft, 'id'>[] = [];
  readonly obstacles: { kind: Obstacle['kind']; x: number }[] = [];
  readonly requires: [number, Gap['requires']][] = [];
  readonly features: Feature[] = [];
  /** Where the run-in for the next compulsory feature begins. */
  approachX: number;

  constructor(readonly x0: number, readonly y0: number, material: Surface['material']) {
    this.pts = [{ x: x0, y: y0 }];
    this.material = material;
    this.approachX = x0;
  }
  cur(): Vec2 { return this.pts[this.pts.length - 1]; }
  flat(len: number): this { extend(this.pts, this.cur().x + len, this.cur().y, linear, 4); return this; }
  slope(len: number, dy: number, ease: Ease = smooth): this { extend(this.pts, this.cur().x + len, this.cur().y + dy, ease, 1.5); return this; }
  kicker(len: number, rise: number): this { extend(this.pts, this.cur().x + len, this.cur().y + rise, kicker, 0.8); return this; }
  /** Crest pop on continuous ground (style air, no gap). Orbs come from trail stamping in EndlessCourse. */
  crest(rise: number, len: number, drop: number, backLen: number): this {
    const top = this.cur().x + len;
    crestPop(this.pts, rise, len, drop, backLen);
    this.features.push({ x: top, kind: 'crest', required: false });
    return this;
  }
  /** Rolling hills: a pop chain for fast riders (style air), calm for slow ones. */
  rollers(count: number, amp: number, period: number): this {
    const a = this.cur().x;
    rollingHills(this.pts, count, amp, period);
    for (let k = 0; k < count; k++) this.features.push({ x: a + period * (k + 0.5), kind: 'rollers', required: false });
    return this;
  }
  /** End the current chain and start the next after a gap. Returns the takeoff lip. */
  gap(len: number, dy: number, requires: Gap['requires'] = 'jump', next: Surface['material'] = this.material === 'stone' ? 'cloud' : 'stone'): Vec2 {
    const lip = this.cur();
    this.chains.push({ points: this.pts, material: this.material });
    this.pts = [{ x: lip.x + len, y: lip.y + dy }];
    this.material = next;
    this.requires.push([lip.x, requires]);
    this.features.push({ x: lip.x, kind: requires === 'jump' ? 'gap' : requires, required: true, approachX: this.approachX });
    if (requires !== 'jump') this.features.push({ x: lip.x + len, kind: requires, required: false });
    this.approachX = lip.x + len;
    return lip;
  }
  rail(x: number, len: number, y0: number, y1: number, lateral: number, required: boolean, mid?: number): void {
    const points = mid === undefined ? [{ x, y: y0 }, { x: x + len, y: y1 }] : [{ x, y: y0 }, { x: x + len * 0.4, y: mid }, { x: x + len, y: y1 }];
    this.rails.push({ points, lateral, required });
    if (!required) this.features.push({ x, kind: 'rail-optional', required: false });
  }
  /** Ground height of the chain being built, at x. */
  private yAt(x: number): number {
    for (let i = 1; i < this.pts.length; i++) if (this.pts[i].x >= x) {
      const a = this.pts[i - 1], b = this.pts[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
    }
    return this.cur().y;
  }
  /** Optional handrail (right of the route) following the ground just built from x0 to x1. */
  handrail(x0: number, x1: number, h = 0.95): this {
    const n = Math.max(2, Math.ceil((x1 - x0) / 3) + 1);
    this.rails.push({ points: Array.from({ length: n }, (_, i) => { const x = x0 + ((x1 - x0) * i) / (n - 1); return { x, y: this.yAt(x) + h }; }), lateral: 1.2, required: false });
    this.features.push({ x: x0, kind: 'rail-optional', required: false });
    return this;
  }
  /**
   * Optional high line over a street that is already built (call after the flat that carries it).
   * The street stays continuous. The void is where an airborne miss falls through; it ends before the rail
   * so a clean grind pops onto the street. Height sits inside the rail catch band of a normal jump.
   */
  highLine(x0: number, len: number, h0 = 1.12, h1 = 0.96, dress: NonNullable<Rail['dress']> = 'wash'): this {
    const n = Math.max(2, Math.ceil(len / 3) + 1);
    const points = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const x = x0 + len * t;
      return { x, y: this.yAt(x) + h0 + (h1 - h0) * t };
    });
    this.rails.push({ points, lateral: 1.15, required: false, risky: true, voidX0: x0 + 0.45, voidX1: x0 + len - 5.2, dress });
    this.features.push({ x: x0, kind: 'rail-risky', required: false });
    return this;
  }
  /**
   * A safe elevated line (no void) dressed as part of the street: laundry, a balcony rail, a gutter
   * or bunting. Bunting is a catenary hooked to both facades, not a row of cones on the grind.
   * Catchable from a normal jump. Orb trails are stamped later.
   */
  lineDress(x0: number, len: number, h: number, dress: NonNullable<Rail['dress']>): this {
    const n = Math.max(2, Math.ceil(len / 3) + 1);
    const points = Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const x = x0 + len * t;
      return { x, y: this.yAt(x) + h };
    });
    this.rails.push({ points, lateral: 1.15, required: false, dress });
    this.features.push({ x: x0, kind: 'rail-optional', required: false });
    if (len >= 12) this.features.push({ x: x0 + len - 1, kind: 'rail-optional', required: false });
    return this;
  }
  /** Descent with an optional handrail along most of it. */
  railSlope(len: number, dy: number): this { const a = this.cur().x; this.slope(len, dy); return this.handrail(a + 3, a + len - 4, 0.95); }
  /**
   * A wall ride beside the street. Gold trails are stamped along the wall afterwards.
   * `trailY` / `purple` are accepted so phrase calls can mark the ride; the stamper owns the orbs.
   */
  wall(w: Omit<Wall, 'id'> & { trailY?: number; purple?: boolean }): void {
    const { trailY: _trailY, purple: _purple, ...rest } = w;
    void _trailY; void _purple;
    this.walls.push(rest);
    if (!rest.required) {
      this.features.push({ x: rest.x0, kind: 'wall', required: false });
      // the ride itself is the thing to do; a long wall's far end keeps the next run-in from reading as empty
      if (rest.x1 - rest.x0 >= 12) this.features.push({ x: rest.x1 - 1, kind: 'wall', required: false });
    }
  }
  /**
   * Washing line at an absolute height. The street under it is already built and stays continuous.
   * No void: a rider who never reaches it just lands.
   */
  washLine(x0: number, len: number, y: number): this {
    const n = Math.max(2, Math.ceil(len / 3) + 1);
    const points = Array.from({ length: n }, (_, i) => ({ x: x0 + (len * i) / (n - 1), y: y - 0.12 * (i / (n - 1)) }));
    this.rails.push({ points, lateral: 1.2, required: false, dress: 'wash', wash: true });
    this.features.push({ x: x0, kind: 'rail-optional', required: false });
    if (len >= 12) this.features.push({ x: x0 + len - 1, kind: 'rail-optional', required: false });
    return this;
  }
  swingAt(ax: number, ay: number, length: number, lateral: number, anchor: Swing['anchor']): this {
    this.swings.push({ ax, ay, length, lateral, anchor });
    this.features.push({ x: ax, kind: 'swing', required: false });
    return this;
  }
  column(u: Omit<Updraft, 'id'>): this {
    this.updrafts.push(u);
    this.features.push({ x: u.x0, kind: 'updraft', required: false });
    this.features.push({ x: u.corridorX1 - 1, kind: 'updraft', required: false });
    return this;
  }
  bouncePad(b: Omit<Bounce, 'id'>): this {
    this.bounces.push(b);
    this.features.push({ x: b.x, kind: 'bounce', required: false });
    return this;
  }
  /** `cluster`: a second pot right behind the first, cleared or skimmed together with it. */
  pot(x: number, cluster = false): void {
    this.obstacles.push({ kind: 'pot', x });
    this.features.push(cluster ? { x, kind: 'pot', required: true } : { x, kind: 'pot', required: true, approachX: this.approachX });
    this.approachX = x + 2;
  }
  pillar(x: number): void {
    this.obstacles.push({ kind: 'pillar', x });
    this.features.push({ x, kind: 'pillar', required: true, approachX: this.approachX });
    this.approachX = x + 2;
  }
  /** Mark that the next compulsory feature's run-in starts here. */
  runIn(): this { this.approachX = this.cur().x; return this; }
  finish(): void { this.chains.push({ points: this.pts, material: this.material }); }
}

const HC = TUNING.movement.hardCap;

/** Phrases that offer a wall ride (optional taps, transfers, the gap ride, and the wall set pieces). */
function isWallRide(id: string): boolean {
  return id.startsWith('wall-') || id === 'death-gauntlet' || id === 'sp-rail-wall' || id === 'sp-canal' || id === 'sp-crest-wall';
}

/**
 * Phrases where the street itself is gone and the only way across is the rail or the wall.
 * Missing it is the ordinary gap fail (missed rail / missed wall / fell short).
 */
export function isDeath(id: string): boolean {
  return id === 'rail-gap' || id === 'rail-gap-early' || id === 'wall-over' || id === 'wall-gap' || id === 'death-gauntlet';
}

/**
 * Longest unassisted jump from a flat lip at `speed`, landing `drop` metres lower.
 * Coyote and a fresh jump share this: grab is a pose and does not add range.
 */
export function maxJumpReach(speed: number, drop: number): number {
  const M = TUNING.movement;
  const vy = M.jumpVelocity;
  const v = Math.min(speed, M.hardCap);
  const t = (vy + Math.sqrt(vy * vy + 2 * M.airGravity * Math.max(0, drop))) / M.airGravity;
  return v * t;
}

/** Same jump off the lip of a kicker (ease t², so the lip grade is 2·rise/len). */
export function kickerJumpReach(speed: number, rise: number, len: number, drop: number): number {
  const M = TUNING.movement;
  const theta = Math.atan((2 * rise) / len);
  const v = Math.min(speed, M.hardCap);
  const vx = v * Math.cos(theta);
  const vy = v * Math.sin(theta) + M.jumpVelocity;
  const t = (vy + Math.sqrt(vy * vy + 2 * M.airGravity * Math.max(0, drop))) / M.airGravity;
  return vx * t;
}

/** Optional activities that fill a plain roll. One per chunk; the same one stays rare. */
function isPlay(id: string): boolean {
  return id === 'wash-line' || id === 'swing-hook' || id === 'updraft' || id === 'bounce' || id === 'awning';
}

/** Ideal path and the purple point for each activity. The other placer may follow `path`; the purple is spawned here. */
function activityRides(rails: Rail[], swings: Swing[], updrafts: Updraft[], bounces: Bounce[]): RideHook[] {
  const out: RideHook[] = [];
  for (const r of rails) if (r.wash) {
    const a = r.points[0], z = r.points[r.points.length - 1];
    const path = r.points.map((p) => ({ x: p.x, y: p.y, lateral: r.lateral }));
    const t = 0.85;
    out.push({ activity: 'wash', path, hardest: { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t, lateral: r.lateral, pickup: 'grind' } });
  }
  for (const s of swings) {
    const path = Array.from({ length: 7 }, (_, i) => {
      const phi = -0.15 + (1.15 * i) / 6;
      return { x: s.ax + s.length * Math.sin(phi), y: s.ay - s.length * Math.cos(phi), lateral: s.lateral };
    });
    const phi = 0.95;
    out.push({ activity: 'swing', path, hardest: { x: s.ax + s.length * Math.sin(phi), y: s.ay - s.length * Math.cos(phi), lateral: s.lateral, pickup: 'air' } });
  }
  for (const u of updrafts) {
    const path = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
      x: u.x0 + (u.corridorX1 - u.x0) * t,
      y: u.y0 + 1.1 + Math.sin(t * Math.PI) * 2.5,
      lateral: 0,
    }));
    const last = path[path.length - 1];
    out.push({ activity: 'flight', path, hardest: { x: last.x, y: last.y, lateral: 0, pickup: 'air' } });
  }
  if (bounces.length) {
    const path = bounces.map((b) => ({ x: b.x, y: b.y + 1.15, lateral: b.lateral * 0.75 }));
    const last = bounces[bounces.length - 1];
    out.push({ activity: 'bounce', path, hardest: { x: last.x, y: last.y + 1.15, lateral: last.lateral * 0.75, pickup: 'air' } });
  }
  return out;
}

/** Height on a rail polyline at x (rails are short and monotonic). */
function railAt(points: Vec2[], x: number): number {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x);
  }
  return points[points.length - 1].y;
}

/**
 * Gold along every required rail and wall of a death phrase (the stamper keeps only two trails),
 * and a purple on a gauntlet when that chunk does not already have one. Returns the purple's x.
 */
function dressDeathOrbs(placements: OrbPlacement[], rails: Rail[], walls: Wall[], phraseId: string): number | null {
  const reqRails = rails.filter((r) => r.required);
  const purpleRail = phraseId === 'death-gauntlet' ? reqRails[reqRails.length - 1] : undefined;
  const purple = purpleRail ? (() => {
    const a = purpleRail.points[0], z = purpleRail.points[purpleRail.points.length - 1];
    const x = a.x + (z.x - a.x) * 0.85;
    return { x, y: railAt(purpleRail.points, x), lateral: purpleRail.lateral };
  })() : null;
  const hasCommon = (x0: number, x1: number, lat: number) => placements.some((p) => p.tier === 'common' && p.x >= x0 && p.x <= x1 && Math.abs(p.lateral - lat) < 1.1);
  for (const r of reqRails) {
    const a = r.points[0], z = r.points[r.points.length - 1];
    if (hasCommon(a.x, z.x, r.lateral)) continue;
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const x = a.x + (z.x - a.x) * t;
      const y = railAt(r.points, x);
      if (purple && Math.hypot(x - purple.x, y - purple.y) < 2) continue;
      addOrb(placements, 'common', x, y, r.lateral, 'grind');
    }
  }
  for (const w of walls) if (w.required) {
    const lat = w.lateral - 0.35;
    if (hasCommon(w.x0, w.x1, lat)) continue;
    const y = w.yBottom + (w.yTop - w.yBottom) * 0.42;
    const len = w.x1 - w.x0;
    for (let i = 0; i < 5; i++) {
      const x = w.x0 + len * (((i + 0.5) / 5) * 0.78);
      addOrb(placements, 'common', x, y, lat, 'wall');
    }
  }
  if (purple && !placements.some((p) => p.tier === 'rare')) {
    addOrb(placements, 'rare', purple.x, purple.y, purple.lateral, 'grind');
    return purple.x;
  }
  return null;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Rail across a hole that is past a hard-cap jump. The early copy is tier 1 so it can sit just
 * after 300 m; the later copy is tier 2 so the difficulty curve still climbs.
 */
function buildRailGap(b: PhraseBuilder, d: number): void {
  b.flat(4).runIn().slope(48, -4, linear).flat(8);
  const y = b.cur().y, len = 26 + 6 * d;
  const lip = b.gap(len, -0.5, 'rail');
  b.rail(lip.x - 3, len + 8, y + 1.0, y + 0.2, 0, true, y + 0.55);
  b.flat(14);
}

/** Phrase library. Entry/exit speeds are checked by tests/endless*.test.ts. */
export const PHRASES: PhraseSpec[] = [
  // ------------------------------------------------------------------ connectors
  {
    id: 'start', title: 'Run-in', tier: 0, style: true, required: false, entry: [0, 4], exit: [13, 22], airtime: 0.5, receiving: 'downslope', cpSpeed: 0,
    build: (b) => { b.flat(64).slope(36, -7).flat(8).crest(1.4, 8, 1.4, 14).flat(14); },
  },
  {
    id: 'boost', title: 'Boost descent', tier: 0, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.2, receiving: 'flat', cpSpeed: 10,
    build: (b) => { b.flat(4).railSlope(40, -9).flat(4).rollers(2, 0.9, 20).flat(8); },
  },
  {
    id: 'bleed', title: 'Easy climb', tier: 0, style: false, required: false, entry: [8, HC], exit: [8, 22], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).slope(36, 4).flat(4).rollers(2, 0.6, 22).flat(8); },
  },
  {
    id: 'recovery', title: 'Recovery', tier: 0, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(10).rollers(2, 0.7, 22).flat(10); },
  },
  {
    // zone gate: a calm, readable run between zones (rendered as an arch + fog wall; see src/zones/scenery.ts)
    id: 'gate', title: 'Zone gate', tier: 0, style: true, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.3, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(24).rollers(2, 0.7, 22).flat(24); },
  },
  {
    id: 'climb', title: 'Climb', tier: 0, style: false, required: false, entry: [8, HC], exit: [8, 22], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).rollers(1, 0.8, 20).slope(40, 6).rollers(2, 0.8, 20).slope(30, 5).rollers(1, 0.8, 20).flat(6); },
  },
  // ------------------------------------------------------------------ style air (no gaps)
  {
    id: 'crest-pop', title: 'Descent → crest pop', tier: 1, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.8, receiving: 'downslope', cpSpeed: 11,
    build: (b, d) => { b.flat(4).railSlope(40, -(9 + 3 * d)).flat(6).crest(2.0 + 0.6 * d, 10, 2.2, 18).flat(14); },
  },
  {
    id: 'rollers', title: 'Rolling hills', tier: 1, style: true, required: false, entry: [6, HC], exit: [11, HC], airtime: 0.4, receiving: 'downslope', cpSpeed: 14,
    build: (b) => { b.flat(4).railSlope(24, -4).flat(4).rollers(3, 1.3, 20).flat(12); },
  },
  {
    id: 'valley-launch', title: 'Valley launch', tier: 1, style: true, required: false, entry: [6, HC], exit: [16, HC], airtime: 0.9, receiving: 'downslope', cpSpeed: 11,
    build: (b, d) => { b.flat(4).railSlope(36, -(10 + 2 * d)).flat(4).crest(3.2, 18, 4.5, 24).flat(12); },
  },
  {
    id: 'pop-chain', title: 'Rolling hills pop chain', tier: 2, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.6, receiving: 'downslope', cpSpeed: 12,
    build: (b, d) => { b.flat(4).railSlope(34, -(8 + 2 * d)).flat(4).rollers(4, 1.6, 18).flat(12); },
  },
  {
    id: 'big-kicker', title: 'Big kicker', tier: 2, style: true, required: false, entry: [6, HC], exit: [15, HC], airtime: 1.2, receiving: 'downslope', cpSpeed: 11,
    // Steep lip and a long landing: one flip is comfortable, a second rotation still finishes.
    build: (b, d) => { b.flat(4).railSlope(44, -(13 + 3 * d)).flat(8).crest(4.6 + 0.5 * d, 8, 7.4, 28).flat(4).rollers(1, 0.55, 18).flat(6); },
  },
  {
    id: 'double-pop', title: 'Double crest', tier: 2, style: true, required: false, entry: [6, HC], exit: [12, HC], airtime: 0.7, receiving: 'downslope', cpSpeed: 11,
    build: (b) => { b.flat(4).railSlope(36, -9).flat(4).crest(1.8, 9, 1.6, 14).flat(12).crest(2.0, 10, 2.2, 16).flat(12); },
  },
  {
    id: 'high-line', title: 'High line', tier: 2, style: true, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.55, receiving: 'flat', cpSpeed: 12,
    build: (b, _d, r) => {
      // a street ramp feeds the line, then the street returns to flat under it (gentle enough not to crest-pop)
      const dresses = ['wash', 'balcony', 'gutter', 'bunting'] as const;
      b.flat(14).kicker(16, 1).slope(12, -1, easeOut);
      const x0 = b.cur().x, len = 22;
      b.flat(len + 6).highLine(x0, len, 1.12, 0.96, dresses[Math.floor(r() * dresses.length)]).flat(8).crest(1.6, 9, 1.6, 14).flat(14);
    },
  },
  // optional wall rides: a chance about every 150-250 m. The street stays continuous except the death gaps
  // (rail-gap, wall-over, wall-gap, death-gauntlet), which the assembler spaces out after the teaching stretch.
  {
    id: 'wall-tap', title: 'Short wall tap', tier: 1, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.35, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(14);
      const x = b.cur().x, y = b.cur().y;
      b.flat(22);
      b.wall({ x0: x + 6, x1: x + 14, yBottom: y - 0.4, yTop: y + 3.6, side: 'right', lateral: 2.4, required: false, trailY: y + 1.5 });
      b.flat(12);
    },
  },
  {
    id: 'wall-long', title: 'Long wall ride', tier: 2, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.4, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(12);
      const x = b.cur().x, y = b.cur().y;
      b.flat(40);
      b.wall({ x0: x + 4, x1: x + 28, yBottom: y - 0.4, yTop: y + 3.8, side: 'right', lateral: 2.4, required: false, trailY: y + 1.5, purple: true });
      b.flat(12);
    },
  },
  {
    id: 'wall-transfer', title: 'Wall to wall', tier: 2, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.45, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(12);
      const x = b.cur().x, y = b.cur().y;
      b.flat(44);
      b.wall({ x0: x + 4, x1: x + 16, yBottom: y - 0.4, yTop: y + 3.6, side: 'right', lateral: 2.4, required: false, trailY: y + 1.5 });
      b.wall({ x0: x + 19, x1: x + 33, yBottom: y - 0.4, yTop: y + 3.6, side: 'right', lateral: 2.4, required: false, trailY: y + 1.5, purple: true });
      b.flat(12);
    },
  },
  {
    id: 'wall-line', title: 'Wall into a washing line', tier: 2, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.5, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(12);
      const x = b.cur().x, y = b.cur().y;
      b.flat(48);
      b.wall({ x0: x + 4, x1: x + 16, yBottom: y - 0.4, yTop: y + 3.6, side: 'right', lateral: 2.4, required: false, trailY: y + 1.5 });
      b.lineDress(x + 15, 16, 1.05, 'wash');
      b.flat(12);
    },
  },
  // ------------------------------------------------------------------ activities (optional: the street under each one still carries a lazy rider)
  {
    id: 'wash-line', title: 'Washing line', tier: 2, style: false, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.7, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(14).kicker(10, 1.6);
      const lip = b.cur();
      b.slope(16, -1.6, easeOut).flat(22);
      b.washLine(lip.x + 1.2, 16, lip.y + 2.05);
      b.flat(12);
    },
  },
  {
    id: 'swing-hook', title: 'Rope swing', tier: 2, style: false, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.6, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(16);
      const y = b.cur().y, ax = b.cur().x + 16;
      b.flat(42);
      b.swingAt(ax, y + 4.35, 3.0, 1.75, 'lamp');
      b.flat(12);
    },
  },
  {
    id: 'updraft', title: 'Updraft', tier: 2, style: false, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.9, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(22);
      const x = b.cur().x, y = b.cur().y;
      b.kicker(8, 0.75).flat(42);
      b.column({ x0: x + 6, x1: x + 16, y0: y + 1.6, y1: y + 10, lift: TUNING.tricks.updraftLift, corridorX1: x + 42, source: 'chimney', lateral: 3.6 });
      b.flat(12);
    },
  },
  {
    id: 'bounce', title: 'Bounce', tier: 2, style: false, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.55, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(16);
      const y = b.cur().y, x = b.cur().x + 8;
      b.flat(40);
      for (let i = 0; i < 4; i++) b.bouncePad({ x: x + i * 4.4, y: y + 1.05, half: 0.7, lateral: 2.25, kind: 'balloon' });
      b.flat(14);
    },
  },
  {
    id: 'awning', title: 'Awning hop', tier: 2, style: false, required: false, entry: [8, HC], exit: [8, HC], airtime: 0.7, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(12).kicker(9, 1.5);
      const lip = b.cur();
      b.slope(12, -1.2, easeOut).flat(26);
      // Pads sit where a jump off this lip is coming back down, and still clear 2.6 m over the street.
      // Four in a row: the first stays 5.4 m past the lip so the autopilot's lead still meets it.
      for (let i = 0; i < 4; i++) b.bouncePad({ x: lip.x + 5.4 + i * 4.0, y: lip.y + 2.05, half: 1.35, lateral: 0.35, kind: 'awning' });
      b.flat(12);
    },
  },
  // ------------------------------------------------------------------ compulsory actions
  {
    id: 'hop', title: 'Hop the gap', tier: 1, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0.5, receiving: 'broad', cpSpeed: 12,
    build: (b, d) => { b.flat(4).runIn().slope(46, 2, linear); b.gap(5 + 1.2 * d, -0.4); b.slope(12, -0.8, easeOut).flat(16); },
  },
  {
    id: 'pot', title: 'Pot', tier: 1, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.4, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).runIn().slope(46, 2, linear); b.pot(b.cur().x); b.flat(16); },
  },
  {
    id: 'skim-pair', title: 'Heel-skim pair', tier: 2, style: false, required: true, entry: [8, HC], exit: [12, HC], airtime: 0.4, receiving: 'downslope', cpSpeed: 14,
    build: (b) => { b.flat(4).runIn().slope(46, 2, linear); const x = b.cur().x; b.flat(8); b.pot(x); b.pot(x + 4, true); b.railSlope(30, -5).flat(10); },
  },
  {
    id: 'pot-pillar', title: 'Pot → pillar', tier: 2, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.5, receiving: 'flat', cpSpeed: 14,
    build: (b, d) => { b.flat(4).runIn().slope(46, 2, linear); const x = b.cur().x; b.flat(lerp(36, 31, d)); b.pot(x); b.pillar(b.cur().x); b.flat(14); },
  },
  {
    id: 'stepdowns', title: 'Step-down gaps', tier: 2, style: false, required: true, entry: [8, HC], exit: [9, HC], airtime: 0.6, receiving: 'broad', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear);
      b.gap(5 + d, -1.2); b.slope(10, -0.6, easeOut).flat(lerp(36, 30, d));
      b.gap(6 + d, -1.4); b.slope(10, -0.6, easeOut).flat(24);
    },
  },
  {
    id: 'ramp-flip', title: 'Ramp → flip → broad landing', tier: 2, style: false, required: true, entry: [8, HC], exit: [13, HC], airtime: 1.0, receiving: 'broad', cpSpeed: 13,
    build: (b, d) => { b.flat(4).runIn().railSlope(36, -8).flat(8).kicker(10, 2.4); b.gap(7 + 2 * d, -1.8); b.slope(16, -2.2, easeOut).flat(24); },
  },
  {
    id: 'rail-launch', title: 'Jump → optional rail → launch', tier: 2, style: true, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.6, receiving: 'downslope', cpSpeed: 13,
    build: (b) => {
      b.flat(4).runIn().slope(46, 2, linear); b.gap(5, -0.3); b.slope(10, -0.6, easeOut).flat(6);
      const x = b.cur().x, y = b.cur().y;
      b.flat(30); b.rail(x, 22, y + 0.95, y + 0.6, 1.2, false);
      b.crest(1.6, 9, 1.6, 14).flat(22);
    },
  },
  {
    id: 'rail-gap-early', title: 'Rail over a gap', tier: 1, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'broad', cpSpeed: 14,
    build: (b, d) => buildRailGap(b, d),
  },
  {
    id: 'rail-gap', title: 'Rail over a gap', tier: 2, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'broad', cpSpeed: 14,
    build: (b, d) => buildRailGap(b, d),
  },
  {
    id: 'wall-over', title: 'Wall ride over a gap', tier: 2, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'broad', cpSpeed: 12,
    build: (b) => {
      b.flat(4).runIn().railSlope(44, -12).flat(8).kicker(10, 1.2);
      const len = 36; // past a hard-cap jump off this kicker
      const lip = b.gap(len, -0.4, 'wall');
      b.wall({ x0: lip.x - 4, x1: lip.x + len + 4, yBottom: lip.y - 4.5, yTop: lip.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(18);
    },
  },
  {
    id: 'wall-gap', title: 'Compression → wall ride → receiving climb', tier: 3, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'climb', cpSpeed: 12,
    build: (b, d) => {
      b.flat(4).runIn().railSlope(44, -12).flat(8).kicker(10, 1.2);
      const len = 36 + 4 * d;
      const lip = b.gap(len, -0.4, 'wall');
      b.wall({ x0: lip.x - 4, x1: lip.x + len + 4, yBottom: lip.y - 4.5, yTop: lip.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(8).slope(26, 2.5).flat(10);
    },
  },
  {
    id: 'death-gauntlet', title: 'Gap, rail, wall, rail', tier: 3, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'broad', cpSpeed: 14,
    build: (b) => {
      // Rail, then a wall ride, then a rail. Each hole is past a jump. Piers are long enough to re-jump.
      b.flat(4).runIn().railSlope(44, -12).flat(6);
      const y1 = b.cur().y;
      const lip1 = b.gap(26, -0.5, 'rail');
      b.rail(lip1.x - 3, 34, y1 + 1.0, y1 + 0.2, 0, true, y1 + 0.55);
      b.flat(20).kicker(10, 1.2);
      const lip2 = b.gap(36, -0.4, 'wall');
      b.wall({ x0: lip2.x - 4, x1: lip2.x + 40, yBottom: lip2.y - 4.5, yTop: lip2.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(30);
      const y3 = b.cur().y;
      const lip3 = b.gap(26, -0.45, 'rail');
      b.rail(lip3.x - 3, 34, y3 + 1.0, y3 + 0.25, 0, true, y3 + 0.55);
      b.flat(14);
    },
  },
  {
    id: 'ramp-pillar', title: 'Big jump → pillar', tier: 3, style: false, required: true, entry: [8, HC], exit: [12, HC], airtime: 1.0, receiving: 'broad', cpSpeed: 13,
    build: (b) => {
      b.flat(4).runIn().railSlope(36, -8).flat(8).kicker(10, 2.4);
      const lip = b.gap(8, -1.8); b.slope(16, -2.2, easeOut).flat(46);
      b.pillar(lip.x + 8 + 30); b.flat(10);
    },
  },
  {
    id: 'crest-pillar', title: 'Crest flip → pillar', tier: 3, style: true, required: true, entry: [6, HC], exit: [12, HC], airtime: 0.9, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(4).railSlope(40, -10).flat(6).crest(2.2, 10, 2.2, 18).runIn().flat(46);
      b.pillar(b.cur().x); b.flat(20);
    },
  },
  {
    id: 'gap-pillar', title: 'Pot → gap → pillar', tier: 3, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.5, receiving: 'flat', cpSpeed: 14,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear); b.pot(b.cur().x); b.flat(lerp(46, 40, d));
      const lip = b.gap(5.5, -0.5); b.slope(10, -0.8, easeOut).flat(46);
      b.pillar(lip.x + 5.5 + 30); b.flat(14);
    },
  },
];

/** Net height change of a phrase (m), measured from a build at mid difficulty. */
const netCache = new Map<string, number>();
export function netDrop(p: PhraseSpec): number {
  let v = netCache.get(p.id);
  if (v === undefined) { const b = buildPhrase(p, 0, 0, 0.5, () => 0.5); const c = b.chains[b.chains.length - 1].points; v = c[c.length - 1].y; netCache.set(p.id, v); }
  return v;
}

/**
 * Variable-length calm run-up (flat, with gentle rollers once it is long enough): pads the route
 * so a set piece starts right at its wave's peak instead of drifting into the build or spilling
 * past the peak. A connector like `recovery` (same entry/exit), never compulsory.
 */
function runwaySpec(len: number): PhraseSpec {
  return {
    id: 'runway', title: 'Run-up', tier: 0, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => {
      const n = len >= 26 ? Math.max(1, Math.round(len / 32)) : 0;
      if (n) { const a = (len - 22 * n) / 2; b.flat(a).rollers(n, 0.7, 22).flat(a); } else if (len >= 8) b.flat(2).rollers(1, Math.min(0.4, 0.018 * (len - 4)), len - 4).flat(2); else b.flat(len);
    },
  };
}
/** Shortest run-up the assembler inserts (m). */
const MIN_RUNWAY = 4;
/** A connector with `extra` m of calm run-up (as a runway) in front: same id, entry and exit, just longer. */
function paddedSpec(spec: PhraseSpec, extra: number): PhraseSpec {
  const lead = runwaySpec(extra);
  return { ...spec, build: (b, d, r) => { lead.build(b, d, r); spec.build(b, d, r); } };
}

export const SPEC = Object.fromEntries([...PHRASES, runwaySpec(40), ...SET_PIECES].map((p) => [p.id, p])) as Record<string, PhraseSpec>;
const CONNECTORS = new Set(['start', 'boost', 'bleed', 'recovery', 'climb', 'gate', 'runway']);

/** Length of a phrase built at difficulty d (m). Phrases ignore their RNG for geometry, so this is exact. */
function measureLength(spec: PhraseSpec, d: number): number {
  const b = buildPhrase(spec, 0, 0, d, () => 0.5);
  const c = b.chains[b.chains.length - 1].points;
  return c[c.length - 1].x;
}
/** Per spec: lengths at d = 0 and 1 when the length is affine in d (every authored phrase lerps), else null. */
const lengthCache = new Map<string, [number, number] | null>();
function phraseLength(spec: PhraseSpec, d: number): number {
  if (spec.id === 'runway' || SPEC[spec.id] !== spec) return measureLength(spec, d); // one-off (padded) lengths
  let e = lengthCache.get(spec.id);
  if (e === undefined) {
    const a = measureLength(spec, 0), b = measureLength(spec, 1), m = measureLength(spec, 0.37);
    e = Math.abs(a + (b - a) * 0.37 - m) < 1e-9 ? [a, b] : null;
    lengthCache.set(spec.id, e);
  }
  return e ? e[0] + (e[1] - e[0]) * d : measureLength(spec, d);
}
export const LIBRARY = PHRASES.filter((p) => !CONNECTORS.has(p.id));
export { SET_PIECES };

/** Highest tier allowed at difficulty d. */
export function maxTier(d: number): Tier { return d >= 0.35 ? 3 : d >= 0.1 ? 2 : 1; }
/** Longest run of consecutive compulsory phrases allowed at difficulty d (longer combinations later). */
export function maxRequiredRun(d: number): number { return d >= 0.35 ? 3 : d >= 0.15 ? 2 : 1; }

/**
 * Neighbour validation: can `b` follow `a` directly, or which connector is needed?
 * Speed: a's likely exit range must reach b's entry range (else boost / bleed).
 * Flow: a compulsory phrase after a run of compulsory phrases needs a recovery.
 * Height: keeps the route within a band so it doesn't drift forever downward.
 */
export function connectorFor(a: PhraseSpec, b: PhraseSpec, ctx: { requiredRun: number; d: number; y: number; y0: number }): string | null {
  // The same hole twice in a row reads as a seam, so a recovery gives the next one its own approach.
  if (isDeath(a.id) && a.id === b.id) return 'recovery';
  // Two different holes share a landing until the compulsory run is full; then a recovery, same as any
  // other required phrase. The climb still leads into the first hole once the route has dropped.
  const deathChain = isDeath(a.id) && isDeath(b.id);
  if (b.required && ctx.requiredRun >= maxRequiredRun(ctx.d)) return 'recovery';
  if (!deathChain && ctx.y < ctx.y0 - 160 && a.id !== 'climb' && a.id !== 'boost' && netDrop(b) < 0) return 'climb';
  if (a.exit[0] < b.entry[0]) return 'boost';
  if (a.exit[1] > b.entry[1] + 0.01) return 'bleed';
  return null;
}

interface Plan { spec: PhraseSpec; d: number; connector: boolean; zone: string; wave: WaveInfo; setPiece?: boolean; gate?: { from: string; to: string } }

/** Lookahead (m) beyond which a phrase can't reach a wave's peak / breather start, so its length needn't be measured. */
const FIT_HORIZON = 900;

/**
 * Seeded phrase sequencer. Phrase i depends only on (seed, i, history): `x`/`y` passed to next()
 * are where the already-assembled route ends, itself a function of the history.
 *
 * Wave placement (see waves.ts):
 *  - each wave gets at most one set piece, which starts at or after the wave's peakAt and ends at
 *    or before its breatherAt. It is picked at the start of the wave's build; build phrases are
 *    only chosen while there is still room for it (plus its run-in recovery and speed connectors)
 *    before the peak, and whatever is left is padded with calm run-up (the first lead-in connector
 *    is lengthened, or a `runway` chunk goes in) so it starts right at the peak.
 *    If it can't fit, the wave goes without one (never spilling into the breather);
 *  - no compulsory phrase or set piece ends inside a breather: breathers hold only style air and
 *    connectors.
 */
export class Assembler {
  private index = 0;
  private history: PhraseSpec[] = [];
  private requiredRun = 0;
  private queue: Plan[] = [];
  /** Zone span the route is in, the last wave whose set piece was decided, and that decision. */
  private span = 0;
  private spWave = -1;
  private spPlan: { wave: number; sp: SetPieceSpec; d: number } | null = null;
  private lastSetPiece = '';
  /** Route distance where the last wall-ride phrase was committed. */
  private lastWallX = 0;
  /** Route distance where the last death-gap phrase started. */
  private lastDeathX = -1e9;
  /** Wave index the death count belongs to, how many holes that wave has committed, and the last gauntlet. */
  private deathWave = -999;
  private deathsInWave = 0;
  private lastGauntletX = -1e9;
  /** Id of the last death phrase, so the next hole can be a different one (no recovery between them). */
  private lastDeathId = '';
  constructor(readonly seed: number, private script?: { ids: string[]; d: number }, readonly zones: ZoneSequence = new ZoneSequence(['town'])) {}

  private rng(i: number): () => number { return mulberry32((this.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0); }

  private weightOf(zone: Zone, id: string): number { return zone.weights?.[id] ?? 1; }

  /** Connectors the pair (a -> spec) needs, `a` having closed a run of `run` compulsory phrases. */
  private connectorsFrom(a: PhraseSpec, run: number, spec: PhraseSpec, d: number, y: number, y0: number, forceRecovery = false): PhraseSpec[] {
    const chain: PhraseSpec[] = [];
    if (forceRecovery && a.required) { chain.push(SPEC.recovery); a = SPEC.recovery; run = 0; }
    for (let k = 0; k < 3; k++) {
      const c = connectorFor(a, spec, { requiredRun: run, d, y, y0 });
      if (!c || chain.some((q) => q.id === c)) break;
      chain.push(SPEC[c]); a = SPEC[c]; run = 0;
    }
    return chain;
  }

  /** Connectors needed before `spec` after whatever is queued (or the history). */
  private connectorChain(spec: PhraseSpec, d: number, y: number, y0: number, forceRecovery = false): PhraseSpec[] {
    const a = this.queue.length ? this.queue[this.queue.length - 1].spec : this.history[this.history.length - 1], run = this.queue.length ? 0 : this.requiredRun;
    return this.connectorsFrom(a, run, spec, d, y, y0, forceRecovery);
  }

  private static lengthOf(specs: PhraseSpec[], d: number): number { let L = 0; for (const p of specs) L += phraseLength(p, d); return L; }

  /** Queue `spec` after whatever connectors the pair (prev -> spec) needs. */
  private enqueueWithConnectors(spec: PhraseSpec, base: Omit<Plan, 'spec' | 'connector'>, y: number, y0: number, forceRecovery = false, connectorZone = base.zone): void {
    for (const c of this.connectorChain(spec, base.d, y, y0, forceRecovery)) this.queue.push({ ...base, zone: connectorZone, spec: c, connector: true, setPiece: undefined, gate: undefined });
    this.queue.push({ ...base, spec, connector: !!base.gate });
  }

  /**
   * Connectors that lead from `a` into the set piece: what the pair needs (a recovery after a
   * compulsory phrase, speed, height), or, when it needs none, what a calm runway in between
   * would need (so whatever pads the route still delivers the rider at the set piece's entry speed).
   */
  private leadIn(a: PhraseSpec, run: number, plan: { sp: SetPieceSpec; d: number }, y: number, y0: number, padding: boolean): PhraseSpec[] {
    const chain = this.connectorsFrom(a, run, plan.sp, plan.d, y, y0, true);
    return chain.length || !padding ? chain : this.connectorsFrom(SPEC.runway, 0, plan.sp, plan.d, y, y0);
  }

  /** Room a set piece needs right after phrase `p`. */
  private setPieceReserve(p: PhraseSpec, plan: { sp: SetPieceSpec; d: number }, y: number, y0: number): number {
    return Assembler.lengthOf(this.leadIn(p, p.required ? this.requiredRun + 1 : 0, plan, y, y0, true), plan.d);
  }

  /**
   * A short wall ride in front of the set piece when the last wall is far enough behind that the
   * set piece's own wall would open a gap past the town cadence. Only if the set piece still ends
   * before the breather.
   */
  private offerWallBeforeSetPiece(plan: { sp: SetPieceSpec; d: number }, x: number, y: number, y0: number, wave: WaveInfo, zone: Zone): boolean {
    if (x - this.lastWallX < 280 || !zone.phrases.includes('wall-tap')) return false;
    const tap = SPEC['wall-tap'];
    const span = Assembler.lengthOf([...this.connectorChain(tap, plan.d, y, y0), tap], plan.d);
    if (x + span >= wave.breatherAt) return false;
    const lead = this.leadIn(tap, 0, plan, y + netDrop(tap), y0, true);
    if (x + span + Assembler.lengthOf(lead, plan.d) + phraseLength(plan.sp, plan.d) > wave.breatherAt + 1e-6) return false;
    this.enqueueWithConnectors(tap, { d: plan.d, zone: zone.id, wave }, y, y0);
    return true;
  }

  /**
   * Queue the wave's set piece so it starts at or after the peak and ends by the breather. If its
   * lead-in doesn't reach the peak, the first connector is lengthened by a calm run-up (or, with
   * no connector due, a runway chunk pads the route). Returns false (nothing queued) if it can't
   * end before the breather.
   */
  private scheduleSetPiece(plan: { sp: SetPieceSpec; d: number }, x: number, y: number, y0: number, wave: WaveInfo, zone: Zone): boolean {
    const a = this.history[this.history.length - 1];
    let chain = this.leadIn(a, this.requiredRun, plan, y, y0, false);
    let L = Assembler.lengthOf(chain, plan.d);
    if (x + L < wave.peakAt) {
      chain = this.leadIn(a, this.requiredRun, plan, y, y0, true);
      const pad = wave.peakAt - x - Assembler.lengthOf(chain, plan.d) + 1e-6;
      if (pad > 0) chain = chain.length ? [paddedSpec(chain[0], Math.max(1, pad)), ...chain.slice(1)] : [runwaySpec(Math.max(MIN_RUNWAY, pad))];
      L = Assembler.lengthOf(chain, plan.d);
    }
    if (x + L + phraseLength(plan.sp, plan.d) > wave.breatherAt + 1e-6) return false;
    for (const c of chain) this.queue.push({ spec: c, d: plan.d, connector: true, zone: zone.id, wave });
    this.queue.push({ spec: plan.sp, d: plan.d, connector: false, zone: zone.id, wave, setPiece: true });
    this.spPlan = null;
    this.lastSetPiece = plan.sp.id;
    return true;
  }

  /**
   * Death holes live in the build (the peak is the set piece, the breather stays calm).
   * Two per wave through the first 1.7 km, then three. The second hole of an early wave waits
   * so it doesn't sit on the first; a gauntlet takes a later slot only when the holes still due
   * after it still fit. `wait` is how long a filler may run before the next hole is due.
   */
  private deathSlot(wave: WaveInfo, x: number, y: number, y0: number, d: number, pool: PhraseSpec[], prev: PhraseSpec, allowed: (p: PhraseSpec) => boolean, force = false): { phrases: PhraseSpec[] } | { wait: number } | null {
    if (wave.phase !== 'build' || wave.index < 0) return null;
    const have = this.deathWave === wave.index ? this.deathsInWave : 0;
    const want = wave.start >= 1700 ? 3 : 2;
    if (have >= want) return null;
    if (x < 300 && have === 0) return null;
    const room = wave.peakAt - x;
    const span = (p: PhraseSpec) => Assembler.lengthOf([...this.connectorChain(p, d, y, y0), p], d);
    // Early waves: hold the second hole past ~1.2 km on wave 1, and keep wave 0's pair from stacking.
    // Wave 1 holds its second hole so it doesn't sit on the first. Wave 0 has room for both
    // before the peak, and waiting there spends the only window the second hole has.
    const gap = !force && have >= 1 && wave.index === 1 ? 220 : 0;
    if (gap && x < this.lastDeathX + gap && this.lastDeathX + gap + (want - have) * 108 <= wave.peakAt + 8) {
      return { wait: Math.max(28, this.lastDeathX + gap + 12 - x) };
    }
    const gauntletDue = x >= 1400 && x - this.lastGauntletX >= 1100;
    const gauntlet = pool.find((p) => p.id === 'death-gauntlet');
    const gauntletSpan = gauntlet && gauntlet !== prev && allowed(gauntlet) ? span(gauntlet) : Infinity;
    // 72 m stays free at the end of the build so the set piece still gets its recovery before the peak.
    const tail = 72;
    const after = Math.max(0, want - have - 1) * 112;
    // The gauntlet replaces whatever holes were still owed: it is the last one, and it still leaves the set piece its recovery.
    if (gauntletDue && have >= 1 && gauntlet && gauntletSpan + tail <= room + 8) return { phrases: [gauntlet] };
    const follow = after + tail;
    // The rail may repeat once tier 2 is shut; a recovery is inserted so the two chunks are not adjacent.
    const fits = (p: PhraseSpec, keep: number) =>
      isDeath(p.id) && p.id !== 'death-gauntlet' && allowed(p) && span(p) <= room - keep + 8;
    let deaths = pool.filter((p) => fits(p, follow));
    // A later hole can be dropped. The set piece's recovery cannot: a hole that runs into that tail is skipped.
    if (!deaths.length && after > 0) deaths = pool.filter((p) => fits(p, tail));
    if (!deaths.length) return null;
    // Later holes are the harder tier, so the run's average difficulty still climbs.
    if (x >= 2200) {
      const hard = deaths.filter((p) => p.tier >= 2);
      if (hard.length) deaths = hard;
    }
    // The same hole twice needs a recovery between the chunks, and that recovery costs the third hole.
    const other = deaths.filter((p) => p.id !== this.lastDeathId);
    if (other.length) deaths = other;
    // Keep the first hole of a gauntlet wave short enough that the chain still fits after it.
    if (gauntletDue && have === 0 && Number.isFinite(gauntletSpan)) {
      const short = deaths.filter((p) => span(p) + gauntletSpan + tail <= room + 16);
      if (short.length) deaths = short;
    }
    const wallDue = x - this.lastWallX >= 188;
    // A wall that is already due becomes the wall over the gap, so the hole doesn't add an extra wall.
    if (wallDue) {
      const over = deaths.filter((p) => p.id === 'wall-over');
      if (over.length) return { phrases: over };
      const taller = deaths.filter((p) => p.id === 'wall-gap');
      if (taller.length) return { phrases: taller };
    }
    const rails = deaths.filter((p) => p.id === 'rail-gap' || p.id === 'rail-gap-early');
    // Before tier 2 is doing the work, keep the hole on the tier-1 rail so the opening kilometre stays teachable.
    if (x < 1000 && !wallDue) {
      const easy = rails.filter((p) => p.tier <= 1);
      if (easy.length) return { phrases: easy };
    }
    // Rail, then a wall over the next gap, then a rail: three different holes fit in one build.
    if (x >= 1000 && (this.lastDeathId === 'rail-gap' || this.lastDeathId === 'rail-gap-early')) {
      const over = deaths.filter((p) => p.id === 'wall-over');
      if (over.length) return { phrases: over };
    }
    return { phrases: rails.length ? rails : deaths };
  }

  /** Next phrase to build, given where the route currently ends (x = distance from the start). */
  next(x: number, y: number, y0: number): Plan {
    const wave = waveAt(x);
    if (this.queue.length) {
      const protect = this.queue.some((q) => q.setPiece || !!q.gate || isDeath(q.spec.id));
      // A filler chosen before the hole was due would run past it. Phrase length alone (no connectors)
      // is the test: the queue is still in the way, so the real span is decided on the next pass.
      if (!protect && wave.phase === 'build' && x >= 300) {
        const have = this.deathWave === wave.index ? this.deathsInWave : 0;
        const want = wave.start >= 1700 ? 3 : 2;
        if (have < want && x + phraseLength(SPEC['rail-gap'], wave.d) <= wave.peakAt + 8) this.queue.length = 0;
      }
      if (this.queue.length) {
        const queued = this.queue.shift()!;
        this.notePhrase(queued.spec.id, x);
        return this.commit(queued);
      }
    }
    const i = this.index;
    const zone = this.zones.zoneAt(x);
    if (this.script) { // tests: a fixed phrase list, then calm recovery forever
      const id = this.script.ids[i] ?? 'recovery';
      return this.commit({ spec: SPEC[id], d: this.script.d, connector: CONNECTORS.has(id), zone: zone.id, wave, setPiece: id.startsWith('sp-') });
    }
    if (i === 0) return this.commit({ spec: SPEC.start, d: 0, connector: true, zone: zone.id, wave });
    const d = wave.d;
    const r = this.rng(i);
    // zone change: a gate chunk first (zones change at the end of a wave, in the breather)
    const span = this.zones.spanAt(x);
    if (span !== this.span) {
      const from = this.zones.zones[this.span % this.zones.zones.length].id;
      this.span = span;
      if (from !== zone.id) { this.enqueueWithConnectors(SPEC.gate, { d, zone: zone.id, wave, gate: { from, to: zone.id } }, y, y0, true, from); return this.commit(this.queue.shift()!); }
    }
    // wave peak: one hand-authored set piece per wave, decided as the wave's build begins
    const live = wave.index >= 0 && (wave.phase === 'build' || wave.phase === 'peak');
    if (this.spPlan && this.spPlan.wave !== wave.index) this.spPlan = null;
    if (live && this.spWave < wave.index) {
      this.spWave = wave.index;
      const pd = Math.max(d, waveAt(wave.peakAt).d); // a set piece is built at the wave's peak difficulty
      const room = wave.breatherAt - wave.peakAt - MIN_RUNWAY;
      const sps = zone.setPieces.map((id) => SPEC[id] as SetPieceSpec)
        .filter((p) => p && p.minWave <= wave.index && p.tier <= maxTier(waveAt(wave.peakAt).d) && p.id !== this.lastSetPiece && phraseLength(p, pd) <= room);
      if (sps.length) {
        const w = sps.map((p) => this.weightOf(zone, p.id) * (p.minWave === wave.index ? 1.5 : 1) * (y < y0 - 100 && netDrop(p) < -12 ? 0.4 : 1)); // deep: fewer big drops
        let pick = r() * w.reduce((a, b) => a + b, 0), sp = sps[sps.length - 1];
        for (let k = 0; k < sps.length; k++) { pick -= w[k]; if (pick <= 0) { sp = sps[k]; break; } }
        this.spPlan = { wave: wave.index, sp, d: pd };
      }
    }
    const plan = live ? this.spPlan : null;
    if (plan && wave.phase === 'peak') { // already at the peak (a long phrase carried the route here): now or never
      if (this.scheduleSetPiece(plan, x, y, y0, wave, zone)) return this.commit(this.queue.shift()!);
      this.spPlan = null;
    }
    const pending = plan && wave.phase === 'build' ? this.spPlan : null;
    const recent = this.history.slice(-3).map((p) => p.id);
    const tier = maxTier(d);
    const breather = wave.phase === 'breather' || wave.phase === 'warmup';
    const pool = zone.phrases.map((id) => SPEC[id]).filter((p) => p && !CONNECTORS.has(p.id));
    const allowed = (p: PhraseSpec) => p.tier <= tier && (!breather || (!p.required && p.tier <= 2));
    // room: compulsory phrases end before the breather; build phrases leave room for the set piece before the peak
    const fits = (p: PhraseSpec, peakRoom: boolean): boolean => {
      const checkBreather = p.required && !breather && x + FIT_HORIZON > wave.breatherAt;
      const checkPeak = peakRoom && !!pending && x + FIT_HORIZON > wave.peakAt;
      if (!checkBreather && !checkPeak) return true;
      const chain = [...this.connectorChain(p, d, y, y0), p];
      const end = x + Assembler.lengthOf(chain, d);
      if (checkBreather && end > wave.breatherAt) return false;
      // (the set piece's connectors are judged from the height the route will be at after p: a climb may be due)
      if (checkPeak && end + this.setPieceReserve(p, pending!, chain.reduce((h, q) => h + netDrop(q), y), y0) > wave.peakAt) return false;
      return true;
    };
    const prev = this.history[this.history.length - 1];
    const choose = (peakRoom: boolean) => {
      const ok = pool.filter((p) => p !== prev && allowed(p) && fits(p, peakRoom));
      const fresh = ok.filter((p) => !recent.includes(p.id));
      return fresh.length ? fresh : ok;
    };
    let cands = choose(true);
    const slotNow = (force = false) => this.deathSlot(wave, x, y, y0, d, pool, prev, allowed, force);
    if (pending && !cands.length) { // nothing else fits before the peak: the set piece goes in now, unless a death hole is still owed
      if (!slotNow() && this.offerWallBeforeSetPiece(pending, x, y, y0, wave, zone)) {
        const first = this.queue.shift()!;
        this.notePhrase(first.spec.id, x);
        return this.commit(first);
      }
      if (!slotNow() && this.scheduleSetPiece(pending, x, y, y0, wave, zone)) return this.commit(this.queue.shift()!);
      if (!slotNow()) this.spPlan = null;
      cands = choose(false);
    }
    if (!cands.length) cands = pool.filter((p) => p !== prev && !p.required && p.tier <= tier);
    if (!cands.length) cands = [SPEC.recovery];
    const topTier = Math.max(...cands.map((p) => p.tier));
    const tier3open = cands.some((p) => p.tier === 3);
    // Space wall rides: dampen a second one immediately, and pull one forward once a couple of phrases have had none.
    // The pull prefers a wall of the hardest tier that actually fits, so a due ride doesn't flatten the later waves.
    let sinceWall = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (isWallRide(this.history[i].id)) break;
      sinceWall++;
    }
    // Holes are placed as soon as one fits before the peak. Before 300 m, and while a hole is
    // waiting out its gap, keep the next phrase short enough that the slot is not skipped.
    let slot = slotNow();
    let deathDue = !!slot && 'phrases' in slot;
    if (deathDue && slot && 'phrases' in slot) cands = slot.phrases;
    else {
      const calm = cands.filter((p) => !isDeath(p.id));
      if (calm.length) cands = calm;
      const span = (p: PhraseSpec) => Assembler.lengthOf([...this.connectorChain(p, d, y, y0), p], d);
      const cap = (budget: number) => {
        if (budget <= 24) return false;
        const short = cands.filter((p) => span(p) <= budget);
        if (!short.length) return false;
        cands = short;
        return true;
      };
      if (slot && 'wait' in slot && !cap(slot.wait)) {
        const forced = slotNow(true);
        if (forced && 'phrases' in forced) { cands = forced.phrases; deathDue = true; slot = forced; }
      }
      // Once this wave's holes are in, don't run a phrase into the peak: the set piece needs the whole of it.
      if (!deathDue && pending && wave.phase === 'build' && !cap(wave.peakAt + 4 - x)) {
        if (this.offerWallBeforeSetPiece(pending, x, y, y0, wave, zone)) {
          const first = this.queue.shift()!;
          this.notePhrase(first.spec.id, x);
          return this.commit(first);
        }
        if (this.scheduleSetPiece(pending, x, y, y0, wave, zone)) return this.commit(this.queue.shift()!);
        this.spPlan = null;
      }
      // A warmup or breather phrase that runs into the next build steals the holes' window.
      if (!deathDue && (wave.phase === 'warmup' || wave.phase === 'breather')) {
        const nextBuild = wave.phase === 'warmup' ? WAVE.first : wave.start + WAVE.length;
        if (!cap(nextBuild + 8 - x) && nextBuild - x >= MIN_RUNWAY) {
          return this.commit({ spec: runwaySpec(Math.max(MIN_RUNWAY, nextBuild - x)), d, connector: true, zone: zone.id, wave });
        }
      }
    }
    const wallDue = x - this.lastWallX >= 188;
    // Distance, not phrase count: a long set piece must not hide the next wall ride.
    if (!deathDue && wallDue) {
      const walls = cands.filter((p) => isWallRide(p.id));
      if (walls.length) cands = walls;
    }
    // The first hole starts at 300 m. A filler chosen just before that pushes it back far enough
    // that the wave's second hole no longer fits ahead of the set piece.
    if (!deathDue && wave.phase === 'build' && wave.index >= 0 && x < 300 && (this.deathWave !== wave.index || this.deathsInWave === 0)) {
      const budget = 300 - x;
      const span = (p: PhraseSpec) => Assembler.lengthOf([...this.connectorChain(p, d, y, y0), p], d);
      const short = budget >= 8 ? cands.filter((p) => span(p) <= budget) : [];
      if (short.length) cands = short;
      else if (budget >= 1) return this.commit({ spec: runwaySpec(Math.max(budget, 1)), d, connector: true, zone: zone.id, wave });
    }
    const w = cands.map((p) => {
      let k = p.style ? 1.3 : 1; // the user wants lots of hills/kickers to trick off (but also things to do: dense course)
      if (p.tier === topTier) k *= 1.6; // the hardest on offer (in breathers and peak tails: the bigger style air)
      if (p.tier === 3) k *= 1.25; // tier-3 phrases are long, so a chunk-average stays harder once they unlock
      if (wave.phase === 'peak' && p.required) k *= 1.5; // peaks: more compulsory chains
      if (p.required && this.requiredRun >= maxRequiredRun(d)) k *= 0.5;
      if (y < y0 - 100 && netDrop(p) < -6) k *= 0.6; // deep below the start: fewer big descents
      if (deathDue && isDeath(p.id)) {
        if (p.id === 'death-gauntlet') k *= 2.6;
        else if (p.id === 'rail-gap') k *= 1.7;
        else if (p.id === 'wall-over') k *= wallDue ? 2.4 : 1.4;
        else if (wallDue) k *= 1.6;
      }
      if (isWallRide(p.id)) {
        if (sinceWall === 0) k *= 0.35;
        else if (sinceWall >= 2) {
          const due = sinceWall >= 3 ? 7 : 4.5;
          // Once tier 3 fits, a due ride is the gap wall. Easier walls stay available, without crowding the hard phrases out.
          if (topTier >= 3 && tier3open) k *= p.tier === 3 ? due : (sinceWall >= 4 ? 3 : 1.2);
          else if (topTier <= 2 && p.id === 'wall-tap') k *= due;
          else if (p.tier >= 2) k *= due;
          else k *= 1.4;
        }
      }
      if (isPlay(p.id)) {
        let sincePlay = 0;
        for (let i = this.history.length - 1; i >= 0; i--) {
          if (isPlay(this.history[i].id)) break;
          sincePlay++;
        }
        if (sincePlay === 0) k *= 0.4;
        else if (sinceWall >= 2) k *= 0.55; // a wall ride is due; leave that slot for it
        else if (sincePlay >= 2 && !(topTier >= 3 && tier3open)) k *= sincePlay >= 3 ? 3.2 : 2.1;
        if (this.history.slice(-3).some((h) => h.id === p.id)) k *= 0.22;
      }
      return k * this.weightOf(zone, p.id);
    });
    let pick = r() * w.reduce((a, b) => a + b, 0), spec = cands[cands.length - 1];
    for (let k = 0; k < cands.length; k++) { pick -= w[k]; if (pick <= 0) { spec = cands[k]; break; } }
    this.enqueueWithConnectors(spec, { d, zone: zone.id, wave }, y, y0);
    const first = this.queue.shift()!;
    this.notePhrase(first.spec.id, x);
    return this.commit(first);
  }

  /** Remember when a wall ride or a death gap actually starts (not the connector in front of it). */
  private notePhrase(id: string, x: number): void {
    if (isWallRide(id)) this.lastWallX = x;
    if (isDeath(id)) {
      this.lastDeathX = x;
      const w = waveAt(x).index;
      if (w !== this.deathWave) { this.deathWave = w; this.deathsInWave = 0; }
      this.deathsInWave++;
      this.lastDeathId = id;
      if (id === 'death-gauntlet') this.lastGauntletX = x;
    }
  }

  private commit(p: Plan): Plan {
    this.index++;
    this.history.push(p.spec);
    if (this.history.length > 8) this.history.shift();
    this.requiredRun = p.spec.required ? this.requiredRun + (p.setPiece ? 99 : 1) : 0;
    return p;
  }

  get phraseIndex(): number { return this.index; }
  rngFor(i: number): () => number { return this.rng(i + 7919); }
}

/** Build one phrase's content starting at (x, y). */
export function buildPhrase(spec: PhraseSpec, x: number, y: number, d: number, r: () => number, material: Surface['material'] = 'stone'): PhraseBuilder {
  const b = new PhraseBuilder(x, y, material);
  spec.build(b, d, r);
  b.finish();
  return b;
}

export const STREAM = {
  /** Keep this much course generated ahead of the rider (m). */
  ahead: 700,
  /** Recycle phrases that end this far behind the rider (m). */
  behind: 160,
};

/**
 * Streamed endless course. Content is appended phrase by phrase as the rider
 * approaches and recycled behind them; ids are never reused.
 */
export class EndlessCourse extends Course {
  private asm: Assembler;
  private ids = { s: 0, r: 0, w: 0, o: 0, c: 0, h: 0, sw: 0, bo: 0, up: 0 };
  private endX = -10;
  private endY = 0;
  private lastSurface: Surface | null = null;
  private material: Surface['material'] = 'stone';
  /** Total chunks ever built / recycled (diagnostics, memory tests). */
  built = 0;
  recycled = 0;
  private nextTrailId = 1;
  /** No second gold trail starts before this x (breather after each line). */
  private rhythm = { quietUntil: 0 };
  /** Next mastery star may appear at or after this course x. */
  private nextRareX = { at: 0 };

  /** `x0` shifts the whole route (precision tests); `script` fixes the phrase list (tests). */
  constructor(seed: number, opts: { x0?: number; script?: string[]; d?: number; zones?: string[] } = {}) {
    super(seed, [], [], [], [], (opts.x0 ?? 0) + 2, Infinity);
    this.kind = 'endless';
    this.zones = new ZoneSequence(opts.zones ?? ['town']);
    this.asm = new Assembler(seed, opts.script ? { ids: opts.script, d: opts.d ?? 0.5 } : undefined, this.zones);
    this.endX = (opts.x0 ?? 0) - 10;
    this.originX = this.endX;
    const r0 = mulberry32(seed)();
    this.rhythm.quietUntil = this.endX + 12;
    this.nextRareX.at = this.endX + 160 + r0 * 80;
    this.generateTo(this.endX + STREAM.ahead);
  }
  /** Where the route begins (distance is measured from startX). */
  readonly originX: number;
  /** Zone order for this run (default: the town only). */
  readonly zones: ZoneSequence;

  private generateTo(x: number): void {
    while (this.endX < x) this.appendPhrase();
  }

  private appendPhrase(): void {
    const i = this.asm.phraseIndex;
    const plan = this.asm.next(this.endX - this.originX, this.endY, 0);
    const b = buildPhrase(plan.spec, this.endX, this.endY, plan.d, this.asm.rngFor(i), this.material);
    const O = TUNING.obstacles;
    const surfaces: Surface[] = b.chains.map((ch) => ({ id: this.ids.s++, kind: 'ground', points: ch.points, material: ch.material, thickness: ch.material === 'stone' ? 5 : 4 }));
    // seamless join onto the previous phrase
    if (this.lastSurface) { this.lastSurface.next = surfaces[0].id; surfaces[0].prev = this.lastSurface.id; }
    const rails: Rail[] = b.rails.map((q) => ({ id: this.ids.r++, ...q }));
    const rawWalls = b.walls.map((q) => ({ ...q }));
    // harbour walls read as warehouses and hulls; the town keeps the shop front
    if (plan.zone === 'harbour') for (const w of rawWalls) w.face = (w.x1 - w.x0) >= 16 ? 'warehouse' : 'hull';
    else for (const w of rawWalls) w.face ??= 'shop';
    const walls: Wall[] = rawWalls.map((q) => ({ id: this.ids.w++, ...q }));
    const ground = (x: number) => {
      for (const s of surfaces) if (x >= Course.x0(s) && x <= Course.x1(s)) return Course.sample(s, x).y;
      throw new Error(`no ground at ${x} in ${plan.spec.id}`);
    };
    const swings: Swing[] = b.swings.map((q) => {
      const s: Swing = { id: this.ids.sw++, ...q };
      if (plan.zone === 'harbour') {
        const street = ground(s.ax);
        s.anchor = 'crane';
        s.ay = street + 6.5;
        s.length = s.ay - (street + 1.35);
        s.lateral = 1.9;
      } else if ((Math.round(s.ax) & 1) === 0) s.anchor = 'sign';
      return s;
    });
    const bounces: Bounce[] = b.bounces.map((q) => {
      const pad: Bounce = { id: this.ids.bo++, ...q };
      if (plan.zone === 'harbour' && pad.kind === 'balloon') {
        pad.kind = 'boat';
        pad.y = ground(pad.x) + 0.42;
        pad.half = 1.05;
        pad.lateral = 2.05;
      }
      return pad;
    });
    const updrafts: Updraft[] = b.updrafts.map((q) => ({ id: this.ids.up++, ...q, source: plan.zone === 'harbour' ? 'vent' as const : q.source }));
    const obstacles: Obstacle[] = b.obstacles.map((q) => ({
      id: this.ids.o++, kind: q.kind, x: q.x, baseY: ground(q.x),
      halfWidth: q.kind === 'pot' ? O.potHalfWidth : O.pillarHalfWidth, height: q.kind === 'pot' ? O.potHeight : O.pillarHeight,
    }));
    const gaps: Gap[] = [];
    for (let k = 0; k + 1 < surfaces.length; k++) {
      const a = surfaces[k].points[surfaces[k].points.length - 1], c = surfaces[k + 1].points[0];
      const req = b.requires.find(([x]) => Math.abs(x - a.x) < 0.01)?.[1] ?? 'jump';
      gaps.push({ x0: a.x, x1: c.x, yTakeoff: a.y, yReceive: c.y, requires: req });
    }
    const last = surfaces[surfaces.length - 1];
    const end = last.points[last.points.length - 1];
    const trailPlacements: OrbPlacement[] = [];
    stampOrbTrails(trailPlacements, {
      phraseId: plan.spec.id,
      chunkX0: this.endX,
      chunkX1: end.x,
      setPiece: plan.setPiece,
      connector: plan.connector,
      breather: plan.wave.phase === 'breather',
      speed: plan.spec.cpSpeed || 13,
      surfaces,
      rails,
      walls,
      gaps,
      features: b.features,
      obstacles,
      yAt: ground,
      rng: this.asm.rngFor(i),
      nextTrailId: () => this.nextTrailId++,
      rhythm: this.rhythm,
      nextRareX: this.nextRareX,
    });
    const rides = activityRides(rails, swings, updrafts, bounces);
    for (const h of rides) addOrb(trailPlacements, 'rare', h.hardest.x, h.hardest.y, h.hardest.lateral, h.hardest.pickup);
    if (isDeath(plan.spec.id)) {
      const rareX = dressDeathOrbs(trailPlacements, rails, walls, plan.spec.id);
      if (rareX !== null) this.nextRareX.at = Math.max(this.nextRareX.at, rareX + 170);
    }
    const orbs: Orb[] = trailPlacements.map((q) => ({ id: this.ids.h++, ...q }));
    const chunk: Chunk = {
      id: this.ids.c++, x0: this.endX, x1: end.x, y0: this.endY, y1: end.y, title: plan.spec.title, spec: plan.spec.id, tier: plan.spec.tier,
      difficulty: plan.d, connector: plan.connector, zone: plan.zone, gate: plan.gate, setPiece: plan.setPiece, wave: this.waveLabel(this.endX), cpX: this.endX + 2, cpSpeed: plan.spec.cpSpeed, features: b.features,
      surfaces: surfaces.map((q) => q.id), rails: rails.map((q) => q.id), walls: walls.map((q) => q.id), obstacles: obstacles.map((q) => q.id), markers: [],
      orbs: orbs.map((q) => q.id),
      swings: swings.map((q) => q.id), bounces: bounces.map((q) => q.id), updrafts: updrafts.map((q) => q.id), rides,
    };
    this.addChunk(chunk, surfaces, rails, walls, obstacles, gaps, orbs, { swings, bounces, updrafts });
    this.lastSurface = last;
    this.material = last.material;
    this.endX = end.x; this.endY = end.y;
    this.built++;
  }

  override stream(x: number, active?: { surfaceId: number; railId: number; wallId: number; swingId?: number }): void {
    this.generateTo(x + STREAM.ahead);
    // recycle phrases safely behind the rider with no active contact
    while (this.chunks.length > 1) {
      const c = this.chunks[0];
      if (c.x1 > x - STREAM.behind) break;
      if (active && (c.surfaces.includes(active.surfaceId) || c.rails.includes(active.railId) || c.walls.includes(active.wallId) || (active.swingId !== undefined && (c.swings ?? []).includes(active.swingId)))) break;
      this.removeChunk(c);
      this.recycled++;
    }
  }

  /** The wave phase a chunk starting at course x really lies in (not the one it was assembled under). */
  private waveLabel(x: number): Chunk['wave'] { const w = waveAt(x - this.originX); return { index: w.index, phase: w.phase }; }

  /** Where the generated route currently ends. */
  get generatedTo(): number { return this.endX; }
}

export function buildEndlessCourse(seed: number, zones?: string[]): EndlessCourse { return new EndlessCourse(seed, { zones }); }
