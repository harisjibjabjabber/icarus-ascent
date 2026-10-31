import { TUNING } from './tuning';
import { buildLabCourse } from './course/lab';
import type { Course } from './course/course';
import { Simulation, predictJumpArc } from './sim/simulation';
import type { Action } from './input/actions';
import { GestureRecognizer } from './input/gesture';
import { bindInput } from './input/dom';
import { Recorder, Replayer, type Trace } from './diag/recorder';
import { DevOverlay } from './diag/overlay';
import { GameView, snap, type Snapshot } from './render/view';
import { newSeed } from './rng';
import { Autopilot } from './diag/autopilot';

/** Composition root: owns the loop and wires input -> sim -> presentation/diagnostics. */
export class Game {
  private seed: number;
  private course!: Course;
  private sim!: Simulation;
  private recorder!: Recorder;
  private replayer: Replayer | null = null;
  private lastTrace: Trace | null = null;
  private pending: Action[] = [];
  private acc = 0;
  private prev!: Snapshot;
  private curr!: Snapshot;
  private failTime = 0;
  private lastFrame = 0;
  private paused = false;
  private autopilot: Autopilot | null = null;
  private fps = 60;
  private hintDismissed = false;
  readonly gestures = new GestureRecognizer();
  readonly view: GameView;
  readonly overlay: DevOverlay;
  private ui: { hint: HTMLElement; fail: HTMLElement; failText: HTMLElement; speed: HTMLElement };

  constructor(root: HTMLElement) {
    this.view = new GameView(root);
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hint">Swipe <b>down</b> push · <b>up</b> jump<br>In the air: <b>up</b> backflip · <b>down</b> grind a rail · hold <b>right</b> by a wall to wall-ride (else grab)<br>Hold <b>down</b> into a landing to heel-skim (slows you)<br><span>Keys: ↓ push/grind/skim · ↑ / Space jump/flip · → / ← hold wall-ride/grab</span></div>
      <div class="fail"><div class="fail-text"></div><div class="fail-sub">Tap / ↑ to retry · same course</div></div>
      <div class="buttons"><button data-act="new">New run</button><button data-act="dev">Dev</button></div>
      <div class="speed"></div>`;
    root.appendChild(hud);
    this.overlay = new DevOverlay(root);
    this.view.showArc = this.overlay.visible;
    this.ui = { hint: hud.querySelector('.hint')!, fail: hud.querySelector('.fail')!, failText: hud.querySelector('.fail-text')!, speed: hud.querySelector('.speed')! };
    for (const b of hud.querySelectorAll('button')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = (b as HTMLElement).dataset.act;
        if (act === 'new') this.newRun();
        if (act === 'dev') this.toggleDev();
        (b as HTMLElement).blur();
      });
    }
    const params = new URLSearchParams(location.search);
    this.seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();
    this.loadCourse();
    this.startRun();
    bindInput(this.view.renderer.domElement, this.gestures, {
      onAction: (a) => this.onAction(a),
      onKey: (code) => this.onMetaKey(code),
    });
    window.addEventListener('resize', () => this.view.resize());
    (window as any).icarus = {
      game: this,
      trace: () => this.recorder.trace,
      lastTrace: () => this.lastTrace,
      replay: (t?: Trace) => this.startReplay(t ?? this.lastTrace),
      tuning: TUNING,
      // dev: freeze the real-time loop and drive the sim deterministically (screenshots, debugging)
      pause: (on = true) => { this.paused = on; this.lastFrame = 0; },
      autopilot: (opts: ConstructorParameters<typeof Autopilot>[0]) => { this.autopilot = new Autopilot(opts); },
      advance: (ticks: number, until?: (g: Game) => boolean) => {
        for (let i = 0; i < ticks; i++) {
          this.tick();
          if (i % 2 === 1) this.view.render(TUNING.sim.dt * 2, this.prev, this.curr, 1);
          if (until && until(this)) break;
        }
        this.view.render(TUNING.sim.dt, this.prev, this.curr, 1);
        return this.sim.state.tick;
      },
    };
  }

  private toggleDev(): void { this.overlay.toggle(); this.view.showArc = this.overlay.visible; }

  private onMetaKey(code: string): boolean {
    switch (code) {
      case 'Backquote': case 'KeyO': this.toggleDev(); return true;
      case 'KeyR': this.retry(); return true;
      case 'KeyN': this.newRun(); return true;
      case 'KeyL': this.startReplay(this.lastTrace ?? this.recorder.trace); return true;
      case 'Enter': if (this.sim.state.mode === 'failed' || this.sim.state.mode === 'finished') { this.retry(); return true; } return false;
    }
    return false;
  }

  private loadCourse(): void {
    this.course = buildLabCourse(this.seed);
    this.view.setCourse(this.course);
    const url = new URL(location.href);
    url.searchParams.set('seed', String(this.seed));
    history.replaceState(null, '', url);
  }

  private startRun(replay: Trace | null = null): void {
    if (this.recorder && this.recorder.trace.entries.length && !this.replayer) this.lastTrace = this.recorder.finish(this.sim.state.tick);
    this.sim = new Simulation(this.course);
    this.recorder = new Recorder(this.seed);
    this.replayer = replay ? new Replayer(replay) : null;
    this.pending = [];
    this.acc = 0;
    this.prev = this.curr = snap(this.sim.state);
    this.view.resetRun(this.curr);
    this.overlay.resetRun();
    this.ui.fail.classList.remove('show');
  }

  retry(): void { this.startRun(); }

  newRun(): void { this.seed = newSeed(); this.loadCourse(); this.startRun(); }

  private startReplay(t: Trace | null): void {
    if (!t) return;
    if (t.seed !== this.seed) { this.seed = t.seed; this.loadCourse(); }
    this.startRun(t);
  }

  private onAction(a: Action): void {
    this.overlay.onAction(a);
    const st = this.sim.state;
    if (st.mode === 'failed' || st.mode === 'finished') {
      const t = performance.now() / 1000;
      if (t - this.failTime >= TUNING.failure.retryLockout && (a.type === 'tap' || a.type === 'up' || (a.type === 'down' && a.fresh))) this.retry();
      return;
    }
    if (this.replayer) { if (a.type === 'tap' || a.type === 'up' || a.type === 'down') this.retry(); return; } // any input exits replay
    if (!this.hintDismissed && (a.type === 'down' || a.type === 'up')) { this.hintDismissed = true; this.ui.hint.classList.add('gone'); }
    this.pending.push(a);
  }

  private tick(): void {
    const tick = this.sim.state.tick;
    if (this.autopilot && !this.replayer) this.pending.push(...this.autopilot.next(this.sim));
    const actions = this.replayer ? this.replayer.actionsFor(tick) : this.pending.splice(0);
    for (const a of actions) { if (!this.replayer) this.recorder.record(tick, a); this.sim.enqueue(a); }
    this.prev = this.curr;
    this.sim.step();
    this.curr = snap(this.sim.state);
    for (const e of this.sim.drainEvents()) {
      this.view.onEvent(e, this.curr.speed);
      this.overlay.onEvent(e);
      if (e.type === 'fail' || e.type === 'finish') this.onRunEnd(e.type === 'fail' ? e.info.message : 'Lab complete — nice line.');
    }
  }

  private onRunEnd(msg: string): void {
    this.failTime = performance.now() / 1000;
    this.ui.failText.textContent = msg;
    this.ui.fail.classList.add('show');
    if (!this.replayer) this.lastTrace = this.recorder.finish(this.sim.state.tick);
  }

  frame(now: number): void {
    if (this.paused) return;
    const dtReal = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    this.fps += (1 / Math.max(dtReal, 1e-3) - this.fps) * 0.05;
    const dt = TUNING.sim.dt;
    this.acc += dtReal;
    let steps = 0;
    while (this.acc >= dt && steps < TUNING.sim.maxStepsPerFrame) { this.tick(); this.acc -= dt; steps++; }
    if (steps >= TUNING.sim.maxStepsPerFrame) this.acc = 0;
    this.view.render(dtReal, this.prev, this.curr, this.acc / dt);
    if (this.overlay.visible) this.view.setArc(predictJumpArc(this.sim));
    else this.view.setArc([]);
    this.overlay.update(this.sim.state, this.gestures, {
      seed: this.seed, replay: !!this.replayer, fps: this.fps,
      context: this.sim.state.mode === 'airborne'
        ? `rail: ${this.sim.railCatchReport() ?? 'none near'} | wall: ${this.sim.wallCatchable().reason ?? 'catchable'}`
        : this.sim.state.mode,
    });
    this.ui.speed.style.setProperty('--v', String(Math.min(1, this.curr.speed / TUNING.movement.hardCap)));
  }
}
