import { TUNING, type Tuning } from '../tuning';

/**
 * Touch gesture recogniser. Pure (no DOM): feed it pointer samples with timestamps,
 * read back gesture events. Distances are measured in "vu" = fraction of the
 * viewport's short side, so behaviour is the same across phone sizes; it is
 * event-driven, so it is independent of frame rate.
 *
 * Stages (brief §6):
 *  1. TRACKING   – finger down; wait for travel beyond the dead zone (intent).
 *  2. DIRECTION  – choose up/down/left/right with axis bias; stay "ambiguous"
 *                  for diagonal travel until ambiguityLimit.
 *  3. FIRE       – committed stroke fires once it travels fireDistance[dir].
 *                  Down strokes keep reporting strength as they lengthen.
 *  4. HOLD       – a committed stroke keeps its meaning while the finger stays
 *                  down; perpendicular wobble is ignored (hysteresis).
 *  5. RELEASE / NEW STROKE – lifting ends the stroke; travelling back against the
 *                  committed direction by reversalDistance from the stroke's
 *                  furthest point ends it and starts a new stroke anchored there.
 *                  Continuing in the same direction never re-fires.
 */
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Stage = 'idle' | 'tracking' | 'committed';

export type GestureEvent =
  | { kind: 'fire'; dir: Dir; strokeId: number; length: number; strength: number; t: number }
  | { kind: 'extend'; dir: 'down'; strokeId: number; length: number; strength: number; t: number }
  | { kind: 'end'; dir: Dir; strokeId: number; fired: boolean; reason: 'lift' | 'reversal' | 'new-touch' | 'cancel'; t: number }
  | { kind: 'tap'; t: number }
  | { kind: 'reject'; reason: string; t: number };

interface Pt { x: number; y: number }

const DIR_VEC: Record<Dir, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

export class GestureRecognizer {
  private G: Tuning['gesture'];
  private unit = 1;
  private pointerId: number | null = null;
  stage: Stage = 'idle';
  private anchor: Pt = { x: 0, y: 0 }; // in vu
  private downT = 0;
  private dir: Dir | null = null;
  private strokeId = 0;
  private fired = false;
  private fireT = 0;
  private extreme = 0; // furthest travel along dir (vu)
  private extremePt: Pt = { x: 0, y: 0 };
  private lastStrength = 0;
  private everStroked = false;
  private events: GestureEvent[] = [];
  /** Diagnostics for the dev overlay. */
  debug = { stage: 'idle' as Stage, dir: '-' as string, travel: 0, lastDetected: '-', lastReject: '-' };
  /** Recent finger path for the overlay (px). */
  trail: { x: number; y: number; t: number }[] = [];

  constructor(tuning: Tuning = TUNING, viewportW = 390, viewportH = 844) {
    this.G = tuning.gesture;
    this.setViewport(viewportW, viewportH);
  }

  setViewport(w: number, h: number): void { this.unit = Math.max(1, Math.min(w, h)); }

  drain(): GestureEvent[] { const e = this.events; this.events = []; return e; }

  private toVu(x: number, y: number): Pt { return { x: x / this.unit, y: y / this.unit }; }

  private emit(e: GestureEvent): void {
    this.events.push(e);
    if (e.kind === 'fire') this.debug.lastDetected = `${e.dir} stroke #${e.strokeId}`;
    if (e.kind === 'tap') this.debug.lastDetected = 'tap';
    if (e.kind === 'reject') this.debug.lastReject = e.reason;
  }

  pointerDown(id: number, px: number, py: number, t: number): void {
    if (this.pointerId !== null) this.endStroke('new-touch', t);
    this.pointerId = id;
    this.beginTracking(this.toVu(px, py), t);
    this.downT = t;
    this.everStroked = false;
    this.trail = [{ x: px, y: py, t }];
  }

  pointerMove(id: number, px: number, py: number, t: number): void {
    if (id !== this.pointerId) return;
    this.trail.push({ x: px, y: py, t });
    if (this.trail.length > 64) this.trail.shift();
    this.process(this.toVu(px, py), t);
  }

  pointerUp(id: number, px: number, py: number, t: number): void {
    if (id !== this.pointerId) return;
    this.process(this.toVu(px, py), t);
    if (this.stage === 'tracking' && !this.everStroked) {
      if (t - this.downT <= this.G.tapMaxMs) this.emit({ kind: 'tap', t });
      else this.emit({ kind: 'reject', reason: 'held without moving past dead zone', t });
    }
    this.endStroke('lift', t);
    this.pointerId = null;
    this.stage = 'idle';
    this.syncDebug(0);
  }

  pointerCancel(id: number, t: number): void {
    if (id !== this.pointerId) return;
    this.endStroke('cancel', t);
    this.pointerId = null;
    this.stage = 'idle';
    this.syncDebug(0);
  }

  private beginTracking(at: Pt, _t: number): void {
    this.stage = 'tracking';
    this.anchor = at;
    this.dir = null;
    this.fired = false;
    this.extreme = 0;
    this.lastStrength = 0;
  }

  private endStroke(reason: 'lift' | 'reversal' | 'new-touch' | 'cancel', t: number): void {
    if (this.stage === 'committed' && this.dir) {
      if (!this.fired) {
        this.emit({ kind: 'reject', reason: `${this.dir} stroke too short (${this.extreme.toFixed(3)} < ${this.G.fireDistance[this.fireKey(this.dir)]} vu)`, t });
      }
      this.emit({ kind: 'end', dir: this.dir, strokeId: this.strokeId, fired: this.fired, reason, t });
    }
    this.stage = 'tracking';
    this.dir = null;
  }

  private fireKey(d: Dir): 'up' | 'down' | 'side' { return d === 'left' || d === 'right' ? 'side' : d; }

  private strengthFor(length: number, t: number): number {
    const G = this.G;
    const s = (length - G.fireDistance.down) / (G.pushFullLength - G.fireDistance.down);
    void t;
    return Math.min(Math.max(s, 0), 1);
  }

  private process(p: Pt, t: number): void {
    const G = this.G;
    if (this.stage === 'idle') return;
    if (this.stage === 'tracking') {
      const dx = p.x - this.anchor.x, dy = p.y - this.anchor.y;
      const dist = Math.hypot(dx, dy);
      this.syncDebug(dist);
      if (dist < G.deadZone) return; // stage 1: not yet intentional
      // stage 2: choose a direction
      const ax = Math.abs(dx), ay = Math.abs(dy);
      let dir: Dir | null = null;
      if (ay >= ax * G.verticalBias) dir = dy > 0 ? 'down' : 'up';
      else if (ax >= ay * G.horizontalBias) dir = dx > 0 ? 'right' : 'left';
      // Still diagonal after ambiguityLimit: an UPWARD diagonal resolves sideways (a wall-ride /
      // grab gesture must never become a flip); a downward diagonal resolves to down.
      else if (dist >= G.ambiguityLimit) dir = dy > 0 ? 'down' : dx > 0 ? 'right' : 'left';
      if (!dir) { this.debug.dir = 'ambiguous'; return; }
      this.stage = 'committed';
      this.dir = dir;
      this.strokeId = nextStrokeId();
      this.everStroked = true;
      this.extreme = 0;
      this.extremePt = { ...this.anchor };
    }
    // committed
    const dir = this.dir!;
    const v = DIR_VEC[dir];
    const along = (p.x - this.anchor.x) * v.x + (p.y - this.anchor.y) * v.y;
    if (along > this.extreme) { this.extreme = along; this.extremePt = { ...p }; }
    this.syncDebug(along);
    // stage 3: fire
    if (!this.fired && this.extreme >= G.fireDistance[this.fireKey(dir)]) {
      this.fired = true;
      this.fireT = t;
      const strength = dir === 'down' ? this.strengthFor(this.extreme, t) : 0;
      this.lastStrength = strength;
      this.emit({ kind: 'fire', dir, strokeId: this.strokeId, length: this.extreme, strength, t });
    } else if (this.fired && dir === 'down' && t - this.fireT <= G.pushGrowWindowMs) {
      // stage 4: a lengthening push stroke reports more strength (never re-fires)
      const strength = this.strengthFor(this.extreme, t);
      if (strength > this.lastStrength + 0.02 || (strength === 1 && this.lastStrength < 1)) {
        this.lastStrength = strength;
        this.emit({ kind: 'extend', dir: 'down', strokeId: this.strokeId, length: this.extreme, strength, t });
      }
    }
    // stage 5: reversal => new stroke anchored at the furthest point
    if (this.extreme - along >= G.reversalDistance) {
      this.endStroke('reversal', t);
      this.beginTracking(this.extremePt, t);
      this.process(p, t);
    }
  }

  private syncDebug(travel: number): void {
    this.debug.stage = this.stage;
    this.debug.dir = this.dir ?? (this.stage === 'tracking' ? 'none yet' : '-');
    this.debug.travel = travel;
  }
}

let strokeCounter = 0;
/** Stroke ids are unique across touch and keyboard so the sim can match extends to pushes. */
export function nextStrokeId(): number { return ++strokeCounter; }
