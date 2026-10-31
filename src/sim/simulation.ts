import { TUNING, type Tuning } from '../tuning';
import { Course, type Obstacle, type Rail, type Surface, type Vec2, type Wall } from '../course/course';
import { describeAction, type Action } from '../input/actions';
import type { FailInfo, RiderState, SimEvent } from './types';

/**
 * Movement simulation. Deterministic, fixed timestep, no rendering, no DOM.
 *
 * State machine (MoveMode):
 *   grounded/heelSkim --up---------------------------> airborne (jump)
 *   grounded/heelSkim --rolls off chain end----------> airborne (edge; coyote window)
 *   heelSkim --release / fresh push------------------> grounded
 *   airborne --swept contact with ground top---------> grounded | heelSkim (prep held)
 *                                                      | failed (mid-flip / grabbing)
 *   airborne --prep armed + inside a rail's band-----> grinding
 *   airborne --right held + valid wall proximity-----> wallRiding
 *   grinding --rail end / up-------------------------> airborne
 *   wallRiding --wall end / release / slid off / up--> airborne
 *   airborne --hits ledge face / falls below route---> failed
 *   grounded --passes finish-------------------------> finished
 *
 * Airborne context resolution (brief §6):
 *   second fresh Up (not the jump's own stroke)  -> backflip (or buffered jump near touchdown)
 *   Right hold within a wall's span/height band  -> wall ride; otherwise -> right grab
 *   Left hold                                    -> left grab
 *   Down                                         -> landing prep: rail catch if in a rail's band,
 *                                                   heel skim on ordinary ground if still held
 */
export class Simulation {
  state: RiderState;
  private events: SimEvent[] = [];
  private queue: Action[] = [];
  readonly M: Tuning['movement'];
  readonly K: Tuning['tricks'];
  readonly dt: number;
  /** Is a side (Left/Right) stroke currently held? Tracked so a hold can become a wall ride. */
  private sideHeld: { side: 'left' | 'right'; strokeId: number } | null = null;

  constructor(readonly course: Course, readonly T: Tuning = TUNING) {
    this.M = T.movement;
    this.K = T.tricks;
    this.dt = T.sim.dt;
    this.state = this.initialState();
  }

  private initialState(): RiderState {
    const x = this.course.startX;
    const g = this.course.groundBelow(x, 1e6)!;
    return {
      mode: 'grounded', tick: 0, x, y: g.sample.y, vx: 0, vy: 0, speed: this.M.restCreep,
      surfaceId: g.surface.id, seg: g.sample.seg, angle: Math.atan(g.sample.slope),
      airTime: 0, groundTime: 0, coyote: 0, jumpBuffer: 0, pushStrokeId: -1, pushApplied: 0, jumpStrokeId: -1,
      air: 'none', flip: 0, flipsThisJump: 0, sideStrokeId: -1, prepStrokeId: -1, prepTimer: 0, prepHeld: false,
      railId: -1, wallId: -1, contactTime: 0, wallEntrySpeed: 0, lastContact: 'ground', lastContactId: g.surface.id,
      prepTriedThisAir: false, sideTriedThisAir: false,
      broken: [], trickCredit: 'none', creditGround: 0, grabbedThisAir: false,
      takeoffX: x, takeoffY: g.sample.y, takeoffSpeed: 0, leftBy: 'none', fail: null,
    };
  }

  /** Copy the private hold-tracking too (used by predictJumpArc and tests). */
  cloneFrom(other: Simulation): void {
    this.state = { ...other.state, broken: [...other.state.broken] };
    this.sideHeld = other.sideHeld ? { ...other.sideHeld } : null;
  }

  enqueue(a: Action): void { this.queue.push(a); }

  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }

  private emit(e: SimEvent): void { this.events.push(e); }
  private reject(action: string, reason: string): void { this.emit({ type: 'reject', action, reason }); }
  private resolve(action: string, result: string): void { this.emit({ type: 'resolve', action, result }); }

  /** Advance exactly one fixed step. Queued actions resolve at the start of the step. */
  step(): void {
    const q = this.queue;
    this.queue = [];
    for (const a of q) this.handle(a);
    const s = this.state;
    const px = s.x, py = s.y, pmode = s.mode, pGroundX = s.mode === 'grounded' || s.mode === 'heelSkim' ? s.x : NaN;
    switch (s.mode) {
      case 'grounded': case 'heelSkim': this.stepGrounded(); break;
      case 'airborne': this.stepAirborne(); break;
      case 'grinding': this.stepGrinding(); break;
      case 'wallRiding': this.stepWall(); break;
      case 'failed': case 'finished': break;
    }
    if (s.mode === 'grounded' || s.mode === 'heelSkim') {
      if (s.trickCredit !== 'none') {
        s.creditGround += s.x - (isNaN(pGroundX) ? s.x : pGroundX);
        if (s.creditGround > this.T.obstacles.pillarCreditDistance) s.trickCredit = 'none';
      }
    }
    if (pmode !== 'failed' && pmode !== 'finished' && s.mode !== 'failed') this.checkObstacles(px, py, pmode);
    s.tick++;
  }

  // ================================================================== obstacles

  /** Swept test of the rider's path this step against every standing obstacle. */
  private checkObstacles(px: number, py: number, pmode: RiderState['mode']): void {
    const s = this.state;
    if (s.mode === 'grinding' || s.mode === 'wallRiding') return; // rails/walls pass over/beside obstacles
    for (const o of this.course.obstacles) {
      if (s.broken.includes(o.id)) continue;
      // forgiving pillars: a valid break reaches further; a plain hit needs a solid overlap
      const O = this.T.obstacles;
      let hw = o.halfWidth, reach = 0, top = o.baseY + o.height;
      if (o.kind === 'pillar') {
        if (this.pillarBreaker()) { reach = O.pillarBreakReach; top += O.pillarBreakTopExtra; }
        else { hw *= O.pillarFailWidthScale; top -= O.pillarFailTopGrace; }
      }
      const x0 = o.x - hw - reach, x1 = o.x + hw;
      if (s.x < x0 || px > x1 || s.x <= px) continue;
      // lowest point of the path while overlapping the obstacle's footprint
      const yAt = (x: number) => py + ((s.y - py) * (x - px)) / (s.x - px);
      const lo = Math.min(yAt(Math.max(px, x0)), yAt(Math.min(s.x, x1)));
      if (lo >= top) continue; // cleared it
      if (lo < o.baseY - 0.5 && pmode === 'airborne' && s.mode === 'airborne') continue; // passing below (in a gap)
      this.resolveObstacle(o, Math.max(px, x0), Math.max(o.baseY, Math.min(top, lo)));
      if (s.mode === 'failed') return;
    }
  }

  private resolveObstacle(o: Obstacle, x: number, y: number): void {
    const s = this.state, O = this.T.obstacles;
    const airborne = s.mode === 'airborne';
    if (o.kind === 'pot') {
      const heel = s.mode === 'heelSkim' || (airborne && this.isPrepArmed() && s.vy <= 0);
      if (!heel) {
        const msg = airborne
          ? `Clipped a pot in the air (${(o.baseY + o.height - y).toFixed(1)} m too low) — jump earlier, or hold down into the landing to heel-break it`
          : 'Hit a pot — jump it, or jump and hold down into the landing to break it with your heel';
        return this.fail({ kind: 'hit-pot', x, y, message: msg });
      }
      this.breakObstacle(o, 'heel', O.potBreakRetention, x, y);
      return;
    }
    // pillar: breaks if you hit it while doing a trick (grab / flip / heel skim)
    const by = this.pillarBreaker();
    if (!by) {
      return this.fail({ kind: 'hit-pillar', x, y, message: airborne
        ? 'Hit a pillar with a plain jump — grab (hold left/right) or backflip (swipe up again) as you reach it to smash through'
        : 'Rolled into a pillar — jump and grab or flip into it, or heel-skim (jump, hold down) through it' });
    }
    this.breakObstacle(o, by, O.pillarBreakRetention, x, y);
    if (by === s.trickCredit) s.trickCredit = 'none';
  }

  /** What would break a pillar right now: an active trick, else a recent trick's credit. */
  private pillarBreaker(): 'grab' | 'flip' | 'heel' | null {
    const s = this.state;
    if (s.mode === 'airborne') {
      if (s.air === 'grabLeft' || s.air === 'grabRight') return 'grab';
      if (s.air === 'flip') return 'flip';
      if (s.grabbedThisAir) return 'grab'; // grabbed earlier on this jump and already let go
      if (this.isPrepArmed() && s.prepHeld && s.vy <= 0) return 'heel';
    }
    if (s.mode === 'heelSkim') return 'heel';
    return s.trickCredit === 'none' ? null : s.trickCredit;
  }

  private breakObstacle(o: Obstacle, by: 'heel' | 'flip' | 'grab', retention: number, x: number, y: number): void {
    const s = this.state;
    s.broken.push(o.id);
    if (s.mode === 'airborne') { s.vx *= retention; s.vy *= retention; }
    else { s.speed *= retention; this.syncContactVelocity(); }
    this.emit({ type: 'break', obstacleId: o.id, kind: o.kind, by, x, y, vx: s.vx, vy: s.vy, speed: s.mode === 'airborne' ? Math.hypot(s.vx, s.vy) : s.speed });
  }

  private earnCredit(c: 'flip' | 'grab'): void {
    const s = this.state;
    s.trickCredit = c; s.creditGround = 0;
    this.emit({ type: 'credit', credit: c });
  }

  // ================================================================== actions

  private handle(a: Action): void {
    const s = this.state;
    const name = describeAction(a);
    // hold tracking is mode-independent
    if (a.type === 'side') this.sideHeld = a.held ? { side: a.side, strokeId: a.strokeId } : (this.sideHeld?.strokeId === a.strokeId ? null : this.sideHeld);
    if (s.mode === 'failed' || s.mode === 'finished') {
      if (a.type !== 'release' && !(a.type === 'side' && !a.held)) this.reject(name, `run is ${s.mode} (retry handled by game)`);
      return;
    }
    switch (a.type) {
      case 'up': return this.onUp(name, a.strokeId);
      case 'down': return this.onDown(name, a.strokeId, a.strength, a.fresh);
      case 'side': return a.held ? this.onSideHold(name, a.side, a.strokeId) : this.onSideRelease(a.side, a.strokeId);
      case 'release': return this.onRelease(a.dir, a.strokeId);
      case 'tap': return;
    }
  }

  private onUp(name: string, strokeId: number): void {
    const s = this.state, K = this.K;
    switch (s.mode) {
      case 'grounded': case 'heelSkim':
        this.jump(s.mode === 'heelSkim' ? 'skim' : 'ground', strokeId);
        return this.resolve(name, 'jump');
      case 'grinding':
        this.jump('rail', strokeId);
        return this.resolve(name, 'jump off rail');
      case 'wallRiding':
        this.jump('wall', strokeId);
        return this.resolve(name, 'jump off wall');
      case 'airborne': {
        if (s.leftBy === 'edge' && s.coyote > 0) { this.jump('coyote', strokeId); return this.resolve(name, 'coyote jump'); }
        if (strokeId === s.jumpStrokeId) return this.reject(name, 'same stroke as the jump (no double action)');
        const h = this.heightAboveGround();
        const ttl = this.timeToFall(h);
        if (s.vy <= 0 && ttl <= this.M.jumpBufferTime) {
          s.jumpBuffer = this.M.jumpBufferTime;
          return this.resolve(name, `jump buffered (${(ttl * 1000).toFixed(0)} ms before contact)`);
        }
        if (s.air === 'flip') return this.reject(name, 'already flipping');
        if (s.air === 'grabLeft' || s.air === 'grabRight') return this.reject(name, 'release the grab before flipping');
        if (s.flipsThisJump >= K.maxFlipsPerJump) return this.reject(name, 'one flip per jump');
        s.air = 'flip'; s.flip = 0; s.flipsThisJump++;
        this.emit({ type: 'flip-start', x: s.x, y: s.y });
        return this.resolve(name, `backflip (${(ttl === Infinity ? '∞' : (ttl * 1000).toFixed(0))} ms to contact, needs ${(K.flipDuration * 1000).toFixed(0)})`);
      }
    }
  }

  private onDown(name: string, strokeId: number, strength: number, fresh: boolean): void {
    const s = this.state;
    switch (s.mode) {
      case 'grounded':
        if (!fresh && strokeId !== s.pushStrokeId) return this.reject(name, 'stroke began in the air; push needs a fresh stroke');
        this.push(strokeId, strength, fresh);
        if (fresh) this.resolve(name, 'push');
        return;
      case 'heelSkim':
        if (!fresh) return; // the held skim stroke lengthening: nothing
        this.endSkim('push');
        this.push(strokeId, strength, true);
        return this.resolve(name, 'push (ends heel skim)');
      case 'airborne':
        if (!fresh) return;
        if (s.air === 'grabLeft' || s.air === 'grabRight') return this.reject(name, 'release the grab before preparing to land');
        s.prepStrokeId = strokeId; s.prepHeld = true; s.prepTimer = this.K.prepArmWindow; s.prepTriedThisAir = true;
        this.emit({ type: 'prep', armed: true });
        this.resolve(name, 'landing prep armed (rail catch / heel skim)');
        this.tryRailCatch(); // already in a catch band? catch now
        return;
      case 'grinding': case 'wallRiding':
        if (fresh) this.reject(name, `down has no meaning while ${s.mode === 'grinding' ? 'grinding' : 'wall riding'}`);
        return;
    }
  }

  private onSideHold(name: string, side: 'left' | 'right', strokeId: number): void {
    const s = this.state;
    if (s.mode === 'grounded' || s.mode === 'heelSkim') return this.reject(name, 'sideways has no meaning on the ground');
    if (s.mode !== 'airborne') return this.reject(name, `sideways ignored while ${s.mode}`);
    s.sideTriedThisAir = true;
    if (side === 'right') {
      const w = this.wallCatchable();
      if (w.wall) { this.startWall(w.wall, strokeId); return this.resolve(name, 'wall ride'); }
      if (w.reason) this.emit({ type: 'reject', action: name, reason: `not a wall ride: ${w.reason} → grab` });
    }
    if (s.air === 'flip') return this.reject(name, 'mid-flip: no grab');
    s.air = side === 'left' ? 'grabLeft' : 'grabRight';
    s.grabbedThisAir = true;
    s.sideStrokeId = strokeId;
    s.contactTime = 0;
    this.emit({ type: 'grab-start', side });
    this.resolve(name, `${side} grab`);
  }

  private onSideRelease(side: 'left' | 'right', strokeId: number): void {
    const s = this.state;
    if (s.mode === 'airborne' && (s.air === 'grabLeft' || s.air === 'grabRight') && s.sideStrokeId === strokeId) {
      s.air = 'none';
      this.emit({ type: 'grab-end', side, held: s.contactTime });
      this.resolve(`${side} release`, 'grab released');
      this.earnCredit('grab'); // any duration: a grab triggered on this jump counts
    } else if (s.mode === 'wallRiding' && s.sideStrokeId === strokeId) {
      this.leaveWall('release');
    }
  }

  private onRelease(dir: 'down' | 'up', strokeId: number): void {
    const s = this.state;
    if (dir !== 'down' || strokeId !== s.prepStrokeId) return;
    s.prepHeld = false;
    if (s.mode === 'heelSkim') this.endSkim('release');
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
    this.syncContactVelocity();
    this.emit({ type: 'push', impulse: s.speed - v, strength, fresh, x: s.x, y: s.y });
  }

  private resetAir(): void {
    const s = this.state;
    s.air = 'none'; s.flip = 0; s.flipsThisJump = 0; s.airTime = 0;
    s.prepTriedThisAir = s.prepHeld; s.sideTriedThisAir = false; s.grabbedThisAir = false;
    s.trickCredit = 'none'; s.creditGround = 0; // a pillar needs a trick from the jump before it
  }

  private jump(kind: 'ground' | 'coyote' | 'buffered' | 'rail' | 'wall' | 'skim', strokeId: number): void {
    const s = this.state, M = this.M;
    if (s.mode === 'heelSkim') this.endSkim('jump');
    if (kind === 'coyote') {
      s.vy = Math.max(s.vy, 0) + M.jumpVelocity;
    } else if (kind === 'rail') {
      this.emit({ type: 'grind-end', railId: s.railId, x: s.x, y: s.y, reason: 'jump' });
      s.vx = s.speed * Math.cos(s.angle);
      s.vy = s.speed * Math.sin(s.angle) + M.jumpVelocity * this.K.grindJumpScale;
      s.lastContact = 'rail'; s.lastContactId = s.railId; s.railId = -1;
    } else if (kind === 'wall') {
      this.emit({ type: 'wall-end', wallId: s.wallId, x: s.x, y: s.y, reason: 'jump' });
      s.vx = s.speed;
      s.vy = Math.max(s.vy, 0) + M.jumpVelocity * 0.8;
      s.lastContact = 'wall'; s.lastContactId = s.wallId; s.wallId = -1;
    } else {
      s.vx = s.speed * Math.cos(s.angle);
      s.vy = s.speed * Math.sin(s.angle) + M.jumpVelocity;
    }
    s.mode = 'airborne';
    s.leftBy = 'jump';
    s.jumpStrokeId = strokeId;
    s.coyote = 0;
    s.jumpBuffer = 0;
    this.resetAir();
    s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = Math.hypot(s.vx, s.vy);
    this.emit({ type: 'jump', kind, x: s.x, y: s.y, vx: s.vx, vy: s.vy });
  }

  // ================================================================== grounded / heel skim

  private syncContactVelocity(): void {
    const s = this.state;
    s.vx = s.speed * Math.cos(s.angle);
    s.vy = s.speed * Math.sin(s.angle);
  }

  private stepGrounded(): void {
    const s = this.state, M = this.M, K = this.K, dt = this.dt;
    const surf = this.course.surface(s.surfaceId);
    let sm = Course.sample(surf, s.x, s.seg);
    const theta = Math.atan(sm.slope);
    const v = s.speed;
    let acc = -M.slopeGravity * Math.sin(theta);
    if (v > 0) acc -= M.rollingFriction + M.airDrag * v * v;
    else acc = Math.max(0, acc - M.rollingFriction);
    if (v > M.softCap) acc -= M.overCapDrag * (v - M.softCap);
    if (s.mode === 'heelSkim') {
      s.contactTime += dt;
      if (v > 0) acc -= Math.min(K.heelDecelMax, K.heelDecelBase + K.heelDecelRamp * s.contactTime);
    }
    s.speed = Math.min(Math.max(v + acc * dt, 0), M.hardCap);
    s.groundTime += dt;
    if (s.mode === 'heelSkim' && s.speed <= 0) this.endSkim('stopped');

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
      if (seg + 1 >= p.length - 1) { this.leaveEdge(b, Math.atan2(b.y - a.y, b.x - a.x)); return; }
      seg++;
    }
    sm = Course.sample(surf, x, seg);
    s.x = x; s.y = sm.y; s.seg = sm.seg; s.angle = Math.atan(sm.slope);
    this.syncContactVelocity();
    if (s.x >= this.course.finishX) { if (s.mode === 'heelSkim') this.endSkim('release'); s.mode = 'finished'; this.emit({ type: 'finish', x: s.x }); }
  }

  private endSkim(reason: 'release' | 'push' | 'jump' | 'edge' | 'stopped'): void {
    const s = this.state;
    if (s.mode !== 'heelSkim') return;
    s.mode = 'grounded';
    this.emit({ type: 'skim-end', x: s.x, y: s.y, reason });
  }

  private leaveEdge(lip: Vec2, angle: number): void {
    const s = this.state;
    if (s.mode === 'heelSkim') this.endSkim('edge');
    s.x = lip.x; s.y = lip.y; s.angle = angle;
    this.syncContactVelocity();
    s.mode = 'airborne'; s.leftBy = 'edge'; s.coyote = this.M.coyoteTime;
    s.jumpStrokeId = -1;
    this.resetAir();
    s.lastContact = 'ground';
    s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = s.speed;
    this.emit({ type: 'leave-edge', x: s.x, y: s.y });
  }

  // ================================================================== airborne

  private timeToFall(h: number): number {
    if (!isFinite(h)) return Infinity;
    const g = this.M.airGravity, vd = -this.state.vy;
    return (-vd + Math.sqrt(Math.max(0, vd * vd + 2 * g * Math.max(0, h)))) / g;
  }

  private heightAboveGround(): number {
    const s = this.state;
    let best = Infinity;
    for (const lead of [0, 0.1]) {
      const x = s.x + s.vx * lead;
      const g = this.course.groundBelow(x, s.y + 0.05);
      if (g) best = Math.min(best, s.y - g.sample.y);
    }
    return best;
  }

  private stepAirborne(): void {
    const s = this.state, M = this.M, K = this.K, dt = this.dt;
    s.airTime += dt;
    s.coyote = Math.max(0, s.coyote - dt);
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
    if (!s.prepHeld) s.prepTimer = Math.max(0, s.prepTimer - dt);
    if (s.air === 'flip') {
      s.flip = Math.min(1, s.flip + dt / K.flipDuration);
      if (s.flip >= 1) { s.air = 'none'; s.flip = 0; this.emit({ type: 'flip-complete', x: s.x, y: s.y }); this.earnCredit('flip'); }
    } else if (s.air === 'grabLeft' || s.air === 'grabRight') s.contactTime += dt;
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
    // contacts that need a held / armed intent
    if (this.isPrepArmed()) this.tryRailCatch();
    if (s.mode === 'airborne' && this.sideHeld?.side === 'right' && s.air === 'grabRight' && this.sideHeld.strokeId === s.sideStrokeId) {
      const w = this.wallCatchable();
      if (w.wall) {
        s.air = 'none';
        this.emit({ type: 'grab-end', side: 'right', held: s.contactTime });
        this.startWall(w.wall, s.sideStrokeId);
      }
    }
    if (s.mode === 'airborne' && s.y < this.course.lowestNear(s.x) - M.failDepth) this.failGap();
  }

  private isPrepArmed(): boolean {
    const s = this.state;
    return s.prepStrokeId !== -1 && (s.prepHeld || s.prepTimer > 0);
  }

  /** Swept contact against the surface where the rider actually arrives. */
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
      for (let i = 0; i < pts.length - 1; i++) {
        const A = pts[i], B = pts[i + 1];
        if (B.x < lo || A.x > hi) continue;
        const ex = B.x - A.x, ey = B.y - A.y;
        const side0 = ex * (p0.y - A.y) - ey * (p0.x - A.x);
        const into = ex * dy - ey * dx;
        if (side0 < -1e-7 || into >= 0) continue;
        const t = -side0 / into;
        if (t <= 1e-9 || t > 1) continue; // t=0: already touching (handled by the safety net)
        const hx = p0.x + dx * t;
        const u = (hx - A.x) / ex;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        if (!best || t < best.t) best = { kind: 'land', t, surface: surf, x: hx, y: p0.y + dy * t };
      }
      if (p1.x < x0 || p1.x > x1) continue;
      const h1 = Course.sample(surf, p1.x).y;
      if (p1.y >= h1) continue;
      if (p0.x < x0 && dx > 0) {
        const t = (x0 - p0.x) / dx;
        const yAt = p0.y + dy * t;
        const hx0 = pts[0].y;
        if (yAt >= hx0 - lipTol) {
          if (!best || t < best.t) best = { kind: 'land', t, surface: surf, x: x0, y: hx0 };
        } else if (!best || t < best.t) best = { kind: 'face', t, surface: surf, x: x0, y: yAt };
        continue;
      }
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
    const s = this.state, M = this.M, K = this.K;
    const sm = Course.sample(surf, x);
    const th = Math.atan(sm.slope);
    s.x = x; s.y = sm.y;
    // trick checks first: the landing must be clean
    if (s.air === 'flip' && s.flip < K.flipLandTolerance) {
      return this.fail({ kind: 'unfinished-flip', x, y: sm.y, message: `Landed mid-flip (${Math.round(s.flip * 100)}% round) — flip from a bigger jump or start it sooner` });
    }
    if (s.air === 'grabLeft' || s.air === 'grabRight') {
      return this.fail({ kind: 'landed-grabbing', x, y: sm.y, message: `Landed still holding the ${s.air === 'grabLeft' ? 'left' : 'right'} grab — let go before touchdown` });
    }
    const flipped = s.flipsThisJump > 0;
    if (s.air === 'flip') { this.emit({ type: 'flip-complete', x, y: sm.y }); this.earnCredit('flip'); } // absorbed by the landing (within tolerance)
    const before = Math.hypot(s.vx, s.vy);
    const tangential = s.vx * Math.cos(th) + s.vy * Math.sin(th);
    const impact = Math.max(0, -(-s.vx * Math.sin(th) + s.vy * Math.cos(th)));
    s.speed = Math.min(Math.max(tangential, M.landingRetention * Math.abs(s.vx), 0), M.hardCap);
    s.mode = 'grounded';
    s.surfaceId = surf.id; s.seg = sm.seg; s.angle = th;
    s.groundTime = 0; s.coyote = 0; s.leftBy = 'none';
    s.air = 'none'; s.flip = 0; s.airTime = 0;
    s.lastContact = 'ground'; s.lastContactId = surf.id;
    s.pushStrokeId = -1;
    this.syncContactVelocity();
    this.emit({ type: 'land', x, y: sm.y, impact, speedBefore: before, speedAfter: s.speed, material: surf.material, flipped });
    if (s.jumpBuffer > 0) { this.jump('buffered', -1); return; }
    // landing prep still held on ordinary ground => heel skim
    if (s.prepHeld && s.prepStrokeId !== -1) {
      s.mode = 'heelSkim';
      s.contactTime = 0;
      this.emit({ type: 'skim-start', x, y: sm.y });
    } else {
      s.prepStrokeId = -1; s.prepTimer = 0;
    }
  }

  // ================================================================== rails

  /** Catch a rail if the rider is genuinely in its catch band right now. */
  private tryRailCatch(): void {
    const s = this.state, K = this.K;
    if (s.mode !== 'airborne') return;
    if (s.air === 'flip') return; // can't lock on mid-rotation
    for (const r of this.course.rails) {
      const x0 = Course.railX0(r), x1 = Course.railX1(r);
      if (s.x < x0 - K.railCatchBefore || s.x > x1 - 0.5) continue;
      const cx = Math.max(s.x, x0);
      const ry = Course.railSample(r, cx).y;
      const d = s.y - ry;
      if (d > K.railCatchAbove || d < -K.railCatchBelow) continue;
      if (d < 0 && s.vy > K.railCatchMaxRise) continue;
      this.startGrind(r, cx);
      return;
    }
  }

  /** Diagnostic: why the nearest rail is not catchable right now (or null if none near). */
  railCatchReport(): string | null {
    const s = this.state, K = this.K;
    for (const r of this.course.rails) {
      const x0 = Course.railX0(r), x1 = Course.railX1(r);
      if (s.x < x0 - 6 || s.x > x1) continue;
      if (s.x < x0 - K.railCatchBefore) return `rail ${r.id}: ${(x0 - K.railCatchBefore - s.x).toFixed(1)} m before catch area`;
      const d = s.y - Course.railSample(r, Math.max(s.x, x0)).y;
      if (d > K.railCatchAbove) return `rail ${r.id}: ${(d - K.railCatchAbove).toFixed(2)} m too high`;
      if (d < -K.railCatchBelow) return `rail ${r.id}: ${(-K.railCatchBelow - d).toFixed(2)} m too low`;
      return `rail ${r.id}: in catch band`;
    }
    return null;
  }

  private startGrind(r: Rail, x: number): void {
    const s = this.state;
    const sm = Course.railSample(r, x);
    const th = Math.atan(sm.slope);
    const speedIn = Math.hypot(s.vx, s.vy);
    s.speed = Math.min(Math.max(s.vx * Math.cos(th) + s.vy * Math.sin(th), this.M.landingRetention * s.vx, 0), this.M.hardCap);
    s.mode = 'grinding'; s.railId = r.id; s.x = x; s.y = sm.y; s.angle = th; s.contactTime = 0;
    s.air = 'none'; s.flip = 0;
    s.prepStrokeId = -1; s.prepHeld = false; s.prepTimer = 0;
    this.syncContactVelocity();
    this.emit({ type: 'grind-start', railId: r.id, x, y: sm.y, speed: speedIn });
  }

  private stepGrinding(): void {
    const s = this.state, M = this.M, K = this.K, dt = this.dt;
    const r = this.course.rails[s.railId];
    let sm = Course.railSample(r, s.x);
    const th = Math.atan(sm.slope);
    const v = s.speed;
    let acc = -M.slopeGravity * Math.sin(th) - K.grindFriction - M.airDrag * v * v;
    if (v < K.grindSustainSpeed) acc += K.grindSustainAccel;
    if (v > M.softCap) acc -= M.overCapDrag * (v - M.softCap);
    s.speed = Math.min(Math.max(v + acc * dt, 0.5), M.hardCap);
    s.contactTime += dt;
    const nx = s.x + s.speed * Math.cos(th) * dt;
    const x1 = Course.railX1(r);
    if (nx >= x1) {
      sm = Course.railSample(r, x1);
      s.x = x1; s.y = sm.y; s.angle = Math.atan(sm.slope);
      this.syncContactVelocity();
      s.vy += K.grindExitPop;
      this.emit({ type: 'grind-end', railId: r.id, x: s.x, y: s.y, reason: 'end' });
      s.lastContact = 'rail'; s.lastContactId = r.id; s.railId = -1;
      s.mode = 'airborne'; s.leftBy = 'rail'; s.jumpStrokeId = -1; s.coyote = 0;
      this.resetAir();
      s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = s.speed;
      return;
    }
    sm = Course.railSample(r, nx);
    s.x = nx; s.y = sm.y; s.angle = Math.atan(sm.slope);
    this.syncContactVelocity();
  }

  // ================================================================== walls

  /** Wall-ride context: actual proximity (inside the span), height band and momentum. */
  wallCatchable(): { wall: Wall | null; reason: string | null } {
    const s = this.state, K = this.K;
    let reason: string | null = null;
    for (const w of this.course.walls) {
      if (w.side !== 'right') continue;
      const near = s.x >= w.x0 - 0.5 && s.x <= w.x1 - K.wallCatchEndMargin;
      if (!near) { if (s.x > w.x0 - 15 && s.x < w.x0) reason = `wall ${(w.x0 - s.x).toFixed(1)} m ahead (not beside you yet)`; continue; }
      if (s.y < w.yBottom + K.wallBandBottom) { reason = 'too low on the wall'; continue; }
      if (s.y > w.yTop - K.wallBandTop) { reason = 'above the wall top'; continue; }
      if (s.vx < K.wallMinSpeed) { reason = `too slow for the wall (${s.vx.toFixed(1)} < ${K.wallMinSpeed} m/s)`; continue; }
      return { wall: w, reason: null };
    }
    return { wall: null, reason };
  }

  private startWall(w: Wall, strokeId: number): void {
    const s = this.state, K = this.K;
    s.mode = 'wallRiding'; s.wallId = w.id; s.sideStrokeId = strokeId; s.contactTime = 0;
    s.speed = Math.min(s.vx, this.M.hardCap);
    s.vy = Math.min(K.wallEntryVyMax, s.vy * K.wallEntryVyScale);
    s.wallEntrySpeed = s.speed;
    s.air = 'none'; s.flip = 0;
    s.prepStrokeId = -1; s.prepHeld = false; s.prepTimer = 0;
    s.angle = 0;
    this.emit({ type: 'wall-start', wallId: w.id, x: s.x, y: s.y, speed: s.speed });
  }

  private stepWall(): void {
    const s = this.state, M = this.M, K = this.K, dt = this.dt;
    const w = this.course.walls[s.wallId];
    const v = s.speed;
    let acc = -K.wallFriction - M.airDrag * v * v;
    if (v > M.softCap) acc -= M.overCapDrag * (v - M.softCap);
    s.speed = Math.min(Math.max(v + acc * dt, 0), M.hardCap);
    s.vy -= K.wallGravity * dt;
    s.contactTime += dt;
    const p0 = { x: s.x, y: s.y };
    const p1 = { x: s.x + s.speed * dt, y: Math.min(s.y + s.vy * dt, w.yTop - K.wallBandTop) };
    s.vx = s.speed;
    // the ground can still come up under a wall ride
    const hit = this.sweep(p0, p1);
    if (hit && hit.kind === 'land') { this.emit({ type: 'wall-end', wallId: w.id, x: s.x, y: s.y, reason: 'end' }); this.afterWall(); return this.land(hit.surface, hit.x); }
    if (hit && hit.kind === 'face') { this.emit({ type: 'wall-end', wallId: w.id, x: s.x, y: s.y, reason: 'slid-off' }); this.afterWall(); return this.failFace(hit.surface, hit.x, hit.y); }
    s.x = p1.x; s.y = hit && hit.kind === 'snap' ? hit.y : p1.y;
    s.angle = Math.atan2(s.vy, s.speed);
    if (s.x >= w.x1) return this.leaveWall('end');
    if (s.y < w.yBottom + K.wallBandBottom) return this.leaveWall('slid-off');
    if (s.speed < K.wallMinSpeed * 0.6) return this.leaveWall('too-slow');
  }

  private afterWall(): void {
    const s = this.state;
    s.lastContact = 'wall'; s.lastContactId = s.wallId; s.wallId = -1;
    s.mode = 'airborne'; s.leftBy = 'wall'; s.jumpStrokeId = -1; s.coyote = 0;
    this.resetAir();
    s.sideTriedThisAir = true;
  }

  private leaveWall(reason: 'end' | 'release' | 'slid-off' | 'too-slow'): void {
    const s = this.state, K = this.K;
    this.emit({ type: 'wall-end', wallId: s.wallId, x: s.x, y: s.y, reason });
    s.vx = s.speed;
    if (reason === 'end') s.vy = Math.max(s.vy, 0) + K.wallExitPop;
    else if (reason === 'release') s.vy = Math.max(s.vy, 0) + K.wallKickOff;
    s.sideStrokeId = -1; // the hold is spent: it can't turn into a grab
    this.afterWall();
    s.takeoffX = s.x; s.takeoffY = s.y; s.takeoffSpeed = s.speed;
  }

  // ================================================================== failure

  private failFace(surf: Surface, x: number, y: number): void {
    const s = this.state;
    const below = surf.points[0].y - y;
    const gap = this.course.gaps.find((g) => Math.abs(g.x1 - x) < 0.5);
    const req = this.requiredMessage(gap?.requires);
    this.fail({ kind: req?.kind ?? 'hit-ledge-face', x, y, gapX1: x, message: req?.message ?? `Hit the far ledge ${below.toFixed(1)} m below its lip — needed more height or speed` });
    s.x = x; s.y = y;
  }

  /** Readable explanations for missing a compulsory rail or wall. */
  private requiredMessage(req: 'jump' | 'rail' | 'wall' | undefined): { kind: FailInfo['kind']; message: string } | null {
    const s = this.state;
    if (req === 'rail') {
      if (s.lastContact === 'rail') return { kind: 'missed-rail', message: 'Came off the rail early — stay on until its end' };
      if (!s.prepTriedThisAir) return { kind: 'missed-rail', message: 'Missed the required rail — jump, then swipe down as you reach it' };
      return { kind: 'missed-rail', message: `Swiped down but never reached the rail's catch area (${s.takeoffSpeed.toFixed(1)} m/s takeoff) — jump closer to it` };
    }
    if (req === 'wall') {
      if (s.lastContact === 'wall') return { kind: 'fell-off-wall', message: `Dropped off the wall short of the landing (entered at ${s.wallEntrySpeed.toFixed(1)} m/s) — hit it faster or higher` };
      if (!s.sideTriedThisAir) return { kind: 'missed-wall', message: 'Missed the required wall ride — jump, then hold right beside the wall' };
      return { kind: 'missed-wall', message: 'Held right but never met the wall (too early, too low or too slow)' };
    }
    return null;
  }

  private failGap(): void {
    const s = this.state;
    const gap = this.course.gaps.find((g) => s.takeoffX <= g.x0 + 0.5 && s.x < g.x1 + 2 && s.x > g.x0 - 40) ?? this.course.gapAt(s.x);
    const shortBy = gap ? Math.max(0, gap.x1 - s.x) : undefined;
    const req = this.requiredMessage(gap?.requires);
    if (req) return this.fail({ ...req, x: s.x, y: s.y, gapX1: gap?.x1, shortBy });
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
  if (sim.state.mode !== 'grounded' && sim.state.mode !== 'heelSkim') return [];
  const clone = new Simulation(sim.course, sim.T);
  clone.cloneFrom(sim);
  clone.state.prepHeld = false; clone.state.prepStrokeId = -1;
  clone.enqueue({ type: 'up', strokeId: -2, source: 'test' });
  const out: Vec2[] = [];
  for (let i = 0; i < maxTicks; i++) {
    clone.step();
    if (i % 4 === 0) out.push({ x: clone.state.x, y: clone.state.y });
    if (clone.state.mode !== 'airborne') { out.push({ x: clone.state.x, y: clone.state.y }); break; }
  }
  return out;
}
