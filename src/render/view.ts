import * as THREE from 'three';
import type { Course, Vec2 } from '../course/course';
import type { RiderState, SimEvent } from '../sim/types';
import { CameraRig } from './cameraRig';
import { CourseView } from './courseView';
import { Effects, SpeedLines, Petals } from './effects';
import { QualityManager, type Quality } from './quality';
import { ART_UNIFORMS } from './materials';
import { RiderView } from './riderView';
import { PostPass } from './post';
import { Environment } from './environment';
import { Debris } from './debris';
import { toScene, ORIGIN, rebaseTarget, rebaseDelta } from './space';
import { TUNING } from '../tuning';

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
  private debris = new Debris();
  private speedLines = new SpeedLines();
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
  showArc = false;
  private failCam: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.quality = new QualityManager(location.search, mobile);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
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
    this.post = new PostPass(this.renderer, new URLSearchParams(location.search).get('outline') === '0' ? 0 : 4);
    if (new URLSearchParams(location.search).get('outline') === '0') this.post.enabled = false;
    this.scene.add(this.rider.root, this.effects.group, this.speedLines.group, this.petals.mesh);
    this.quality.onChange = (q) => this.applyQuality(q);
    this.applyQuality(this.quality.level);
    void this.rider.setLook(this.rider.look);

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

  /** Apply a render quality level (pixel ratio, shadows, cloud detail, particle counts). */
  applyQuality(q: Quality): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadowMap > 0;
    this.env.applyQuality(q);
    this.petals.count = q.petals;
    this.rider.setQuality(q.name);
    this.resize();
  }

  setCourse(course: Course): void {
    this.petals.reset();
    if (this.courseView) { this.scene.remove(this.courseView.group); this.courseView.dispose(); }
    ORIGIN.x = 0; ORIGIN.y = 0;
    this.courseView = new CourseView(course);
    this.scene.add(this.courseView.group);
    this.debris.setCourse(course);
    this.effects.clear();
    const streamed = course.kind === 'endless';
    const minY = streamed ? 0 : Math.min(...course.surfaces.flatMap((q) => q.points.map((pt) => pt.y)));
    let lastH = 0;
    const heightAt = (x: number) => { const g = course.groundBelow(x, 1e6); if (g) lastH = g.sample.y; else if (!streamed) lastH = course.lowestNear(x); return lastH; };
    const groundAt = (x: number) => { const g = course.groundBelow(x, 1e6); return g ? { y: g.sample.y, gap: false } : { y: heightAt(x), gap: true }; };
    const towers = streamed ? Array.from({ length: 200 }, (_, i) => 520 + i * 900) : [course.finishX * 0.22, course.finishX * 0.64];
    const harbourFrom = streamed ? undefined : Math.floor((course.finishX - 220) / 40) * 40;
    this.env.buildScenery(course.seed, course.finishX, heightAt, minY, streamed, groundAt, { harbourFrom, clockTowers: towers, endless: streamed });
    this.env.streamScenery(course.startX, streamed ? (course as unknown as { generatedTo: number }).generatedTo : Infinity);
  }

  /** Floating origin: when the rider is far from it, move it and shift everything that persists. */
  private rebaseIfNeeded(x: number, y: number): void {
    const t = rebaseTarget(x, y);
    if (!t) return;
    const d = rebaseDelta(ORIGIN, t);
    ORIGIN.x = t.x; ORIGIN.y = t.y;
    for (const c of this.effects.group.children) c.position.add(d);
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
        if (e.flipped) this.effects.ring(e.x, e.y, 0, '#fff3c4');
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
    this.env.follow(toScene(x + 10, y), this.rig.camera.position, x, y);
    this.petals.update(dt, x, y);
    // restrained air-cutting streaks scale with actual speed
    this.speedLines.update(dt, x, y, failed ? 0 : curr.speed);
    if (SpeedLines.intensity(curr.speed) > 0.3 && !failed) {
      this.streakTimer -= dt * (curr.speed - 12) * 0.6;
      if (this.streakTimer <= 0) { this.effects.speedStreak(x, y, curr.speed); this.streakTimer = 1; }
    }
    this.effects.update(dt);
    this.debris.update(dt);
    if (this.failMarker.visible) this.failMarker.scale.setScalar(1 + 0.1 * Math.sin(performance.now() / 120));
    this.post.render(this.scene, this.rig.camera);
  }

  /** Draw the scene through the post pass from any camera (review/capture scripts). */
  present(camera: THREE.Camera = this.rig.camera): void { this.post.render(this.scene, camera); }
}
