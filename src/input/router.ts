import { TUNING, type Tuning } from '../tuning';
import { GestureRecognizer, type GestureEvent } from './gesture';

/**
 * Routes pointers to gesture recognisers (pure, no DOM).
 *
 * - Each finger gets its own recogniser, so a second touch (other thumb, palm) never ends the
 *   first finger's stroke: an active hold (wall ride, grab, heel skim, rail catch) survives it.
 *   Stroke ids are global, so the sim tells the fingers' actions apart.
 * - Touches that begin in the bottom edge strip belong to the OS (home indicator / gesture bar)
 *   and are ignored entirely.
 * The first recogniser is the "primary" one the dev overlay shows.
 */
export class PointerRouter {
  private recs: GestureRecognizer[];
  private owner = new Map<number, GestureRecognizer | null>(); // null = ignored pointer
  private h: number;
  private w: number;

  constructor(readonly primary: GestureRecognizer, private T: Tuning = TUNING, w = 390, h = 844, private maxFingers = 2) {
    this.recs = [primary];
    this.w = w; this.h = h;
  }

  setViewport(w: number, h: number): void { this.w = w; this.h = h; for (const r of this.recs) r.setViewport(w, h); }

  /** `touch`: false for a mouse (no OS edge gestures there). */
  down(id: number, x: number, y: number, t: number, touch = true): void {
    if (this.owner.has(id)) this.cancel(id, t);
    if (touch && y >= this.h * (1 - this.T.gesture.bottomEdgeIgnore)) { this.owner.set(id, null); return; }
    let r = this.recs.find((q) => !q.active);
    if (!r) {
      if (this.recs.length < this.maxFingers) { r = new GestureRecognizer(this.T, this.w, this.h); this.recs.push(r); }
      else { this.owner.set(id, null); return; } // more fingers than we track: ignore, never steal
    }
    this.owner.set(id, r);
    r.pointerDown(id, x, y, t);
  }
  move(id: number, x: number, y: number, t: number): void { this.owner.get(id)?.pointerMove(id, x, y, t); }
  up(id: number, x: number, y: number, t: number): void { const r = this.owner.get(id); this.owner.delete(id); r?.pointerUp(id, x, y, t); }
  cancel(id: number, t: number): void { const r = this.owner.get(id); this.owner.delete(id); r?.pointerCancel(id, t); }

  drain(): GestureEvent[] {
    const out: GestureEvent[] = [];
    for (const r of this.recs) out.push(...r.drain());
    return out.sort((a, b) => a.t - b.t);
  }
}
