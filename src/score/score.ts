import type { RiderState, SimEvent } from '../sim/types';
import type { Course } from '../course/course';
import type { Orb } from '../course/orbs';
import { ORB, orbPoints, orbPopup } from '../course/orbs';

export type OrbCollectResult = { streak: number; trailDone: boolean; tier: Orb['tier']; trailLen: number };

export { orbTouched } from '../course/orbs';

/**
 * Endless scoring (pure, deterministic: sim state + events in, numbers and pop-ups out). Lives outside the sim.
 *
 * - Score = distance + style. Distance is never multiplied. Style (the combo) is.
 * - Trick points: flips, grabs, grinds and wall rides (per second), heel skims, pot / pillar smashes.
 * - Combo: every trick adds a link. The chain multiplier still grows x1 -> x5 with the length, then a
 *   variety factor pulls it down when the combo repeats one kind and up when the kinds mix. Repeating the
 *   previous kind also pays SCORE.staleScale of the points. A short run of one kind can still reach x3;
 *   holding x5 takes a mix. Banked (points x multiplier x flow) once the rider rolls plain for SCORE.idle
 *   seconds, and lost on a bail. A sloppy landing does not break the combo, only a fail does.
 * - Flow: 0..1. Fresh links and carrying speed raise it; a repeated kind and plain rolling lower it.
 *   It scales the combo when it banks (and the live total), never the distance.
 * - Air: points per second of real airborne time. Not a combo link: see `update`.
 * - Near misses (links, with a pop-up). Closer to the line pays more; the trigger windows are unchanged.
 * - Orbs: optional pickups along the route, banked at once, never a failure. See `orbTouched`.
 * - Re-ridden ground pays nothing again: no distance, tricks, air, near misses or set-piece bonus.
 * - Distance: SCORE.perMetre per metre of new ground.
 */
export const SCORE = {
  perMetre: 1,
  flip: 500,
  /** A second rotation in one jump. Distinct from a flip, so variety treats it as its own kind. */
  double: 1100,
  /** Clean clear of a risky high line (on top of the grind link). */
  line: 900,
  grab: 150, grabPerSec: 400, grabMin: 0.2,
  grind: 100, grindPerSec: 250,
  wall: 150, wallPerSec: 350,
  wash: 420, washPerSec: 280,
  swing: 380, swingPerSec: 320,
  flight: 700, flightPerSec: 220,
  bounce: 260,
  skim: 60, skimPerSec: 120,
  pot: 200, pillar: 600,
  airMin: 0.7, airPerSec: 150,
  // Near-miss thresholds, tuned against autopilot rides (tests/score.test.ts: 14 seeds x 4 km fire on
  // ~5-15% of the relevant events, not never and not constantly).
  /** Landing within this far past a jump gap's far lip (m). Gap landings fall 0.1-6 m past the lip. */
  edge: 300, edgeWithin: 1.8,
  /** Wall caught later than this relative to the takeoff lip (m; negative = before it). A right held
   *  into the kicker catches as the rider leaves it, about 0.45-0.65 m before the lip. A catch in
   *  the lip's last 0.45 m, or over the gap, came late. Required gap-walls land a few centimetres
   *  later than the older entries, so the line sits just inside half a metre. */
  lateWall: 300, lateWallOver: -0.455,
  /** Pot cleared in the air with less than this under the board (m). Jumps clear by 0.25-0.55 m. */
  closePot: 200, closePotClearance: 0.35,
  /** Pillar smashed within this of its real face or of its top (m): the trick came on with the rider
   *  already inside the smash reach (TUNING.obstacles.pillarBreakReach), or the rider barely
   *  reached the top. A smash started on time hits the reach boundary, 0.8 m before the face. */
  pillarEdge: 300, pillarEdgeWithin: 0.35,
  setPiece: 1000,
  /** Seconds of plain rolling (no trick, not airborne) that bank the combo. */
  idle: 2.5,
  maxMult: 5,
  /** Links per multiplier step (before variety). */
  linksPerStep: 2,
  /** A repeated kind pays this fraction of its points and drags the multiplier down. */
  staleScale: 0.45,
  /** Variety added per distinct kind after the first, subtracted per extra repeat. */
  varietyPerKind: 0.12,
  varietyPerRepeat: 0.04,
  varietyMin: 0.55,
  varietyMax: 1.35,
  /** Flow: fresh link raises it, a repeat lowers it, plain rolling drains it, speed fills it. */
  flowPerFresh: 0.18,
  flowPerStale: 0.1,
  flowDecay: 0.1,
  flowGain: 0.08,
  flowSpeedMin: 14,
  /** Combo bank (and the live total) is multiplied by 1 + flowBank * flow. */
  flowBank: 0.4,
};

export type PopupKind = 'near' | 'bank' | 'bail' | 'bonus';
export interface Popup { text: string; pts: number; kind: PopupKind }
export type Cue = 'near' | 'rank' | 'orb' | 'bank';
const TRICK_KINDS = ['flip', 'double', 'grab', 'grind', 'line', 'wall', 'wash', 'flight', 'bounce', 'skim', 'pot', 'pillar', 'near'] as const;
export type TrickKind = typeof TRICK_KINDS[number];
export interface BailInfo { mult: number; chain: number; points: number }

function isKind(v: unknown): v is TrickKind { return typeof v === 'string' && (TRICK_KINDS as readonly string[]).includes(v); }

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
  /** Optional, so a snapshot from before variety / flow / lanterns still restores. */
  flow?: number;
  flowPeak?: number;
  lastKind?: TrickKind | null;
  comboKinds?: TrickKind[];
  runKinds?: TrickKind[];
  orbIds?: number[];
  orbCommon?: number;
  orbRare?: number;
  lastBail?: BailInfo | null;
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
  private cues: Cue[] = [];
  /** Kinds linked in the combo in progress, in order. */
  private comboKinds = new Set<TrickKind>();
  /** Kinds whose combo was banked (a bail does not count). */
  private runKinds = new Set<TrickKind>();
  private lastKind: TrickKind | null = null;
  /** Multiplier last announced, so a drop doesn't re-fire and a reload doesn't either. */
  private rankShown = 0;
  flow = 0;
  flowPeak = 0;
  private orbIds: number[] = [];
  orbCommon = 0;
  orbRare = 0;
  private orbStreak = 0;
  private lastOrbT = -999;
  private trailProgress = new Map<number, number>();
  private trailsDone = new Set<number>();
  lastBail: BailInfo | null = null;

  /** Chain length only, before variety. */
  get chainMult(): number { return Math.min(SCORE.maxMult, 1 + Math.floor(this.chain / SCORE.linksPerStep)); }
  /**
   * 1 when the combo is a single link. Mixing kinds raises it (capped); repeating the same kind lowers it.
   * Tuned so four of a kind still reach x3, and a long repeat cannot hold x5.
   */
  get variety(): number {
    if (this.chain <= 1 || this.comboKinds.size === 0) return 1;
    const unique = this.comboKinds.size;
    const repeats = Math.max(0, this.chain - unique);
    const v = 1 + SCORE.varietyPerKind * Math.max(0, unique - 1) - SCORE.varietyPerRepeat * repeats;
    return Math.min(SCORE.varietyMax, Math.max(SCORE.varietyMin, v));
  }
  /** What the HUD shows and what a bank pays. */
  get mult(): number { return Math.min(SCORE.maxMult, Math.max(1, Math.round(this.chainMult * this.variety))); }
  /** Distinct trick kinds in the combo (a near miss is not a trick). */
  get comboTrickKinds(): number { let n = 0; for (const k of this.comboKinds) if (k !== 'near') n++; return n; }
  /** Kinds actually banked this run. */
  get runKindCount(): number { return this.runKinds.size; }
  get flowPay(): number { return 1 + SCORE.flowBank * this.flow; }
  /** Banked + what the current combo would bank now (the HUD's score). */
  get total(): number { return this.banked + Math.round(this.comboPoints * this.mult * this.flowPay); }
  get orbCount(): number { return this.orbCommon + this.orbRare; }
  tookOrb(id: number): boolean { return this.orbIds.includes(id); }
  /** Furthest x reached this run (-Infinity before the first update). */
  get furthestX(): number { return this.maxX; }

  drainPopups(): Popup[] { return this.popups.splice(0); }
  drainCues(): Cue[] { return this.cues.splice(0); }
  /** Seconds of plain rolling so far (the combo banks at SCORE.idle). */
  get idleTime(): number { return this.idle; }

  /** A whole new run. */
  reset(): void {
    this.banked = 0; this.chain = 0; this.comboPoints = 0; this.best = { points: 0, chain: 0, mult: 1 };
    this.tricks = 0; this.nearMisses = 0; this.comboTricks = 0; this.comboNear = 0; this.idle = 0;
    this.maxX = -Infinity; this.bonusKeys = []; this.popups = []; this.cues = [];
    this.comboKinds.clear(); this.runKinds.clear(); this.lastKind = null; this.rankShown = 0;
    this.flow = 0; this.flowPeak = 0; this.orbIds = []; this.orbCommon = 0; this.orbRare = 0;
    this.orbStreak = 0; this.lastOrbT = -999; this.trailProgress.clear(); this.trailsDone.clear();
    this.lastBail = null;
    this.respawn();
  }

  private noteFlow(): void { if (this.flow > this.flowPeak) this.flowPeak = this.flow; }

  /** One combo link. A kind that matches the previous link is stale: fewer points, less flow. */
  private addLink(kind: TrickKind, pts: number): number {
    const freshKind = this.lastKind !== kind;
    const paid = Math.round(pts * (freshKind ? 1 : SCORE.staleScale));
    this.chain++; this.tricks++; this.comboTricks++;
    if (kind === 'near') { this.nearMisses++; this.comboNear++; }
    this.comboPoints += paid;
    this.comboKinds.add(kind);
    this.lastKind = kind;
    this.idle = 0;
    this.flow = Math.min(1, Math.max(0, this.flow + (freshKind ? SCORE.flowPerFresh : -SCORE.flowPerStale)));
    this.noteFlow();
    if (this.mult >= 2 && this.mult > this.rankShown) this.cues.push('rank');
    this.rankShown = this.mult;
    return paid;
  }
  /** `closeness` is 0 at the edge of the window and 1 on the line. The window itself is unchanged. */
  private near(text: string, base: number, closeness: number): void {
    const scaled = Math.round(base * (0.75 + 0.5 * Math.min(1, Math.max(0, closeness))));
    const paid = this.addLink('near', scaled);
    this.popups.push({ text, pts: paid, kind: 'near' });
    this.cues.push('near');
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
        case 'flip-complete': {
          const rotation = e.rotation ?? 1;
          if (rotation >= 2) { if (fresh) this.addLink('double', SCORE.double); }
          else { this.flipsThisAir++; if (fresh) this.addLink('flip', SCORE.flip * this.flipsThisAir); }
          break;
        }
        case 'grind-end': {
          if (fresh && e.reason === 'end' && course.rails.some((q) => q.id === e.railId && q.risky)) this.addLink('line', SCORE.line);
          break;
        }
        case 'grab-end': if (fresh && e.held >= SCORE.grabMin) this.addLink('grab', Math.round(SCORE.grab + SCORE.grabPerSec * Math.min(e.held, 1.5))); break;
        // contact starts end the flight: time on a rail / wall / heel is not air
        case 'grind-start': {
          this.endFlight();
          if (!fresh) break;
          const rail = course.rails.find((q) => q.id === e.railId);
          this.addLink(rail?.wash ? 'wash' : 'grind', rail?.wash ? SCORE.wash : SCORE.grind);
          break;
        }
        case 'flight-start': if (fresh) this.addLink('flight', SCORE.flight); break;
        case 'bounce': if (fresh) this.addLink('bounce', SCORE.bounce); break;
        case 'skim-start': this.endFlight(); if (fresh) this.addLink('skim', SCORE.skim); break;
        case 'wall-start': {
          this.endFlight();
          if (!fresh) break;
          this.addLink('wall', SCORE.wall);
          const w = course.walls.find((q) => q.id === e.wallId);
          if (w && e.x > w.x0 + 4 + SCORE.lateWallOver) {
            const late = e.x - (w.x0 + 4 + SCORE.lateWallOver);
            this.near('Late catch!', SCORE.lateWall, Math.min(1, late / 2.5)); // walls start 4 m before the takeoff lip
          }
          break;
        }
        case 'break': {
          if (!fresh) break;
          this.addLink(e.kind === 'pillar' ? 'pillar' : 'pot', e.kind === 'pillar' ? SCORE.pillar : SCORE.pot);
          const o = e.kind === 'pillar' ? course.obstacle(e.obstacleId) : undefined;
          if (o && (e.x >= o.x - o.halfWidth - SCORE.pillarEdgeWithin || e.y >= o.baseY + o.height - SCORE.pillarEdgeWithin)) {
            const into = Math.max(e.x - (o.x - o.halfWidth - SCORE.pillarEdgeWithin), e.y - (o.baseY + o.height - SCORE.pillarEdgeWithin), 0);
            this.near('Clipped it!', SCORE.pillarEdge, Math.min(1, into / Math.max(0.2, SCORE.pillarEdgeWithin)));
          }
          break;
        }
        case 'land': {
          if (fresh && this.inAir) {
            const g = course.gaps.find((q) => q.x1 <= e.x && e.x - q.x1 < SCORE.edgeWithin && q.x0 >= this.takeoffX - 0.5 && q.requires === 'jump');
            if (g) this.near('Close call!', SCORE.edge, 1 - (e.x - g.x1) / SCORE.edgeWithin);
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
    if (st.mode === 'airborne' || st.mode === 'flying') {
      if (!this.inAir) { this.inAir = true; this.airTime = 0; this.takeoffX = Number.isFinite(this.prevX) ? this.prevX : st.x; }
      this.airTime += dt;
      if (fresh && Number.isFinite(this.prevX)) for (const o of course.obstacles) {
        if (o.kind !== 'pot' || st.broken.includes(o.id) || !(this.prevX < o.x && st.x >= o.x)) continue;
        const clear = st.y - (o.baseY + o.height);
        if (clear >= 0 && clear < SCORE.closePotClearance) this.near('Close!', SCORE.closePot, 1 - clear / SCORE.closePotClearance);
      }
    } else this.endFlight();
    // sustained contact points
    const wash = st.mode === 'grinding' && course.rails.some((q) => q.id === st.railId && q.wash);
    const rate = wash ? SCORE.washPerSec : st.mode === 'grinding' ? SCORE.grindPerSec : st.mode === 'wallRiding' ? SCORE.wallPerSec : st.mode === 'heelSkim' ? SCORE.skimPerSec : st.mode === 'flying' ? SCORE.flightPerSec : st.mode === 'gusting' ? 0 : 0;
    if (rate && this.chain > 0 && fresh) { this.comboPoints += rate * dt; this.idle = 0; }
    // banking: plain rolling for a while ends the combo
    if (st.mode === 'grounded') {
      this.idle += dt;
      this.flow = Math.max(0, this.flow - dt * SCORE.flowDecay);
      if (this.chain > 0 && this.idle >= SCORE.idle) this.bank();
    } else if (st.mode !== 'failed' && st.mode !== 'finished') {
      this.idle = Math.min(this.idle, SCORE.idle * 0.5);
      const speed = st.mode === 'airborne' ? Math.hypot(st.vx, st.vy) : st.speed;
      if (this.chain > 0 && speed >= SCORE.flowSpeedMin) this.flow = Math.min(1, this.flow + dt * SCORE.flowGain);
    }
    this.noteFlow();
    this.prevX = st.x;
  }

  /** End the combo and bank its points (plain rolling, or the run ending cleanly). */
  bank(): void {
    if (this.chain === 0 && this.comboPoints === 0) return;
    const mult = this.mult, pts = Math.round(this.comboPoints * mult * this.flowPay);
    for (const k of this.comboKinds) if (k !== 'near') this.runKinds.add(k);
    this.banked += pts;
    if (pts > this.best.points) this.best = { points: pts, chain: this.chain, mult };
    if (this.chain >= 2) { this.popups.push({ text: `Combo ×${mult}`, pts, kind: 'bank' }); this.cues.push('bank'); }
    this.chain = 0; this.comboPoints = 0; this.idle = 0; this.comboTricks = 0; this.comboNear = 0;
    this.comboKinds.clear(); this.lastKind = null; this.rankShown = 0;
  }

  /** A bail loses the combo in progress (its points, and its tricks / near misses from the counts). */
  bail(): void {
    if (this.chain > 0) {
      const lost = Math.round(this.comboPoints * this.mult * this.flowPay);
      this.lastBail = { mult: this.mult, chain: this.chain, points: lost };
      this.popups.push({ text: 'Bail! combo lost', pts: -lost, kind: 'bail' });
    } else this.lastBail = null;
    this.tricks -= this.comboTricks; this.nearMisses -= this.comboNear;
    this.chain = 0; this.comboPoints = 0; this.idle = 0; this.comboTricks = 0; this.comboNear = 0;
    this.comboKinds.clear(); this.lastKind = null; this.rankShown = 0;
    this.endFlight();
  }

  /** An orb, banked at once. Paying twice for the same id is refused. */
  collectOrb(o: Orb, simTime: number): OrbCollectResult | null {
    if (this.orbIds.includes(o.id)) return null;
    if (simTime - this.lastOrbT > ORB.streakGap) this.orbStreak = 0;
    this.orbStreak++;
    this.lastOrbT = simTime;
    const streak = o.tier === 'rare' ? 1 : this.orbStreak;
    const pts = orbPoints(o.tier, streak);
    this.orbIds.push(o.id);
    if (o.tier === 'rare') this.orbRare++; else this.orbCommon++;
    this.banked += pts;
    this.popups.push({ text: orbPopup(o.tier), pts, kind: 'bonus' });
    let trailDone = false;
    if (o.trailId > 0 && o.trailLen > 1) {
      const n = (this.trailProgress.get(o.trailId) ?? 0) + 1;
      this.trailProgress.set(o.trailId, n);
      if (n >= o.trailLen && !this.trailsDone.has(o.trailId)) {
        this.trailsDone.add(o.trailId);
        trailDone = true;
        this.banked += ORB.trailComplete;
        this.popups.push({ text: '+TRAIL BONUS', pts: ORB.trailComplete, kind: 'bonus' });
      }
    }
    return { streak, trailDone, tier: o.tier, trailLen: o.trailLen };
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
      flow: this.flow, flowPeak: this.flowPeak, lastKind: this.lastKind, comboKinds: [...this.comboKinds], runKinds: [...this.runKinds],
      orbIds: [...this.orbIds], orbCommon: this.orbCommon, orbRare: this.orbRare, lastBail: this.lastBail ? { ...this.lastBail } : null,
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
    if (num(q.flow)) this.flow = Math.min(1, Math.max(0, q.flow));
    if (num(q.flowPeak)) this.flowPeak = Math.min(1, Math.max(0, q.flowPeak));
    this.lastKind = isKind(q.lastKind) ? q.lastKind : null;
    for (const k of q.comboKinds ?? []) if (isKind(k)) this.comboKinds.add(k);
    for (const k of q.runKinds ?? []) if (isKind(k)) this.runKinds.add(k);
    this.orbIds = Array.isArray(q.orbIds) ? q.orbIds.filter(num) : [];
    if (num(q.orbCommon)) this.orbCommon = q.orbCommon;
    if (num(q.orbRare)) this.orbRare = q.orbRare;
    const bail = q.lastBail;
    if (bail && num(bail.mult) && num(bail.chain) && num(bail.points)) this.lastBail = { mult: bail.mult, chain: bail.chain, points: bail.points };
    this.rankShown = this.mult;
    this.respawn();
    return true;
  }
}
