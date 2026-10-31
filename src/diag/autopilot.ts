import type { Action } from '../input/actions';
import type { Simulation } from '../sim/simulation';

/**
 * Dev/test autopilot: a "competent" lab rider. Keeps speed in a band by pushing,
 * jumps every gap, swipes down for required rails, holds right for required walls,
 * and optionally backflips off the first ramp. Pure function of sim state per tick.
 */
export class Autopilot {
  private t = 0;
  private prepDone = false;
  private wallStroke = -1;
  private flipDone = false;
  private sid = 1_000_000;
  constructor(private opts: { minSpeed: number; pushEvery?: number; strength?: number; jumpEarly?: number; flipAtFirstGap?: boolean; optionalRail?: boolean }) {}

  next(sim: Simulation): Action[] {
    const out: Action[] = [];
    const st = sim.state, course = sim.course;
    if (st.mode === 'finished' || st.mode === 'failed') return out;
    this.t++;
    const id = () => ++this.sid;
    if (st.mode === 'grounded') {
      this.prepDone = false;
      if (this.wallStroke !== -1) { out.push({ type: 'side', side: 'right', held: false, strokeId: this.wallStroke, source: 'test' }); this.wallStroke = -1; }
      if (this.t % (this.opts.pushEvery ?? 36) === 0 && st.speed < this.opts.minSpeed) out.push({ type: 'down', strokeId: id(), strength: this.opts.strength ?? 0.65, fresh: true, source: 'test' });
      for (const g of course.gaps) {
        const early = g.requires === 'rail' ? 2.2 : (this.opts.jumpEarly ?? 0.8);
        if (st.x > g.x0 - early && st.x < g.x0 - early + 0.6) out.push({ type: 'up', strokeId: id(), source: 'test' });
      }
      const r = this.opts.optionalRail ? course.rails.find((q) => !q.required) : undefined;
      if (r && st.x > r.points[0].x - 3.2 && st.x < r.points[0].x - 2.6) out.push({ type: 'up', strokeId: id(), source: 'test' });
    } else if (st.mode === 'airborne') {
      const g = course.gaps.find((q) => st.x > q.x0 - 4 && st.x < q.x1);
      const r = this.opts.optionalRail ? course.rails.find((q) => !q.required) : undefined;
      const nearOptional = r && st.x > r.points[0].x - 3.5 && st.x < r.points[0].x + 2;
      if ((g?.requires === 'rail' || nearOptional) && !this.prepDone) { out.push({ type: 'down', strokeId: id(), strength: 0.65, fresh: true, source: 'test' }); this.prepDone = true; }
      if (g?.requires === 'wall' && this.wallStroke === -1 && st.lastContact !== 'wall') {
        const w = course.walls[0];
        if (st.x >= w.x0) { this.wallStroke = id(); out.push({ type: 'side', side: 'right', held: true, strokeId: this.wallStroke, source: 'test' }); }
      }
      if (this.opts.flipAtFirstGap && !this.flipDone && g === course.gaps[0] && st.airTime > 0.12) { out.push({ type: 'up', strokeId: id(), source: 'test' }); this.flipDone = true; }
    } else if (st.mode === 'heelSkim') {
      out.push({ type: 'down', strokeId: id(), strength: 0.65, fresh: true, source: 'test' });
    }
    return out;
  }
}
