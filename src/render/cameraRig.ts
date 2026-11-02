import * as THREE from 'three';
import type { Course } from '../course/course';
import { TUNING } from '../tuning';
import type { MoveMode } from '../sim/types';
import { toScene } from './space';

/** Ground ahead, plus sky lines and balloon clusters, so the chase camera can look up the ladder. */
export function chaseAheadMax(course: Course, x: number, range: number): number {
  let hi = course.maxHeightAhead(x, range);
  const x1 = x + range;
  for (const r of course.rails) {
    if (!r.sky) continue;
    for (const p of r.points) if (p.x > x && p.x <= x1) hi = Math.max(hi, p.y);
  }
  for (const b of course.bounces) {
    if (!b.sky || b.x <= x || b.x > x1) continue;
    hi = Math.max(hi, b.y);
  }
  for (const seg of course.sky) {
    if (seg.x1 < x || seg.x0 > x1) continue;
    for (const line of seg.lines) for (const a of line.anchors) if (a.x > x && a.x <= x1) hi = Math.max(hi, a.y);
    for (const c of seg.clusters) if (c.tether.x > x && c.tether.x <= x1) hi = Math.max(hi, c.tether.y);
  }
  return hi;
}

/** Spec §1: the fast height follow lasts through the gust and this long after it. */
export const GUST_CAM_HOLD = 0.3;

/**
 * The stock chase camera at the governed 14 m/s already puts Ao's feet at about
 * 85% of a 390×844 frame. `tricks.sky.camSkyLift` (+0.8) and the 1.9 m look-over
 * both push her off the bottom, which fails the sky framing test. A sky shot
 * therefore aims this far *below* the rider and will not look over. The gust
 * lag still tracks the whoosh; grinding keeps the slower sky lag.
 */
const SKY_FRAME_LIFT = -0.65;
/** Look-over may not raise the sky frame above the rider by more than this (m). */
const SKY_MAX_ABOVE = -0.2;

export interface SkyCamMemory { postGust: number }

export interface CamPlan {
  heightLag: number;
  lift: number;
  /** Look-over may not place the follow above `riderY + maxAbove`. */
  maxAbove?: number;
  /** Faster height lag when a descent has left the frame high. */
  catchLag?: number;
  /** Hold projected feet inside the sky band (45–85%). Street chase leaves this off. */
  band?: boolean;
}

/** Gust, sky layer, or anywhere inside a sky segment — the run-in and the landing are part of the shot. */
export function skyCameraZone(
  course: { sky: readonly { x0: number; x1: number }[] } | null | undefined,
  x: number,
  mode: MoveMode,
  layer: 'street' | 'sky',
): boolean {
  if (mode === 'gusting' || layer === 'sky') return true;
  if (!course) return false;
  for (const seg of course.sky) if (x >= seg.x0 && x <= seg.x1) return true;
  return false;
}

/** Height-follow for the chase camera. Street play is unchanged; a sky shot tracks the whoosh and stays in frame. */
export function stepSkyCamera(
  mode: MoveMode,
  layer: 'street' | 'sky',
  dt: number,
  mem: SkyCamMemory,
  inSkyRun = false,
): CamPlan {
  const S = TUNING.tricks.sky;
  if (mode === 'gusting') mem.postGust = GUST_CAM_HOLD;
  else mem.postGust = Math.max(0, mem.postGust - Math.max(0, dt));
  const gustCam = mode === 'gusting' || mem.postGust > 0;
  const sky = inSkyRun || gustCam || layer === 'sky';
  if (!sky) return { heightLag: TUNING.camera.heightLag, lift: 0 };
  // Airborne arcs (the gust, a hop, the ladder) are tracked quickly so the rider
  // stays readable. A level grind keeps the slower lag so the frame doesn't bob.
  const track = gustCam || mode === 'airborne' || mode === 'flying';
  return {
    heightLag: track ? S.camGustLag : S.camSkyLag,
    lift: SKY_FRAME_LIFT,
    maxAbove: SKY_MAX_ABOVE,
    catchLag: S.camGustLag,
    band: true,
  };
}

/**
 * Fixed-orientation chase camera. It sits behind and above the rider and looks
 * ahead down the route at a fixed pitch. It never orbits or rotates: it only
 * translates to follow progress (x) and, with more lag, height (y).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private fx = 0; // followed route x
  private fy = 0; // followed height
  private pull = 0; // smoothed speed-based pull-back
  private initialised = false;
  private scale = 1;
  private shakeAmp = 0;
  private shakeT = 0;
  private fovPunch = 0;
  private prevRiderY = 0;

  /** Restrained, quickly decaying jolt (breaks). Never changes the camera's angle. */
  jolt(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = 0;
    this.fovPunch = TUNING.feedback.breakFovPunch * Math.min(1, amount / TUNING.feedback.breakShakePillar);
  }

  constructor() {
    const C = TUNING.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, 1, 0.3, 2400);
    const pitch = (C.pitchDeg * Math.PI) / 180;
    // camera looks along the route direction (scene -Z for yaw 90) pitched down
    const yaw = ((C.routeYawDeg - 90) * Math.PI) / 180;
    this.camera.rotation.set(-pitch, -yaw, 0, 'YXZ');
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.scale = w / h > 1 ? TUNING.camera.landscapeScale : 1;
    this.camera.updateProjectionMatrix();
  }

  /** Floating origin moved (the camera is re-placed from route coordinates every update). */
  shift(delta: THREE.Vector3): void { this.camera.position.add(delta); }

  get progress(): number { return this.fx; }
  get height(): number { return this.fy; }

  update(dt: number, riderX: number, riderY: number, speed: number, snap = false, aheadMaxY = -Infinity, lateral = 0, follow?: CamPlan): void {
    const C = TUNING.camera;
    const lift = follow?.lift ?? 0;
    // raise the follow height to see over an upcoming crest/lip
    const base = riderY + lift;
    let targetY = Math.max(base, Math.min(aheadMaxY + C.lookOverClearance - C.height, base + C.lookOverMaxLift));
    // A sky shot refuses the look-over: at 14 m/s it shoves the feet off the bottom of the frame.
    if (follow?.maxAbove !== undefined) targetY = Math.min(targetY, riderY + follow.maxAbove);
    const vy = this.initialised && dt > 0 ? (riderY - this.prevRiderY) / dt : 0;
    this.prevRiderY = riderY;
    let lag = follow?.heightLag ?? C.heightLag;
    if (follow?.catchLag !== undefined && this.initialised && (this.fy - targetY > 0.2 || vy < -1.2)) {
      lag = Math.min(lag, follow.catchLag);
    }
    if (!this.initialised || snap) {
      this.fx = riderX; this.fy = targetY; this.pull = speed; this.initialised = true;
    } else {
      this.fx += (riderX - this.fx) * (1 - Math.exp(-dt / C.followLag));
      this.fy += (targetY - this.fy) * (1 - Math.exp(-dt / Math.max(1e-4, lag)));
      this.pull += (speed - this.pull) * (1 - Math.exp(-dt / C.pullLag));
    }
    // speed sensation: gentle FOV widening (angle/pitch never change)
    this.shakeT += dt;
    const decay = Math.max(0, 1 - this.shakeT / TUNING.feedback.breakShakeTime);
    if (decay <= 0) { this.shakeAmp = 0; this.fovPunch = 0; }
    const fov = this.fovPunch * decay * decay + C.fov + C.fovAtCap * Math.min(1, Math.max(0, this.pull / TUNING.movement.hardCap));
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.placeChase(decay, lateral);
    if (follow?.band) this.holdFeetInBand(riderX, riderY, decay, lateral);
  }

  /** Chase position from the smoothed follow. Shake is applied on top and does not move the follow. */
  private placeChase(decay: number, lateral: number): void {
    const C = TUNING.camera;
    const behind = (C.behind + C.behindPerSpeed * this.pull) * this.scale;
    const height = (C.height + C.heightPerSpeed * this.pull) * this.scale;
    toScene(this.fx - behind, this.fy + height, lateral, this.camera.position);
    if (this.shakeAmp > 0) {
      const a = this.shakeAmp * decay * decay, w = this.shakeT * 70;
      this.camera.position.y += Math.sin(w) * a;
      this.camera.position.x += Math.sin(w * 1.37 + 1) * a * 0.6;
    }
  }

  /**
   * Last-resort correction so a sky shot cannot leave Ao's feet outside 45–85%
   * of the frame. The follow above is tuned to stay inside; this only trims
   * whatever a steep drop still accumulates, and it does not change pitch or yaw.
   */
  private holdFeetInBand(riderX: number, riderY: number, decay: number, lateral: number): void {
    const hi = 0.83;
    const lo = 0.48;
    const read = (): number => {
      this.camera.updateMatrixWorld(true);
      toScene(riderX, riderY, 0, _feet);
      _feet.project(this.camera);
      return (1 - _feet.y) / 2;
    };
    let f = read();
    for (let n = 0; n < 2 && (f > hi || f < lo); n++) {
      const saved = this.fy;
      this.fy = saved + 0.4;
      this.placeChase(decay, lateral);
      const f2 = read();
      const slope = (f2 - f) / 0.4;
      const goal = f > hi ? 0.78 : 0.55;
      this.fy = Math.abs(slope) > 1e-4 ? saved + (goal - f) / slope : saved;
      this.placeChase(decay, lateral);
      f = read();
    }
  }
}

const _feet = new THREE.Vector3();
