import * as THREE from 'three';
import type { Course, Vec2 } from '../course/course';
import type { EndlessCourse } from '../course/endless';
import type { RiderState, SimEvent } from '../sim/types';
import { CameraRig } from './cameraRig';
import { CourseView } from './courseView';
import { Effects, SpeedLines, Petals } from './effects';
import { OrbPickupFx } from './orbFx';
import type { OrbFxEvent } from '../orb/orbFxEvent';
import { QualityManager, QUALITY, ORDER, deviceAnisotropy, type Quality } from './quality';
import { loadLoss, recordLoss, saveLoss } from './gfxHistory';
import { ART_UNIFORMS } from './materials';
import { RiderView } from './riderView';
import { PostPass } from './post';
import { Environment } from './environment';
import { Debris } from './debris';
import { toScene, ORIGIN, rebaseTarget, rebaseDelta } from './space';
import { TUNING } from '../tuning';
import { TIMES, DEFAULT_TOD, todName, type TodName } from './timeOfDay';
import { biomeName } from './biomeHills';

/** Interpolatable slice of sim state. */
export interface Snapshot {
  x: number; y: number; angle: number; speed: number; vy: number; mode: RiderState['mode'];
  air: RiderState['air']; flip: number; railId: number; wallId: number;
  /** Landing prep armed (presentation: the heroine's catch pose). */
  prep?: boolean;
}
export const snap = (s: RiderState): Snapshot => ({
  x: s.x, y: s.y, angle: s.angle, vy: s.vy, mode: s.mode, air: s.air, flip: s.air === 'flip' ? s.flip : 0,
  railId: s.railId, wallId: s.wallId,
  prep: s.mode === 'airborne' && s.prepStrokeId !== -1 && (s.prepHeld || s.prepTimer > 0),
  speed: s.mode === 'airborne' ? Math.hypot(s.vx, s.vy) : s.speed,
});

/**
 * Presentation root. Observes the simulation (snapshots + events) and never
 * feeds anything back into it.
 */
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly env: Environment;
  private courseView: CourseView | null = null;
  readonly rider = new RiderView();
  private effects = new Effects();
  private orbFx = new OrbPickupFx();
  private debris = new Debris();
  private speedLines = new SpeedLines();
  /** 0..1 from the score's flow meter. Presentation only: speed lines thicken when a combo is flowing. */
  styleFlow = 0;
  private petals = new Petals();
  readonly quality: QualityManager;
  private trail: Vec2[] = [];
  private trailLine: THREE.Line;
  private arcLine: THREE.Line;
  private failMarker: THREE.Mesh;
  private edgeMarker: THREE.Mesh;
  readonly post: PostPass;
  private streakTimer = 0;
  private contactFx = 0;
  /** Presentation clock. Hitstop passes dt 0, so lanterns and the town hold still with the rider. */
  private presentTime = 0;
  showArc = false;
  private failCam: { x: number; y: number } | null = null;
  private readonly focus = new THREE.Vector3();

  constructor(container: HTMLElement) {
    const qs0 = new URLSearchParams(location.search);
    const postOn = qs0.get('outline') !== '0';
    // GPU memory: the post pass renders the scene into its own MSAA target + depth texture, so the canvas only ever
    // receives one full-screen quad and needs neither MSAA nor a depth buffer of its own (same image; on a 390x844
    // phone that is ~60 MB less at DPR 2.5, ~85 MB at DPR 3). The drawing buffer is preserved only for capture
    // scripts (headless automation or ?capture=1; ?capture=0 forces it off).
    const capture = qs0.get('capture') === '1' || (qs0.get('capture') !== '0' && navigator.webdriver === true);
    this.renderer = new THREE.WebGLRenderer({ antialias: !postOn, depth: !postOn, powerPreference: 'high-performance', preserveDrawingBuffer: capture });
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.quality = new QualityManager(location.search, mobile, loadLoss());
    this.aniso = deviceAnisotropy(this.renderer.capabilities.getMaxAnisotropy(), mobile);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.watchContext(container);
    // colour grade: a soft warm vignette in CSS (free on the GPU, never covers the route centre)
    const grade = document.createElement('div');
    grade.className = 'grade';
    container.appendChild(grade);
    this.scene.add(this.rig.camera);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.env = new Environment(this.scene);
    this.env.setAnisotropy(this.aniso); // once, before any texture is on the GPU (tier switches never change it)
    this.post = new PostPass(this.renderer, postOn ? 4 : 0);
    if (!postOn) this.post.enabled = false;
    // vision presets: ?tod= (lighting/grade only) and ?biome=hills (mock). Without them nothing here runs.
    const tod = todName(location.search);
    if (tod !== DEFAULT_TOD) this.setTimeOfDay(tod);
    this.env.biome = biomeName(location.search);
    this.scene.add(this.rider.root, this.effects.group, this.speedLines.group, this.petals.mesh, this.orbFx.particles.group);
    this.quality.onChange = (q) => this.applyQuality(q);
    this.quality.onScale = () => this.applyResolution();
    this.applyQuality(this.quality.level);
    const qs = new URLSearchParams(location.search);
    if (qs.has('fps') || qs.has('q')) this.makeHud(container);
    const look = this.rider.setLook(this.rider.look);
    this.env.prepare(this.renderer);
    // load veil: the first view waits (max ~9 s) for Ao, the town kit and the painted textures, all pre-uploaded, so
    // nothing pops in on the start screen. Purely visual: input and the sim are never blocked.
    const veil = document.createElement('div');
    veil.className = 'veil';
    container.appendChild(veil);
    void Promise.race([Promise.all([this.env.ready, Promise.resolve(look).catch(() => {})]), new Promise((r) => setTimeout(r, 9000))]).then(() => {
      try { this.renderer.compile(this.scene, this.rig.camera); } catch { /* precompile is best-effort */ }
      requestAnimationFrame(() => veil.classList.add('gone'));
      setTimeout(() => veil.remove(), 1500);
      // the post variants a later tier switch can reach compile in the background now, not in the switch frame
      setTimeout(() => void this.post.prewarm(this.postCombos()), 2000);
    });

    this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#c8553d', dashSize: 0.5, gapSize: 0.35, fog: false }));
    this.trailLine.visible = false;
    this.arcLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#2f7d6d', transparent: true, opacity: 0.8, fog: false }));
    this.arcLine.visible = false;
    this.failMarker = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: '#c8553d', fog: false }));
    this.failMarker.visible = false;
    this.edgeMarker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4, 0.12), new THREE.MeshBasicMaterial({ color: '#2f7d6d', fog: false }));
    this.edgeMarker.visible = false;
    this.scene.add(this.trailLine, this.arcLine, this.failMarker, this.edgeMarker, this.debris.group);
    this.resize();
  }

  /** Time-of-day preset: uniforms, light and fog values only (no new draw calls, programs or texture uploads). */
  setTimeOfDay(name: TodName): void {
    const t = TIMES[name];
    this.env.applyTime(t);
    this.renderer.toneMappingExposure = t.exposure;
    this.post.setGrade(t.warm, t.sat);
  }

  /** Apply a render quality level (pixel ratio, shadows, textures, post effects, LOD, particle counts). */
  applyQuality(q: Quality): void {
    this.renderer.shadowMap.enabled = q.shadowMap > 0;
    this.env.applyQuality(q);
    this.post.configure({ bloom: q.bloom, ao: q.ao, grade: q.name !== 'low' });
    this.petals.count = q.petals;
    this.rider.setQuality(q.name, this.aniso);
    this.applyResolution();
    this.watchHitch();
  }

  /** Render resolution: the tier's (dynamic) pixel ratio, never above the device's own. */
  applyResolution(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.scale));
    this.resize();
    this.watchHitch();
  }

  /** Texture anisotropy for this device (set once; see deviceAnisotropy). */
  private readonly aniso: number;
  /** Every bloom/AO combination of the tiers (prewarmed composite programs). */
  private postCombos(): { bloom: boolean; ao: boolean }[] {
    const seen = new Map<string, { bloom: boolean; ao: boolean }>();
    for (const n of ORDER) { const t = QUALITY[n]; seen.set(`${t.bloom}${t.ao}`, { bloom: t.bloom, ao: t.ao }); }
    return [...seen.values()];
  }

  // ---- switch hitch diagnostics: the longest frame interval among the few frames after a tier/resolution change ----
  private lastFrameAt = 0;
  private hitchFrames = 0;
  private hitchMax = 0;
  /** Diagnostics: duration (ms) of the last switch hitch, and of the last context-loss blackout. */
  lastHitchMs = 0;
  lastBlackoutMs = 0;
  private watchHitch(): void { if (this.lastFrameAt) { this.hitchFrames = 3; this.hitchMax = 0; } }
  private frameTiming(): void {
    const now = performance.now();
    if (this.lastFrameAt && this.hitchFrames > 0) {
      this.hitchMax = Math.max(this.hitchMax, now - this.lastFrameAt);
      if (--this.hitchFrames === 0) this.lastHitchMs = this.hitchMax;
    }
    this.lastFrameAt = now;
  }

  // ---- WebGL context loss: keep playing (the sim never depends on the GPU), show a quiet hint, come back a tier lower ----
  /** True while the WebGL context is lost (nothing renders; the CSS sky shows through). */
  contextLost = false;
  private lostAt = 0;
  private lostCounts = true;
  private visAt = 0;
  private restoredAt = 0;
  private gfxHint: HTMLDivElement | null = null;
  private gfxHintTimer = 0;
  private watchContext(container: HTMLElement): void {
    const canvas = this.renderer.domElement;
    document.addEventListener('visibilitychange', () => { this.visAt = performance.now(); });
    // three registers its own handlers first (preventDefault on loss -> the browser may restore; re-init on restore)
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.contextLost) return;
      this.contextLost = true;
      this.lostAt = performance.now();
      // a background tab (or one just brought back) can lose its context to the OS: not this tier's fault
      this.lostCounts = document.visibilityState === 'visible' && this.lostAt - this.visAt > 1000;
      this.quality.contextLost();
      canvas.classList.add('gfx-lost'); // the CSS sky shows instead of whatever the browser paints for a lost canvas
      clearTimeout(this.gfxHintTimer);
      this.gfxHintTimer = window.setTimeout(() => this.showGfxHint(container, true), 400);
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      if (!this.contextLost) return;
      this.contextLost = false;
      this.restoredAt = performance.now();
      const tier = this.quality.contextRestored(this.lostCounts); // steps the tier down (re-applies it) when it counts
      if (tier) saveLoss(recordLoss(loadLoss(), tier, Date.now()));
      else this.applyQuality(this.quality.level);
      void this.post.prewarm(this.postCombos());
    }, false);
  }
  private showGfxHint(container: HTMLElement, on: boolean): void {
    if (on && !this.gfxHint) {
      const d = document.createElement('div');
      d.className = 'gfx-hint';
      d.textContent = 'graphics recovering…';
      container.appendChild(d);
      this.gfxHint = d;
    }
    if (this.gfxHint) this.gfxHint.classList.toggle('show', on);
  }
  /** First frame drawn after a restore: hide the hint, note how long the screen had nothing new. */
  private afterRestoreFrame(): void {
    if (!this.restoredAt) return;
    this.lastBlackoutMs = performance.now() - this.lostAt;
    this.restoredAt = 0;
    this.renderer.domElement.classList.remove('gfx-lost');
    clearTimeout(this.gfxHintTimer);
    this.showGfxHint(document.body, false);
  }

  // ---- on-screen perf readout (?fps=1, or whenever a tier is pinned with ?q=): fps, tier, resolution, cost ----
  private hud: HTMLDivElement | null = null;
  private hudT = 0; private hudFrames = 0; private hudLast = 0;
  private makeHud(container: HTMLElement): void {
    const d = document.createElement('div');
    d.className = 'fps-hud';
    d.style.cssText = 'position:absolute;left:6px;top:calc(env(safe-area-inset-top, 0px) + 6px);z-index:50;pointer-events:none;font:600 11px/1.35 ui-monospace,Menlo,monospace;color:#fff;background:rgba(30,24,40,.55);padding:3px 6px;border-radius:6px;white-space:pre';
    container.appendChild(d);
    this.hud = d;
  }
  private updateHud(): void {
    if (!this.hud) return;
    const now = performance.now();
    if (!this.hudLast) this.hudLast = now;
    this.hudFrames++;
    this.hudT = now - this.hudLast;
    if (this.hudT < 500) return;
    const fps = (this.hudFrames * 1000) / this.hudT;
    this.hudFrames = 0; this.hudLast = now;
    const i = this.renderer.info.render, q = this.quality, c = this.renderer.domElement;
    this.hud.textContent = `${fps.toFixed(0)} fps  ${q.level.name}${q.pinned ? ' (pinned)' : ''}\n${this.renderer.getPixelRatio().toFixed(2)}x  ${c.width}x${c.height}\n${i.calls} calls  ${(i.triangles / 1000).toFixed(0)}k tris`
      + `\ntiers ${q.tierChanges}  lost ${q.losses}${q.pastLosses ? `+${q.pastLosses} before` : ''}  hitch ${this.lastHitchMs.toFixed(0)}ms`
      + (this.lastBlackoutMs ? `\nblackout ${this.lastBlackoutMs.toFixed(0)}ms` : '');
  }

  setCourse(course: Course): void {
    this.petals.reset();
    if (this.courseView) { this.scene.remove(this.courseView.group); this.courseView.dispose(); }
    ORIGIN.x = 0; ORIGIN.y = 0;
    this.courseView = new CourseView(course);
    this.scene.add(this.courseView.group);
    this.debris.setCourse(course);
    this.effects.clear();
    this.orbFx.clear();
    const streamed = course.kind === 'endless';
    const minY = streamed ? 0 : Math.min(...course.surfaces.flatMap((q) => q.points.map((pt) => pt.y)));
    let lastH = 0;
    const heightAt = (x: number) => { const g = course.groundBelow(x, 1e6); if (g) lastH = g.sample.y; else if (!streamed) lastH = course.lowestNear(x); return lastH; };
    // past the finish the town carries on at the quay level (no cliffs/terraces from the course's lowest fallback)
    const endY = streamed ? 0 : (course.groundBelow(course.finishX - 0.5, 1e6)?.sample.y ?? minY);
    const groundAt = (x: number) => {
      if (!streamed && x > course.finishX - 0.5) return { y: endY, gap: false };
      const g = course.groundBelow(x, 1e6); return g ? { y: g.sample.y, gap: false } : { y: heightAt(x), gap: true };
    };
    // opening: the course says where its harbour begins (big-jump landing). Endless: each harbour zone
    // span (town, then harbour, looping) is a quay. Chunks are born as one or the other and stream in
    // with the same slice budget; the floating origin shifts the chunk group, props included.
    let harbourFrom: number | undefined;
    let harbourAt: ((x: number) => boolean) | undefined;
    if (streamed) {
      const ec = course as EndlessCourse;
      harbourAt = (x) => ec.zones.zoneAt(x - ec.originX).theme.scenery === 'harbour';
    } else harbourFrom = course.harbourX ?? Math.floor((course.finishX - 220) / 40) * 40;
    const towers = streamed ? Array.from({ length: 200 }, (_, i) => 520 + i * 900) : [harbourFrom! * 0.45, harbourFrom! - 50];
    this.env.buildScenery(course.seed, course.finishX, heightAt, minY, streamed, groundAt, { harbourFrom, harbourAt, clockTowers: towers, endless: streamed });
    this.env.streamScenery(course.startX, streamed ? (course as unknown as { generatedTo: number }).generatedTo : Infinity);
  }

  /** Floating origin: when the rider is far from it, move it and shift everything that persists. */
  private rebaseIfNeeded(x: number, y: number): void {
    const t = rebaseTarget(x, y);
    if (!t) return;
    const d = rebaseDelta(ORIGIN, t);
    ORIGIN.x = t.x; ORIGIN.y = t.y;
    for (const c of this.effects.group.children) c.position.add(d);
    for (const c of this.orbFx.particles.group.children) c.position.add(d);
    for (const c of this.speedLines.group.children) c.position.add(d);
    for (const o of [this.trailLine, this.arcLine, this.failMarker, this.edgeMarker]) o.position.add(d);
    this.env.shift(d);
    this.courseView?.rebase();
    this.rig.shift(d);
    this.rebases++;
  }
  /** Diagnostics: how many times the origin has moved. */
  rebases = 0;

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.rig.resize(w, h);
  }

  resetRun(s: Snapshot): void {
    this.rider.reset();
    this.trail = [];
    this.courseView?.resetObstacles();
    this.debris.clear();
    this.failCam = null;
    this.trailLine.visible = false;
    this.failMarker.visible = false;
    this.edgeMarker.visible = false;
    this.rig.update(0, s.x, s.y, s.speed, true, this.courseView ? this.courseView.course.maxHeightAhead(s.x, TUNING.camera.lookOverRange) : -Infinity);
  }

  onEvent(e: SimEvent, speed: number): void {
    this.rider.event(e);
    switch (e.type) {
      case 'push':
        if (e.fresh) { this.rider.kick(TUNING.feedback.pushSquash); this.effects.pushTuft(e.x, e.y, Math.max(e.impulse, 1.5), speed); }
        break;
      case 'jump':
        this.rider.kick(-0.15);
        this.trail = [{ x: e.x, y: e.y }];
        break;
      case 'leave-edge':
        if (e.crest) this.rider.kick(-0.12);
        this.trail = [{ x: e.x, y: e.y }];
        break;
      case 'land':
        this.rider.kick(Math.min(0.45, TUNING.feedback.landSquash * (0.4 + e.impact / 10)));
        this.effects.landPuff(e.x, e.y, e.impact, e.material, e.speedAfter);
        if (e.flipped) { this.effects.ring(e.x, e.y, 0, '#fff3c4'); this.rig.jolt(TUNING.feedback.flipLandShake); }
        break;
      case 'break': {
        const o = this.courseView?.course.obstacle(e.obstacleId);
        if (!o) break;
        const F = TUNING.feedback;
        this.courseView!.setBroken(o.id, true);
        this.debris.burst(o.kind, o.x, o.baseY, o.height, e.vx, e.vy, o.kind === 'pot' ? F.potFragments : F.pillarFragments);
        this.effects.landPuff(o.x + 0.6, o.baseY, o.kind === 'pot' ? 2 : 7, 'stone', e.speed);
        this.rig.jolt(o.kind === 'pot' ? F.breakShakePot : F.breakShakePillar);
        this.rider.kick(o.kind === 'pot' ? 0.12 : 0.22);
        break;
      }
      case 'grind-start': {
        this.rider.kick(0.25);
        const r = this.courseView?.course.rail(e.railId);
        this.effects.sparks(e.x, e.y, r?.lateral ?? 0, e.speed, 14);
        this.trail = [];
        break;
      }
      case 'grind-end': {
        const r = this.courseView?.course.rail(e.railId);
        this.effects.sparks(e.x, e.y, r?.lateral ?? 0, speed, 8);
        this.trail = [{ x: e.x, y: e.y }];
        break;
      }
      case 'wall-start': {
        this.rider.kick(0.2);
        const w = this.courseView?.course.wall(e.wallId);
        for (let i = 0; i < 8; i++) this.effects.wallSmoke(e.x, e.y, (w?.lateral ?? 2.4) - 0.05, e.speed);
        this.trail = [];
        break;
      }
      case 'wall-end': {
        const w = this.courseView?.course.wall(e.wallId);
        for (let i = 0; i < 5; i++) this.effects.wallSmoke(e.x, e.y, (w?.lateral ?? 2.4) - 0.05, speed);
        this.trail = [{ x: e.x, y: e.y }];
        break;
      }
      case 'skim-start':
        this.rider.kick(0.15);
        for (let i = 0; i < 6; i++) this.effects.skimDust(e.x, e.y, speed);
        break;
      case 'flip-complete':
        this.effects.ring(e.x, e.y, this.rider.currentLateral);
        break;
      case 'grab-start':
        this.rider.kick(0.1);
        break;
      case 'fail': {
        const c = this.courseView?.course;
        const lip = c ? c.maxHeightAhead(e.info.x - 14, 18) : e.info.y;
        this.failCam = { x: e.info.x - 7, y: Number.isFinite(lip) ? lip : e.info.y };
        // readable failure: show the flight path, where it ended, and the edge it needed
        this.showTrail();
        this.failMarker.position.copy(toScene(e.info.x, e.info.y, -0.2));
        this.failMarker.rotation.y = Math.PI / 2 - (TUNING.camera.routeYawDeg * Math.PI) / 180;
        this.failMarker.visible = true;
        if (e.info.gapX1 !== undefined) {
          const gnd = this.courseView?.course.groundBelow(e.info.gapX1 + 0.05, 1e6);
          this.edgeMarker.position.copy(toScene(e.info.gapX1, (gnd?.sample.y ?? 0) + 2, -1.8));
          this.edgeMarker.visible = true;
        }
        break;
      }
      default: break;
    }
  }

  private showTrail(): void {
    if (this.trail.length < 2) return;
    const g = new THREE.BufferGeometry().setFromPoints(this.trail.map((p) => toScene(p.x, p.y + 0.3, -0.2)));
    this.trailLine.geometry.dispose();
    this.trailLine.geometry = g;
    this.trailLine.position.set(0, 0, 0);
    this.trailLine.computeLineDistances();
    this.trailLine.visible = true;
  }

  setArc(points: Vec2[]): void {
    this.arcLine.visible = this.showArc && points.length > 1;
    if (!this.arcLine.visible) return;
    this.arcLine.geometry.dispose();
    this.arcLine.position.set(0, 0, 0);
    this.arcLine.geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => toScene(p.x, p.y + 0.2, -0.2)));
  }

  render(dt: number, prev: Snapshot, curr: Snapshot, alpha: number): void {
    const failed = curr.mode === 'failed';
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const x = failed ? curr.x : lerp(prev.x, curr.x);
    const y = failed ? curr.y : lerp(prev.y, curr.y);
    this.rebaseIfNeeded(x, y);
    this.courseView?.sync();
    this.presentTime += Math.max(0, dt);
    this.courseView?.animate(this.presentTime, this.rig.camera, this.renderer.domElement.clientHeight || 844);
    this.env.streamScenery(x, this.courseView?.course.kind === 'endless' ? (this.courseView.course as unknown as { generatedTo: number }).generatedTo : Infinity);
    const airborne = curr.mode === 'airborne';
    if (airborne && (this.trail.length === 0 || Math.abs(this.trail[this.trail.length - 1].x - x) > 0.4)) this.trail.push({ x, y });
    if (this.trail.length > 400) this.trail.shift();
    const course = this.courseView?.course;
    let lateral = 0;
    if (curr.mode === 'grinding' && course) lateral = course.rail(curr.railId).lateral;
    if (curr.mode === 'wallRiding' && course) lateral = course.wall(curr.wallId).lateral - 0.3;
    const flip = curr.flip > 0 ? (curr.flip >= prev.flip ? lerp(prev.flip, curr.flip) : curr.flip) : 0;
    this.rider.update(dt, curr, x, y, lerp(prev.angle, curr.angle), flip, lateral);
    // sustained contact feedback, emitted at the actual contact point
    this.contactFx -= dt;
    if (this.contactFx <= 0 && !failed) {
      this.contactFx = 1 / 40;
      if (curr.mode === 'grinding') this.effects.sparks(x, y, this.rider.currentLateral, curr.speed, 3);
      if (curr.mode === 'wallRiding' && course) this.effects.wallSmoke(x, y, course.wall(curr.wallId).lateral - 0.05, curr.speed);
      if (curr.mode === 'heelSkim' && curr.speed > 0.5 && Math.random() < 0.6) this.effects.skimDust(x, y, curr.speed);
    }
    if (failed && this.failCam) {
      // pull back and up to the takeoff level so the miss, both gap edges and the flight path are in frame
      this.rig.update(dt, this.failCam.x, this.failCam.y, 0, false);
    } else {
      const ahead = course ? course.maxHeightAhead(x, TUNING.camera.lookOverRange) : -Infinity;
      this.rig.update(dt, x, y, curr.speed, false, ahead);
    }
    ART_UNIFORMS.uTime.value += dt;
    this.env.follow(toScene(x + 18, y, 0, this.focus), this.rig.camera.position, x, y);
    this.petals.update(dt, x, y);
    // restrained air-cutting streaks scale with actual speed
    this.speedLines.update(dt, x, y, failed ? 0 : curr.speed, this.styleFlow);
    if (SpeedLines.intensity(curr.speed) > 0.3 && !failed) {
      this.streakTimer -= dt * (curr.speed - 12) * 0.6;
      if (this.streakTimer <= 0) { this.effects.speedStreak(x, y, curr.speed); this.streakTimer = 1; }
    }
    this.effects.update(dt);
    this.orbFx.setLowTier(this.quality.level.name === 'low');
    this.orbFx.update(dt, this.rig.camera.quaternion);
    this.debris.update(dt);
    if (this.failMarker.visible) this.failMarker.scale.setScalar(1 + 0.1 * Math.sin(performance.now() / 120));
    // mid-jump: resolution changes and promotions wait for the landing (a resize there is the most visible hitch)
    this.quality.busy = airborne;
    if (!this.contextLost) {
      this.post.render(this.scene, this.rig.camera);
      this.afterRestoreFrame();
    }
    this.frameTiming();
    this.updateHud();
  }

  /** Restrained camera punch. Does not change the frame step. */
  punch(amount: number): void { this.rig.jolt(amount); }
  /** Orb pickup VFX (deterministic from sim tick + orb id). */
  onOrbCollect(e: OrbFxEvent): void {
    this.orbFx.onCollect(e);
    this.rig.jolt(e.tier === 'rare' ? TUNING.feedback.charmShake * 1.15 : TUNING.feedback.charmShake);
  }
  hideOrb(id: number): void { this.courseView?.hideOrb(id); }

  /** Draw the scene through the post pass from any camera (review/capture scripts). */
  present(camera: THREE.Camera = this.rig.camera): void { this.post.render(this.scene, camera); }
}
