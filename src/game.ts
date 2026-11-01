import { TUNING } from './tuning';
import { GAME_TITLE } from './meta';
import { buildLabCourse } from './course/lab';
import { buildOpeningCourse } from './course/opening';
import { EndlessCourse, SPEC } from './course/endless';
import type { SetPieceSpec } from './course/setpieces';
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
import { LOOKS, nextLook } from './render/heroine/looks';
import { ScoreKeeper, SCORE } from './score/score';
import { EndlessHud } from './score/hud';
import { zonesFromSearch } from './zones/registry';
import { ZONES } from './zones/registry';
import type { SimEvent } from './sim/types';
import { MAX_LIVES, newRunState, loseLife, retryCostsLife, updateBest, endRun, buildResume, parseResume, applyRunResume, type Checkpoint } from './score/run';

type Mode = 'opening' | 'endless' | 'lab';
const NEXT_MODE: Record<Mode, Mode> = { opening: 'endless', endless: 'lab', lab: 'opening' };
const MODE_LABEL: Record<Mode, string> = { opening: 'Course', endless: 'Endless', lab: 'Lab' };
/** Endless best = longest clean run (no fail) — v2 key: older bests included checkpoint retries. */
// Storage keys keep the legacy `icarus.` prefix on purpose: renaming them would wipe players' saved bests.
const BEST_KEY = 'icarus.endless.bestClean';
/** Endless v2: personal best score. */
const BEST_SCORE_KEY = 'icarus.endless.bestScore';
/** Endless v2: lives per run (src/score/run.ts). */
export { MAX_LIVES };
/** Checkpoint carried across an update reload (sessionStorage). */
const RESUME_KEY = 'icarus.resume';

/** Composition root: owns the loop and wires input -> sim -> presentation/diagnostics. */
export class Game {
  private seed: number;
  /** 'opening' (default, authored lessons), 'endless' (?endless, streamed phrases) or 'lab' (?lab). */
  private mode: Mode = 'opening';
  /** Endless: the furthest phrase checkpoint reached while grounded (retry point). */
  private endlessCp: Checkpoint | null = null;
  /** Where the current attempt started: endless distance (and best) is the clean run since then. */
  private attemptStartX = 0;
  /** Endless: distance shown in the HUD, and the local best. */
  private best = 0;
  /** Endless v2: score, lives / run-over state (src/score/run.ts), personal best score. */
  readonly score = new ScoreKeeper();
  readonly run = newRunState();
  get lives(): number { return this.run.lives; }
  get runOver(): boolean { return this.run.over; }
  private bestScore = 0;
  /** Endless zone order of the current course (recorded into traces). */
  private zones: string[] = [];
  private lastChunkId = -1;
  private lastWave = -2;
  private hud: EndlessHud;
  private startScreen = true;
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
  private ui: { hint: HTMLElement; fail: HTMLElement; failText: HTMLElement; failSub: HTMLElement; speed: HTMLElement; prompt: HTMLElement; finish: HTMLElement; version: HTMLElement; start: HTMLElement; distance: HTMLElement };

  constructor(root: HTMLElement) {
    this.view = new GameView(root);
    const hud = document.createElement('div');
    hud.className = 'hud';
    hud.innerHTML = `
      <div class="hint">Swipe <b>down</b> push · <b>up</b> jump<br>In the air: <b>up</b> backflip · <b>down</b> grind a rail · hold <b>right</b> by a wall to wall-ride (else grab)<br>Hold <b>down</b> into a landing to heel-skim (slows you)<br>Pots: jump them or heel-break them · Pillars: smash through mid-grab, mid-flip or heel-skimming<br><span>Keys: ↓ push/grind/skim · ↑ / Space jump/flip · → / ← hold wall-ride/grab · M sound</span></div>
      <div class="prompt"><div class="prompt-lesson"></div><div class="prompt-text"></div><div class="prompt-keys"></div></div>
      <div class="fail"><div class="fail-text"></div><div class="fail-sub">Tap / ↑ to retry · same course</div></div>
      <div class="finish"><div class="finish-title">Course complete</div><div class="finish-sub">That's every move. Keep going — endless strings them together.</div>
        <div class="finish-buttons"><button data-act="endless" class="primary">Continue endless</button><button data-act="again">Ride again</button><button data-act="lab">Go to the lab</button></div></div>
      <div class="start"><div class="start-title">${GAME_TITLE}</div><div class="start-sub">Swipe down to start the course</div>
        <div class="start-buttons"><button data-act="endless">Endless</button><button data-act="lab">Lab</button></div></div>
      <div class="distance"></div>
      <div class="buttons"><button data-act="sound" class="sound"></button><button data-act="mode" class="mode"></button><button data-act="look" class="look"></button><button data-act="new" class="new">New run</button><button data-act="dev">Dev</button></div>
      <div class="speed"></div>
      <div class="version"></div>`;
    root.appendChild(hud);
    this.hud = new EndlessHud(root);
    this.hud.onAgain = () => this.newRun();
    this.hud.onSameSeed = () => { this.loadCourse(); this.startRun(); };
    this.overlay = new DevOverlay(root);
    this.view.showArc = this.overlay.visible;
    this.ui = {
      hint: hud.querySelector('.hint')!, fail: hud.querySelector('.fail')!, failText: hud.querySelector('.fail-text')!, failSub: hud.querySelector('.fail-sub')!,
      speed: hud.querySelector('.speed')!, prompt: hud.querySelector('.prompt')!, finish: hud.querySelector('.finish')!, version: hud.querySelector('.version')!,
      start: hud.querySelector('.start')!, distance: hud.querySelector('.distance')!,
    };
    try { this.best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { this.best = 0; }
    try { this.bestScore = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0; } catch { this.bestScore = 0; }
    this.ui.version.textContent = `v ${BUILD_VERSION}`;
    for (const b of hud.querySelectorAll('button')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = (b as HTMLElement).dataset.act;
        if (act === 'new') this.newRun();
        if (act === 'dev') this.toggleDev();
        if (act === 'sound') this.toggleSound();
        if (act === 'look') this.toggleLook();
        if (act === 'mode') this.setMode(NEXT_MODE[this.mode]);
        if (act === 'again') { this.cpIndex = 0; this.startRun(); }
        if (act === 'lab') this.setMode('lab');
        if (act === 'endless') this.continueEndless();
        (b as HTMLElement).blur();
      });
    }
    this.updateSoundButton(); this.updateLookButton();
    const params = new URLSearchParams(location.search);
    this.seed = params.has('seed') ? Number(params.get('seed')) >>> 0 : newSeed();
    this.mode = params.has('lab') ? 'lab' : params.has('endless') ? 'endless' : 'opening';
    this.startScreen = this.mode === 'opening';
    this.loadCourse();
    this.resumeAfterReload();
    this.startRun();
    this.versionWatcher = new VersionWatcher(() => this.canReload(), undefined, () => this.saveResume());
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
      setMode: (m: Mode) => this.setMode(m),
      /** render stats for perf checks */
      renderInfo: () => ({ ...this.view.renderer.info.render, geometries: this.view.renderer.info.memory.geometries, programs: this.view.renderer.info.programs?.length, quality: this.view.quality.level.name }),
      continueEndless: () => this.continueEndless(),
      /** dev/review: autopilot off (e.g. to lose a life on purpose) */
      autopilotOff: () => { this.autopilot = null; },
      retry: () => this.retry(),
      score: () => ({ total: this.score.total, chain: this.score.chain, mult: this.score.mult, lives: this.lives, runOver: this.runOver, best: this.score.best }),
      /** dev: jump to an opening lesson's checkpoint */
      lesson: (i: number) => { this.cpIndex = Math.max(0, Math.min(i, this.course.lessons.length - 1)); this.startRun(); },
      // dev: freeze the real-time loop and drive the sim deterministically (screenshots, debugging)
      pause: (on = true) => { this.paused = on; this.lastFrame = 0; },
      autopilot: (opts: ConstructorParameters<typeof Autopilot>[0]) => { this.autopilot = new Autopilot(opts); },
      advance: (ticks: number, until?: (g: Game) => boolean, renderEvery = 2) => {
        for (let i = 0; i < ticks; i++) {
          this.tick();
          this.updateLessons();
          this.updateHud(TUNING.sim.dt);
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

  /** Switch Ao's outfit (the other look lazy-loads; the current one rides until it is ready). */
  private toggleLook(): void {
    void this.view.rider.setLook(nextLook(this.view.rider.look));
    this.updateLookButton();
  }

  private updateLookButton(): void {
    const b = document.querySelector('button.look');
    if (b) b.textContent = LOOKS[nextLook(this.view.rider.look)].label;
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
      case 'KeyC': this.setMode(NEXT_MODE[this.mode]); return true;
      case 'KeyE': this.continueEndless(); return true;
      case 'KeyL': this.startReplay(this.lastTrace ?? this.recorder.trace); return true;
      case 'Enter': if (this.sim.state.mode === 'failed' || this.sim.state.mode === 'finished') { this.retry(); return true; } return false;
    }
    return false;
  }

  /** Build the course for the current mode / seed (endless: `zones`, default from the URL) and start a fresh run. */
  private loadCourse(zones?: string[]): void {
    if (this.sim) { this.saveBest(); this.commitLiveBest(); }
    this.zones = this.mode === 'endless' ? [...(zones ?? zonesFromSearch(location.search))] : [];
    this.course = this.mode === 'lab' ? buildLabCourse(this.seed) : this.mode === 'endless' ? new EndlessCourse(this.seed, { zones: this.zones }) : buildOpeningCourse();
    this.resetEndlessRun();
    this.cpIndex = 0;
    this.endlessCp = null;
    this.view.setCourse(this.course);
    const url = new URL(location.href);
    url.searchParams.delete('lab'); url.searchParams.delete('endless'); url.searchParams.delete('seed');
    if (this.mode !== 'opening') { url.searchParams.set(this.mode, ''); url.searchParams.set('seed', String(this.seed)); }
    history.replaceState(null, '', url.toString().replace(/(lab|endless)=(&|$)/, '$1$2'));
    document.title = this.mode === 'lab' ? `${GAME_TITLE} — Movement Lab` : this.mode === 'endless' ? `${GAME_TITLE} — Endless` : GAME_TITLE;
    const modeBtn = document.querySelector('button.mode'); if (modeBtn) modeBtn.textContent = MODE_LABEL[NEXT_MODE[this.mode]];
    const newBtn = document.querySelector('button.new'); if (newBtn) newBtn.textContent = this.mode === 'opening' ? 'Restart' : 'New run';
    this.ui.distance.style.display = 'none'; // endless: the score HUD shows distance
    this.hud.show(this.mode === 'endless');
    if (this.mode !== 'opening') this.startScreen = false;
    this.ui.start.classList.toggle('show', this.startScreen);
    // the full control sheet is for the lab; the opening teaches through its prompts
    this.ui.hint.style.display = this.mode === 'lab' ? '' : 'none';
  }

  /** Before an update reload: remember where the player is (checkpoint, and in endless the whole run:
   *  score, lives, run over + summary) so the reload doesn't cost progress or resurrect a dead run. */
  private saveResume(): void {
    const finished = this.sim?.state.mode === 'finished';
    try { // (a replay leaves the run's score alone, so the run is saved during one too)
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(buildResume({ mode: this.mode, seed: this.seed, cpIndex: finished ? 0 : this.cpIndex, endlessCp: this.endlessCp, now: Date.now(), run: this.run, score: this.score })));
    } catch { /* storage blocked: reload anyway */ }
  }

  /** After an update reload: restore what saveResume stored (same mode and seed only). A run that was
   *  over comes back to its summary, never to a live run. */
  private resumeAfterReload(): void {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); } catch { raw = null; }
    const r = parseResume(raw, Date.now(), this.mode, this.seed);
    if (!r) return;
    this.cpIndex = Math.max(0, Math.min(r.cpIndex | 0, Math.max(0, this.course.lessons.length - 1)));
    this.endlessCp = r.endlessCp ?? null;
    const restored = this.mode === 'endless' && applyRunResume(r.run, this.run, this.score);
    if (this.cpIndex > 0 || this.endlessCp || restored) { this.startScreen = false; this.ui.start.classList.remove('show'); }
    if (!restored) return;
    this.hud.setLives(this.run.lives, MAX_LIVES);
    if (this.run.over) this.hud.summary(this.run.summary ?? endRun(this.run, this.score, this.runDistance(), this.bestScore, this.seed));
  }

  private setMode(m: Mode): void {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'endless') this.seed = newSeed();
    this.loadCourse();
    this.startRun();
  }

  /** Endless with a fresh seed; after the opening, carry some of the rider's speed in. */
  private continueEndless(): void {
    const carry = this.mode === 'opening' && this.sim?.state.mode === 'finished' ? Math.min(14, this.sim.state.speed) : 0;
    this.mode = 'endless';
    this.seed = newSeed();
    this.startScreen = false;
    this.loadCourse();
    if (carry > 0) this.endlessCp = { x: this.course.startX, speed: carry, title: 'Run-in' };
    this.startRun();
  }

  /** Endless: distance of the current clean run (since the attempt started; a retry starts a new one). */
  private distance(): number { return Math.max(0, this.sim.state.x - this.attemptStartX); }
  /** Endless v2: furthest distance reached this run (across lives). */
  private runDistance(): number { const m = this.score.furthestX; return Math.max(0, (Number.isFinite(m) ? m : this.course.startX) - this.course.startX); }

  /** Endless v2: a fresh run: score, lives, summary. */
  private resetEndlessRun(): void {
    this.score.reset();
    Object.assign(this.run, newRunState());
    this.lastChunkId = -1; this.lastWave = -2;
    this.hud?.hideSummary(); this.hud?.setLives(this.run.lives, MAX_LIVES);
  }

  /** Endless: a live run is about to be discarded (new run, same route, mode switch): keep its score as the personal best if it beats it. */
  private commitLiveBest(): void {
    if (this.course?.kind !== 'endless' || this.run.over) return;
    this.saveBestScore(this.score.total);
  }

  private saveBestScore(score: number): boolean {
    const pb = updateBest(score, this.bestScore);
    if (!pb.isNew) return false;
    this.bestScore = pb.best;
    try { localStorage.setItem(BEST_SCORE_KEY, String(pb.best)); } catch { /* private mode */ }
    return true;
  }

  /** Endless v2: wave / set piece / zone banners and the set-piece bonus, as the rider enters a new chunk. */
  private onChunk(): void {
    const st = this.sim.state;
    const c = this.course.chunkAt(st.x);
    if (!c || c.id === this.lastChunkId) return;
    const prev = this.lastChunkId >= 0 ? this.course.chunks.find((q) => q.id === this.lastChunkId) : undefined;
    this.lastChunkId = c.id;
    // paid once per set piece per run (a checkpoint retry re-riding it pays nothing again)
    if (prev?.setPiece && st.mode !== 'failed') this.score.bonus(`${prev.title} cleared`, SCORE.setPiece, prev.id);
    const w = c.wave;
    if (c.setPiece && w) this.hud.banner(`Wave ${w.index + 1} · peak`, c.title, (SPEC[c.spec ?? ''] as SetPieceSpec | undefined)?.blurb ?? '', 'peak', 3);
    else if (c.gate) { const z = ZONES[c.gate.to]; this.hud.banner('Now entering', z?.name ?? c.gate.to, `${z?.tagline ?? ''}${z?.experimental ? ' · rough' : ''}`, '', 3.2); }
    else if (w && w.index !== this.lastWave && w.phase === 'build' && w.index >= 0) this.hud.banner(`Wave ${w.index + 1}`, w.index === 0 ? 'Here we go' : 'Faster, harder', '', '', 2);
    else if (w && w.phase === 'breather' && prev?.wave?.phase !== 'breather') this.hud.banner('Breather', 'Catch your breath', '', '', 1.8);
    if (w) this.lastWave = w.index;
  }

  private saveBest(): void {
    if (this.course?.kind !== 'endless' || this.replayer) return;
    const d = this.distance();
    if (d > this.best) { this.best = d; try { localStorage.setItem(BEST_KEY, String(Math.round(d))); } catch { /* private mode */ } }
  }

  /** Safe to reload for a new build: not mid-run (start, fail or finish screen). */
  private canReload(): boolean {
    const m = this.sim?.state.mode;
    return !this.runStarted || m === 'failed' || m === 'finished';
  }

  /** Where the current attempt starts: the reached lesson's checkpoint (opening) or the start. */
  private startPoint(): { x: number; speed: number } | undefined {
    if (this.mode === 'endless') return this.endlessCp ? { x: this.endlessCp.x, speed: this.endlessCp.speed } : undefined;
    if (this.mode !== 'opening' || this.cpIndex <= 0) return undefined;
    const l = this.course.lessons[this.cpIndex];
    return { x: l.cpX, speed: l.cpSpeed };
  }

  private startRun(replay: Trace | null = null): void {
    if (this.recorder && this.recorder.trace.entries.length && !this.replayer) this.lastTrace = this.recorder.finish(this.sim.state.tick);
    const start = replay ? replay.start : this.startPoint();
    this.sim = new Simulation(this.course, TUNING, start);
    this.attemptStartX = this.sim.state.x;
    if (this.mode === 'endless') { this.score.respawn(); this.lastChunkId = -1; }
    this.recorder = new Recorder(this.seed, this.course.kind, start, this.mode === 'endless' ? this.zones : undefined);
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
    if (this.mode === 'endless' && this.run.over) {
      if (this.replayer) { this.startRun(); if (this.run.summary) this.hud.summary(this.run.summary); return; } // leaving a replay: back to the summary
      this.newRun(); return;
    }
    const st = this.sim.state;
    // endless mid-run: a manual retry is a bail and costs a life, exactly like a fail
    if (retryCostsLife({ mode: this.mode, runOver: this.run.over, replay: !!this.replayer, simMode: st.mode, moved: this.runStarted || st.x > this.attemptStartX + 1 })) {
      this.saveBest();
      const over = loseLife(this.run, this.score, 'manual-retry');
      this.hud.setLives(this.run.lives, MAX_LIVES);
      if (over) {
        this.lastTrace = this.recorder.finish(st.tick);
        this.startRun(); // park the rider at the checkpoint under the summary
        this.showSummary();
        return;
      }
    }
    if (st.mode === 'finished') this.cpIndex = 0; // finished: ride again from the top
    this.startRun();
  }

  /** Endless: the run is over (the last life is gone): summary and personal best. */
  private showSummary(): void {
    const s = endRun(this.run, this.score, this.runDistance(), this.bestScore, this.seed);
    this.saveBestScore(s.score);
    this.ui.fail.classList.remove('show');
    this.hud.summary(s);
  }

  newRun(): void {
    if (this.mode !== 'opening') this.seed = newSeed(); // endless & lab: New run = new seed
    this.loadCourse();
    this.startRun();
  }

  private startReplay(t: Trace | null): void {
    if (!t) return;
    const m: Mode = t.course;
    const zones = m === 'endless' ? (t.zones ?? ['town']) : [];
    if (m !== this.mode || (m !== 'opening' && t.seed !== this.seed) || zones.join() !== this.zones.join()) { this.mode = m; this.seed = t.seed; this.loadCourse(zones); }
    this.hud.hideSummary(); // the replay plays in the open (leaving it brings a finished run's summary back)
    this.startRun(t);
  }

  private onAction(a: Action): void {
    this.sfx.unlock(); // first gesture starts audio (autoplay rules)
    this.overlay.onAction(a);
    const st = this.sim.state;
    if (st.mode === 'finished' && this.mode === 'opening') return; // finish screen: use its buttons
    if (this.mode === 'endless' && this.run.over && !this.replayer) return; // summary screen: use its buttons
    if (st.mode === 'failed' || st.mode === 'finished') {
      const t = performance.now() / 1000;
      if (t - this.failTime >= TUNING.failure.retryLockout && (a.type === 'tap' || a.type === 'up' || (a.type === 'down' && a.fresh))) this.retry();
      return;
    }
    if (this.replayer) { if (a.type === 'tap' || a.type === 'up' || a.type === 'down') this.retry(); return; } // any input exits replay
    if (!this.hintDismissed && (a.type === 'down' || a.type === 'up')) { this.hintDismissed = true; this.ui.hint.classList.add('gone'); }
    if (a.type !== 'release' && a.type !== 'tap') this.runStarted = true;
    if (this.startScreen && (a.type === 'down' || a.type === 'up')) { this.startScreen = false; this.ui.start.classList.remove('show'); }
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
    const st = this.sim.state;
    if (this.mode === 'endless' && !this.replayer && (st.mode === 'grounded' || st.mode === 'heelSkim')) {
      // per-phrase checkpoint: the phrase the rider is riding on the ground
      const c = this.course.chunkAt(st.x);
      if (c && c.cpX <= st.x && (!this.endlessCp || c.cpX > this.endlessCp.x)) this.endlessCp = { x: c.cpX, speed: c.cpSpeed, title: c.title };
    }
    const events: SimEvent[] = this.sim.drainEvents();
    if (this.mode === 'endless' && !this.replayer && !this.run.over) {
      this.score.update(TUNING.sim.dt, st, events, this.course);
      this.onChunk();
    }
    for (const e of events) {
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
    if (this.mode === 'endless' && !finished && !this.replayer && !this.run.over) {
      this.saveBest();
      const over = loseLife(this.run, this.score, 'fail');
      this.hud.setLives(this.run.lives, MAX_LIVES);
      const cp = this.endlessCp;
      if (!over) this.ui.failSub.textContent = `Life lost · ${this.run.lives} left — tap / ↑ to carry on${cp ? ` from “${cp.title}”` : ''}`;
      else this.showSummary();
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
    this.view.quality.sample(dtReal, this.paused);
    this.sfx.update(this.sim.state);
    this.updateLessons();
    if (this.overlay.visible) this.view.setArc(predictJumpArc(this.sim));
    else this.view.setArc([]);
    this.overlay.update(this.sim.state, this.gestures, {
      seed: this.seed, replay: !!this.replayer, fps: this.fps, version: BUILD_VERSION, quality: `${this.view.quality.level.name}${this.view.quality.pinned ? ' (pinned)' : ''}`,
      lesson: this.mode === 'opening' ? `${this.cpIndex + 1}/${this.course.lessons.length} ${this.course.lessons[this.cpIndex]?.title ?? ''}` : this.mode === 'endless' ? this.phraseInfo() : 'lab',
      context: this.sim.state.mode === 'airborne'
        ? `rail: ${this.sim.railCatchReport() ?? 'none near'} | wall: ${this.sim.wallCatchable().reason ?? 'catchable'}`
        : this.sim.state.mode,
    });
    this.ui.speed.style.setProperty('--v', String(Math.min(1, this.curr.speed / TUNING.movement.hardCap)));
    this.updateHud(dtReal);
  }

  private updateHud(dt: number): void {
    // the title card goes once the rider is moving (any input, autopilot or replay)
    if (this.startScreen && this.sim.state.x > this.course.startX + 3) { this.startScreen = false; this.ui.start.classList.remove('show'); }
    if (this.mode === 'endless') {
      const idle = this.sim.state.mode === 'grounded' ? Math.min(1, this.score.idleTime / SCORE.idle) : 0;
      this.hud.update(dt, this.score, this.runDistance(), this.bestScore, idle);
    }
  }

  private phraseInfo(): string {
    const c = this.course.chunkAt(this.sim.state.x);
    return c ? `endless #${c.id} ${c.title} · tier ${c.tier} · d ${(c.difficulty ?? 0).toFixed(2)} · chunks ${this.course.chunks.length} · rebases ${this.view.rebases}` : 'endless';
  }
}
