import type { Action } from '../input/actions';
import { Simulation } from '../sim/simulation';
import type { Obstacle } from '../course/course';

export interface AutopilotOptions {
  minSpeed: number;
  pushEvery?: number;
  strength?: number;
  jumpEarly?: number;
  /** Also backflip off the first gap even with no pillar after it. */
  flipAtFirstGap?: boolean;
  /** Ride the optional rail. */
  optionalRail?: boolean;
  /** How to deal with pots: jump over them (default) or heel-break them. */
  pots?: 'jump' | 'heel';
  /** How to power pillar breaks: pick by predicted airtime (default), or force one. */
  pillarTrick?: 'auto' | 'flip' | 'grab';
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
  private sid = 1_000_000;
  private airPlan: 'none' | 'flip' | 'grab' | 'done' = 'none';
  private grabStroke = -1;
  private grabTicks = 0;
  private heelStroke = -1;
  private lastMode = '';
  private potsTried = new Set<number>();
  constructor(private opts: AutopilotOptions) {}

  private id(): number { return ++this.sid; }

  /** Next pillar ahead of x, within range. */
  private pillarAhead(sim: Simulation, range: number): Obstacle | undefined {
    const x = sim.state.x;
    return sim.course.obstacles.find((o) => o.kind === 'pillar' && !sim.state.broken.includes(o.id) && o.x > x && o.x - x < range);
  }

  /** Predicted airtime of the current flight (pure: clones the sim). */
  private predictAirtime(sim: Simulation): number {
    const c = new Simulation(sim.course, sim.T);
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
    const justTookOff = st.mode === 'airborne' && this.lastMode !== 'airborne';
    this.lastMode = st.mode;
    const pots = this.opts.pots ?? 'jump';
    if (st.mode === 'grounded') {
      this.prepDone = false; this.airPlan = 'none';
      if (this.wallStroke !== -1) { out.push({ type: 'side', side: 'right', held: false, strokeId: this.wallStroke, source: 'test' }); this.wallStroke = -1; }
      if (this.heelStroke !== -1) { out.push({ type: 'release', dir: 'down', strokeId: this.heelStroke, source: 'test' }); this.heelStroke = -1; }
      if (this.t % (this.opts.pushEvery ?? 36) === 0 && st.speed < this.opts.minSpeed) out.push({ type: 'down', strokeId: this.id(), strength: this.opts.strength ?? 0.65, fresh: true, source: 'test' });
      let jump = false;
      for (const g of course.gaps) {
        const early = g.requires === 'rail' ? 2.2 : (this.opts.jumpEarly ?? 0.8);
        if (st.x > g.x0 - early && st.x < g.x0 - early + 0.6) jump = true;
      }
      const r = this.opts.optionalRail ? course.rails.find((q) => !q.required) : undefined;
      if (r && st.x > r.points[0].x - 3.2 && st.x < r.points[0].x - 2.6) jump = true;
      for (const o of course.obstacles) {
        if (o.kind !== 'pot' || st.broken.includes(o.id)) continue;
        // jump: be at the apex over the pot. heel: land just before it while holding down.
        const lead = Math.max(1.2, st.speed * (pots === 'heel' ? 0.56 : 0.3));
        if (st.x > o.x - lead && st.x < o.x - 0.8 && !this.potsTried.has(o.id)) { jump = true; this.potsTried.add(o.id); }
      }
      if (jump) out.push({ type: 'up', strokeId: this.id(), source: 'test' });
    } else if (st.mode === 'heelSkim') {
      // keep holding through the pot, then let go
      const potNear = course.obstacles.some((o) => o.kind === 'pot' && !st.broken.includes(o.id) && o.x > st.x - 0.5 && o.x - st.x < 4);
      if (!potNear && this.heelStroke !== -1) { out.push({ type: 'release', dir: 'down', strokeId: this.heelStroke, source: 'test' }); this.heelStroke = -1; }
      else if (this.heelStroke === -1) out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' });
    } else if (st.mode === 'airborne') {
      const g = course.gaps.find((q) => st.x > q.x0 - 4 && st.x < q.x1);
      const r = this.opts.optionalRail ? course.rails.find((q) => !q.required) : undefined;
      const nearOptional = r && st.x > r.points[0].x - 3.5 && st.x < r.points[0].x + 2;
      if ((g?.requires === 'rail' || nearOptional) && !this.prepDone) { out.push({ type: 'down', strokeId: this.id(), strength: 0.65, fresh: true, source: 'test' }); this.prepDone = true; }
      if (g?.requires === 'wall' && this.wallStroke === -1 && st.lastContact !== 'wall') {
        const w = course.walls[0];
        if (st.x >= w.x0) { this.wallStroke = this.id(); out.push({ type: 'side', side: 'right', held: true, strokeId: this.wallStroke, source: 'test' }); }
      }
      // heel-break a pot: hold down through the landing in front of it
      if (pots === 'heel' && this.heelStroke === -1 && st.vy < 0) {
        const pot = course.obstacles.find((o) => o.kind === 'pot' && !st.broken.includes(o.id) && o.x > st.x && o.x - st.x < 8);
        if (pot) { this.heelStroke = this.id(); out.push({ type: 'down', strokeId: this.heelStroke, strength: 0.65, fresh: true, source: 'test' }); }
      }
      // trick before a pillar (decided at takeoff from the predicted airtime)
      if (justTookOff && this.airPlan === 'none' && st.lastContact === 'ground') {
        const want = this.pillarAhead(sim, 45) ? (this.opts.pillarTrick ?? 'auto') : (this.opts.flipAtFirstGap && !this.flipDone && g === course.gaps[0] ? 'flip' : null);
        if (want) {
          const air = this.predictAirtime(sim);
          this.airPlan = want === 'auto' ? (air > sim.K.flipDuration + 0.2 ? 'flip' : 'grab') : want;
        }
      }
      if (this.airPlan === 'flip' && st.airTime > 0.06 && st.air === 'none') { out.push({ type: 'up', strokeId: this.id(), source: 'test' }); this.airPlan = 'done'; this.flipDone = true; }
      if (this.airPlan === 'grab' && st.airTime > 0.06 && st.air === 'none' && this.grabStroke === -1) {
        this.grabStroke = this.id(); this.grabTicks = 0;
        out.push({ type: 'side', side: 'left', held: true, strokeId: this.grabStroke, source: 'test' });
      }
      if (this.grabStroke !== -1 && ++this.grabTicks > Math.round(0.2 / sim.dt)) {
        out.push({ type: 'side', side: 'left', held: false, strokeId: this.grabStroke, source: 'test' });
        this.grabStroke = -1; this.airPlan = 'done';
      }
    }
    return out;
  }
}
