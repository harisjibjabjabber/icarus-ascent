import { TUNING, type Tuning } from '../tuning';
import { Course, type Surface, type Vec2 } from '../course/course';
import { describeAction, type Action } from '../input/actions';
import type { FailInfo, RiderState, SimEvent } from './types';

/**
 * Movement simulation. Deterministic, fixed timestep, no rendering, no DOM.
 *
 * State machine (MoveMode):
 *   grounded --up--------------------> airborne (jump)
 *   grounded --rolls off chain end---> airborne (edge; coyote window opens)
 *   airborne --swept contact w/ top--> grounded (land; buffered jump may fire)
 *   airborne --hits ledge face-------> failed
 *   airborne --falls below route-----> failed
 *   grounded --passes finish---------> finished
 *   [M2] airborne --down near rail---> grinding ; airborne --right near wall--> wallRiding
 */
export class Simulation {
  state: RiderState;
  private events: SimEvent[] = [];
  private queue: Action[] = [];
  readonly M: Tuning['movement'];
  readonly dt: number;

  constructor(readonly course: Course, readonly T: Tuning = TUNING) {
    this.M = T.movement;
    this.dt = T.sim.dt;
    this.state = this.initialState();
  }

  private initialState(): RiderState {
    const x = this.course.startX;
    const g = this.course.groundBelow(x, 1e6)!;
    return {
      mode: 'grounded', tick: 0, x, y: g.sample.y, vx: 0, vy: 0, speed: this.M.restCreep,
      surfaceId: g.surface.id, seg: g.sample.seg, angle: Math.atan(g.sample.slope),
      airTime: 0, groundTime: 0, coyote: 0, jumpBuffer: 0, pushStrokeId: -1, pushApplied: 0,
      takeoffX: x, takeoffY: g.sample.y, takeoffSpeed: 0, leftBy: 'none', fail: null,
    };
  }

  enqueue(a: Action): void { this.queue.push(a); }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private emit(e: SimEvent): void { this.events.push(e); }

  /** Advance exactly one fixed step. Queued actions resolve at the start of the step. */
  step(): void {
    const q = this.queue;
    this.queue = [];
    for (const a of q) this.handle(a);
    const s = this.state;
    switch (s.mode) {
      case 'grounded': this.stepGrounded(); break;
      case 'airborne': this.stepAirborne(); break;
      case 'grinding': case 'wallRiding': // milestone 2
      case 'failed': case 'finished': break;
    }
    s.tick++;
  }

  // ------------------------------------------------------------------ actions

  private handle(a: Action): void {
    const s = this.state;
    const name = describeAction(a);
    if (s.mode === 'failed' || s.mode === 'finished') {
      if (a.type !== 'release') this.emit({ type: 'reject', action: name, reason: `run is ${s.mode} (retry handled by game)` });
      return;
    }
    switch (a.type) {
      case 'up': return this.onUp(name);
      case 'down': return this.onDown(name, a.strokeId, a.strength, a.fresh);
      case 'side':
        if (!a.held) return;
        return this.emit({
          type: 'reject', action: name,
          reason: s.mode === 'grounded' ? 'sideways has no meaning on the ground' : 'grab / wall ride arrive in milestone 2',
        });
      case 'release': case 'tap': return;
    }
  }

  private onUp(name: string): void {
    const s = this.state;
    if (s.mode === 'grounded') { this.jump('ground'); this.emit({ type: 'resolve', action: name, result: 'jump' }); return; }
    if (s.mode === 'airborne') {
      if (s.leftBy === 'edge' && s.coyote > 0) { this.jump('coyote'); this.emit({ type: 'resolve', action: name, result: 'coyote jump' }); return; }
      const h = this.heightAboveGround();
      const ttl = this.timeToFall(h);
      if (s.vy <= 0 && ttl <= this.M.jumpBufferTime) {
        s.jumpBuffer = this.M.jumpBufferTime;
        this.emit({ type: 'resolve', action: name, result: `jump buffered (${(ttl * 1000).toFixed(0)} ms before contact)` });
        return;
      }
      // Milestone 2 hook: a deliberate second upward stroke = backflip.
      this.emit({ type: 'reject', action: name, reason: h === Infinity ? 'airborne over a gap (backflip = M2)' : `airborne ${h.toFixed(1)} m up: too early to buffer (backflip = M2)` });
    }
  }

  private onDown(name: string, strokeId: number, strength: number, fresh: boolean): void {
    const s = this.state;
    if (s.mode === 'grounded') {
      if (!fresh && strokeId !== s.pushStrokeId) {
        this.emit({ type: 'reject', action: name, reason: 'stroke began in the air; push needs a fresh stroke' });
        return;
      }
      this.push(strokeId, strength, fresh);
      if (fresh) this.emit({ type: 'resolve', action: name, result: 'push' });
      return;
    }
    if (!fresh) return; // growing an airborne stroke: nothing to do in M1
    // Milestone 2 hook: airborne down = landing preparation (heel skim / rail catch).
    this.emit({ type: 'reject', action: name, reason: 'down in air = landing prep (heel skim / grind, M2)' });
  }

  pushImpulse(strength: number): number {
    const k = Math.min(Math.max(strength, 0), 1) ** this.M.pushCurveExponent;
    return this.M.pushImpulseMin + (this.M.pushImpulseMax - this.M.pushImpulseMin) * k;
  }

  private push(strokeId: number, strength: number, fresh: boolean): void {
    const s = this.state, M = this.M;
    if (fresh) { s.pushStrokeId = strokeId; s.pushApplied = 0; }
    const target = this.pushImpulse(strength);
    const delta = target - s.pushApplied;
    if (delta <= 1e-9) return;
    s.pushApplied = target;
    const v = s.speed;
    const r = v / M.softCap;
    const falloff = Math.max(0, 1 - r * r);
    const taperRad = (M.pushUphillTaperDeg * Math.PI) / 180;
    const taper = s.angle > 0 ? Math.max(0.5, 1 - 0.5 * (s.angle / taperRad)) : 1;
    const gain = delta * falloff * taper;
    if (v < M.softCap) s.speed = Math.min(v + gain, M.softCap);
    this.syncGroundVelocity();
    this.emit({ type: 'push', impulse: s.speed - v, strength, fresh, x: s.x, y: s.y });
  }

  private jump(kind: 'ground' | 'coyote' | 'buffered'): void {
    const s = this.state, M = this.M;
    if (kind === 'coyote') {
      s.vy = Math.max(s.vy, 0) + M.jumpVelocity;
    } else {
      s.vx = s.speed * Math.cos(s.angle);
      s.vy = s.speed * Math.sin(s.angle) + M.jumpVelocity;
    }
    s.mode = 'airborne';
    s.leftBy = 'jump';
    s.coyote = 0;
    s.jumpBuffer = 0;
    s.airTime = 0;
    s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = Math.hypot(s.vx, s.vy);
    this.emit({ type: 'jump', kind, x: s.x, y: s.y, vx: s.vx, vy: s.vy });
  }

  // ------------------------------------------------------------------ grounded

  private syncGroundVelocity(): void {
    const s = this.state;
    s.vx = s.speed * Math.cos(s.angle);
    s.vy = s.speed * Math.sin(s.angle);
  }

  private stepGrounded(): void {
    const s = this.state, M = this.M, dt = this.dt;
    const surf = this.course.surface(s.surfaceId);
    let sm = Course.sample(surf, s.x, s.seg);
    const theta = Math.atan(sm.slope);
    const v = s.speed;
    let acc = -M.slopeGravity * Math.sin(theta);
    if (v > 0) acc -= M.rollingFriction + M.airDrag * v * v;
    else acc = Math.max(0, acc - M.rollingFriction); // at rest: only a slope steeper than friction starts us rolling
    if (v > M.softCap) acc -= M.overCapDrag * (v - M.softCap);
    s.speed = Math.min(Math.max(v + acc * dt, 0), M.hardCap);
    s.groundTime += dt;

    // advance along the polyline by arc length
    let dist = s.speed * dt;
    let x = s.x, seg = sm.seg;
    const p = surf.points;
    while (dist > 0) {
      const a = p[seg], b = p[seg + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const remain = ((b.x - x) / (b.x - a.x)) * segLen;
      if (dist <= remain) { x += (dist / segLen) * (b.x - a.x); dist = 0; break; }
      dist -= remain;
      x = b.x;
      if (seg + 1 >= p.length - 1) { this.leaveEdge(surf, b, Math.atan2(b.y - a.y, b.x - a.x)); return; }
      seg++;
    }
    sm = Course.sample(surf, x, seg);
    s.x = x; s.y = sm.y; s.seg = sm.seg; s.angle = Math.atan(sm.slope);
    this.syncGroundVelocity();
    if (s.x >= this.course.finishX) { s.mode = 'finished'; this.emit({ type: 'finish', x: s.x }); }
  }

  private leaveEdge(_surf: Surface, lip: Vec2, angle: number): void {
    const s = this.state;
    s.x = lip.x; s.y = lip.y; s.angle = angle;
    this.syncGroundVelocity();
    s.mode = 'airborne'; s.leftBy = 'edge'; s.coyote = this.M.coyoteTime; s.airTime = 0;
    s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = s.speed;
    this.emit({ type: 'leave-edge', x: s.x, y: s.y });
  }

  // ------------------------------------------------------------------ airborne

  /** Seconds until the rider falls height h with the current vertical speed. */
  private timeToFall(h: number): number {
    if (!isFinite(h)) return Infinity;
    const g = this.M.airGravity, vd = -this.state.vy;
    return (-vd + Math.sqrt(Math.max(0, vd * vd + 2 * g * Math.max(0, h)))) / g;
  }

  private heightAboveGround(): number {
    const s = this.state;
    let best = Infinity;
    // check under the rider and a little ahead (where they will actually arrive)
    for (const lead of [0, 0.1]) {
      const x = s.x + s.vx * lead;
      const g = this.course.groundBelow(x, s.y + 0.05);
      if (g) best = Math.min(best, s.y - g.sample.y);
    }
    return best;
  }

  private stepAirborne(): void {
    const s = this.state, M = this.M, dt = this.dt;
    s.airTime += dt;
    s.coyote = Math.max(0, s.coyote - dt);
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
    s.vy -= M.airGravity * dt;
    s.vx -= Math.sign(s.vx) * M.airDrag * s.vx * s.vx * dt;
    s.vx = Math.min(s.vx, M.hardCap);
    const p0 = { x: s.x, y: s.y };
    const p1 = { x: s.x + s.vx * dt, y: s.y + s.vy * dt };
    const hit = this.sweep(p0, p1);
    if (hit) {
      if (hit.kind === 'land') return this.land(hit.surface, hit.x);
      if (hit.kind === 'snap') { s.x = p1.x; s.y = hit.y; return; }
      return this.failFace(hit.surface, hit.x, hit.y);
    }
    s.x = p1.x; s.y = p1.y;
    if (s.y < this.course.lowestNear(s.x) - M.failDepth) this.failGap();
  }

  /**
   * Swept contact between the rider's motion this step and every surface it could
   * reach. Compares against the surface where the rider actually arrives (never the
   * takeoff height), so rising ground and thin surfaces cannot be tunnelled through.
   */
  sweep(p0: Vec2, p1: Vec2):
    | { kind: 'land'; surface: Surface; x: number }
    | { kind: 'snap'; surface: Surface; y: number }
    | { kind: 'face'; surface: Surface; x: number; y: number }
    | null {
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    let best: { kind: 'land' | 'face'; t: number; surface: Surface; x: number; y: number } | null = null;
    let snap: { surface: Surface; y: number } | null = null;
    const tol = this.M.surfaceSnapTolerance;
    const lipTol = 0.35;
    for (const surf of this.course.surfacesInRange(p0.x, p1.x)) {
      const x0 = Course.x0(surf), x1 = Course.x1(surf);
      const pts = surf.points;
      const lo = Math.min(p0.x, p1.x), hi = Math.max(p0.x, p1.x);
      // 1) proper segment crossings from above
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        if (B.x < lo || A.x > hi) continue;
        const ex = B.x - A.x, ey = B.y - A.y;
        const side0 = ex * (p0.y - A.y) - ey * (p0.x - A.x); // >0 = above
        const into = ex * dy - ey * dx; // <0 = moving down into the surface
        if (side0 < -1e-7 || into >= 0) continue;
        const t = -side0 / into; // param along motion where it meets the infinite line
        if (t <= 1e-9 || t > 1) continue; // t=0: already touching (handled by the safety net)
        const hx = p0.x + dx * t;
        const u = (hx - A.x) / ex;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        if (!best || t < best.t) best = { kind: 'land', t, surface: surf, x: hx, y: p0.y + dy * t };
      }
      if (p1.x < x0 || p1.x > x1) continue;
      const h1 = Course.sample(surf, p1.x).y;
      if (p1.y >= h1) continue;
      // 2) arriving below a surface we were not over last step => ledge face (or lip catch)
      if (p0.x < x0 && dx > 0) {
        const t = (x0 - p0.x) / dx;
        const yAt = p0.y + dy * t;
        const hx0 = pts[0].y;
        if (yAt >= hx0 - lipTol) {
          if (!best || t < best.t) best = { kind: 'land', t, surface: surf, x: x0, y: hx0 };
        } else if (!best || t < best.t) best = { kind: 'face', t, surface: surf, x: x0, y: yAt };
        continue;
      }
      // 3) numeric safety net: we were on/near this surface, and now we are slightly under it
      const h0 = Course.sample(surf, p0.x).y;
      if (p0.y >= h0 - tol) {
        const sl = Course.sample(surf, p1.x).slope;
        const relNormal = this.state.vy - sl * this.state.vx;
        if (relNormal < 0) { if (!best) best = { kind: 'land', t: 1, surface: surf, x: p1.x, y: h1 }; }
        else snap = { surface: surf, y: h1 };
      }
    }
    if (best) {
      if (best.kind === 'land') return { kind: 'land', surface: best.surface, x: best.x };
      return { kind: 'face', surface: best.surface, x: best.x, y: best.y };
    }
    if (snap) return { kind: 'snap', surface: snap.surface, y: snap.y };
    return null;
  }

  private land(surf: Surface, x: number): void {
    const s = this.state, M = this.M;
    const sm = Course.sample(surf, x);
    const th = Math.atan(sm.slope);
    const before = Math.hypot(s.vx, s.vy);
    const tangential = s.vx * Math.cos(th) + s.vy * Math.sin(th);
    const impact = Math.max(0, -(-s.vx * Math.sin(th) + s.vy * Math.cos(th)));
    s.speed = Math.min(Math.max(tangential, M.landingRetention * Math.abs(s.vx), 0), M.hardCap);
    s.mode = 'grounded';
    s.surfaceId = surf.id; s.seg = sm.seg; s.x = x; s.y = sm.y; s.angle = th;
    s.airTime = 0; s.groundTime = 0; s.coyote = 0; s.leftBy = 'none';
    s.pushStrokeId = -1; // a stroke that began in the air can't be extended into a push
    this.syncGroundVelocity();
    this.emit({ type: 'land', x, y: sm.y, impact, speedBefore: before, speedAfter: s.speed, material: surf.material });
    if (s.jumpBuffer > 0) { this.jump('buffered'); }
  }

  private failFace(surf: Surface, x: number, y: number): void {
    const s = this.state;
    const below = surf.points[0].y - y;
    this.fail({
      kind: 'hit-ledge-face', x, y, gapX1: x,
      message: `Hit the far ledge ${below.toFixed(1)} m below its lip — needed more height or speed`,
    });
    s.x = x; s.y = y;
  }

  private failGap(): void {
    const s = this.state;
    const gap = this.course.gaps.find((g) => s.takeoffX <= g.x0 + 0.5 && s.x < g.x1 + 2) ?? this.course.gapAt(s.x);
    const shortBy = gap ? Math.max(0, gap.x1 - s.x) : undefined;
    this.fail({
      kind: 'fell-in-gap', x: s.x, y: s.y, gapX1: gap?.x1, shortBy,
      message: shortBy !== undefined && shortBy > 0
        ? `Fell short of the gap by ${shortBy.toFixed(1)} m (took off at ${s.takeoffSpeed.toFixed(1)} m/s${s.leftBy === 'edge' ? ', without jumping' : ''})`
        : 'Fell off the route',
    });
  }

  private fail(info: FailInfo): void {
    const s = this.state;
    s.mode = 'failed';
    s.fail = info;
    s.vx = 0; s.vy = 0; s.speed = 0;
    this.emit({ type: 'fail', info });
  }
}

/** Dev-overlay helper: the arc the rider would fly if they jumped right now. Pure: clones. */
export function predictJumpArc(sim: Simulation, maxTicks = 240): Vec2[] {
  if (sim.state.mode !== 'grounded') return [];
  const clone = new Simulation(sim.course, sim.T);
  clone.state = { ...sim.state };
  clone.enqueue({ type: 'up', strokeId: -1, source: 'test' });
  const out: Vec2[] = [];
  for (let i = 0; i < maxTicks; i++) {
    clone.step();
    if (i % 4 === 0) out.push({ x: clone.state.x, y: clone.state.y });
    if (clone.state.mode !== 'airborne') { out.push({ x: clone.state.x, y: clone.state.y }); break; }
  }
  return out;
}
