/**
 * Course representation: pure data + geometric queries. No rendering, no physics.
 *
 * Gameplay is 2D: x = distance along the route (forward), y = surface height.
 * "lateral" is presentation-only depth (positive = to the rider's right, which the
 * camera sees as further away). Gameplay never reads lateral except to decide
 * which features are *available* (milestone 2 uses it for rail/wall context).
 */

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
}

/** Grind rail (milestone 2 mechanics). Geometry + metadata only for now. */
export interface Rail {
  id: number;
  points: Vec2[];
  /** Lateral offset of the rail from the route centre (m, + = right). */
  lateral: number;
  /** Compulsory rails bridge a gap; optional ones run alongside the ordinary route. */
  required: boolean;
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
}

export interface Marker { x: number; label: string }

export interface SurfaceSample {
  y: number;
  /** dy/dx of the segment under x. */
  slope: number;
  seg: number;
}

export class Course {
  readonly gaps: Gap[] = [];

  constructor(
    readonly seed: number,
    readonly surfaces: Surface[],
    readonly rails: Rail[],
    readonly walls: Wall[],
    readonly markers: Marker[],
    readonly startX: number,
    readonly finishX: number,
  ) {
    const sorted = [...surfaces].sort((a, b) => a.points[0].x - b.points[0].x);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i].points[sorted[i].points.length - 1];
      const b = sorted[i + 1].points[0];
      if (b.x > a.x) this.gaps.push({ x0: a.x, x1: b.x, yTakeoff: a.y, yReceive: b.y });
    }
  }

  surface(id: number): Surface {
    const s = this.surfaces[id];
    if (!s || s.id !== id) throw new Error(`surface ${id} missing`);
    return s;
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

  /** The gap whose span contains x (or the nearest ahead within lookahead). */
  gapAt(x: number): Gap | null {
    for (const g of this.gaps) if (x >= g.x0 - 0.01 && x <= g.x1 + 0.01) return g;
    return null;
  }
}
