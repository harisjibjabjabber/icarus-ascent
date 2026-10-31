import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

/**
 * Animation authoring kit for the heroine. Clips are authored as sparse keys in "rider space"
 * (the figure faces +Z, her left = +X = the board nose / travel direction, +Y up) and baked
 * into dense THREE.AnimationClips (30 Hz, monotone cubic between keys, so holds stay still and
 * nothing overshoots unless a key says so: anticipation / overshoot / settle are authored).
 * Rotations are Euler 'ZYX' on VRM normalized bones:
 *   x+ = bend forward (toward her face), y+ = turn toward travel (+X), z+ = tilt top toward -X (her right).
 */
export type V3 = [number, number, number];
export type Pose = Record<string, V3>;
export interface Ctl { gripL: number; gripR: number; look: number }
export interface Key {
  t: number;
  /** Bone euler overrides (inherited by later keys until overridden). */
  pose?: Pose;
  /** Hips offset (m) from "standing on the deck" rest: x along the board, y up, z toward her face. */
  hips?: V3;
  /** Ankle targets (m): x along the board, y above the planted ankle height, z across the deck. */
  ikL?: V3; ikR?: V3;
  /** Foot orientation (euler, deck space): yaw toward the nose, pitch (toe down +), roll. */
  fL?: V3; fR?: V3;
  ctl?: Partial<Ctl>;
}
export interface ClipDef { name: string; base: Pose; keys: Key[]; loop?: boolean; dur?: number;
  /** Restraint: authored upper-body rotations and hips offsets are scaled toward the riding stance by this (1 = as authored). */
  amp?: number }

/** Reference the restraint scales toward (set once by clips.ts): the stance pose and its hips offset. */
let REST: { pose: Pose; hips: V3 } | null = null;
export function setRestraintReference(pose: Pose, hips: V3): void { REST = { pose, hips }; }
/** Bones the restraint touches: the trunk, head and arms. Legs are IK-driven and hands keep their gestures. */
const RESTRAINED = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand']);

export const E = (x = 0, y = 0, z = 0): V3 => [x, y, z];
const FPS = 30;

/** Rest measurements of the loaded model, in figure space. */
export interface RigInfo {
  vrm: VRM;
  v0: boolean;
  hipsRest: THREE.Vector3;
  ankleL: THREE.Vector3; ankleR: THREE.Vector3;
  /** figure space -> hips parent space */
  hipsParentInv: THREE.Matrix4;
  footRestL: THREE.Quaternion; footRestR: THREE.Quaternion;
  deckTop: number;
  ik: { L: THREE.Object3D; R: THREE.Object3D; fL: THREE.Object3D; fR: THREE.Object3D; ctl: THREE.Object3D };
}

// ---- monotone cubic (Fritsch-Carlson / PCHIP) on a scalar channel ----
function tangents(t: number[], v: number[], loop: boolean): number[] {
  const n = v.length, m = new Array<number>(n).fill(0);
  const d: number[] = []; for (let i = 0; i < n - 1; i++) d.push((v[i + 1] - v[i]) / Math.max(1e-6, t[i + 1] - t[i]));
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const h0 = t[i] - t[i - 1], h1 = t[i + 1] - t[i];
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d[i - 1] + (h1 + 2 * h0) / d[i]);
  }
  if (loop && n > 2) { // wrap: first and last key are the same pose
    const a = d[n - 2], b = d[0];
    const h0 = t[n - 1] - t[n - 2], h1 = t[1] - t[0];
    m[0] = m[n - 1] = a * b <= 0 ? 0 : (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
  }
  return m;
}
function hermite(t: number[], v: number[], m: number[], x: number): number {
  if (x <= t[0]) return v[0];
  const n = t.length; if (x >= t[n - 1]) return v[n - 1];
  let i = 0; while (i < n - 2 && x > t[i + 1]) i++;
  const h = t[i + 1] - t[i], s = (x - t[i]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
}

/** Resolve key inheritance: every key gets every channel. */
function resolve(def: ClipDef) {
  const keys = [...def.keys].sort((a, b) => a.t - b.t);
  const dur = def.dur ?? keys[keys.length - 1].t;
  if (def.loop && keys[keys.length - 1].t < dur) keys.push({ ...keys[0], t: dur });
  const full: Required<Omit<Key, 'ctl'>> & { ctl: Ctl }[] = [] as never;
  let prev: { pose: Pose; hips: V3; ikL: V3; ikR: V3; fL: V3; fR: V3; ctl: Ctl } = {
    pose: { ...def.base }, hips: [0, 0, 0], ikL: [0.24, 0, 0.02], ikR: [-0.24, 0, 0], fL: [0.3, 0, 0], fR: [-0.15, 0, 0], ctl: { gripL: 0, gripR: 0, look: 1 },
  };
  const out: { t: number; pose: Pose; hips: V3; ikL: V3; ikR: V3; fL: V3; fR: V3; ctl: Ctl }[] = [];
  for (const k of keys) {
    const cur = { t: k.t, pose: { ...prev.pose, ...(k.pose ?? {}) }, hips: k.hips ?? prev.hips, ikL: k.ikL ?? prev.ikL, ikR: k.ikR ?? prev.ikR, fL: k.fL ?? prev.fL, fR: k.fR ?? prev.fR, ctl: { ...prev.ctl, ...(k.ctl ?? {}) } };
    out.push(cur); prev = cur;
  }
  void full;
  // a loop's closing key must equal the first, whatever the inheritance produced
  if (def.loop) { const f = out[0]; out[out.length - 1] = { ...f, t: dur, pose: { ...f.pose } }; }
  return { keys: out, dur };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();

/** Bake a clip definition into an AnimationClip bound to this rig. */
export function bake(def: ClipDef, rig: RigInfo): THREE.AnimationClip {
  const { keys, dur } = resolve(def);
  const T = keys.map((k) => k.t);
  const loop = !!def.loop;
  const n = Math.max(2, Math.round(dur * FPS) + 1);
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * dur);
  const chan = (get: (k: (typeof keys)[number]) => number) => { const v = keys.map(get); const m = tangents(T, v, loop); return (x: number) => hermite(T, v, m, x); };
  const tracks: THREE.KeyframeTrack[] = [];
  const bones = new Set<string>(); for (const k of keys) for (const b of Object.keys(k.pose)) bones.add(b);
  const amp = def.amp ?? 1;
  if (REST && amp !== 1) {
    const hipsAmp = 0.5 + 0.5 * amp; // crouch depth reads; keep more of it than of the rotations
    for (const k of keys) {
      for (const bn of Object.keys(k.pose)) {
        if (!RESTRAINED.has(bn)) continue;
        const r = REST.pose[bn] ?? [0, 0, 0], v = k.pose[bn];
        k.pose[bn] = [r[0] + (v[0] - r[0]) * amp, r[1] + (v[1] - r[1]) * amp, r[2] + (v[2] - r[2]) * amp];
      }
      k.hips = [REST.hips[0] + (k.hips[0] - REST.hips[0]) * hipsAmp, REST.hips[1] + (k.hips[1] - REST.hips[1]) * hipsAmp, REST.hips[2] + (k.hips[2] - REST.hips[2]) * hipsAmp];
    }
  }
  for (const b of bones) {
    const node = rig.vrm.humanoid.getNormalizedBoneNode(b as never); if (!node) continue;
    const cx = chan((k) => (k.pose[b] ?? [0, 0, 0])[0]), cy = chan((k) => (k.pose[b] ?? [0, 0, 0])[1]), cz = chan((k) => (k.pose[b] ?? [0, 0, 0])[2]);
    const vals: number[] = [];
    let last: THREE.Quaternion | null = null;
    for (const t of times) {
      _q.setFromEuler(_e.set(cx(t), cy(t), cz(t), 'ZYX'));
      if (rig.v0) { _q.x = -_q.x; _q.z = -_q.z; } // VRM0 normalized bones are mirrored about Y
      if (last && last.dot(_q) < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      last = (last ?? new THREE.Quaternion()).copy(_q);
      vals.push(_q.x, _q.y, _q.z, _q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, vals));
  }
  const vec = (name: string, get: (k: (typeof keys)[number]) => V3, map: (v: THREE.Vector3) => THREE.Vector3) => {
    const c = [0, 1, 2].map((i) => chan((k) => get(k)[i]));
    const vals: number[] = [];
    for (const t of times) { map(_v.set(c[0](t), c[1](t), c[2](t))); vals.push(_v.x, _v.y, _v.z); }
    tracks.push(new THREE.VectorKeyframeTrack(name, times, vals));
  };
  const hips = rig.vrm.humanoid.getNormalizedBoneNode('hips')!;
  vec(`${hips.name}.position`, (k) => k.hips, (v) => v.add(rig.hipsRest).setY(v.y + rig.deckTop).applyMatrix4(rig.hipsParentInv));
  vec(`${rig.ik.L.name}.position`, (k) => k.ikL, (v) => v.set(v.x, rig.deckTop + rig.ankleL.y + v.y, v.z));
  vec(`${rig.ik.R.name}.position`, (k) => k.ikR, (v) => v.set(v.x, rig.deckTop + rig.ankleR.y + v.y, v.z));
  vec(`${rig.ik.fL.name}.rotation`, (k) => k.fL, (v) => v); // read back as euler by the IK pass
  vec(`${rig.ik.fR.name}.rotation`, (k) => k.fR, (v) => v);
  vec(`${rig.ik.ctl.name}.position`, (k) => [k.ctl.gripL, k.ctl.gripR, k.ctl.look], (v) => v);
  // rotation tracks on plain Object3Ds are not standard: store euler in .position of the foot objects instead
  for (const tr of tracks) if (tr.name.endsWith('.rotation')) tr.name = tr.name.replace('.rotation', '.position');
  return new THREE.AnimationClip(def.name, dur, tracks);
}

/** Keep only upper-body bone tracks (for additive layers). */
export function upperBodyOnly(clip: THREE.AnimationClip, rig: RigInfo): THREE.AnimationClip {
  const keep = new Set(['spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand']
    .map((b) => rig.vrm.humanoid.getNormalizedBoneNode(b as never)?.name).filter(Boolean) as string[]);
  clip.tracks = clip.tracks.filter((t) => keep.has(t.name.split('.')[0]));
  return clip;
}

// ---- analytic two-bone IK (world space), from the proven spike ----
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _ac = new THREE.Vector3(), _ab = new THREE.Vector3(), _ba = new THREE.Vector3(), _bc = new THREE.Vector3(), _at = new THREE.Vector3();
const _ax0 = new THREE.Vector3(), _ax1 = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _r0 = new THREE.Quaternion(), _r1 = new THREE.Quaternion(), _r2 = new THREE.Quaternion(), _n1 = new THREE.Quaternion(), _n2 = new THREE.Quaternion();
const clampDot = (u: THREE.Vector3, v: THREE.Vector3) => Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
/**
 * Two-bone IK: rotates upper/lower so `end` reaches `target` (the bend plane comes from the
 * animated pose; `hint` is used only when the limb is straight). Optionally sets the end
 * bone's world rotation. `weight` blends from the animated pose.
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, hint: THREE.Vector3, endWorld: THREE.Quaternion | null, weight = 1): void {
  if (weight <= 0.001) return;
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); end.getWorldPosition(_c);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  _t.copy(target);
  if (weight < 1) _t.lerpVectors(_c, target, weight);
  _at.copy(_t).sub(_a);
  const lat = THREE.MathUtils.clamp(_at.length(), 0.01, lab + lcb - 0.001);
  _ac.copy(_c).sub(_a); _ab.copy(_b).sub(_a); _ba.copy(_a).sub(_b); _bc.copy(_c).sub(_b);
  const acab0 = clampDot(_ac.clone().normalize(), _ab.clone().normalize());
  const babc0 = clampDot(_ba.clone().normalize(), _bc.clone().normalize());
  const acat0 = clampDot(_ac.clone().normalize(), _at.clone().normalize());
  const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  _ax0.crossVectors(_ac, _ab); if (_ax0.lengthSq() < 1e-8) _ax0.copy(hint); _ax0.normalize();
  _ax1.crossVectors(_ac, _at); if (_ax1.lengthSq() < 1e-10) _ax1.copy(_ax0); _ax1.normalize();
  _r0.setFromAxisAngle(_ax0, acab1 - acab0);
  _r1.setFromAxisAngle(_ax0, babc1 - babc0);
  _r2.setFromAxisAngle(_ax1, acat0);
  upper.getWorldQuaternion(_qa); lower.getWorldQuaternion(_qb); upper.parent!.getWorldQuaternion(_qp);
  _n1.copy(_r2).multiply(_r0).multiply(_qa);
  _n2.copy(_r2).multiply(_r0).multiply(_r1).multiply(_qb);
  upper.quaternion.copy(_qp.invert().multiply(_n1));
  lower.quaternion.copy(_n1.clone().invert().multiply(_n2));
  if (endWorld) end.quaternion.copy(_n2.clone().invert().multiply(endWorld));
  upper.updateMatrixWorld(true);
}
