/**
 * Course representation: pure data + geometric queries. No rendering, no physics.
 *
 * Gameplay is 2D: x = distance along the route (forward), y = surface height.
 * "lateral" is presentation-only depth (positive = to the rider's right, which the
 * camera sees as further away). Gameplay never reads lateral except to decide
 * which features are *available* (milestone 2 uses it for rail/wall context).
 */

import type { Orb } from './orbs';

export type { Orb, OrbPlacement, OrbTier, OrbPickup } from './orbs';

export interface Vec2 { x: number; y: number }

export type Material = 'cloud' | 'stone';

/** A continuous rideable ground chain. points have strictly increasing x.
 *  Chain ends are ledges: riding off an end makes the rider airborne. */
export interface Surface {
  id: number;
  kind: 'ground';
  points: Vec2[];
  material: Material;
  /** Visual thickness under the surface (presentation hint). */
  thickness: number;
  /** Seamless continuation: the id of a chain that starts exactly at this chain's last
   *  point (streamed phrases join this way). Riding off the end transfers onto it. */
  next?: number;
  /** The chain this one seamlessly continues (presentation: no end cap / edge line). */
  prev?: number;
}

/** Grind rail (milestone 2 mechanics). Geometry + metadata only for now. */
export interface Rail {
  id: number;
  points: Vec2[];
  /** Lateral offset of the rail from the route centre (m, + = right). */
  lateral: number;
  /** Compulsory rails bridge a gap; optional ones run alongside the ordinary route. */
  required: boolean;
  /**
   * Optional high line. The street stays continuous underneath (a grounded rider never leaves it).
   * An airborne rider between voidX0 and voidX1 falls through that street, so a mistimed attempt can fail.
   */
  risky?: boolean;
  voidX0?: number;
  voidX1?: number;
}

/** Rideable wall (milestone 2 mechanics). */
export interface Wall {
  id: number;
  x0: number;
  x1: number;
  yBottom: number;
  yTop: number;
  side: 'right';
  lateral: number;
  required: boolean;
}

/** An explicit gap between two ground chains. */
export interface Gap {
  x0: number; // takeoff edge (end of previous chain)
  x1: number; // receiving edge (start of next chain)
  yTakeoff: number;
  yReceive: number;
  /** What it takes to cross: a jump, a compulsory rail, or a compulsory wall ride. */
  requires: 'jump' | 'rail' | 'wall';
}

export interface Marker { x: number; label: string }

/** Breakable obstacle standing on the ground at x (brief §8). */
export interface Obstacle {
  id: number;
  kind: 'pot' | 'pillar';
  x: number;
  halfWidth: number;
  height: number;
  /** Ground height at x. */
  baseY: number;
}

/** Authored-course lesson: a checkpoint (retry point) plus its calm on-track prompt. */
export interface Lesson {
  id: number;
  title: string;
  /** Checkpoint: where a retry of this lesson starts, and the speed it starts with. */
  cpX: number;
  cpSpeed: number;
  /** Prompt shown while promptX0 <= x < promptX1. `keys` is the keyboard equivalent. */
  prompt: string;
  keys?: string;
  promptX0: number;
  promptX1: number;
  /** Where the lesson's key action is committed (takeoff / contact). */
  featureX: number;
  /** The lesson's action is compulsory (must be read before commitment). */
  required: boolean;
}

/** Something to do on the course (tests use these for spacing/approach checks). */
export interface Feature {
  x: number;
  kind: 'gap' | 'rail' | 'rail-optional' | 'rail-risky' | 'wall' | 'pot' | 'pillar' | 'crest' | 'rollers';
  required: boolean;
  /** Where the approach to this feature starts (run-in begins), for required features. */
  approachX?: number;
}

/**
 * A streamable piece of course: one authored phrase (endless) or the whole course
 * (lab / opening). Everything a chunk owns is added and recycled together.
 */
export interface Chunk {
  id: number;
  x0: number;
  x1: number;
  /** Ground height at x0 / x1 (phrases join seamlessly end to start). */
  y0: number;
  y1: number;
  title: string;
  /** Phrase spec id (endless), tier and difficulty when it was assembled. */
  spec?: string;
  tier?: number;
  difficulty?: number;
  connector?: boolean;
  /** Endless: zone this chunk belongs to, zone gate / set piece flags and the wave phase its start (x0) lies in. */
  zone?: string;
  gate?: { from: string; to: string };
  setPiece?: boolean;
  wave?: { index: number; phase: 'warmup' | 'build' | 'peak' | 'breather' };
  /** Checkpoint: a retry from this chunk starts here, rolling at cpSpeed. */
  cpX: number;
  cpSpeed: number;
  features: Feature[];
  surfaces: number[];
  rails: number[];
  walls: number[];
  obstacles: number[];
  markers: Marker[];
  /** Optional orbs owned by this chunk (endless). Recycled with it. */
  orbs?: number[];
}

export interface SurfaceSample {
  y: number;
  /** dy/dx of the segment under x. */
  slope: number;
  seg: number;
}

export class Course {
  readonly gaps: Gap[] = [];
  /** 'lab' (seeded test route), 'opening' (authored teaching course) or 'endless' (streamed phrases). */
  kind: 'lab' | 'opening' | 'endless' = 'lab';
  /** Streamable pieces, in x order. Static courses are one chunk. */
  readonly chunks: Chunk[] = [];
  /** Bumped whenever content is removed (the sim prunes state that refers to it). */
  revision = 0;
  private sById = new Map<number, Surface>();
  private rById = new Map<number, Rail>();
  private wById = new Map<number, Wall>();
  private oById = new Map<number, Obstacle>();
  private oOrbById = new Map<number, Orb>();
  /** Optional orbs currently streamed (endless). */
  readonly orbs: Orb[] = [];
  /** Presentation hint (opening only): route x where the harbour town (quay, sea on the right) begins. */
  harbourX?: number;
  /** Authored lessons in order (opening only). */
  lessons: Lesson[] = [];

  /** Index of the last lesson whose checkpoint is at or behind x (-1 if none). */
  lessonAt(x: number): number {
    let i = -1;
    for (let k = 0; k < this.lessons.length; k++) if (this.lessons[k].cpX <= x + 1e-6) i = k;
    return i;
  }

  constructor(
    readonly seed: number,
    readonly surfaces: Surface[],
    readonly rails: Rail[],
    readonly walls: Wall[],
    readonly markers: Marker[],
    readonly startX: number,
    readonly finishX: number,
    readonly obstacles: Obstacle[] = [],
  ) {
    for (const q of surfaces) this.sById.set(q.id, q);
    for (const q of rails) this.rById.set(q.id, q);
    for (const q of walls) this.wById.set(q.id, q);
    for (const q of obstacles) this.oById.set(q.id, q);
    const sorted = [...surfaces].sort((a, b) => a.points[0].x - b.points[0].x);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i].points[sorted[i].points.length - 1];
      const b = sorted[i + 1].points[0];
      if (b.x > a.x) this.gaps.push({ x0: a.x, x1: b.x, yTakeoff: a.y, yReceive: b.y, requires: 'jump' });
    }
    if (surfaces.length) this.sealAsSingleChunk('course');
  }

  surface(id: number): Surface {
    const s = this.sById.get(id);
    if (!s) throw new Error(`surface ${id} missing`);
    return s;
  }
  findSurface(id: number | undefined): Surface | undefined { return id === undefined ? undefined : this.sById.get(id); }
  rail(id: number): Rail { const r = this.rById.get(id); if (!r) throw new Error(`rail ${id} missing`); return r; }
  wall(id: number): Wall { const w = this.wById.get(id); if (!w) throw new Error(`wall ${id} missing`); return w; }
  obstacle(id: number): Obstacle | undefined { return this.oById.get(id); }
  orb(id: number): Orb | undefined { return this.oOrbById.get(id); }
  hasObstacle(id: number): boolean { return this.oById.has(id); }

  /** Static courses: one chunk owning everything (call after construction is complete). */
  sealAsSingleChunk(title: string): void {
    const ys = this.surfaces.flatMap((q) => q.points);
    const x0 = Math.min(...ys.map((p) => p.x)), x1 = Math.max(...ys.map((p) => p.x));
    this.chunks.length = 0;
    this.chunks.push({
      id: 0, x0, x1, y0: ys[0].y, y1: ys[ys.length - 1].y, title, cpX: this.startX, cpSpeed: 0, features: [],
      surfaces: this.surfaces.map((q) => q.id), rails: this.rails.map((q) => q.id), walls: this.walls.map((q) => q.id),
      obstacles: this.obstacles.map((q) => q.id), markers: [...this.markers],
    });
  }

  /** Streaming hook, called by the simulation at the start of every step with the
   *  rider's position and active contacts. Static courses do nothing. */
  stream(_x: number, _active?: { surfaceId: number; railId: number; wallId: number }): void {}

  /** Append a chunk's content (streamed courses). */
  protected addChunk(c: Chunk, surfaces: Surface[], rails: Rail[], walls: Wall[], obstacles: Obstacle[], gaps: Gap[], orbs: Orb[] = []): void {
    for (const q of surfaces) { this.surfaces.push(q); this.sById.set(q.id, q); }
    for (const q of rails) { this.rails.push(q); this.rById.set(q.id, q); }
    for (const q of walls) { this.walls.push(q); this.wById.set(q.id, q); }
    for (const q of obstacles) { this.obstacles.push(q); this.oById.set(q.id, q); }
    for (const q of orbs) { this.orbs.push(q); this.oOrbById.set(q.id, q); }
    this.gaps.push(...gaps);
    this.markers.push(...c.markers);
    this.chunks.push(c);
  }

  /** Recycle a chunk and everything it owns. */
  protected removeChunk(c: Chunk): void {
    const drop = <T extends { id: number }>(arr: T[], ids: number[], map: Map<number, T>) => {
      const set = new Set(ids);
      for (let i = arr.length - 1; i >= 0; i--) if (set.has(arr[i].id)) arr.splice(i, 1);
      for (const id of ids) map.delete(id);
    };
    drop(this.surfaces, c.surfaces, this.sById);
    drop(this.rails, c.rails, this.rById);
    drop(this.walls, c.walls, this.wById);
    drop(this.obstacles, c.obstacles, this.oById);
    if (c.orbs?.length) {
      const set = new Set(c.orbs);
      for (let i = this.orbs.length - 1; i >= 0; i--) if (set.has(this.orbs[i].id)) this.orbs.splice(i, 1);
      for (const id of c.orbs) this.oOrbById.delete(id);
    }
    for (let i = this.gaps.length - 1; i >= 0; i--) if (this.gaps[i].x0 >= c.x0 - 1e-6 && this.gaps[i].x0 <= c.x1 + 1e-6) this.gaps.splice(i, 1);
    for (let i = this.markers.length - 1; i >= 0; i--) if (c.markers.includes(this.markers[i])) this.markers.splice(i, 1);
    for (const s of this.surfaces) if (s.prev !== undefined && c.surfaces.includes(s.prev)) delete s.prev;
    const k = this.chunks.indexOf(c);
    if (k >= 0) this.chunks.splice(k, 1);
    this.revision++;
  }

  /** The chunk containing x (last one starting at or before x). */
  chunkAt(x: number): Chunk | undefined {
    let best: Chunk | undefined;
    for (const c of this.chunks) if (c.x0 <= x + 1e-6) best = c;
    return best;
  }

  static x0(s: Surface): number { return s.points[0].x; }
  static x1(s: Surface): number { return s.points[s.points.length - 1].x; }

  /** Height/slope of a surface at x (clamped to the chain's range). */
  static sample(s: Surface, x: number, hint = 0): SurfaceSample {
    const p = s.points;
    let i = Math.min(Math.max(hint, 0), p.length - 2);
    while (i > 0 && x < p[i].x) i--;
    while (i < p.length - 2 && x > p[i + 1].x) i++;
    const a = p[i], b = p[i + 1];
    const slope = (b.y - a.y) / (b.x - a.x);
    const t = Math.min(Math.max((x - a.x) / (b.x - a.x), 0), 1);
    return { y: a.y + (b.y - a.y) * t, slope, seg: i };
  }

  /** Surfaces whose x-range overlaps [xa, xb]. */
  surfacesInRange(xa: number, xb: number): Surface[] {
    const lo = Math.min(xa, xb), hi = Math.max(xa, xb);
    return this.surfaces.filter((s) => Course.x1(s) >= lo && Course.x0(s) <= hi);
  }

  /** Highest surface at x whose height is <= y + tol (i.e. the ground beneath). */
  groundBelow(x: number, y: number, tol = 0.05): { surface: Surface; sample: SurfaceSample } | null {
    let best: { surface: Surface; sample: SurfaceSample } | null = null;
    for (const s of this.surfacesInRange(x, x)) {
      const sm = Course.sample(s, x);
      if (sm.y <= y + tol && (!best || sm.y > best.sample.y)) best = { surface: s, sample: sm };
    }
    return best;
  }

  /** Lowest ground height within +-range of x; used to decide "fell into the gap". */
  lowestNear(x: number, range = 30): number {
    let lo = Infinity;
    for (const s of this.surfacesInRange(x - range, x + range)) {
      for (const p of s.points) if (Math.abs(p.x - x) <= range) lo = Math.min(lo, p.y);
      lo = Math.min(lo, Course.sample(s, Math.min(Math.max(x, Course.x0(s)), Course.x1(s))).y);
    }
    return lo === Infinity ? 0 : lo;
  }

  /** Highest ground point in (x, x + range]. Used by the chase camera to look over crests and ramp lips. */
  maxHeightAhead(x: number, range: number): number {
    let hi = -Infinity;
    for (const s of this.surfacesInRange(x, x + range)) {
      for (const p of s.points) if (p.x > x && p.x <= x + range) hi = Math.max(hi, p.y);
    }
    return hi;
  }

  /** Rail height/slope at x (clamped). */
  static railSample(r: Rail, x: number): { y: number; slope: number; seg: number } {
    const p = r.points;
    let i = 0;
    while (i < p.length - 2 && x > p[i + 1].x) i++;
    const a = p[i], b = p[i + 1];
    const t = Math.min(Math.max((x - a.x) / (b.x - a.x), 0), 1);
    return { y: a.y + (b.y - a.y) * t, slope: (b.y - a.y) / (b.x - a.x), seg: i };
  }
  static railX0(r: Rail): number { return r.points[0].x; }
  static railX1(r: Rail): number { return r.points[r.points.length - 1].x; }

  /** Mark a gap (by its takeoff edge) as requiring a rail or wall. */
  /** Stand an obstacle on the ground at x. */
  addObstacle(kind: Obstacle['kind'], x: number, halfWidth: number, height: number): Obstacle {
    const g = this.groundBelow(x, 1e6);
    if (!g) throw new Error(`no ground for ${kind} at ${x}`);
    const o: Obstacle = { id: this.obstacles.length, kind, x, halfWidth, height, baseY: g.sample.y };
    this.obstacles.push(o);
    this.oById.set(o.id, o);
    if (this.chunks.length === 1) this.chunks[0].obstacles.push(o.id);
    return o;
  }

  markGap(x0: number, requires: Gap['requires']): void {
    const g = this.gaps.find((q) => Math.abs(q.x0 - x0) < 0.01);
    if (!g) throw new Error(`no gap at ${x0}`);
    g.requires = requires;
  }

  /** The gap whose span contains x (or the nearest ahead within lookahead). */
  gapAt(x: number): Gap | null {
    for (const g of this.gaps) if (x >= g.x0 - 0.01 && x <= g.x1 + 0.01) return g;
    return null;
  }
}
