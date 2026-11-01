import type { RiderState, SimEvent } from '../sim/types';
import type { Course } from '../course/course';

/**
 * Endless scoring (pure, deterministic: sim state + events in, numbers and pop-ups out).
 *
 * - Trick points: flips, grabs, grinds and wall rides (per second), heel skims, pot / pillar smashes, big air.
 * - Combo: every trick adds a link to the chain; the multiplier grows x1 -> x5 with the chain. The combo's
 *   points are banked (points x multiplier) once the rider rolls plain on the ground for SCORE.idle seconds,
 *   and are lost on a bail.
 * - Near misses: landing right at a gap's far lip, catching a wall late over the gap, clearing a pot by a hair.
 * - Distance: SCORE.perMetre per metre of new ground.
 */
export const SCORE = {
  perMetre: 1,
  flip: 500,
  grab: 150, grabPerSec: 400, grabMin: 0.2,
  grind: 100, grindPerSec: 250,
  wall: 150, wallPerSec: 350,
  skim: 60, skimPerSec: 120,
  pot: 200, pillar: 600,
  airMin: 0.7, airPerSec: 150,
  edge: 300, edgeWithin: 0.9,
  lateWall: 300, lateWallOver: 1.0,
  closePot: 200, closePotClearance: 0.35,
  setPiece: 1000,
  /** Seconds of plain rolling (no trick, not airborne) that bank the combo. */
  idle: 2.5,
  maxMult: 5,
  /** Links per multiplier step. */
  linksPerStep: 2,
};

export type PopupKind = 'trick' | 'near' | 'bank' | 'bail' | 'bonus';
export interface Popup { text: string; pts: number; kind: PopupKind }

export class ScoreKeeper {
  /** Banked score. */
  banked = 0;
  /** Current combo: links and raw points (before the multiplier). */
  chain = 0;
  comboPoints = 0;
  best = { points: 0, chain: 0, mult: 1 };
  tricks = 0;
  nearMisses = 0;
  private idle = 0;
  private maxX = -Infinity;
  private prevX = NaN;
  private flipsThisAir = 0;
  private contactAcc = 0;
  private popups: Popup[] = [];

  get mult(): number { return Math.min(SCORE.maxMult, 1 + Math.floor(this.chain / SCORE.linksPerStep)); }
  /** Banked + what the current combo would bank now (the HUD's score). */
  get total(): number { return this.banked + Math.round(this.comboPoints * this.mult); }

  drainPopups(): Popup[] { return this.popups.splice(0); }
  /** Seconds of plain rolling so far (the combo banks at SCORE.idle). */
  get idleTime(): number { return this.idle; }

  /** A whole new run. */
  reset(): void {
    this.banked = 0; this.chain = 0; this.comboPoints = 0; this.best = { points: 0, chain: 0, mult: 1 };
    this.tricks = 0; this.nearMisses = 0; this.idle = 0; this.maxX = -Infinity; this.popups = []; this.respawn();
  }

  private link(text: string, pts: number, kind: PopupKind = 'trick'): void {
    this.chain++; this.tricks++;
    this.comboPoints += pts;
    this.idle = 0;
    this.popups.push({ text, pts, kind });
  }

  /** One sim tick: `events` are the tick's drained sim events. */
  update(dt: number, st: RiderState, events: SimEvent[], course: Course): void {
    // distance: new ground only (a checkpoint retry doesn't pay twice)
    if (st.x > this.maxX) { if (Number.isFinite(this.maxX)) this.banked += (st.x - this.maxX) * SCORE.perMetre; this.maxX = st.x; }
    for (const e of events) {
      switch (e.type) {
        case 'jump': case 'leave-edge': this.flipsThisAir = 0; break;
        case 'flip-complete': this.flipsThisAir++; this.link(this.flipsThisAir > 1 ? `${this.flipsThisAir}× flip` : 'Backflip', SCORE.flip * this.flipsThisAir); break;
        case 'grab-end': if (e.held >= SCORE.grabMin) this.link('Grab', Math.round(SCORE.grab + SCORE.grabPerSec * Math.min(e.held, 1.5))); break;
        case 'grind-start': this.link('Grind', SCORE.grind); this.contactAcc = 0; break;
        case 'wall-start': {
          const w = course.walls.find((q) => q.id === e.wallId);
          this.link('Wall ride', SCORE.wall); this.contactAcc = 0;
          if (w && e.x > w.x0 + 4 + SCORE.lateWallOver) { this.nearMisses++; this.link('Late catch!', SCORE.lateWall, 'near'); }
          break;
        }
        case 'skim-start': this.link('Heel skim', SCORE.skim); this.contactAcc = 0; break;
        case 'grind-end': case 'wall-end': case 'skim-end':
          if (this.contactAcc >= 50) this.popups.push({ text: e.type === 'grind-end' ? 'Grind' : e.type === 'wall-end' ? 'Wall ride' : 'Skim', pts: Math.round(this.contactAcc), kind: 'trick' });
          this.contactAcc = 0; break;
        case 'break': this.link(e.kind === 'pillar' ? 'Pillar smash!' : 'Smash!', e.kind === 'pillar' ? SCORE.pillar : SCORE.pot); break;
        case 'land': {
          const g = course.gaps.find((q) => q.x1 <= e.x && e.x - q.x1 < SCORE.edgeWithin && q.x0 >= this.takeoffX - 0.5 && q.requires === 'jump');
          if (g) { this.nearMisses++; this.link('Close call!', SCORE.edge, 'near'); }
          if (this.airStart >= 0) { const air = st.tick * dt - this.airStart; if (air >= SCORE.airMin) { this.comboPoints += Math.round(air * SCORE.airPerSec); this.popups.push({ text: 'Air', pts: Math.round(air * SCORE.airPerSec), kind: 'trick' }); } }
          this.airStart = -1;
          break;
        }
        case 'fail': this.bail(); break;
        default: break;
      }
    }
    // flight tracking (air points, edge landings, close pots)
    if (st.mode === 'airborne') {
      if (this.airStart < 0) { this.airStart = st.tick * dt; this.takeoffX = Number.isFinite(this.prevX) ? this.prevX : st.x; }
      if (Number.isFinite(this.prevX)) for (const o of course.obstacles) {
        if (o.kind !== 'pot' || st.broken.includes(o.id) || !(this.prevX < o.x && st.x >= o.x)) continue;
        const clear = st.y - (o.baseY + o.height);
        if (clear >= 0 && clear < SCORE.closePotClearance) { this.nearMisses++; this.link('Close!', SCORE.closePot, 'near'); }
      }
    }
    // sustained contact points
    const rate = st.mode === 'grinding' ? SCORE.grindPerSec : st.mode === 'wallRiding' ? SCORE.wallPerSec : st.mode === 'heelSkim' ? SCORE.skimPerSec : 0;
    if (rate && this.chain > 0) { this.comboPoints += rate * dt; this.contactAcc += rate * dt; this.idle = 0; }
    // banking: plain rolling for a while ends the combo
    if (st.mode === 'grounded') {
      this.idle += dt;
      if (this.chain > 0 && this.idle >= SCORE.idle) this.bank();
    } else if (st.mode !== 'failed' && st.mode !== 'finished') this.idle = Math.min(this.idle, SCORE.idle * 0.5);
    this.prevX = st.x;
  }
  private airStart = -1;
  private takeoffX = -Infinity;

  /** End the combo and bank its points (plain rolling, or the run ending cleanly). */
  bank(): void {
    if (this.chain === 0 && this.comboPoints === 0) return;
    const mult = this.mult, pts = Math.round(this.comboPoints * mult);
    this.banked += pts;
    if (pts > this.best.points) this.best = { points: pts, chain: this.chain, mult };
    if (this.chain >= 2) this.popups.push({ text: `Combo ×${mult}`, pts, kind: 'bank' });
    this.chain = 0; this.comboPoints = 0; this.idle = 0;
  }

  /** A bail loses the combo in progress. */
  bail(): void {
    if (this.chain > 0) this.popups.push({ text: 'Bail! combo lost', pts: -Math.round(this.comboPoints * this.mult), kind: 'bail' });
    this.chain = 0; this.comboPoints = 0; this.idle = 0; this.airStart = -1;
  }

  /** A retry starts mid-route: forget the last position (no phantom flight / distance). */
  respawn(): void { this.prevX = NaN; this.airStart = -1; this.flipsThisAir = 0; }

  bonus(text: string, pts: number): void { this.banked += pts; this.popups.push({ text, pts, kind: 'bonus' }); }
}
