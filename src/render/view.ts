import * as THREE from 'three';
import type { Course, Vec2 } from '../course/course';
import type { RiderState, SimEvent } from '../sim/types';
import { CameraRig } from './cameraRig';
import { CourseView } from './courseView';
import { Effects } from './effects';
import { RiderView } from './riderView';
import { Environment } from './environment';
import { toScene } from './space';
import { TUNING } from '../tuning';

/** Interpolatable slice of sim state. */
export interface Snapshot { x: number; y: number; angle: number; speed: number; vy: number; mode: RiderState['mode'] }
export const snap = (s: RiderState): Snapshot => ({
  x: s.x, y: s.y, angle: s.angle, vy: s.vy, mode: s.mode,
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
  private rider = new RiderView();
  private effects = new Effects();
  private trail: Vec2[] = [];
  private trailLine: THREE.Line;
  private arcLine: THREE.Line;
  private failMarker: THREE.Mesh;
  private edgeMarker: THREE.Mesh;
  private streakTimer = 0;
  showArc = false;
  private failCam: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.rig.camera);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.env = new Environment(this.scene);
    this.scene.add(this.rider.root, this.effects.group);

    this.trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#c8553d', dashSize: 0.5, gapSize: 0.35, fog: false }));
    this.trailLine.visible = false;
    this.arcLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#2f7d6d', transparent: true, opacity: 0.8, fog: false }));
    this.arcLine.visible = false;
    this.failMarker = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: '#c8553d', fog: false }));
    this.failMarker.visible = false;
    this.edgeMarker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4, 0.12), new THREE.MeshBasicMaterial({ color: '#2f7d6d', fog: false }));
    this.edgeMarker.visible = false;
    this.scene.add(this.trailLine, this.arcLine, this.failMarker, this.edgeMarker);
    this.resize();
  }

  setCourse(course: Course): void {
    if (this.courseView) { this.scene.remove(this.courseView.group); this.courseView.dispose(); }
    this.courseView = new CourseView(course);
    this.scene.add(this.courseView.group);
    this.env.buildScenery(course.seed, course.finishX + 80);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  resetRun(s: Snapshot): void {
    this.trail = [];
    this.failCam = null;
    this.trailLine.visible = false;
    this.failMarker.visible = false;
    this.edgeMarker.visible = false;
    this.rig.update(0, s.x, s.y, s.speed, true, this.courseView ? this.courseView.course.maxHeightAhead(s.x, TUNING.camera.lookOverRange) : -Infinity);
  }

  onEvent(e: SimEvent, speed: number): void {
    switch (e.type) {
      case 'push':
        if (e.fresh) { this.rider.kick(TUNING.feedback.pushSquash); this.effects.pushTuft(e.x, e.y, Math.max(e.impulse, 1.5), speed); }
        break;
      case 'jump':
        this.rider.kick(-0.15);
        this.trail = [{ x: e.x, y: e.y }];
        break;
      case 'leave-edge':
        this.trail = [{ x: e.x, y: e.y }];
        break;
      case 'land':
        this.rider.kick(Math.min(0.45, TUNING.feedback.landSquash * (0.4 + e.impact / 10)));
        this.effects.landPuff(e.x, e.y, e.impact, e.material, e.speedAfter);
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
    this.trailLine.computeLineDistances();
    this.trailLine.visible = true;
  }

  setArc(points: Vec2[]): void {
    this.arcLine.visible = this.showArc && points.length > 1;
    if (!this.arcLine.visible) return;
    this.arcLine.geometry.dispose();
    this.arcLine.geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => toScene(p.x, p.y + 0.2, -0.2)));
  }

  render(dt: number, prev: Snapshot, curr: Snapshot, alpha: number): void {
    const failed = curr.mode === 'failed';
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const x = failed ? curr.x : lerp(prev.x, curr.x);
    const y = failed ? curr.y : lerp(prev.y, curr.y);
    const airborne = curr.mode === 'airborne';
    if (airborne && (this.trail.length === 0 || Math.abs(this.trail[this.trail.length - 1].x - x) > 0.4)) this.trail.push({ x, y });
    if (this.trail.length > 400) this.trail.shift();
    this.rider.update(dt, x, y, lerp(prev.angle, curr.angle), curr.speed, airborne, curr.vy);
    const course = this.courseView?.course;
    if (failed && this.failCam) {
      // pull back and up to the takeoff level so the miss, both gap edges and the flight path are in frame
      this.rig.update(dt, this.failCam.x, this.failCam.y, 0, false);
    } else {
      const ahead = course ? course.maxHeightAhead(x, TUNING.camera.lookOverRange) : -Infinity;
      this.rig.update(dt, x, y, curr.speed, false, ahead);
    }
    this.env.follow(toScene(x + 10, y), this.rig.camera.position);
    // restrained air-cutting streaks scale with actual speed
    if (curr.speed > 11 && !failed) {
      this.streakTimer -= dt * (curr.speed - 10) * 0.9;
      if (this.streakTimer <= 0) { this.effects.speedStreak(x, y, curr.speed); this.streakTimer = 1; }
    }
    this.effects.update(dt);
    if (this.failMarker.visible) this.failMarker.scale.setScalar(1 + 0.1 * Math.sin(performance.now() / 120));
    this.renderer.render(this.scene, this.rig.camera);
  }
}
