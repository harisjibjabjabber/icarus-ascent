import type { RiderState, SimEvent } from '../sim/types';
import type { Course } from '../course/course';

/**
 * Endless scoring (pure, deterministic: sim state + events in, numbers and pop-ups out). Lives outside the sim.
 *
 * - Score = distance + style, added (not multiplied): deliberate, so a long clean run and a
 *   trick-heavy one both count and neither multiplies the other.
 * - Trick points: flips, grabs, grinds and wall rides (per second), heel skims, pot / pillar smashes.
 * - Combo: every trick adds a link to the chain; the multiplier grows x1 -> x5 with the chain. The combo's
 *   points are banked (points x multiplier) once the rider rolls plain on the ground for SCORE.idle seconds,
 *   and are lost on a bail (a fail). A sloppy landing does not break the combo, only a fail does (deliberate:
 *   the sim already makes a bad landing cost speed).
 * - Air: points per second of real airborne time (a flight that ends in a landing; grind / wall / skim time
 *   is not air). Not a combo link: see `update`.
 * - Near misses (links, with a pop-up): landing right at a gap's far lip, catching a wall late over the gap,
 *   clearing a pot by a hair.
 * - Re-ridden ground (a checkpoint retry behind the furthest point already reached) pays nothing again:
 *   no distance, tricks, air, near misses or set-piece bonus.
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

export type PopupKind = 'near' | 'bank' | 'bail' | 'bonus';
export interface Popup { text: string; pts: number; kind: PopupKind }

/** Everything a ScoreKeeper needs to carry a run across a page reload (JSON-safe). */
export interface ScoreSnapshot {
  v: 1;
  banked: number; chain: number; comboPoints: number; idle: number;
  best: { points: number; chain: number; mult: number };
  tricks: number; nearMisses: number; comboTricks: number; comboNear: number;
  /** Furthest x scored this run (null: none yet). */
  maxX: number | null;
  /** Set pieces whose bonus was paid (chunk ids). */
  bonusKeys: number[];
}

export class ScoreKeeper {
  /** Banked score. */
  banked = 0;
  /** Current combo: links and raw points (before the multiplier). */
  chain = 0;
  comboPoints = 0;
  best = { points: 0, chain: 0, mult: 1 };
  /** Tricks and near misses this run, not counting ones lost to a bail (the summary's counts). */
  tricks = 0;
  nearMisses = 0;
  /** ... of which in the combo in progress (a bail takes them back off). */
  private comboTricks = 0;
  private comboNear = 0;
  private idle = 0;
  private maxX = -Infinity;
  /** After a checkpoint retry: ground up to here was already scored this run. */
  private replayUntil = -Infinity;
  private prevX = NaN;
  private flipsThisAir = 0;
  /** Current flight: airborne since the last contact (s), and where it took off. */
  private inAir = false;
  private airTime = 0;
  private takeoffX = -Infinity;
  private bonusKeys: number[] = [];
  private popups: Popup[] = [];

  get mult(): number { return Math.min(SCORE.maxMult, 1 + Math.floor(this.chain / SCORE.linksPerStep)); }
  /** Banked + what the current combo would bank now (the HUD's score). */
  get total(): number { return this.banked + Math.round(this.comboPoints * this.mult); }
  /** Furthest x reached this run (-Infinity before the first update). */
  get furthestX(): number { return this.maxX; }

  drainPopups(): Popup[] { return this.popups.splice(0); }
  /** Seconds of plain rolling so far (the combo banks at SCORE.idle). */
  get idleTime(): number { return this.idle; }

  /** A whole new run. */
  reset(): void {
    this.banked = 0; this.chain = 0; this.comboPoints = 0; this.best = { points: 0, chain: 0, mult: 1 };
    this.tricks = 0; this.nearMisses = 0; this.comboTricks = 0; this.comboNear = 0; this.idle = 0;
    this.maxX = -Infinity; this.bonusKeys = []; this.popups = []; this.respawn();
  }

  private link(pts: number): void {
    this.chain++; this.tricks++; this.comboTricks++;
    this.comboPoints += pts;
    this.idle = 0;
  }
  private near(text: string, pts: number): void {
    this.chain++; this.nearMisses++; this.comboNear++;
    this.comboPoints += pts;
    this.idle = 0;
    this.popups.push({ text, pts, kind: 'near' });
  }
  private endFlight(): void { this.inAir = false; this.airTime = 0; }

  /** One sim tick: `events` are the tick's drained sim events. */
  update(dt: number, st: RiderState, events: SimEvent[], course: Course): void {
    // ground behind the furthest point already scored (a checkpoint retry) pays nothing twice
    const fresh = st.x > this.replayUntil;
    if (st.x > this.maxX) { if (Number.isFinite(this.maxX)) this.banked += (st.x - this.maxX) * SCORE.perMetre; this.maxX = st.x; }
    for (const e of events) {
      switch (e.type) {
        case 'jump': case 'leave-edge': this.flipsThisAir = 0; break;
        case 'flip-complete': this.flipsThisAir++; if (fresh) this.link(SCORE.flip * this.flipsThisAir); break;
        case 'grab-end': if (fresh && e.held >= SCORE.grabMin) this.link(Math.round(SCORE.grab + SCORE.grabPerSec * Math.min(e.held, 1.5))); break;
        // contact starts end the flight: time on a rail / wall / heel is not air
        case 'grind-start': this.endFlight(); if (fresh) this.link(SCORE.grind); break;
        case 'skim-start': this.endFlight(); if (fresh) this.link(SCORE.skim); break;
        case 'wall-start': {
          this.endFlight();
          if (!fresh) break;
          this.link(SCORE.wall);
          const w = course.walls.find((q) => q.id === e.wallId);
          if (w && e.x > w.x0 + 4 + SCORE.lateWallOver) this.near('Late catch!', SCORE.lateWall);
          break;
        }
        case 'break': {
          if (!fresh) break;
          this.link(e.kind === 'pillar' ? SCORE.pillar : SCORE.pot);
          break;
        }
        case 'land': {
          if (fresh && this.inAir) {
            const g = course.gaps.find((q) => q.x1 <= e.x && e.x - q.x1 < SCORE.edgeWithin && q.x0 >= this.takeoffX - 0.5 && q.requires === 'jump');
            if (g) this.near('Close call!', SCORE.edge);
            if (this.airTime >= SCORE.airMin) {
              const pts = Math.round(this.airTime * SCORE.airPerSec);
              // Air is not a combo link. Inside a combo it rides along (multiplied, lost on a bail); with no
              // combo running it is banked at once: parked in comboPoints with chain 0 it could never bank
              // (banking needs a chain), so it would sit there and later be multiplied by an unrelated
              // combo or vanish on a bail. Either way the HUD total stays honest (x1 when chain is 0).
              if (this.chain > 0) this.comboPoints += pts; else this.banked += pts;
            }
          }
          this.endFlight();
          break;
        }
        case 'fail': this.bail(); break;
        default: break;
      }
    }
    // flight tracking (air points, edge landings, close pots): only real airborne time counts
    if (st.mode === 'airborne') {
      if (!this.inAir) { this.inAir = true; this.airTime = 0; this.takeoffX = Number.isFinite(this.prevX) ? this.prevX : st.x; }
      this.airTime += dt;
      if (fresh && Number.isFinite(this.prevX)) for (const o of course.obstacles) {
        if (o.kind !== 'pot' || st.broken.includes(o.id) || !(this.prevX < o.x && st.x >= o.x)) continue;
        const clear = st.y - (o.baseY + o.height);
        if (clear >= 0 && clear < SCORE.closePotClearance) this.near('Close!', SCORE.closePot);
      }
    } else this.endFlight();
    // sustained contact points
    const rate = st.mode === 'grinding' ? SCORE.grindPerSec : st.mode === 'wallRiding' ? SCORE.wallPerSec : st.mode === 'heelSkim' ? SCORE.skimPerSec : 0;
    if (rate && this.chain > 0 && fresh) { this.comboPoints += rate * dt; this.idle = 0; }
    // banking: plain rolling for a while ends the combo
    if (st.mode === 'grounded') {
      this.idle += dt;
      if (this.chain > 0 && this.idle >= SCORE.idle) this.bank();
    } else if (st.mode !== 'failed' && st.mode !== 'finished') this.idle = Math.min(this.idle, SCORE.idle * 0.5);
    this.prevX = st.x;
  }

  /** End the combo and bank its points (plain rolling, or the run ending cleanly). */
  bank(): void {
    if (this.chain === 0 && this.comboPoints === 0) return;
    const mult = this.mult, pts = Math.round(this.comboPoints * mult);
    this.banked += pts;
    if (pts > this.best.points) this.best = { points: pts, chain: this.chain, mult };
    if (this.chain >= 2) this.popups.push({ text: `Combo ×${mult}`, pts, kind: 'bank' });
    this.chain = 0; this.comboPoints = 0; this.idle = 0; this.comboTricks = 0; this.comboNear = 0;
  }

  /** A bail loses the combo in progress (its points, and its tricks / near misses from the counts). */
  bail(): void {
    if (this.chain > 0) this.popups.push({ text: 'Bail! combo lost', pts: -Math.round(this.comboPoints * this.mult), kind: 'bail' });
    this.tricks -= this.comboTricks; this.nearMisses -= this.comboNear;
    this.chain = 0; this.comboPoints = 0; this.idle = 0; this.comboTricks = 0; this.comboNear = 0;
    this.endFlight();
  }

  /** A retry starts mid-route: forget the last position (no phantom flight / distance); ground up to the
   *  furthest point reached was already scored. */
  respawn(): void { this.prevX = NaN; this.endFlight(); this.flipsThisAir = 0; this.replayUntil = this.maxX; }

  /** A one-off bonus, banked at once. With a `key` (e.g. the set piece's chunk id) it is paid once per run. */
  bonus(text: string, pts: number, key?: number): void {
    if (key !== undefined) {
      if (this.bonusKeys.includes(key)) return;
      this.bonusKeys.push(key);
      if (this.bonusKeys.length > 64) this.bonusKeys.shift();
    }
    this.banked += pts; this.popups.push({ text, pts, kind: 'bonus' });
  }

  /** The run so far, for a page reload (see src/score/run.ts). */
  serialize(): ScoreSnapshot {
    return {
      v: 1, banked: this.banked, chain: this.chain, comboPoints: this.comboPoints, idle: this.idle, best: { ...this.best },
      tricks: this.tricks, nearMisses: this.nearMisses, comboTricks: this.comboTricks, comboNear: this.comboNear,
      maxX: Number.isFinite(this.maxX) ? this.maxX : null, bonusKeys: [...this.bonusKeys],
    };
  }

  /** Restore a serialized run (after reset()). Returns false (and leaves a fresh run) if the snapshot is unusable. */
  restore(s: unknown): boolean {
    this.reset();
    const q = s as Partial<ScoreSnapshot> | null;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    if (!q || q.v !== 1 || ![q.banked, q.chain, q.comboPoints, q.idle, q.tricks, q.nearMisses, q.comboTricks, q.comboNear].every(num)) return false;
    const b = q.best;
    if (!b || ![b.points, b.chain, b.mult].every(num)) return false;
    if (q.maxX !== null && !num(q.maxX)) return false;
    this.banked = q.banked!; this.chain = q.chain!; this.comboPoints = q.comboPoints!; this.idle = q.idle!;
    this.best = { points: b.points, chain: b.chain, mult: b.mult };
    this.tricks = q.tricks!; this.nearMisses = q.nearMisses!; this.comboTricks = q.comboTricks!; this.comboNear = q.comboNear!;
    this.maxX = q.maxX ?? -Infinity;
    this.bonusKeys = Array.isArray(q.bonusKeys) ? q.bonusKeys.filter(num).slice(-64) : [];
    this.respawn();
    return true;
  }
}
