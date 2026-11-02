import type { Action } from '../input/actions';
import { Simulation } from '../sim/simulation';
import type { Obstacle, Rail } from '../course/course';

export interface AutopilotOptions {
  minSpeed: number;
  pushEvery?: number;
  strength?: number;
  jumpEarly?: number;
  /** Also backflip off the first gap even with no pillar after it. */
  flipAtFirstGap?: boolean;
  /** Backflip off crest launches (no gap) for style. */
  styleFlips?: boolean;
  /** Queue a second rotation once the first flip is readable and a full extra one still fits. */
  styleDouble?: boolean;
  /** Grab off crest launches (no gap) for style. */
  styleGrabs?: boolean;
  /** Ride the optional (non-risky) rail. */
  optionalRail?: boolean;
  /** Jump onto bounce pads. */
  bounce?: boolean;
  /** Take the risky high line: jump it and swipe down. */
  riskyLine?: boolean;
  /** Jump the risky high line but never swipe down, so the attempt misses. */
  riskyMistime?: 'nodown';
  /**
   * Sky-layer hops. On by default: arm Down 0.15 s before each `down` hop, jump at the middle of each
   * `jump` window, and do nothing on `roll`. `false` rides the gust and then stays passive.
   */
  sky?: boolean;
  /** Skip the second sky line and do not catch the street rail under that segment, so a death gap is real. */
  skyMistime?: 'drop-over-gap';
  /** How to deal with pots: jump over them (default) or heel-break them. */
  pots?: 'jump' | 'heel';
  /** How to smash pillars: jump into them grabbing (default) or flipping, or heel-skim through. */
  pillarTrick?: 'grab' | 'flip' | 'heel';
}

/**
 * Dev/test autopilot: a "competent" lab rider. Keeps speed in a band, jumps gaps,
 * swipes down for required rails, holds right for required walls, clears or breaks
 * pots and does an airborne trick before pillars. Deterministic per sim state.
 */
export class Autopilot {
  private t = 0;
  private prepDone = false;
  private wallStroke = -1;
  private flipDone = false;
  private doubleSent = false;
  private sid = 1_000_000;
  private airPlan: 'none' | 'flip' | 'grab' | 'done' = 'none';
  private grabStroke = -1;
  private grabTicks = 0;
  private heelStroke = -1;
  private lastMode = '';
  private potsTried = new Set<number>();
  private pillarsTried = new Set<number>();
  private heelNext = false;
  private pillarId = -1;
  private readonly bounced = new Set<number>();
  /** Sky hops already committed, keyed by segment and hop. Cleared if a retry rewinds the rider. */
  private skyDone = new Set<string>();
  private skyX = 0;
  constructor(private opts: AutopilotOptions) {}

  private id(): number { return ++this.sid; }

  /** Next pillar ahead of x, within range. */
  private pillarAhead(sim: Simulation, range: number): Obstacle | undefined {
    const x = sim.state.x;
    return sim.course.obstacles.find((o) => o.kind === 'pillar' && !sim.state.broken.includes(o.id) && o.x > x && o.x - x < range);
  }

  /** Predicted airtime of the current flight (pure: clones the sim). */
  private predictAirtime(sim: Simulation): number {
    const c = new Simulation(sim.course, sim.T, undefined, { stream: false });
    c.cloneFrom(sim);
    let t = 0;
    for (let i = 0; i < 600 && c.state.mode === 'airborne'; i++) { c.step(); t += c.dt; }
    return t;
  }

  next(sim: Simulation): Action[] {
    const out: Action[] = [];
    const st = sim.state, course = sim.course;
    if (st.mode === 'finished' || st.mode === 'failed') return out;
    this.t++;
    if (this.t % 600 === 0) { // streamed courses recycle obstacles: forget ones that are gone
      for (const id of this.potsTried) if (!course.hasObstacle(id)) this.potsTried.delete(id);
      for (const id of this.pillarsTried) if (!course.hasObstacle(id)) this.pillarsTried.delete(id);
    }
    const justTookOff = st.mode === 'airborne' && this.lastMode !== 'airborne';
    this.lastMode = st.mode;
    const pots = this.opts.pots ?? 'jump';
    if (st.mode === 'grounded') {
      this.prepDone = false; this.airPlan = 'none'; this.pillarId = -1; this.doubleSent = false;
      if (this.wallStroke !== -1) { out.push({ type: 'side', side: 'right', held: false, strokeId: this.wallStroke, source: 'test' }); this.wallStroke = -1; }
      if (this.heelStroke !== -1) { out.push({ type: 'release', dir: 'down', strokeId: this.heelStroke, source: 'test' }); this.heelStroke = -1; this.heelNext = false; }
      if (this.t % (this.opts.pushEvery ?? 36) === 0 && st.speed < this.opts.minSpeed) out.push({ type: 'down', strokeId: this.id(), strength: this.opts.strength ?? 0.65, fresh: true, source: 'test' });
      let jump = false;
      for (const g of course.gaps) {
        // Fast wall entries used to grab a hair late; keep slow entries on the early jump so a long gap still carries.
        const early = g.requires === 'rail' ? 2.2 : g.requires === 'wall' && st.speed >= 16 ? 0.76 : (this.opts.jumpEarly ?? 0.8);
        if (st.x > g.x0 - early && st.x < g.x0 - early + 0.6) jump = true;
      }
      const r = course.rails.find((q) => this.takes(q) && q.points[0].x > st.x - 4);
      if (r && st.x > r.points[0].x - 3.2 && st.x < r.points[0].x - 2.6) jump = true;
      if (this.opts.bounce) {
        const b = course.bounces.find((q) => !this.bounced.has(q.id) && q.x > st.x && q.x - st.x < 14);
        if (b) {
          const lead = Math.max(1.4, st.speed * 0.3);
          if (st.x > b.x - lead && st.x < b.x - 0.5) { jump = true; this.bounced.add(b.id); }
        }
      }
      for (const o of course.obstacles) {
        if (o.kind !== 'pot' || st.broken.includes(o.id) || this.potsTried.has(o.id)) continue;
        // a cluster of pots close together is cleared (or skimmed) as one
        const cluster = course.obstacles.filter((q) => q.kind === 'pot' && q.x >= o.x && q.x - o.x < 5);
        const last = cluster[cluster.length - 1];
        const span = last.x - o.x + 2 * o.halfWidth;
        // too wide to hop at this speed: skim it instead
        const heel = pots === 'heel' || span > st.speed * 0.34;
        // jump: apex over the middle of the pots. heel: land just before the first, holding down.
        const trigger = heel ? o.x - Math.max(1.2, st.speed * 0.56) : (o.x + last.x) / 2 - Math.max(1.2, st.speed * 0.3);
        if (st.x > trigger && st.x < o.x - 0.8) { jump = true; if (heel) this.heelNext = true; for (const q of cluster) this.potsTried.add(q.id); }
      }
      const pt = this.opts.pillarTrick ?? 'grab';
      const p = this.pillarAhead(sim, 30);
      if (p && !this.pillarsTried.has(p.id)) {
        const lead = pt === 'heel' ? st.speed * 0.613 + 1.5 : Math.max(1.5, st.speed * 0.3);
        if (st.x > p.x - lead) { jump = true; this.pillarsTried.add(p.id); this.airPlan = pt === 'heel' ? 'none' : pt; this.pillarId = p.id; }
      }
      if (jump) out.push({ type: 'up', strokeId: this.id(), source: 'test' });
    } else if (st.mode === 'heelSkim') {
      // keep holding through the pot, then let go
      const potNear = course.obstacles.some((o) => !st.broken.includes(o.id) && o.x > st.x - 0.5 && o.x - st.x < 4);
      if (!potNear && this.heelStroke !== -1) { out.push({ type: 'release', dir: 'down', strokeId: this.heelStroke, source: 'test' }); this.heelStroke = -1; }
      else if (this.heelStroke === -1) out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' });
    } else if (st.mode === 'airborne') {
      const g = course.gaps.find((q) => st.x > q.x0 - 4 && st.x < q.x1);
      const r = course.rails.find((q) => this.takes(q) && q.points[q.points.length - 1].x > st.x);
      const nearOptional = r && st.x > r.points[0].x - 3.5 && st.x < r.points[0].x + 2;
      const skipDown = !!r?.risky && this.opts.riskyMistime === 'nodown';
      if ((g?.requires === 'rail' || (nearOptional && !skipDown)) && !this.prepDone && !this.dropOverGap(sim)) { out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' }); this.prepDone = true; }
      if (g?.requires === 'wall' && this.wallStroke === -1 && st.lastContact !== 'wall') {
        const w = course.walls.find((q) => st.x > q.x0 - 6 && st.x < q.x1) ?? course.walls[0];
        if (w && st.x >= w.x0) { this.wallStroke = this.id(); out.push({ type: 'side', side: 'right', held: true, strokeId: this.wallStroke, source: 'test' }); }
      }
      // heel-break a pot: hold down through the landing in front of it
      const heelPillar = (this.opts.pillarTrick ?? 'grab') === 'heel';
      if (this.heelStroke === -1 && st.vy < 0) {
        const pot = course.obstacles.find((o) => (o.kind === 'pot' ? pots === 'heel' || this.heelNext : heelPillar) && !st.broken.includes(o.id) && o.x > st.x && o.x - st.x < 8);
        if (pot) { this.heelStroke = this.id(); out.push({ type: 'down', strokeId: this.heelStroke, strength: 0.65, fresh: true, source: 'test' }); }
      }
      if (justTookOff && this.airPlan === 'none' && this.opts.flipAtFirstGap && !this.flipDone && g === course.gaps[0]) {
        if (this.predictAirtime(sim) > sim.K.flipDuration + 0.2) this.airPlan = 'flip';
      }
      if (this.opts.styleFlips && this.airPlan === 'none' && st.leftBy === 'crest' && st.airTime > sim.M.coyoteTime + 0.01 && st.flipsThisJump === 0) {
        this.airPlan = this.predictAirtime(sim) > sim.K.flipDuration + 0.06 ? 'flip' : 'done';
      }
      if (this.opts.styleGrabs && this.airPlan === 'none' && st.leftBy === 'crest' && st.airTime > sim.M.coyoteTime + 0.01) {
        this.airPlan = this.predictAirtime(sim) > 0.45 ? 'grab' : 'done';
      }
      if (this.airPlan === 'flip' && st.airTime > 0.06 && st.air === 'none') { out.push({ type: 'up', strokeId: this.id(), source: 'test' }); this.airPlan = 'done'; this.flipDone = true; }
      if (this.opts.styleDouble && !this.doubleSent && st.air === 'flip' && st.flipsThisJump === 1 && !st.flipQueued && st.flip >= sim.K.flipReadable) {
        const pc = sim.predictContact();
        const need = (1 - st.flip) * sim.K.flipDuration + sim.K.flipDuration * sim.K.flipLandTolerance;
        if (pc.kind !== 'ground' || pc.t >= need) { out.push({ type: 'up', strokeId: this.id(), source: 'test' }); this.doubleSent = true; }
      }
      if (this.airPlan === 'grab' && st.airTime > 0.06 && st.air === 'none' && this.grabStroke === -1) {
        this.grabStroke = this.id(); this.grabTicks = 0;
        out.push({ type: 'side', side: 'left', held: true, strokeId: this.grabStroke, source: 'test' });
      }
      // hold the grab through the pillar, then let go
      const holdUntilPast = this.pillarId >= 0 && !st.broken.includes(this.pillarId) && (course.obstacle(this.pillarId)?.x ?? -Infinity) + 0.5 > st.x;
      if (this.grabStroke !== -1 && ++this.grabTicks > Math.round(0.2 / sim.dt) && !holdUntilPast) {
        out.push({ type: 'side', side: 'left', held: false, strokeId: this.grabStroke, source: 'test' });
        this.grabStroke = -1; this.airPlan = 'done';
      }
    }
    if (this.opts.sky !== false) out.push(...this.skyActions(sim));
    return out;
  }

  /** Horizontal speed the sky timers should use, including the scripted gust. */
  private skySpeed(sim: Simulation): number {
    const st = sim.state;
    if (st.mode === 'gusting') {
      const tuft = sim.course.tuft(st.tuftId) ?? sim.course.tufts.find((t) => t.id === st.tuftId);
      if (tuft) return Math.max(1, (tuft.exitX - st.gustFrom.x) / sim.K.sky.gustDuration);
    }
    if (st.mode === 'airborne' || st.mode === 'flying' || st.mode === 'gusting') return Math.max(1, st.vx);
    return Math.max(1, st.speed * Math.cos(st.angle || 0));
  }

  /**
   * Sky hops from the segment under the rider. Down is armed early and held (the sim keeps the catch
   * until a grind consumes it). Jumps fire once, at the middle of the window, and the target line is
   * caught on the way across.
   */
  private skyActions(sim: Simulation): Action[] {
    const out: Action[] = [];
    const st = sim.state;
    if (st.x < this.skyX - 8) this.skyDone.clear();
    this.skyX = st.x;
    const seg = sim.course.skyAt(st.x) ?? sim.course.sky.find((s) => st.x >= s.x0 - 1 && st.x <= s.x1);
    if (!seg) return out;
    const speed = this.skySpeed(sim);
    const lead = speed * 0.15;
    const l2 = seg.lines[1]?.railId;
    const mistime = this.opts.skyMistime === 'drop-over-gap';
    const airborne = st.mode === 'airborne' || st.mode === 'gusting';
    for (let i = 0; i < seg.hops.length; i++) {
      const h = seg.hops[i];
      const key = `${seg.id}:${seg.gx}:${i}`;
      if (h.action === 'roll') continue;
      if (mistime && h.targetRail !== undefined && h.targetRail === l2) continue;
      if (h.action === 'down') {
        if (this.skyDone.has(key) || !airborne) continue;
        if (st.x >= h.x0 - lead && st.x < h.x1) {
          out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' });
          this.skyDone.add(key);
        }
      } else if (h.action === 'jump') {
        const onSky = seg.lines.some((ln) => ln.railId === st.railId);
        if (!this.skyDone.has(key) && st.mode === 'grinding' && onSky && st.railId !== h.targetRail && st.x >= (h.x0 + h.x1) / 2 && st.x <= h.x1) {
          out.push({ type: 'up', strokeId: this.id(), source: 'test' });
          this.skyDone.add(key);
        }
        const catchKey = `${key}:catch`;
        if (h.targetRail !== undefined && this.skyDone.has(key) && !this.skyDone.has(catchKey) && st.mode === 'airborne') {
          const rail = sim.course.rails.find((r) => r.id === h.targetRail);
          if (rail && st.x >= rail.points[0].x - lead && st.x < rail.points[rail.points.length - 1].x) {
            out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' });
            this.skyDone.add(catchKey);
          }
        }
      }
    }
    return out;
  }

  /** Mistime: do not catch the street rail that bridges the gap under this sky segment. */
  private dropOverGap(sim: Simulation): boolean {
    if (this.opts.skyMistime !== 'drop-over-gap') return false;
    const x = sim.state.x;
    return sim.course.sky.some((seg) => {
      const g = seg.gapBelow;
      if (!g) return false;
      return x > seg.gx && x < seg.x1 + 5 && x > g.x0 - 8 && x < g.x1 + 8;
    });
  }

  /** Risky rails only for a high-line rider. Other optional rails only when optionalRail is set.
   *  Sky lines are hopped from the segment, not treated as street rails. */
  private takes(q: Rail): boolean {
    if (q.required) return false;
    if (q.sky) return false;
    if (q.wash) return false;
    if (q.risky) return !!this.opts.riskyLine || this.opts.riskyMistime === 'nodown';
    return !!this.opts.optionalRail;
  }
}
