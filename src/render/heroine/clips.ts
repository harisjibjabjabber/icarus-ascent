import * as THREE from 'three';
import { E, setRestraintReference, type ClipDef, type Pose, type V3, type Key } from './kit';

/**
 * Ao's performance, authored for the broom (ridden like a skateboard) (regular stance: left foot to the nose, +X).
 * She faces +Z (the rider's right, away from the chase camera), so the camera reads her back,
 * hair and three-quarter profile; the chest opens toward travel and the head turns further.
 * Appeal rules: an S-curve in every key pose (hips set back and counter-tilted against the
 * shoulders), asymmetric arms, soft wrists and fingers, a 5-10 deg head tilt; anticipation
 * before big moves, overshoot on arrival, settle after. Tasteful: no chest physics, no
 * lingering poses, nothing suggestive.
 */

// ---------- pose helpers ----------
const _q = new THREE.Quaternion(), _tw = new THREE.Quaternion(), _e = new THREE.Euler(), _d = new THREE.Vector3();
const REST_L = new THREE.Vector3(1, 0, 0), REST_R = new THREE.Vector3(-1, 0, 0);
const eul = (q: THREE.Quaternion): V3 => { _e.setFromQuaternion(q, 'ZYX'); return [_e.x, _e.y, _e.z]; };
/**
 * Arm pose from intuitive values: `dir` = upper-arm direction in chest space (x toward the nose,
 * y up, z toward her face), `twist` about the arm (+ = thumb forward), `elbow` flex (rad),
 * `wrist` euler.
 */
function arm(side: 'L' | 'R', dir: V3, elbow = 0.3, twist = 0, wrist: V3 = [0, 0, 0]): Pose {
  _d.set(...dir).normalize();
  _q.setFromUnitVectors(side === 'L' ? REST_L : REST_R, _d);
  _tw.setFromAxisAngle(_d, side === 'L' ? twist : -twist);
  _q.premultiply(_tw);
  const s = side === 'L' ? 'left' : 'right';
  const flex = side === 'L' ? -elbow : elbow;
  return { [`${s}UpperArm`]: eul(_q), [`${s}LowerArm`]: [0, flex, 0], [`${s}Hand`]: side === 'L' ? wrist : [wrist[0], -wrist[1], -wrist[2]] };
}
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
/** Finger curl per finger (0 open .. 1 fist), thumb curl. */
function hand(side: 'L' | 'R', curl: [number, number, number, number], thumb = 0.3): Pose {
  const s = side === 'L' ? 'left' : 'right', sg = side === 'L' ? -1 : 1;
  const p: Pose = {};
  FINGERS.forEach((f, i) => {
    const c = curl[i];
    const spread = (i - 1.5) * 0.06 * (1 - c);
    p[`${s}${f}Proximal`] = [0, sg * spread, sg * c * 1.25];
    p[`${s}${f}Intermediate`] = [0, 0, sg * c * 1.35];
    p[`${s}${f}Distal`] = [0, 0, sg * c * 0.9];
  });
  p[`${s}ThumbMetacarpal`] = [0, -sg * (0.35 + thumb * 0.3), sg * 0.1];
  p[`${s}ThumbProximal`] = [0, -sg * thumb * 0.5, 0];
  p[`${s}ThumbDistal`] = [0, -sg * thumb * 0.6, 0];
  return p;
}
const RELAX: [number, number, number, number] = [0.22, 0.3, 0.38, 0.45];
const FIST: [number, number, number, number] = [0.95, 1, 1, 1];
const PEACE: [number, number, number, number] = [0, 0, 0.95, 1];
const OPEN: [number, number, number, number] = [0.05, 0.08, 0.12, 0.16];
const m = (...ps: Pose[]): Pose => Object.assign({}, ...ps);

// legs: a soft pre-bend so the IK plane points the knees over the toes (cute: back knee a touch in)
const LEGS: Pose = { leftUpperLeg: E(-0.32, -0.1, 0.02), leftLowerLeg: E(0.62, 0, 0), rightUpperLeg: E(-0.34, 0.2, -0.02), rightLowerLeg: E(0.66, 0, 0), leftFoot: E(), rightFoot: E() };

/** The riding stance every clip starts from. */
const STANCE: Pose = m(
  {
    hips: E(0.05, 0.22, -0.06),
    spine: E(0.03, 0.1, 0.06), chest: E(-0.02, 0.08, 0.03), upperChest: E(-0.03, 0.04, 0),
    neck: E(0.0, 0.18, -0.02), head: E(0.03, 0.36, -0.1),
    leftShoulder: E(0, 0, 0), rightShoulder: E(0, 0, 0),
  },
  LEGS,
  arm('L', [0.36, -0.92, 0.14], 0.4, 0.2, [0, 0, 0.12]), arm('R', [-0.3, -0.94, -0.06], 0.45, 0.15, [0, 0, 0.12]),
  hand('L', RELAX), hand('R', RELAX),
);
const H0: V3 = [0, -0.1, -0.03]; // hips: knees soft, seat a touch back
const IKL: V3 = [0.2, 0, 0.04], IKR: V3 = [-0.21, 0, -0.01];

// ---------- ground ----------
const idle: ClipDef = { name: 'idle', base: STANCE, loop: true, dur: 2.6, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR },
  { t: 1.3, hips: [0.02, -0.105, -0.04], pose: m({ hips: E(0.07, 0.26, -0.12), spine: E(0.04, 0.12, 0.1), chest: E(-0.01, 0.1, 0.05), head: E(0.06, 0.42, -0.15), neck: E(0.0, 0.2, -0.03) },
    arm('L', [0.42, -0.88, 0.18], 0.48, 0.2, [0, 0, 0.18]), arm('R', [-0.26, -0.95, -0.1], 0.38, 0.15, [0, 0, 0.08])) },
] };
const cruise: ClipDef = { name: 'cruise', base: STANCE, loop: true, dur: 1.6, keys: [
  { t: 0, hips: [0.03, -0.16, -0.06], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.1, 0.26, -0.04), spine: E(0.05, 0.12, 0.04), chest: E(-0.02, 0.06, 0.02), upperChest: E(-0.03, 0.03, 0), neck: E(-0.04, 0.16, 0), head: E(-0.02, 0.34, -0.08) },
    arm('L', [0.45, -0.84, 0.28], 0.65, 0.3, [0, 0, 0.2]), arm('R', [-0.38, -0.88, -0.2], 0.6, 0.2, [0, 0, 0.15])) },
  { t: 0.8, hips: [0.035, -0.175, -0.065], pose: m({ spine: E(0.06, 0.13, 0.02), head: E(-0.01, 0.35, -0.06) }, arm('L', [0.47, -0.82, 0.3], 0.7, 0.3, [0, 0, 0.24]), arm('R', [-0.4, -0.86, -0.22], 0.64, 0.2, [0, 0, 0.18])) },
] };
/** Downhill tuck / charge: deep C-curve, hands by the knees, eyes up the line. */
const tuck: ClipDef = { name: 'tuck', base: STANCE, loop: true, dur: 1.2, keys: [
  { t: 0, hips: [0.04, -0.3, -0.1], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.5, 0.28, -0.03), spine: E(0.16, 0.16, 0.02), chest: E(0.02, 0.08, 0), upperChest: E(-0.04, 0.03, 0), neck: E(-0.22, 0.16, 0), head: E(-0.2, 0.34, -0.06) },
    arm('L', [0.45, -0.7, 0.55], 0.95, 0.5, [0.1, 0, 0.25]), arm('R', [-0.3, -0.75, 0.55], 1.05, 0.4, [0.1, 0, 0.2]), hand('L', [0.4, 0.5, 0.55, 0.6]), hand('R', [0.4, 0.5, 0.55, 0.6])) },
  { t: 0.6, hips: [0.04, -0.315, -0.1], pose: { spine: E(0.18, 0.17, 0.0) } },
] };
/** Push (v2, Haris: no crunch): tall spine, hinge ~12 deg from the hips only, chest open, head up looking ahead.
 *  Front knee softens, the back foot steps down on the toe side, makes one long smooth sweep back and returns.
 *  Arms swing loosely, opposite to the kicking leg, never across the chest. Gentle hip sway. */
const PUSH_UP = (hipF: number, sway: number, twist: number): Pose => ({
  hips: E(hipF, 0.26 + twist, -0.04 + sway), spine: E(0.02, 0.08 + twist * 0.4, 0.04 - sway * 0.5), chest: E(-0.03, 0.05, 0.02),
  upperChest: E(-0.04, 0.03, 0), neck: E(-0.04, 0.14, -0.02), head: E(-0.05, 0.3, -0.08),
  leftShoulder: E(0, 0, 0), rightShoulder: E(0, 0, 0),
});
const push: ClipDef = { name: 'push', base: STANCE, dur: 1.0, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR, fR: [0, 0, 0] },
  // weight onto the front foot, back foot lifts (anticipation: tiny settle down)
  { t: 0.14, hips: [0.05, -0.15, -0.03], ikL: IKL, ikR: [-0.15, 0.1, 0.1], fR: [-0.08, 0.15, 0],
    pose: m(PUSH_UP(0.12, 0.02, 0.06), arm('L', [0.38, -0.91, 0.12], 0.38, 0.2, [0, 0, 0.12]), arm('R', [-0.36, -0.91, 0.06], 0.4, 0.15, [0, 0, 0.12]), hand('L', RELAX), hand('R', RELAX)) },
  // foot plants on the toe side, front knee soft (deepest hinge ~12 deg)
  { t: 0.3, hips: [0.06, -0.19, -0.02], ikR: [-0.08, -0.07, 0.25], fR: [-0.12, 0.05, 0],
    pose: m(PUSH_UP(0.2, 0.04, 0.08), arm('L', [0.3, -0.93, 0.1], 0.35, 0.2, [0, 0, 0.12]), arm('R', [-0.3, -0.93, 0.08], 0.38, 0.15, [0, 0, 0.12])) },
  // long sweep back: left arm drifts forward, right arm back (opposite to the kicking leg), hips sway over the front foot
  { t: 0.56, hips: [0.07, -0.19, -0.02], ikR: [-0.6, -0.075, 0.22], fR: [-0.18, 0.3, 0],
    pose: m(PUSH_UP(0.2, -0.04, 0.1), arm('L', [0.52, -0.84, 0.14], 0.42, 0.2, [0, 0, 0.14]), arm('R', [-0.55, -0.82, -0.08], 0.32, 0.15, [0, 0, 0.1])) },
  // foot comes off the ground and swings home
  { t: 0.74, hips: [0.05, -0.15, -0.03], ikR: [-0.4, 0.12, 0.08], fR: [-0.12, 0.1, 0],
    pose: m(PUSH_UP(0.13, 0, 0.05), arm('L', [0.4, -0.9, 0.12], 0.4, 0.2, [0, 0, 0.12]), arm('R', [-0.38, -0.9, 0.0], 0.4, 0.15, [0, 0, 0.12])) },
  // back on the deck: soft overshoot down, then settle tall
  { t: 0.86, hips: [0.02, -0.13, -0.035], ikR: IKR, fR: [-0.04, 0, 0] },
  { t: 1.0, hips: H0, fR: [0, 0, 0], pose: STANCE },
] };

// ---------- air ----------
const AIR_OPEN = m({ hips: E(0.05, 0.28, -0.04), spine: E(-0.02, 0.18, 0.04), chest: E(-0.04, 0.12, 0.02), neck: E(-0.1, 0.16, 0), head: E(-0.14, 0.4, -0.1) },
  arm('L', [0.85, -0.08, 0.28], 0.35, 0.4, [0, 0, 0.15]), arm('R', [-0.84, 0.04, -0.15], 0.4, 0.4, [0, 0, 0.15]), hand('L', OPEN), hand('R', OPEN));
const pop: ClipDef = { name: 'pop', base: STANCE, dur: 0.34, keys: [
  { t: 0, hips: [0.02, -0.28, -0.08], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.4, 0.28, -0.04), spine: E(0.12, 0.14, 0), chest: E(0, 0.06, 0), upperChest: E(-0.04, 0, 0), neck: E(-0.12, 0.14, 0), head: E(-0.18, 0.34, -0.05) }, arm('L', [0.3, -0.88, -0.3], 0.4), arm('R', [-0.3, -0.88, -0.35], 0.4)) },
  { t: 0.08, hips: [0.0, -0.02, -0.02], pose: m({ hips: E(0.0, 0.25, -0.04), spine: E(-0.1, 0.16, 0.04), chest: E(-0.06, 0.1, 0), head: E(-0.22, 0.38, -0.08) }, arm('L', [0.55, 0.75, 0.3], 0.3), arm('R', [-0.45, 0.8, 0.1], 0.35), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.2, hips: [0.0, -0.18, -0.04], pose: m({ hips: E(0.12, 0.28, -0.04), spine: E(0.06, 0.18, 0.04) }, arm('L', [0.8, 0.3, 0.2], 0.3, 0.4), arm('R', [-0.78, 0.38, -0.05], 0.35, 0.4)) },
  { t: 0.34, hips: [0.0, -0.14, -0.04], pose: AIR_OPEN },
] };
const airUp: ClipDef = { name: 'airUp', base: STANCE, loop: true, dur: 1.4, keys: [
  { t: 0, hips: [0, -0.15, -0.04], ikL: IKL, ikR: IKR, pose: AIR_OPEN },
  { t: 0.7, hips: [0, -0.165, -0.04], pose: m(arm('L', [0.85, -0.02, 0.3], 0.38, 0.45, [0, 0, 0.1]), arm('R', [-0.84, 0.1, -0.17], 0.42, 0.45, [0, 0, 0.1]), { head: E(-0.18, 0.42, -0.12) }) },
] };
const airDown: ClipDef = { name: 'airDown', base: STANCE, loop: true, dur: 1.2, keys: [
  { t: 0, hips: [0, -0.08, -0.03], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.08, 0.26, -0.05), spine: E(0.08, 0.16, 0.05), chest: E(0.04, 0.1, 0.02), neck: E(0.05, 0.16, 0), head: E(0.22, 0.38, -0.08) },
    arm('L', [0.82, -0.38, 0.2], 0.3, 0.3), arm('R', [-0.8, -0.3, -0.1], 0.32, 0.3), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.6, hips: [0, -0.09, -0.03], pose: m(arm('L', [0.8, -0.32, 0.22], 0.32, 0.3), arm('R', [-0.82, -0.26, -0.12], 0.3, 0.3)) },
] };
/** Crest float: a softer "whee" with the arms drifting up. */
const float: ClipDef = { name: 'float', base: STANCE, dur: 0.45, keys: [
  { t: 0, hips: [0.02, -0.12, -0.04], ikL: IKL, ikR: IKR },
  { t: 0.22, hips: [0, -0.06, -0.03], pose: m({ spine: E(-0.08, 0.2, 0.05), chest: E(-0.06, 0.12, 0), head: E(-0.28, 0.42, -0.14) }, arm('L', [0.6, 0.62, 0.3], 0.35, 0.5, [0, 0, -0.25]), arm('R', [-0.58, 0.66, 0.1], 0.4, 0.5, [0, 0, -0.25]), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.45, hips: [0, -0.14, -0.04], pose: AIR_OPEN },
] };
/** Grab left: front hand to the toe edge, knees up, back arm up, head turned back to camera (wink). */
const GRAB_L = m({ hips: E(0.25, 0.1, -0.12), spine: E(0.38, -0.05, 0.12), chest: E(0.14, -0.08, 0.06), upperChest: E(0.05, 0, 0), neck: E(-0.05, -0.25, 0.04), head: E(-0.05, -0.55, 0.16) },
  arm('L', [0.3, -0.75, 0.6], 0.5, 0.3), arm('R', [-0.45, 0.8, -0.35], 0.45, 0.6, [0, 0, -0.2]), hand('L', [0.85, 0.9, 0.9, 0.95]), hand('R', OPEN));
const grabL: ClipDef = { name: 'grabL', base: STANCE, loop: true, dur: 1.4, keys: [
  { t: 0, hips: [0.04, -0.36, -0.02], ikL: [0.2, 0, 0.04], ikR: [-0.2, 0, -0.01], pose: GRAB_L, ctl: { gripL: 1, gripR: 0, look: 0 } },
  { t: 0.7, hips: [0.04, -0.375, -0.02], pose: m({ head: E(-0.08, -0.6, 0.2) }, arm('R', [-0.5, 0.78, -0.32], 0.5, 0.6, [0, 0, -0.28])) },
] };
/** Grab right: stalefish-style, back hand behind the back leg to the heel edge, hips twisted, smug. */
const GRAB_R = m({ hips: E(0.3, 0.45, 0.1), spine: E(0.3, 0.3, -0.1), chest: E(0.12, 0.2, -0.06), neck: E(-0.1, 0.25, 0), head: E(-0.1, 0.5, -0.14) },
  arm('R', [-0.35, -0.7, -0.62], 0.55, -0.4), arm('L', [0.75, 0.55, 0.25], 0.5, 0.5, [0, 0, -0.25]), hand('R', [0.85, 0.9, 0.9, 0.95]), hand('L', OPEN));
const grabR: ClipDef = { name: 'grabR', base: STANCE, loop: true, dur: 1.4, keys: [
  { t: 0, hips: [-0.03, -0.37, -0.06], ikL: [0.2, 0, 0.04], ikR: [-0.2, 0, -0.01], pose: GRAB_R, ctl: { gripL: 0, gripR: 1, look: 0.4 } },
  { t: 0.7, hips: [-0.03, -0.385, -0.06], pose: m({ head: E(-0.12, 0.54, -0.18) }, arm('L', [0.72, 0.6, 0.25], 0.55, 0.5, [0, 0, -0.3])) },
] };
/** Backflip, progress-driven (clip time = flip progress): open, tuck by 0.15, open at 0.8 to spot the landing. */
const TUCK = m({ hips: E(0.55, 0.2, 0), spine: E(0.42, 0.12, 0.02), chest: E(0.2, 0.06, 0), upperChest: E(0.08, 0, 0), neck: E(0.15, 0.1, 0), head: E(0.25, 0.25, -0.05) },
  arm('L', [0.25, -0.55, 0.8], 1.2, 0.6), arm('R', [-0.25, -0.5, 0.82], 1.25, 0.6), hand('L', [0.6, 0.7, 0.75, 0.8]), hand('R', [0.6, 0.7, 0.75, 0.8]));
const flip: ClipDef = { name: 'flip', base: STANCE, dur: 1, keys: [
  { t: 0, hips: [0, -0.15, -0.04], ikL: IKL, ikR: IKR, pose: AIR_OPEN, ctl: { look: 0 } },
  { t: 0.15, hips: [0, -0.42, 0.02], pose: TUCK },
  { t: 0.62, hips: [0, -0.44, 0.02], pose: m(TUCK, { head: E(0.3, 0.28, -0.05) }) },
  { t: 0.82, hips: [0, -0.16, -0.03], pose: m({ hips: E(0.1, 0.25, -0.04), spine: E(0.04, 0.16, 0.04), chest: E(0.02, 0.1, 0.02), neck: E(0.05, 0.16, 0), head: E(0.2, 0.38, -0.08) }, arm('L', [0.84, -0.1, 0.2], 0.3, 0.3), arm('R', [-0.84, 0.0, -0.1], 0.3, 0.3), hand('L', OPEN), hand('R', OPEN)), ctl: { look: 1 } },
  { t: 1, hips: [0, -0.1, -0.03] },
] };
/** Landing prep (catch armed): legs reach, eyes down, arms balance low. */
const prep: ClipDef = { name: 'prep', base: STANCE, loop: true, dur: 1, keys: [
  { t: 0, hips: [0, -0.03, -0.03], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.1, 0.22, -0.05), spine: E(0.12, 0.14, 0.04), neck: E(0.12, 0.1, 0), head: E(0.35, 0.3, -0.08) }, arm('L', [0.8, -0.5, 0.3], 0.35, 0.3), arm('R', [-0.78, -0.45, -0.1], 0.35, 0.3), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.5, pose: m(arm('L', [0.8, -0.45, 0.32], 0.38, 0.3), arm('R', [-0.8, -0.4, -0.12], 0.38, 0.3)) },
] };

// ---------- surfaces ----------
/** Grind (boardslide; the stance yaw stays sim-driven): arms out playfully, wobble at ~1.3 Hz, smirk. */
// the game yaws the stance ~77 deg for the boardslide, so her rest facing already looks down the rail:
// open the chest a little toward the camera (y-) instead of twisting further away
const GR = m({ hips: E(0.12, -0.22, -0.1), spine: E(0.12, -0.1, 0.1), chest: E(0.05, -0.05, 0.04), neck: E(-0.05, 0.02, -0.04), head: E(0.04, 0.08, -0.14) });
const grind: ClipDef = { name: 'grind', base: STANCE, loop: true, dur: 1.5, keys: [
  { t: 0, hips: [0.0, -0.17, -0.05], ikL: [0.21, 0, 0.04], ikR: [-0.21, 0, -0.01], pose: m(GR, arm('L', [0.72, 0.42, 0.25], 0.35, 0.4, [0, 0, -0.2]), arm('R', [-0.82, 0.05, -0.3], 0.4, 0.3, [0, 0, -0.1]), hand('L', OPEN), hand('R', RELAX)) },
  { t: 0.38, hips: [-0.02, -0.18, -0.05], pose: m({ hips: E(0.12, -0.2, -0.02), spine: E(0.12, -0.08, 0.02) }, arm('L', [0.78, 0.3, 0.2], 0.4, 0.4, [0, 0, -0.15]), arm('R', [-0.78, 0.18, -0.28], 0.38, 0.3, [0, 0, -0.18])) },
  { t: 0.75, hips: [0.0, -0.165, -0.05], pose: m({ hips: E(0.12, -0.24, -0.12), spine: E(0.12, -0.12, 0.12) }, arm('L', [0.7, 0.46, 0.25], 0.33, 0.4, [0, 0, -0.22]), arm('R', [-0.83, 0.0, -0.3], 0.42, 0.3, [0, 0, -0.08])) },
  { t: 1.13, hips: [0.02, -0.18, -0.05], pose: m({ hips: E(0.12, -0.22, -0.04), spine: E(0.12, -0.1, 0.04) }, arm('L', [0.76, 0.34, 0.22], 0.38, 0.4, [0, 0, -0.16]), arm('R', [-0.8, 0.14, -0.3], 0.38, 0.3, [0, 0, -0.16])) },
] };
/** Wall ride (roll stays sim-driven): inside hand reaching for the wall, outside arm out, head to travel. */
const wall: ClipDef = { name: 'wall', base: STANCE, loop: true, dur: 1.2, keys: [
  { t: 0, hips: [0.02, -0.2, 0.0], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.15, 0.3, -0.08), spine: E(0.18, 0.25, 0.08), chest: E(0.08, 0.14, 0.04), neck: E(-0.15, 0.3, 0), head: E(-0.1, 0.55, -0.1) },
    arm('L', [0.35, -0.45, 0.82], 0.25, 0.2, [0.1, 0, 0.1]), arm('R', [-0.75, 0.55, -0.3], 0.4, 0.4, [0, 0, -0.2]), hand('L', OPEN), hand('R', RELAX)) },
  { t: 0.6, hips: [0.02, -0.21, 0.0], pose: m(arm('L', [0.38, -0.48, 0.8], 0.22, 0.2, [0.15, 0, 0.12]), arm('R', [-0.78, 0.5, -0.32], 0.42, 0.4, [0, 0, -0.25])) },
] };
/** Heel skim: weight on the tail, leaning back, arms windmilling lightly. */
const SK = m({ hips: E(-0.05, 0.28, -0.05), spine: E(-0.12, 0.25, 0.05), chest: E(-0.06, 0.12, 0.02), neck: E(0.05, 0.2, 0), head: E(0.12, 0.4, -0.08) });
const skim: ClipDef = { name: 'skim', base: STANCE, loop: true, dur: 1.0, keys: [
  { t: 0, hips: [-0.13, -0.14, -0.06], ikL: IKL, ikR: IKR, pose: m(SK, arm('L', [0.7, 0.4, 0.4], 0.3, 0.3), arm('R', [-0.7, -0.4, -0.35], 0.35, 0.3), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.25, pose: m(arm('L', [0.85, 0.2, -0.3], 0.3, 0.3), arm('R', [-0.75, 0.2, 0.4], 0.35, 0.3)) },
  { t: 0.5, hips: [-0.14, -0.15, -0.06], pose: m(arm('L', [0.7, -0.4, -0.3], 0.3, 0.3), arm('R', [-0.7, 0.45, -0.3], 0.35, 0.3)) },
  { t: 0.75, pose: m(arm('L', [0.75, -0.2, 0.5], 0.3, 0.3), arm('R', [-0.8, -0.2, -0.4], 0.35, 0.3)) },
] };

// ---------- landings ----------
const SETTLE: Key = { t: 0, hips: H0, ikL: IKL, ikR: IKR, pose: STANCE };
const landClean: ClipDef = { name: 'landClean', base: STANCE, dur: 0.8, keys: [
  { t: 0, hips: [0, -0.12, -0.03], ikL: IKL, ikR: IKR, pose: m(STANCE, arm('L', [0.8, -0.3, 0.2], 0.3), arm('R', [-0.78, -0.25, -0.1], 0.3)) },
  // absorb (anticipation for the hop)
  { t: 0.09, hips: [0.02, -0.3, -0.06], pose: m({ hips: E(0.32, 0.26, -0.04), spine: E(0.1, 0.12, 0.04), head: E(0.12, 0.38, -0.1) }, arm('L', [0.72, -0.55, 0.3], 0.45), arm('R', [-0.7, -0.5, -0.05], 0.45)) },
  // happy little hop: feet leave the deck a touch, fists in to the chest, head tilt
  { t: 0.25, hips: [0, 0.07, -0.02], ikL: [0.2, 0.09, 0.04], ikR: [-0.21, 0.09, -0.01], pose: m({ hips: E(0.02, 0.24, -0.1), spine: E(-0.05, 0.1, 0.09), chest: E(-0.04, 0.08, 0.04), head: E(-0.1, 0.42, -0.22) }, arm('L', [0.45, -0.6, 0.65], 1.6, 0.4, [0, 0, 0.3]), arm('R', [-0.4, -0.62, 0.65], 1.6, 0.4, [0, 0, 0.3]), hand('L', FIST), hand('R', FIST)) },
  // re-contact, soft knees (overshoot)
  { t: 0.38, hips: [0, -0.17, -0.04], ikL: IKL, ikR: IKR },
  { t: 0.56, hips: [0, -0.08, -0.03], pose: m({ hips: E(0.1, 0.22, -0.07), spine: E(0.06, 0.1, 0.06), head: E(0.04, 0.38, -0.13) }, arm('L', [0.5, -0.82, 0.22], 0.45, 0.2, [0, 0, 0.12]), arm('R', [-0.42, -0.86, -0.1], 0.45, 0.15, [0, 0, 0.12]), hand('L', RELAX), hand('R', RELAX)) },
  { ...SETTLE, t: 0.8 },
] };
const landBig: ClipDef = { name: 'landBig', base: STANCE, dur: 1.15, keys: [
  { t: 0, hips: [0, -0.15, -0.04], ikL: IKL, ikR: IKR },
  { t: 0.1, hips: [0.04, -0.36, -0.08], pose: m({ hips: E(0.4, 0.3, -0.02), spine: E(0.14, 0.16, 0), chest: E(0.02, 0.08, 0), neck: E(-0.18, 0.18, 0), head: E(-0.1, 0.4, -0.05) }, arm('R', [-0.15, -0.8, 0.6], 0.3, 0.2, [0.6, 0, 0]), arm('L', [0.75, 0.2, 0.3], 0.4), hand('R', OPEN)) },
  { t: 0.36, hips: [0.04, -0.34, -0.08] },
  { t: 0.56, hips: [0, -0.06, -0.02], pose: m({ hips: E(0.08, 0.24, -0.06), spine: E(-0.04, 0.16, 0.08), chest: E(-0.02, 0.1, 0.03), neck: E(-0.08, 0.15, 0), head: E(-0.12, 0.3, -0.12) }, arm('L', [0.35, 0.85, 0.3], 1.7, 0.5), arm('R', [-0.55, -0.82, 0.0], 0.5), hand('L', FIST), hand('R', RELAX)) },
  { t: 0.68, hips: [0, -0.1, -0.03], pose: m(arm('L', [0.3, 0.6, 0.45], 2.0, 0.5)) },
  { t: 0.8, hips: [0, -0.08, -0.03], pose: m(arm('L', [0.35, 0.82, 0.32], 1.75, 0.5)) },
  { t: 1.15, hips: H0, pose: STANCE },
] };
/** Flip landing: absorb, free-arm swirl, hair flip, peace sign by the face, wink. */
const landFlip: ClipDef = { name: 'landFlip', base: STANCE, dur: 1.45, keys: [
  { t: 0, hips: [0, -0.12, -0.03], ikL: IKL, ikR: IKR },
  { t: 0.09, hips: [0.02, -0.28, -0.06], pose: m({ hips: E(0.3, 0.26, -0.04), spine: E(0.1, 0.12, 0.04), head: E(0.12, 0.38, -0.08) }, arm('L', [0.8, -0.4, 0.2], 0.4), arm('R', [-0.75, -0.4, -0.1], 0.4)) },
  { t: 0.28, hips: [0, -0.1, -0.03], pose: m({ hips: E(0.1, 0.24, -0.08), spine: E(0.0, 0.16, 0.07), head: E(-0.05, 0.1, -0.12) }, arm('L', [0.5, 0.8, 0.3], 0.3, 0.6)) },
  { t: 0.42, pose: m(arm('L', [-0.1, 0.95, 0.3], 0.35, 0.8), { head: E(-0.1, -0.15, -0.05) }) },
  { t: 0.56, pose: m(arm('L', [0.7, 0.4, 0.55], 0.4, 0.6), { head: E(0.0, 0.55, -0.2), neck: E(-0.05, 0.25, -0.05) }) },
  { t: 0.74, hips: [0, -0.08, -0.03], pose: m({ hips: E(0.1, 0.18, -0.1), spine: E(0.02, 0.0, 0.1), chest: E(0.0, -0.06, 0.06), neck: E(0, -0.15, 0.04), head: E(0.02, -0.4, 0.14) }, arm('R', [-0.1, 0.25, 0.8], 2.1, -0.3, [0, 0.3, 0]), hand('R', PEACE, 0.9), arm('L', [0.55, -0.8, 0.15], 0.5)) },
  { t: 1.15, pose: m({ head: E(0.04, -0.44, 0.16) }) },
  { t: 1.45, hips: H0, pose: STANCE },
] };
const landSketchy: ClipDef = { name: 'landSketchy', base: STANCE, dur: 1.15, keys: [
  { t: 0, hips: [0, -0.18, -0.05], ikL: IKL, ikR: IKR },
  { t: 0.1, hips: [-0.05, -0.3, -0.1], pose: m({ hips: E(0.1, 0.35, 0.12), spine: E(-0.1, 0.3, -0.14), chest: E(-0.05, 0.1, -0.06), head: E(0.1, 0.3, 0.1) }, arm('L', [0.6, 0.75, 0.2], 0.3), arm('R', [-0.6, -0.4, 0.5], 0.3), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.24, hips: [0.06, -0.24, -0.02], pose: m({ hips: E(0.3, 0.2, -0.14), spine: E(0.3, 0.1, 0.16), head: E(0.0, 0.45, -0.2) }, arm('L', [0.6, -0.4, -0.5], 0.3), arm('R', [-0.55, 0.78, 0.2], 0.3)) },
  { t: 0.38, hips: [-0.03, -0.26, -0.08], pose: m({ hips: E(0.12, 0.32, 0.08), spine: E(0.0, 0.25, -0.1), head: E(0.05, 0.32, 0.06) }, arm('L', [0.55, 0.78, 0.25], 0.3), arm('R', [-0.6, -0.45, 0.45], 0.3)) },
  { t: 0.52, hips: [0.03, -0.22, -0.04], pose: m({ hips: E(0.2, 0.24, -0.08), spine: E(0.18, 0.15, 0.08), head: E(0.04, 0.4, -0.12) }, arm('L', [0.7, -0.2, -0.3], 0.3), arm('R', [-0.7, 0.5, 0.0], 0.3)) },
  { t: 0.72, hips: [0, -0.16, -0.04], pose: m({ hips: E(0.12, 0.24, -0.04), spine: E(0.16, 0.12, 0.04), chest: E(0.1, 0.1, 0.03), neck: E(0.05, 0.18, 0), head: E(0.15, 0.36, -0.1) }, arm('L', [0.5, -0.84, 0.1], 0.35), arm('R', [-0.45, -0.87, -0.05], 0.35), hand('L', RELAX), hand('R', RELAX)) },
  { t: 0.95, hips: [0, -0.1, -0.03], pose: m({ spine: E(0.04, 0.1, 0.05), head: E(0.0, 0.36, -0.1) }) },
  { t: 1.15, hips: H0, pose: STANCE },
] };
/** Upper-body additive flinch-and-grin for breaks (key 0 is the reference: zero offset). */
const flinch: ClipDef = { name: 'flinch', base: STANCE, dur: 0.42, keys: [
  { t: 0 },
  { t: 0.07, pose: { spine: E(0.18, 0.08, 0.04), chest: E(0.12, 0.06, 0.02), neck: E(0.15, 0.1, 0), head: E(0.22, 0.18, -0.15), leftShoulder: E(0, 0, 0.18), rightShoulder: E(0, 0, -0.18) } },
  { t: 0.18, pose: { spine: E(0.12, 0.06, 0.04), head: E(0.14, 0.4, -0.12), leftShoulder: E(0, 0, 0.1), rightShoulder: E(0, 0, -0.1) } },
  { t: 0.42, pose: STANCE },
] };

// ---------- crash, respawn, finish ----------
/** Crash: arms windmill, plop down sitting on the board edge, then a sheepish laugh. */
const SIT = m({ hips: E(-0.35, 0.15, -0.08), spine: E(0.1, 0.05, 0.1), chest: E(0.08, 0.04, 0.04), neck: E(0.0, -0.1, 0.0), head: E(0.08, -0.35, 0.14) },
  { leftUpperLeg: E(-1.25, 0.2, 0.1), leftLowerLeg: E(1.3, 0, 0), rightUpperLeg: E(-1.2, -0.3, -0.05), rightLowerLeg: E(1.25, 0, 0) },
  arm('L', [0.35, -0.75, -0.55], 0.15, 0.2, [-0.9, 0, 0]), arm('R', [-0.35, 0.85, -0.1], 2.45, 1.2, [0, 0, 0]), hand('L', OPEN), hand('R', [0.35, 0.4, 0.45, 0.5]));
const crash: ClipDef = { name: 'crash', base: STANCE, dur: 1.3, keys: [
  { t: 0, hips: [0, -0.12, -0.03], ikL: IKL, ikR: IKR },
  { t: 0.1, hips: [0.05, -0.2, 0.06], pose: m({ hips: E(0.35, 0.3, 0.1), spine: E(0.45, 0.2, -0.1), head: E(-0.3, 0.3, 0.1) }, arm('L', [0.4, 0.85, 0.2], 0.3), arm('R', [-0.5, 0.75, 0.3], 0.3), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.26, hips: [-0.04, -0.3, 0.02], pose: m({ hips: E(-0.1, 0.25, -0.1), spine: E(-0.25, 0.2, 0.1), head: E(0.2, 0.2, -0.1) }, arm('L', [0.6, 0.6, -0.4], 0.3), arm('R', [-0.6, 0.55, 0.4], 0.3)), ikL: [0.3, 0.1, 0.22], ikR: [-0.15, 0.05, 0.15] },
  { t: 0.46, hips: [-0.05, -0.62, -0.12], ikL: [0.16, -0.03, 0.4], ikR: [-0.12, -0.03, 0.38], fL: [0.4, -0.3, 0], fR: [-0.4, -0.3, 0], pose: m(SIT, arm('R', [-0.6, 0.3, 0.3], 0.5), { head: E(0.25, 0.1, 0.0) }) },
  { t: 0.56, hips: [-0.05, -0.58, -0.12] },
  { t: 0.7, hips: [-0.05, -0.6, -0.12], pose: m(SIT, arm('R', [-0.6, 0.35, 0.3], 0.6)) },
  { t: 1.05, pose: SIT },
  { t: 1.3, pose: m(SIT, { head: E(0.06, -0.4, 0.18) }) },
] };
const crashSit: ClipDef = { name: 'crashSit', base: STANCE, loop: true, dur: 1.6, keys: [
  { t: 0, hips: [-0.05, -0.6, -0.12], ikL: [0.16, -0.03, 0.4], ikR: [-0.12, -0.03, 0.38], fL: [0.4, -0.3, 0], fR: [-0.4, -0.3, 0], pose: m(SIT, { head: E(0.06, -0.4, 0.18) }), ctl: { look: 0 } },
  { t: 0.2, pose: { spine: E(0.14, 0.05, 0.08), head: E(0.12, -0.38, 0.14) } },
  { t: 0.4, pose: { spine: E(0.1, 0.05, 0.1), head: E(0.04, -0.42, 0.2) } },
  { t: 0.6, pose: { spine: E(0.14, 0.05, 0.08), head: E(0.12, -0.38, 0.14) } },
  { t: 1.0, pose: { spine: E(0.1, 0.05, 0.11), head: E(0.05, -0.42, 0.22) } },
] };
const respawn: ClipDef = { name: 'respawn', base: STANCE, dur: 1.25, keys: [
  { t: 0, hips: [0, 0.06, -0.02], ikL: [0.2, 0.16, 0.04], ikR: [-0.21, 0.16, -0.01], pose: m(AIR_OPEN), ctl: { look: 0.5 } },
  { t: 0.12, hips: [0, -0.24, -0.06], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.3, 0.25, -0.04), spine: E(0.1, 0.12, 0.04), head: E(0.1, 0.35, -0.08) }, arm('L', [0.8, -0.3, 0.2], 0.4), arm('R', [-0.75, -0.3, -0.1], 0.4)) },
  { t: 0.3, hips: [0, -0.08, -0.03], pose: m({ hips: E(0.1, 0.15, -0.05), spine: E(0.12, 0.0, 0.04), chest: E(0.06, -0.05, 0.02), neck: E(0.08, -0.05, 0), head: E(0.2, -0.05, -0.06) }, arm('L', [0.15, -0.6, 0.75], 1.4, 0.8, [0, 0, 0]), arm('R', [-0.15, -0.6, 0.75], 1.4, 0.8, [0, 0, 0]), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.42, pose: m(arm('L', [0.2, -0.55, 0.78], 1.55, 0.9), arm('R', [-0.1, -0.62, 0.75], 1.3, 0.7)) },
  { t: 0.54, pose: m(arm('L', [0.12, -0.62, 0.75], 1.35, 0.8), arm('R', [-0.2, -0.55, 0.78], 1.55, 0.9)) },
  { t: 0.7, pose: m({ head: E(-0.05, 0.25, -0.2), neck: E(-0.05, 0.12, -0.05), spine: E(0.04, 0.08, 0.08) }, arm('L', [0.3, 0.6, 0.55], 2.3, 1.0, [0.2, 0, 0.3]), arm('R', [-0.5, -0.84, -0.04], 0.45), hand('L', OPEN), hand('R', RELAX)) },
  { t: 0.92, pose: m(arm('L', [0.45, 0.5, -0.2], 2.0, 1.0, [0.2, 0, 0.3]), { head: E(0.0, 0.42, -0.14) }) },
  { t: 1.25, ...{ hips: H0, pose: STANCE }, ctl: { look: 1 } },
] };
const finish: ClipDef = { name: 'finish', base: STANCE, dur: 2.0, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR },
  { t: 0.2, hips: [0, -0.26, -0.06], pose: m({ hips: E(0.3, 0.25, -0.04), spine: E(0.1, 0.12, 0.04) }, arm('L', [0.4, -0.85, -0.3], 0.5), arm('R', [-0.4, -0.85, -0.3], 0.5)) },
  { t: 0.36, hips: [0, 0.12, 0], ikL: [0.2, 0.18, 0.04], ikR: [-0.21, 0.18, -0.01], pose: m({ hips: E(0.0, 0.6, -0.04), spine: E(-0.06, 0.4, 0.04), chest: E(-0.04, 0.2, 0), head: E(-0.15, 0.3, -0.12) }, arm('L', [0.55, 0.8, 0.2], 0.3), arm('R', [-0.5, 0.82, 0.1], 0.35), hand('L', OPEN), hand('R', OPEN)) },
  { t: 0.56, hips: [0, -0.2, -0.05], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.2, -0.2, -0.04), spine: E(0.15, -0.3, 0.06), chest: E(0.05, -0.15, 0.02), head: E(0.05, -0.3, 0.1) }, arm('L', [0.8, -0.2, 0.3], 0.5), arm('R', [-0.8, -0.1, -0.3], 0.5)) },
  { t: 0.8, hips: [0, -0.06, -0.02], pose: m({ hips: E(0.1, 0.0, -0.1), spine: E(0.02, -0.15, 0.1), chest: E(0, -0.1, 0.05), neck: E(0, -0.2, 0.05), head: E(0.0, -0.5, 0.16) }, arm('L', [0.15, 0.3, 0.8], 2.15, -0.3, [0, -0.3, 0]), hand('L', PEACE, 0.9), arm('R', [-0.42, -0.6, 0.2], 1.6, 0.4, [0, 0, -0.5]), hand('R', RELAX)) },
  { t: 1.5, hips: [0, -0.07, -0.02], pose: m({ head: E(0.03, -0.46, 0.2) }) },
  { t: 2.0, hips: [0, -0.065, -0.02] },
] };
const finishIdle: ClipDef = { name: 'finishIdle', base: STANCE, loop: true, dur: 2.4, keys: [
  { t: 0, hips: [0, -0.065, -0.02], ikL: IKL, ikR: IKR, pose: m({ hips: E(0.1, 0.0, -0.1), spine: E(0.02, -0.15, 0.1), chest: E(0, -0.1, 0.05), neck: E(0, -0.2, 0.05), head: E(0.03, -0.46, 0.2) }, arm('L', [0.3, 0.75, 0.35], 1.2, 0.6, [0, 0, -0.4]), hand('L', OPEN), arm('R', [-0.42, -0.6, 0.2], 1.6, 0.4, [0, 0, -0.5])) },
  { t: 0.3, pose: arm('L', [0.45, 0.75, 0.3], 1.0, 0.6, [0, 0, 0.3]) },
  { t: 0.6, pose: arm('L', [0.3, 0.75, 0.35], 1.2, 0.6, [0, 0, -0.4]) },
  { t: 0.9, pose: arm('L', [0.45, 0.75, 0.3], 1.0, 0.6, [0, 0, 0.3]) },
  { t: 1.4, pose: m(arm('L', [0.5, -0.8, 0.2], 0.5), { head: E(0.06, -0.4, 0.14) }) },
] };

// ---------- personality idles (grounded, slow) ----------
const fidgetHip: ClipDef = { name: 'fidgetHip', base: STANCE, dur: 2.8, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR },
  { t: 0.45, hips: [-0.06, -0.07, -0.04], pose: m({ hips: E(0.12, 0.15, -0.2), spine: E(0.06, 0.05, 0.16), chest: E(0.04, 0.05, 0.08), neck: E(-0.02, 0.1, -0.06), head: E(0.05, 0.2, -0.2) }, arm('R', [-0.55, -0.55, -0.35], 1.65, 0.9, [0, 0, -0.6]), hand('R', [0.3, 0.35, 0.4, 0.45]), arm('L', [0.5, -0.82, 0.1], 0.3)) },
  { t: 0.6, hips: [-0.065, -0.068, -0.04], pose: { hips: E(0.12, 0.15, -0.23) } },
  { t: 1.9, hips: [-0.06, -0.07, -0.04], pose: m({ hips: E(0.12, 0.17, -0.2), head: E(0.08, 0.3, -0.24) }) },
  { t: 2.8, hips: H0, pose: STANCE },
] };
const fidgetHair: ClipDef = { name: 'fidgetHair', base: STANCE, dur: 2.4, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR },
  { t: 0.5, pose: m({ head: E(0.1, 0.25, -0.22), neck: E(0.0, 0.15, -0.06) }, arm('L', [0.35, 0.35, 0.5], 2.35, 1.1, [0.3, 0, 0.4]), hand('L', [0.15, 0.2, 0.3, 0.4])) },
  { t: 0.85, pose: m(arm('L', [0.35, 0.45, 0.25], 2.4, 1.2, [0.4, 0, 0.5])) },
  { t: 1.2, pose: m({ head: E(0.05, 0.32, -0.14) }, arm('L', [0.45, 0.3, 0.1], 2.0, 1.0, [0.3, 0, 0.3])) },
  { t: 1.6, pose: m(arm('L', [0.55, -0.79, 0.18], 0.45, 0.2, [0, 0, 0.12]), hand('L', RELAX)) },
  { t: 2.4, pose: STANCE },
] };
const fidgetStretch: ClipDef = { name: 'fidgetStretch', base: STANCE, dur: 3.0, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR },
  { t: 0.35, hips: [0, -0.12, -0.04], pose: m(arm('L', [0.3, -0.5, 0.6], 1.6, 0.6), arm('R', [-0.3, -0.5, 0.6], 1.6, 0.6), hand('L', [0.6, 0.65, 0.7, 0.75]), hand('R', [0.6, 0.65, 0.7, 0.75])) },
  { t: 0.9, hips: [0, -0.02, -0.02], pose: m({ hips: E(0.02, 0.2, -0.02), spine: E(-0.12, 0.1, 0.0), chest: E(-0.1, 0.05, 0), neck: E(-0.15, 0.1, 0), head: E(-0.25, 0.2, -0.04) }, arm('L', [0.12, 0.98, 0.1], 0.5, 1.2), arm('R', [-0.08, 0.98, 0.1], 0.5, 1.2), hand('L', [0.3, 0.3, 0.3, 0.3]), hand('R', [0.3, 0.3, 0.3, 0.3])) },
  { t: 1.4, pose: m({ spine: E(-0.1, 0.1, 0.18), chest: E(-0.08, 0.05, 0.1) }) },
  { t: 1.85, pose: m({ spine: E(-0.1, 0.1, -0.1), chest: E(-0.08, 0.05, -0.06) }) },
  { t: 2.25, hips: [0, -0.1, -0.03], pose: m({ spine: E(0.08, 0.1, 0.05), chest: E(0.05, 0.1, 0.04), head: E(0.08, 0.36, -0.12) }, arm('L', [0.6, -0.78, 0.18], 0.4, 0.2), arm('R', [-0.55, -0.82, -0.04], 0.45, 0.15), hand('L', RELAX), hand('R', RELAX)) },
  { t: 2.45, hips: [0, -0.085, -0.03] },
  { t: 3.0, hips: H0, pose: STANCE },
] };
const fidgetLook: ClipDef = { name: 'fidgetLook', base: STANCE, dur: 2.6, keys: [
  { t: 0, hips: H0, ikL: IKL, ikR: IKR, ctl: { look: 1 } },
  { t: 0.5, ctl: { look: 0 }, pose: m({ neck: E(-0.2, 0.1, 0), head: E(-0.35, 0.0, -0.1), spine: E(0.0, 0.05, 0.05) }, arm('L', [0.35, 0.35, 0.65], 2.25, 1.2, [0.2, 0, 0.6]), hand('L', OPEN)) },
  { t: 1.2, pose: m({ neck: E(-0.2, 0.3, 0), head: E(-0.3, 0.55, -0.1) }) },
  { t: 1.8, pose: m({ neck: E(-0.1, 0.0, 0), head: E(-0.15, -0.25, 0.08) }, arm('L', [0.55, -0.79, 0.18], 0.45, 0.2, [0, 0, 0.12]), hand('L', RELAX)) },
  { t: 2.6, pose: STANCE, ctl: { look: 1 } },
] };

/** Gust catch: chest open, head up, arms swept back. The broom itself pitches 20° in the rider view. */
const gust: ClipDef = { name: 'gust', base: STANCE, loop: true, dur: 0.8, keys: [
  { t: 0, hips: [0.02, -0.04, -0.02], ikL: IKL, ikR: IKR, pose: m(
    { hips: E(0.02, 0.16, -0.04), spine: E(-0.06, 0.08, 0.02), chest: E(-0.1, 0.06, 0), upperChest: E(-0.05, 0.04, 0), neck: E(-0.1, 0.14, 0), head: E(-0.16, 0.26, -0.08) },
    arm('L', [0.18, 0.22, -0.82], 0.38, 0.15, [0, 0, 0.08]),
    arm('R', [-0.22, 0.08, -0.78], 0.42, 0.12, [0, 0, 0.08]),
    hand('L', OPEN), hand('R', RELAX),
  ) },
  { t: 0.4, hips: [0.03, -0.02, -0.03], pose: m(
    { chest: E(-0.12, 0.08, 0.03), head: E(-0.2, 0.3, -0.12) },
    arm('L', [0.28, 0.32, -0.68], 0.48, 0.25),
    arm('R', [-0.12, 0.16, -0.88], 0.32, 0.1),
  ) },
] };

export const CLIPS: ClipDef[] = [idle, cruise, tuck, push, pop, airUp, airDown, float, grabL, grabR, flip, prep, grind, wall, skim, gust,
  landClean, landBig, landFlip, landSketchy, flinch, crash, crashSit, respawn, finish, finishIdle, fidgetHip, fidgetHair, fidgetStretch, fidgetLook];
export const FIDGETS = ['fidgetHip', 'fidgetHair', 'fidgetStretch', 'fidgetLook'];

/**
 * Restraint pass (Haris: "too OTT ... floppy like a rag doll"): authored trunk/head/arm motion is scaled toward the
 * stance so she reads controlled and athletic, core engaged. Appeal comes from small touches (head tilt, face, a hand).
 * Poses that must land somewhere (flip tuck, grabs reaching the board, the crash sit) keep more amplitude.
 */
const AMP: Record<string, number> = {
  idle: 0.55, fidgetHip: 0.55, fidgetHair: 0.65, fidgetStretch: 0.6, fidgetLook: 0.55, cruise: 0.7, tuck: 0.8, push: 0.85,
  pop: 0.65, airUp: 0.6, airDown: 0.6, float: 0.6, grabL: 0.8, grabR: 0.8, flip: 0.9, prep: 0.6, grind: 0.55, wall: 0.65, skim: 0.6, gust: 0.85,
  landClean: 0.6, landBig: 0.65, landFlip: 0.7, landSketchy: 0.6, flinch: 0.5, crash: 0.8, crashSit: 0.85, respawn: 0.6,
  finish: 0.65, finishIdle: 0.6,
};
setRestraintReference(STANCE, H0);
for (const c of CLIPS) c.amp = AMP[c.name] ?? 0.65;
