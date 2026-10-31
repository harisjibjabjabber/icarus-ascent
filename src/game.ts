import { TUNING } from './tuning';
import { buildLabCourse } from './course/lab';
import { buildOpeningCourse } from './course/opening';
import { BUILD_VERSION, VersionWatcher } from './version';
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
import { Sfx } from './audio/sfx';

/** Composition root: owns the loop and wires input -> sim -> presentation/diagnostics. */
export class Game {
  private seed: number;
  /** 'opening' (default, authored lessons) or 'lab' (?lab). */
  private mode: 'opening' | 'lab' = 'opening';
  /** Opening: index of the furthest lesson checkpoint reached this attempt. */
  private cpIndex = 0;
  private runStarted = false;
  private versionWatcher!: VersionWatcher;
  private promptKey = '';
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
  readonly sfx = new Sfx();
  readonly view: GameView;
  readonly overlay: DevOverlay;
  private ui: { hint: HTMLElement; fail: HTMLElement; failText: HTMLElement; failSub: HTMLElement; speed: HTMLElement; prompt: HTMLElement; finish: HTMLElement; version: HTMLElement };

  constructor(root: HTMLElement) {
    this.view = new GameView(root);
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hint">Swipe <b>down</b> push · <b>up</b> jump<br>In the air: <b>up</b> backflip · <b>down</b> grind a rail · hold <b>right</b> by a wall to wall-ride (else grab)<br>Hold <b>down</b> into a landing to heel-skim (slows you)<br>Pots: jump them or heel-break them · Pillars: smash through mid-grab, mid-flip or heel-skimming<br><span>Keys: ↓ push/grind/skim · ↑ / Space jump/flip · → / ← hold wall-ride/grab · M sound</span></div>
      <div class="prompt"><div class="prompt-lesson"></div><div class="prompt-text"></div><div class="prompt-keys"></div></div>
      <div class="fail"><div class="fail-text"></div><div class="fail-sub">Tap / ↑ to retry · same course</div></div>
      <div class="finish"><div class="finish-title">Course complete</div><div class="finish-sub">That's every move. The lab has more of each.</div>
        <div class="finish-buttons"><button data-act="again">Ride again</button><button data-act="lab">Go to the lab</button></div></div>
      <div class="buttons"><button data-act="sound" class="sound"></button><button data-act="mode" class="mode"></button><button data-act="new" class="new">New run</button><button data-act="dev">Dev</button></div>
      <div class="speed"></div>
      <div class="version"></div>`;
    root.appendChild(hud);
    this.overlay = new DevOverlay(root);
    this.view.showArc = this.overlay.visible;
    this.ui = {
      hint: hud.querySelector('.hint')!, fail: hud.querySelector('.fail')!, failText: hud.querySelector('.fail-text')!, failSub: hud.querySelector('.fail-sub')!,
      speed: hud.querySelector('.speed')!, prompt: hud.querySelector('.prompt')!, finish: hud.querySelector('.finish')!, version: hud.querySelector('.version')!,
    };
    this.ui.version.textContent = `v ${BUILD_VERSION}`;
    for (const b of hud.querySelectorAll('button')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = (b as HTMLElement).dataset.act;
        if (act === 'new') this.newRun();
        if (act === 'dev') this.toggleDev();
        if (act === 'sound') this.toggleSound();
        if (act === 'mode') this.setMode(this.mode === 'lab' ? 'opening' : 'lab');
        if (act === 'again') { this.cpIndex = 0; this.startRun(); }
        if (act === 'lab') this.setMode('lab');
        (b as HTMLElement).blur();
      });
    }
    this.updateSoundButton();
    const params = new URLSearchParams(location.search);
    this.seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();
    this.mode = params.has('lab') ? 'lab' : 'opening';
    this.loadCourse();
    this.startRun();
    this.versionWatcher = new VersionWatcher(() => this.canReload());
    this.versionWatcher.start();
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
      version: BUILD_VERSION,
      setMode: (m: 'opening' | 'lab') => this.setMode(m),
      /** dev: jump to an opening lesson's checkpoint */
      lesson: (i: number) => { this.cpIndex = Math.max(0, Math.min(i, this.course.lessons.length - 1)); this.startRun(); },
      // dev: freeze the real-time loop and drive the sim deterministically (screenshots, debugging)
      pause: (on = true) => { this.paused = on; this.lastFrame = 0; },
      autopilot: (opts: ConstructorParameters<typeof Autopilot>[0]) => { this.autopilot = new Autopilot(opts); },
      advance: (ticks: number, until?: (g: Game) => boolean, renderEvery = 2) => {
        for (let i = 0; i < ticks; i++) {
          this.tick();
          this.updateLessons();
          if (i % renderEvery === renderEvery - 1) this.view.render(TUNING.sim.dt * renderEvery, this.prev, this.curr, 1);
          if (until && until(this)) break;
        }
        this.view.render(TUNING.sim.dt, this.prev, this.curr, 1);
        return this.sim.state.tick;
      },
    };
  }

  private toggleSound(): void {
    this.sfx.unlock();
    this.sfx.setMuted(!this.sfx.muted);
    this.updateSoundButton();
  }

  private updateSoundButton(): void {
    const b = document.querySelector('button.sound');
    if (b) b.textContent = this.sfx.muted ? 'Sound off' : 'Sound on';
  }

  private toggleDev(): void { this.overlay.toggle(); this.view.showArc = this.overlay.visible; }

  private onMetaKey(code: string): boolean {
    switch (code) {
      case 'Backquote': case 'KeyO': this.toggleDev(); return true;
      case 'KeyR': this.retry(); return true;
      case 'KeyM': this.toggleSound(); return true;
      case 'KeyN': this.newRun(); return true;
      case 'KeyC': this.setMode(this.mode === 'lab' ? 'opening' : 'lab'); return true;
      case 'KeyL': this.startReplay(this.lastTrace ?? this.recorder.trace); return true;
      case 'Enter': if (this.sim.state.mode === 'failed' || this.sim.state.mode === 'finished') { this.retry(); return true; } return false;
    }
    return false;
  }

  private loadCourse(): void {
    this.course = this.mode === 'lab' ? buildLabCourse(this.seed) : buildOpeningCourse();
    this.cpIndex = 0;
    this.view.setCourse(this.course);
    const url = new URL(location.href);
    if (this.mode === 'lab') { url.searchParams.set('lab', ''); url.searchParams.set('seed', String(this.seed)); }
    else { url.searchParams.delete('lab'); url.searchParams.delete('seed'); }
    history.replaceState(null, '', url.toString().replace('lab=&', 'lab&').replace(/lab=$/, 'lab'));
    document.title = this.mode === 'lab' ? "Icarus's Ascent — Movement Lab" : "Icarus's Ascent";
    const modeBtn = document.querySelector('button.mode'); if (modeBtn) modeBtn.textContent = this.mode === 'lab' ? 'Course' : 'Lab';
    const newBtn = document.querySelector('button.new'); if (newBtn) newBtn.textContent = this.mode === 'lab' ? 'New run' : 'Restart';
    // the full control sheet is for the lab; the opening teaches through its prompts
    this.ui.hint.style.display = this.mode === 'lab' ? '' : 'none';
  }

  private setMode(m: 'opening' | 'lab'): void {
    if (m === this.mode) return;
    this.mode = m;
    this.loadCourse();
    this.startRun();
  }

  /** Safe to reload for a new build: not mid-run (start, fail or finish screen). */
  private canReload(): boolean {
    const m = this.sim?.state.mode;
    return !this.runStarted || m === 'failed' || m === 'finished';
  }

  /** Where the current attempt starts: the reached lesson's checkpoint (opening) or the start. */
  private startPoint(): { x: number; speed: number } | undefined {
    if (this.mode !== 'opening' || this.cpIndex <= 0) return undefined;
    const l = this.course.lessons[this.cpIndex];
    return { x: l.cpX, speed: l.cpSpeed };
  }

  private startRun(replay: Trace | null = null): void {
    if (this.recorder && this.recorder.trace.entries.length && !this.replayer) this.lastTrace = this.recorder.finish(this.sim.state.tick);
    const start = replay ? replay.start : this.startPoint();
    this.sim = new Simulation(this.course, TUNING, start);
    this.recorder = new Recorder(this.seed, this.course.kind, start);
    this.runStarted = false;
    this.replayer = replay ? new Replayer(replay) : null;
    this.pending = [];
    this.acc = 0;
    this.prev = this.curr = snap(this.sim.state);
    this.view.resetRun(this.curr);
    this.overlay.resetRun();
    this.ui.fail.classList.remove('show');
    this.ui.finish.classList.remove('show');
    this.promptKey = '';
    this.versionWatcher?.safePoint();
  }

  retry(): void {
    if (this.sim.state.mode === 'finished') this.cpIndex = 0; // finished: ride again from the top
    this.startRun();
  }

  newRun(): void {
    if (this.mode === 'lab') this.seed = newSeed();
    this.loadCourse();
    this.startRun();
  }

  private startReplay(t: Trace | null): void {
    if (!t) return;
    const m = t.course === 'opening' ? 'opening' : 'lab';
    if (m !== this.mode || (m === 'lab' && t.seed !== this.seed)) { this.mode = m; this.seed = t.seed; this.loadCourse(); }
    this.startRun(t);
  }

  private onAction(a: Action): void {
    this.sfx.unlock(); // first gesture starts audio (autoplay rules)
    this.overlay.onAction(a);
    const st = this.sim.state;
    if (st.mode === 'finished' && this.mode === 'opening') return; // finish screen: use its buttons
    if (st.mode === 'failed' || st.mode === 'finished') {
      const t = performance.now() / 1000;
      if (t - this.failTime >= TUNING.failure.retryLockout && (a.type === 'tap' || a.type === 'up' || (a.type === 'down' && a.fresh))) this.retry();
      return;
    }
    if (this.replayer) { if (a.type === 'tap' || a.type === 'up' || a.type === 'down') this.retry(); return; } // any input exits replay
    if (!this.hintDismissed && (a.type === 'down' || a.type === 'up')) { this.hintDismissed = true; this.ui.hint.classList.add('gone'); }
    if (a.type !== 'release' && a.type !== 'tap') this.runStarted = true;
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
      this.sfx.onEvent(e);
      this.overlay.onEvent(e);
      if (e.type === 'fail' || e.type === 'finish') this.onRunEnd(e.type === 'fail' ? e.info.message : 'Lab complete — nice line.', e.type === 'finish');
    }
  }

  private onRunEnd(msg: string, finished = false): void {
    this.failTime = performance.now() / 1000;
    this.ui.prompt.classList.remove('show');
    if (finished && this.mode === 'opening') {
      this.ui.finish.classList.add('show');
    } else {
      this.ui.failText.textContent = msg;
      const l = this.mode === 'opening' ? this.course.lessons[this.cpIndex] : null;
      this.ui.failSub.textContent = finished ? 'Tap / ↑ to ride again' : l ? `Tap / ↑ to retry · from lesson ${l.id + 1}: ${l.title}` : 'Tap / ↑ to retry · same course';
      this.ui.fail.classList.add('show');
    }
    if (!this.replayer) this.lastTrace = this.recorder.finish(this.sim.state.tick);
    this.versionWatcher?.safePoint();
  }

  /** Opening: advance the checkpoint as lessons are reached; show the current calm prompt. */
  private updateLessons(): void {
    if (this.mode !== 'opening' || this.replayer) { this.ui.prompt.classList.remove('show'); return; }
    const st = this.sim.state;
    if (st.mode === 'grounded' || st.mode === 'heelSkim') {
      const i = this.course.lessonAt(st.x);
      if (i > this.cpIndex) this.cpIndex = i;
    }
    if (st.mode === 'failed' || st.mode === 'finished') return;
    const l = this.course.lessons.find((q) => st.x >= q.promptX0 && st.x < q.promptX1);
    const key = l ? String(l.id) : '';
    if (key === this.promptKey) return;
    this.promptKey = key;
    if (!l) { this.ui.prompt.classList.remove('show'); return; }
    (this.ui.prompt.querySelector('.prompt-lesson') as HTMLElement).textContent = `${l.id + 1} · ${l.title}`;
    (this.ui.prompt.querySelector('.prompt-text') as HTMLElement).textContent = l.prompt;
    (this.ui.prompt.querySelector('.prompt-keys') as HTMLElement).textContent = l.keys ? `keys: ${l.keys}` : '';
    this.ui.prompt.classList.add('show');
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
    this.sfx.update(this.sim.state);
    this.updateLessons();
    if (this.overlay.visible) this.view.setArc(predictJumpArc(this.sim));
    else this.view.setArc([]);
    this.overlay.update(this.sim.state, this.gestures, {
      seed: this.seed, replay: !!this.replayer, fps: this.fps, version: BUILD_VERSION,
      lesson: this.mode === 'opening' ? `${this.cpIndex + 1}/${this.course.lessons.length} ${this.course.lessons[this.cpIndex]?.title ?? ''}` : 'lab',
      context: this.sim.state.mode === 'airborne'
        ? `rail: ${this.sim.railCatchReport() ?? 'none near'} | wall: ${this.sim.wallCatchable().reason ?? 'catchable'}`
        : this.sim.state.mode,
    });
    this.ui.speed.style.setProperty('--v', String(Math.min(1, this.curr.speed / TUNING.movement.hardCap)));
  }
}
