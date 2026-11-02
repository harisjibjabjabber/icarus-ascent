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

/** The fast gust follow used to last this long after release. The settle now takes the handoff. */
export const GUST_CAM_HOLD = 0.3;

/**
 * Settled sky shot, tuned on a 390×844 frame at the governed 14 m/s.
 * The street chase already pins Ao's feet at ~85%. Matching that framing on a
 * laundry line makes the line read as the ground. A few degrees more look-down
 * and a slightly lower boom put her up in the frame, the cobbles in the bottom
 * band, and the next line still inside the picture.
 */
const SKY_PITCH_EXTRA = 8;
const SKY_SETTLE_LIFT = -0.7;
/** Height lag while she is rising in the gust, so the camera stays behind and below. */
const GUST_HEIGHT_LAG = 0.4;
/** How far behind (along the route) the camera trails during the gust. Street follow is 0.06 s. */
const GUST_FOLLOW_LAG = 0.16;

export interface SkyCamMemory { postGust: number }

export interface CamPlan {
  heightLag: number;
  lift: number;
  /** Look-over may not place the follow above `riderY + maxAbove`. */
  maxAbove?: number;
  /** Faster height lag when the frame has been left far above the rider. */
  catchLag?: number;
  /** Hold projected feet inside the sky band (45–85%). Street chase leaves this off. */
  band?: boolean;
  /** Added to the street pitch (deg). Positive looks down more. Eased by the rig. */
  pitchExtra?: number;
  /** Seconds to ease the extra pitch. */
  pitchLag?: number;
  /** Along-route follow lag. Street chase keeps the tuning value when this is omitted. */
  followLag?: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Street height under the rider, for the sky look-down blend. No course reads as 0. */
export function streetUnder(
  course: { groundBelow(x: number, y: number): { sample: { y: number } } | null } | null | undefined,
  x: number,
  y: number,
): number {
  if (!course) return 0;
  return course.groundBelow(x, y + 4)?.sample.y ?? 0;
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

/**
 * Height-follow for the chase camera.
 * Street play is unchanged. In the sky the gust lags so the rise reads, then the
 * shot settles into a slightly steeper look-down and eases back as she descends.
 * `heightAbove` is metres above the street under the rider.
 */
export function stepSkyCamera(
  mode: MoveMode,
  layer: 'street' | 'sky',
  dt: number,
  mem: SkyCamMemory,
  inSkyRun = false,
  heightAbove = 0,
): CamPlan {
  const S = TUNING.tricks.sky;
  if (mode === 'gusting') mem.postGust = GUST_CAM_HOLD;
  else mem.postGust = Math.max(0, mem.postGust - Math.max(0, dt));
  const gustCam = mode === 'gusting' || mem.postGust > 0;
  const sky = inSkyRun || gustCam || layer === 'sky';
  if (!sky) return { heightLag: TUNING.camera.heightLag, lift: 0 };

  // The whoosh: stay on the street angle and trail below her, so she shoots up the frame.
  if (mode === 'gusting') {
    return {
      heightLag: GUST_HEIGHT_LAG,
      lift: -0.45,
      maxAbove: -0.2,
      pitchExtra: 0,
      pitchLag: 0.7,
      followLag: GUST_FOLLOW_LAG,
      band: true,
    };
  }

  if (layer === 'sky' || gustCam) {
    // Full look-down once she is clearly above the street; it eases off on the glide down.
    // Full look-down on the lines (about 6 m and up). The glide down from the
    // top line passes back through this ramp, so the angle eases off with her.
    const blend = smoothstep(2.2, 6.6, heightAbove);
    const airborne = mode === 'airborne' || mode === 'flying';
    return {
      heightLag: airborne ? 0.28 : S.camSkyLag,
      lift: SKY_SETTLE_LIFT * blend,
      maxAbove: -0.2,
      pitchExtra: SKY_PITCH_EXTRA * blend,
      pitchLag: 0.5,
      band: true,
      catchLag: 0.24,
    };
  }

  // Run-in and the landing, still inside the segment: street angle, and don't
  // look over the lines yet or the feet leave the frame before the gust.
  return {
    heightLag: TUNING.camera.heightLag,
    lift: 0,
    maxAbove: 0.05,
    pitchExtra: 0,
    pitchLag: 0.55,
    band: true,
  };
}

/**
 * Chase camera. It sits behind and above the rider and looks ahead down the route.
 * It never orbits or yaws. Street pitch stays fixed; a sky shot eases a few degrees
 * steeper so the height reads, then eases back on the way down. Position follows
 * progress (x) and, with more lag, height (y).
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
  private pitchExtra = 0;

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
    // Sky shots cap look-over. At 14 m/s the full 1.9 m lift shoves the feet off the bottom,
    // and during the gust it would cancel the trail that sells the rise.
    if (follow?.maxAbove !== undefined) targetY = Math.min(targetY, riderY + follow.maxAbove);
    let lag = follow?.heightLag ?? C.heightLag;
    // Only catch up when the frame has been left far above her (a landing). A gentle
    // descent keeps its lag so the camera eases down instead of sticking to her.
    if (follow?.catchLag !== undefined && this.initialised && this.fy - targetY > 1.15) {
      lag = Math.min(lag, follow.catchLag);
    }
    const wantPitch = follow?.pitchExtra ?? 0;
    const pitchLag = Math.max(1e-4, follow?.pitchLag ?? 0.45);
    const followLag = follow?.followLag ?? C.followLag;
    if (!this.initialised || snap) {
      this.fx = riderX; this.fy = targetY; this.pull = speed; this.pitchExtra = wantPitch; this.initialised = true;
    } else {
      this.fx += (riderX - this.fx) * (1 - Math.exp(-dt / Math.max(1e-4, followLag)));
      this.fy += (targetY - this.fy) * (1 - Math.exp(-dt / Math.max(1e-4, lag)));
      this.pull += (speed - this.pull) * (1 - Math.exp(-dt / C.pullLag));
      this.pitchExtra += (wantPitch - this.pitchExtra) * (1 - Math.exp(-dt / pitchLag));
    }
    this.applyPitch();
    // speed sensation: gentle FOV widening (angle/pitch never change)
    this.shakeT += dt;
    const decay = Math.max(0, 1 - this.shakeT / TUNING.feedback.breakShakeTime);
    if (decay <= 0) { this.shakeAmp = 0; this.fovPunch = 0; }
    const fov = this.fovPunch * decay * decay + C.fov + C.fovAtCap * Math.min(1, Math.max(0, this.pull / TUNING.movement.hardCap));
    if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.placeChase(decay, lateral);
    if (follow?.band) this.holdFeetInBand(riderX, riderY, decay, lateral);
  }

  /** Street pitch plus the eased sky look-down. Yaw never changes. */
  private applyPitch(): void {
    const C = TUNING.camera;
    const pitch = ((C.pitchDeg + this.pitchExtra) * Math.PI) / 180;
    const yaw = ((C.routeYawDeg - 90) * Math.PI) / 180;
    this.camera.rotation.set(-pitch, -yaw, 0, 'YXZ');
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
      const goal = f > hi ? 0.78 : 0.52;
      this.fy = Math.abs(slope) > 1e-4 ? saved + (goal - f) / slope : saved;
      this.placeChase(decay, lateral);
      f = read();
    }
  }
}

const _feet = new THREE.Vector3();
