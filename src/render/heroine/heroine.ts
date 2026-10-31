import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  VRMLoaderPlugin, VRMUtils, MToonMaterial, VRMSpringBoneCollider, VRMSpringBoneColliderShapeSphere, VRMSpringBoneColliderShapeCapsule,
  type VRM, type VRMSpringBoneJoint, type VRMSpringBoneColliderGroup,
} from '@pixiv/three-vrm';
import type { SimEvent, MoveMode, AirTrick } from '../../sim/types';
import { bake, solveTwoBone, upperBodyOnly, type RigInfo } from './kit';
import { DEG, limitsFor, postureCorrection, torsoPitch } from './posture';
import { CLIPS, FIDGETS } from './clips';

/** What the rider presentation feeds the character every render frame (all read-only sim state). */
export interface HeroineFrame {
  mode: MoveMode; air: AirTrick; flip: number; speed: number; vy: number; angle: number;
  /** Landing prep armed (in the air). */
  prep: boolean;
  /** Presentation lateral velocity (m/s, + = toward the rider's right). */
  lateralVel: number;
}
export type HeroineTier = 'low' | 'medium' | 'high';

/** Minimum visual hold of a grab pose (s), so a quick tap-grab still reads. Presentation only. */
const GRAB_MIN_HOLD = 0.35;
type StateName = 'loco' | 'push' | 'pop' | 'air' | 'float' | 'grabL' | 'grabR' | 'flip' | 'prep' | 'grind' | 'wall' | 'skim'
  | 'landClean' | 'landBig' | 'landFlip' | 'landSketchy' | 'crash' | 'crashSit' | 'respawn' | 'finish' | 'finishIdle' | 'fidget';
interface StateDef { acts: [string, (h: Heroine) => number][]; once?: { clip: string; next: StateName; fade: number } }
const ONE = () => 1;
const STATES: Record<StateName, StateDef> = {
  loco: { acts: [['idle', (h) => h.inner.idle], ['cruise', (h) => h.inner.cruise], ['tuck', (h) => h.inner.tuck]] },
  push: { acts: [['push', ONE]], once: { clip: 'push', next: 'loco', fade: 0.22 } },
  pop: { acts: [['pop', ONE]], once: { clip: 'pop', next: 'air', fade: 0.12 } },
  float: { acts: [['float', ONE]], once: { clip: 'float', next: 'air', fade: 0.15 } },
  air: { acts: [['airUp', (h) => 1 - h.inner.down], ['airDown', (h) => h.inner.down]] },
  grabL: { acts: [['grabL', ONE]] }, grabR: { acts: [['grabR', ONE]] },
  flip: { acts: [['flip', ONE]] }, prep: { acts: [['prep', ONE]] },
  grind: { acts: [['grind', ONE]] }, wall: { acts: [['wall', ONE]] }, skim: { acts: [['skim', ONE]] },
  landClean: { acts: [['landClean', ONE]], once: { clip: 'landClean', next: 'loco', fade: 0.25 } },
  landBig: { acts: [['landBig', ONE]], once: { clip: 'landBig', next: 'loco', fade: 0.3 } },
  landFlip: { acts: [['landFlip', ONE]], once: { clip: 'landFlip', next: 'loco', fade: 0.3 } },
  landSketchy: { acts: [['landSketchy', ONE]], once: { clip: 'landSketchy', next: 'loco', fade: 0.3 } },
  crash: { acts: [['crash', ONE]], once: { clip: 'crash', next: 'crashSit', fade: 0.25 } },
  crashSit: { acts: [['crashSit', ONE]] },
  respawn: { acts: [['respawn', ONE]], once: { clip: 'respawn', next: 'loco', fade: 0.25 } },
  finish: { acts: [['finish', ONE]], once: { clip: 'finish', next: 'finishIdle', fade: 0.3 } },
  finishIdle: { acts: [['finishIdle', ONE]] },
  fidget: { acts: [['fidget', ONE]] }, // resolved to the chosen fidget clip
};
/** Which states each sim mode allows (anything else is corrected after a short grace). */
const ALLOWED: Record<MoveMode, StateName[]> = {
  grounded: ['loco', 'push', 'landClean', 'landBig', 'landFlip', 'landSketchy', 'respawn', 'fidget', 'pop'],
  heelSkim: ['skim', 'landClean', 'landBig', 'landFlip', 'landSketchy'],
  airborne: ['air', 'pop', 'float', 'grabL', 'grabR', 'flip', 'prep'],
  grinding: ['grind'], wallRiding: ['wall'], failed: ['crash', 'crashSit'], finished: ['finish', 'finishIdle'],
};
const DEFAULT: Record<MoveMode, StateName> = { grounded: 'loco', heelSkim: 'skim', airborne: 'air', grinding: 'grind', wallRiding: 'wall', failed: 'crash', finished: 'finish' };

// ---- faces: expression targets per mood (VRM0 presets + custom groups added by the optimiser) ----
type Face = Partial<Record<string, number>>;
const MOOD: Record<string, Face> = {
  calm: { relaxed: 0.2, mouthSmile: 0.35 },
  cruise: { mouthSmile: 0.5, browSoft: 0.2 },
  push: { browFocus: 0.25, mouthSmile: 0.3 },
  tuck: { browFocus: 0.55, eyeFocus: 0.25, mouthSmall: 0.4 },
  air: { mouthSmile: 0.6, eyeWide: 0.15, browUp: 0.2 },
  whee: { mouthOpen: 0.55, eyeWide: 0.35, browUp: 0.5 },
  focus: { browFocus: 0.65, eyeFocus: 0.3, mouthSmall: 0.6 },
  wink: { blinkLeft: 1, mouthGrin: 0.75, browSoft: 0.4, fang: 0.4 },
  smug: { mouthSmile: 0.8, eyeSmile: 0.35, browSoft: 0.45, blinkRight: 0.1 },
  grind: { mouthSmile: 0.75, eyeSmile: 0.3, browSoft: 0.4 },
  wall: { mouthSmile: 0.45, browFocus: 0.35, eyeFocus: 0.15 },
  skim: { mouthSmall: 0.5, browFocus: 0.5, eyeFocus: 0.2, ih: 0.25 },
  happy: { happy: 0.95 },
  big: { mouthGrin: 0.9, eyeWide: 0.3, browUp: 0.45 },
  victory: { blinkLeft: 1, mouthGrin: 0.9, browSoft: 0.5 },
  eek: { surprised: 0.8 },
  relief: { relaxed: 0.6, mouthSmile: 0.3 },
  crash: { surprised: 1 },
  sheepish: { happy: 0.55, browUp: 0.55, mouthGrin: 0.3 },
  flinch: { blink: 0.65, mouthGrin: 0.7 },
  cheer: { happy: 0.9, mouthGrin: 0.5 },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler(), _ax = new THREE.Vector3();
const smooth = (x: number) => x * x * (3 - 2 * x);
const sstep = (a: number, b: number, x: number) => smooth(THREE.MathUtils.clamp((x - a) / (b - a), 0, 1));
const DECK_Y = 0.06; // the board mesh sits this high in the stance group (riderView)

/** Load a VRM (meshopt + WebP) and prepare it for the game. */
export async function loadVrm(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register((p) => new VRMLoaderPlugin(p));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM0 faces -Z; now she faces +Z like VRM1
  return vrm;
}

/**
 * Ao, the playable heroine: a VRM driven by sim snapshots and events through a layered
 * animation stack (base state machine with tuned crossfades and blend spaces, an additive
 * upper-body layer, procedural lean/squash/breathing, head + eye look-at, leg IK to the deck,
 * hand IK for grabs), VRM expressions with auto-blink, and spring bones with wind.
 * Presentation only: it never touches the simulation.
 */
export class Heroine {
  readonly object = new THREE.Group();
  readonly vrm: VRM;
  private rig: RigInfo;
  private mixer: THREE.AnimationMixer;
  /** Last mixer output per humanoid bone (quaternion, position): the base the procedural/IK layers build on. */
  private animCache: [THREE.Object3D, THREE.Quaternion, THREE.Vector3][] = [];
  private actions = new Map<string, THREE.AnimationAction>();
  private state: StateName = 'loco';
  private fidgetClip = 'fidgetHip';
  private stateW = new Map<StateName, number>([['loco', 1]]);
  private fadeFrom = new Map<StateName, number>([['loco', 1]]);
  private fadeK = 1; private fadeDur = 0.2;
  private stateTime = 0;
  private wrongModeT = 0;
  /** Inner blend weights (read by the state table). */
  inner = { idle: 1, cruise: 0, tuck: 0, down: 0 };
  private sp = 0; private slope = 0; private latVel = 0;
  private squash = 0; private squashVel = 0;
  private slowT = 0; private lastFidget = '';
  private t = 0;
  // expressions
  private faceVals = new Map<string, number>();
  private moodBase = 'calm'; private moodOver: { name: string; until: number } | null = null;
  private blinkT = 2; private blinkPhase = -1;
  private exprNames: Set<string>;
  private alias = new Map<string, string>();
  // look-at
  private lookTarget = new THREE.Object3D();
  private lookW = 1;
  // springs
  private joints: VRMSpringBoneJoint[] = [];
  private jointBase: { stiff: number; grav: number; kind: 'hair' | 'skirt' | 'cloth' }[] = [];
  private tier: HeroineTier = 'high';
  private springAcc = 0;
  private outlineMats: MToonMaterial[] = [];
  private deck: THREE.Object3D | null = null;
  private center: THREE.Object3D | null = null;
  private compK = 0; private lastDt = 1 / 60; private postureLim: { forward: number; travel: number } | null = null;
  /** Grab-hand targets in deck space (defaults: the board's toe/heel edges; the broom moves them onto the handle). */
  readonly grabTargets = { L: new THREE.Vector3(0.12, 0.05, 0.2), R: new THREE.Vector3(-0.1, 0.05, -0.21) };
  readonly stats = { cpuMs: 0, state: 'loco' as string, ik: [0, 0], posture: [0, 0, 0, 0] as number[] }; // posture: torso pF, pT, correction X, Z (deg)
  private v0: boolean;

  constructor(vrm: VRM) {
    this.vrm = vrm;
    this.v0 = vrm.meta?.metaVersion === '0';
    this.object.name = 'heroine';
    this.object.add(vrm.scene);
    vrm.scene.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.styleMaterials();
    // rest measurements (figure space = this.object space; the model stands on y = 0)
    this.object.updateMatrixWorld(true);
    const H = vrm.humanoid;
    const rel = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()); // object is at the origin during construction
    const hips = H.getNormalizedBoneNode('hips')!;
    const ankleL = rel(H.getNormalizedBoneNode('leftFoot')!), ankleR = rel(H.getNormalizedBoneNode('rightFoot')!);
    const ik = { L: new THREE.Object3D(), R: new THREE.Object3D(), fL: new THREE.Object3D(), fR: new THREE.Object3D(), ctl: new THREE.Object3D() };
    ik.L.name = 'ao_ikL'; ik.R.name = 'ao_ikR'; ik.fL.name = 'ao_footL'; ik.fR.name = 'ao_footR'; ik.ctl.name = 'ao_ctl';
    this.object.add(ik.L, ik.R, ik.fL, ik.fR, ik.ctl, this.lookTarget);
    this.rig = {
      vrm, v0: this.v0, hipsRest: rel(hips), ankleL, ankleR,
      hipsParentInv: hips.parent!.matrixWorld.clone().invert(),
      footRestL: H.getNormalizedBoneNode('leftFoot')!.getWorldQuaternion(new THREE.Quaternion()),
      footRestR: H.getNormalizedBoneNode('rightFoot')!.getWorldQuaternion(new THREE.Quaternion()),
      deckTop: DECK_Y + 0.035, ik,
    };
    // clips
    this.mixer = new THREE.AnimationMixer(this.object);
    for (const def of CLIPS) {
      let clip = bake(def, this.rig);
      const a = (() => {
        if (def.name === 'flinch') {
          clip = upperBodyOnly(clip, this.rig);
          THREE.AnimationUtils.makeClipAdditive(clip);
          return this.mixer.clipAction(clip, undefined, THREE.AdditiveAnimationBlendMode);
        }
        return this.mixer.clipAction(clip);
      })();
      if (!def.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play(); a.setEffectiveWeight(def.name === 'idle' ? 1 : 0);
      this.actions.set(def.name, a);
    }
    const flip = this.actions.get('flip')!; flip.timeScale = 0;
    for (const name of Object.keys(vrm.humanoid.normalizedHumanBones)) {
      const n = vrm.humanoid.getNormalizedBoneNode(name as never);
      if (n) this.animCache.push([n, n.quaternion.clone(), n.position.clone()]);
    }
    this.exprNames = new Set(vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? []);
    // VRoid VRM0 exports sometimes name a preset with a capital (e.g. 'Surprised'): alias to the preset name
    for (const n of [...this.exprNames]) { const l = n.charAt(0).toLowerCase() + n.slice(1); if (l !== n && !this.exprNames.has(l)) this.alias.set(l, n); }
    if (vrm.lookAt) { vrm.lookAt.target = this.lookTarget; vrm.lookAt.autoUpdate = true; }
    this.setupSprings();
  }

  /** Soft painterly cel to sit in the Icarus palette; outlines tinted warm. */
  private styleMaterials(): void {
    const mats = new Set<MToonMaterial>();
    this.vrm.scene.traverse((o) => { const m = (o as THREE.Mesh).material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (x && (x as MToonMaterial).isMToonMaterial) mats.add(x as MToonMaterial); }); });
    for (const m of mats) {
      if (m.isOutline) { m.outlineColorFactor.lerp(new THREE.Color('#5a3f3a'), 0.6); this.outlineMats.push(m); continue; }
      m.shadeColorFactor.lerp(new THREE.Color('#c7a6c4'), 0.4);
      m.shadingToonyFactor = 0.85; m.shadingShiftFactor = -0.25;
      m.parametricRimColorFactor.set('#ffd9a8'); m.parametricRimFresnelPowerFactor = 3.5; m.parametricRimLiftFactor = 0.04; m.rimLightingMixFactor = 0.7;
      m.giEqualizationFactor = 0.85;
    }
  }

  private setupSprings(): void {
    const sbm = this.vrm.springBoneManager; if (!sbm) return;
    const H = this.vrm.humanoid;
    // no chest physics (guard rail): drop the bust chains entirely
    for (const j of [...sbm.joints]) if (/Bust/i.test(j.bone.name)) sbm.deleteJoint(j);
    // extra colliders so the skirt / coat tails never cut through the legs in the crouch, tuck or sit
    const add = (bone: string, shape: VRMSpringBoneColliderShapeSphere | VRMSpringBoneColliderShapeCapsule) => { const c = new VRMSpringBoneCollider(shape); H.getRawBoneNode(bone as never)?.add(c); return c; };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const legs: VRMSpringBoneColliderGroup = { name: 'ao-legs', colliders: [
      add('leftUpperLeg', new VRMSpringBoneColliderShapeCapsule({ offset: v(0, -0.02, 0), tail: v(0, -0.36, 0.0), radius: 0.075 })),
      add('rightUpperLeg', new VRMSpringBoneColliderShapeCapsule({ offset: v(0, -0.02, 0), tail: v(0, -0.36, 0.0), radius: 0.075 })),
      add('leftLowerLeg', new VRMSpringBoneColliderShapeCapsule({ offset: v(0, 0, 0), tail: v(0, -0.3, 0), radius: 0.055 })),
      add('rightLowerLeg', new VRMSpringBoneColliderShapeCapsule({ offset: v(0, 0, 0), tail: v(0, -0.3, 0), radius: 0.055 })),
      add('hips', new VRMSpringBoneColliderShapeSphere({ offset: v(0, -0.02, 0), radius: 0.11 })),
    ] };
    for (const j of sbm.joints) {
      const n = j.bone.name;
      const kind: 'hair' | 'skirt' | 'cloth' = /Hair/i.test(n) ? 'hair' : /Skirt/i.test(n) ? 'skirt' : 'cloth';
      if (kind !== 'hair') j.colliderGroups = [...j.colliderGroups, legs];
      // VRoid ships zero gravity: give everything a little weight so it hangs and settles
      j.settings.gravityPower = Math.max(j.settings.gravityPower, kind === 'hair' ? 0.12 : kind === 'skirt' ? 0.22 : 0.16);
      // damped so hair and skirt flow but never flail (restraint pass)
      j.settings.stiffness *= kind === 'hair' ? 1.25 : 1.45;
      j.settings.dragForce = Math.min(0.85, Math.max(j.settings.dragForce, kind === 'hair' ? 0.45 : 0.55));
      this.joints.push(j);
      this.jointBase.push({ stiff: j.settings.stiffness, grav: j.settings.gravityPower, kind });
    }
  }

  /** Attach to the rider: `deck` = the board mesh (feet plant on it), `center` = the rider root (spring space). */
  attach(parent: THREE.Object3D, deck: THREE.Object3D, center: THREE.Object3D): void {
    parent.add(this.object);
    this.deck = deck; this.center = center;
    for (const j of this.joints) j.center = center; // hair reacts to the rider's motion, not to route travel/rebases
    this.object.updateMatrixWorld(true);
    this.vrm.springBoneManager?.setInitState();
  }

  setTier(t: HeroineTier): void {
    this.tier = t;
    for (const m of this.outlineMats) m.visible = t !== 'low';
    this.vrm.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = t !== 'low'; });
  }

  // ---------------- state machine ----------------
  private go(s: StateName, fade: number, restart = false): void {
    if (s === this.state && !restart) return;
    this.fadeFrom = new Map(this.stateW);
    this.fadeK = 0; this.fadeDur = Math.max(0.01, fade);
    if (STATES[s].once) {
      const a = this.actionFor(s);
      // a restarted one-shot of the same clip (push spam) keeps its old weight fading out via the micro-fade
      a.reset(); a.play();
    }
    if (s === 'fidget' || STATES[s].acts.some(([n]) => !STATES[s].once && this.actions.get(n === 'fidget' ? this.fidgetClip : n))) {
      if (s === 'fidget') { const a = this.actions.get(this.fidgetClip)!; a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play(); }
    }
    this.state = s; this.stateTime = 0;
    this.stats.state = s === 'fidget' ? this.fidgetClip : s;
  }
  private actionFor(s: StateName): THREE.AnimationAction { return this.actions.get(STATES[s].once?.clip ?? (s === 'fidget' ? this.fidgetClip : STATES[s].acts[0][0]))!; }
  private mood(name: string, hold = 0): void { if (hold > 0) this.moodOver = { name, until: this.t + hold }; else this.moodBase = name; }

  kick(amount: number): void { this.squash = Math.max(this.squash, amount * 0.6); this.squashVel = 0; } // restrained: a firm dip, not a bounce

  /** Sim events (presentation reacts; nothing flows back). */
  event(e: SimEvent): void {
    switch (e.type) {
      case 'push':
        if (!e.fresh) break;
        if (this.state === 'loco' || this.state === 'push' || this.state === 'fidget' || this.state.startsWith('land')) {
          this.go('push', this.state === 'push' ? 0.06 : 0.12, true);
          this.actions.get('push')!.timeScale = THREE.MathUtils.clamp(0.85 + this.sp / 60, 0.85, 1.15);
        }
        break;
      case 'jump': this.go('pop', 0.05, true); this.mood('whee', 0.5); break;
      case 'leave-edge': if (e.crest) { this.go('float', 0.08, true); this.mood('whee', 0.6); } else this.go('air', 0.15); break;
      case 'grab-start': this.go(e.side === 'left' ? 'grabL' : 'grabR', 0.08); this.mood(e.side === 'left' ? 'wink' : 'smug', 99); break;
      case 'grab-end': {
        // a tap-grab still reads: the pose holds at least GRAB_MIN_HOLD (the per-frame check below releases it)
        const left = GRAB_MIN_HOLD - this.stateTime;
        if (left <= 0) { this.go('air', 0.15); this.moodOver = null; } else if (this.moodOver) this.moodOver.until = this.t + left;
        break;
      }
      case 'flip-start': this.go('flip', 0.05); this.mood('focus', 99); break;
      case 'flip-complete': this.go('air', 0.12); this.mood('big', 0.5); break;
      case 'prep': if (e.armed) { this.go('prep', 0.1); this.mood('focus', 0.6); } break;
      case 'land': {
        this.moodOver = null;
        const sketchy = e.impact >= 14 || e.speedAfter < e.speedBefore * 0.72;
        const s: StateName = e.flipped ? 'landFlip' : sketchy ? 'landSketchy' : e.impact >= 10 ? 'landBig' : 'landClean';
        // a prepped landing into a heel skim keeps the skim pose (the mode switch handles it)
        this.go(s, 0.04, true);
        this.mood(s === 'landFlip' ? 'victory' : s === 'landSketchy' ? 'eek' : s === 'landBig' ? 'big' : 'happy', s === 'landSketchy' ? 0.45 : s === 'landClean' ? 0.55 : 0.9);
        if (s === 'landSketchy') this.moodOverAfter = { name: 'relief', at: this.t + 0.45, hold: 0.6 };
        if (s === 'landBig') this.moodOverAfter = { name: 'happy', at: this.t + 0.5, hold: 0.6 };
        break;
      }
      case 'grind-start': this.go('grind', 0.08); this.mood('grind'); break;
      case 'grind-end': if (e.reason === 'end') this.go('air', 0.1); break;
      case 'wall-start': this.go('wall', 0.1); this.mood('wall'); break;
      case 'wall-end': if (e.reason !== 'jump') this.go('air', 0.12); break;
      case 'skim-start': this.go('skim', 0.1); this.mood('skim'); break;
      case 'skim-end': if (e.reason !== 'jump' && e.reason !== 'push') this.go('loco', 0.2); break;
      case 'break': {
        const a = this.actions.get('flinch')!; a.reset(); a.play(); this.flinchW = e.kind === 'pillar' ? 1 : 0.6;
        this.mood('flinch', 0.35); this.kick(e.kind === 'pot' ? 0.12 : 0.22);
        break;
      }
      case 'fail': this.go('crash', 0.05, true); this.mood('crash', 0.5); this.moodOverAfter = { name: 'sheepish', at: this.t + 0.7, hold: 99 }; break;
      case 'finish': this.go('finish', 0.2, true); this.mood('cheer', 99); break;
      default: break;
    }
  }
  private moodOverAfter: { name: string; at: number; hold: number } | null = null;
  /** Review tooling only: hold one clip at time t (null = normal). */
  debugFreeze: { clip: string; t: number } | null = null;
  /** Review tooling only: force a mood. */
  debugMood(name: string | null): void { this.moodOver = name ? { name, until: 1e9 } : null; }
  private flinchW = 0;

  /** Run (re)started at a checkpoint: hop back on. */
  reset(): void {
    this.moodOver = null; this.moodOverAfter = null; this.squash = 0; this.squashVel = 0; this.slowT = 0;
    this.go('respawn', 0.01, true);
    this.mood('happy', 0.6);
    this.vrm.springBoneManager?.reset();
  }

  // ---------------- per frame ----------------
  update(dt: number, f: HeroineFrame): void {
    const c0 = performance.now();
    dt = Math.min(dt, 1 / 20);
    this.lastDt = Math.max(dt, 1e-4);
    this.t += dt; this.stateTime += dt;
    const ease = (r: number) => 1 - Math.exp(-dt * r);
    this.sp += (f.speed - this.sp) * ease(4);
    this.slope += (f.angle - this.slope) * ease(5);
    this.latVel += (f.lateralVel - this.latVel) * ease(8);

    // --- state corrections from the sim mode (robust even if an event was missed) ---
    if (!ALLOWED[f.mode].includes(this.state)) {
      this.wrongModeT += dt;
      const urgent = f.mode === 'failed' || f.mode === 'grinding' || f.mode === 'wallRiding' || f.mode === 'heelSkim';
      if (urgent || this.wrongModeT > 0.12) this.go(DEFAULT[f.mode], urgent ? 0.08 : 0.15);
    } else this.wrongModeT = 0;
    if (f.mode === 'airborne') {
      if (f.air === 'flip' && this.state !== 'flip') this.go('flip', 0.05);
      else if (f.air === 'grabLeft' && this.state !== 'grabL') this.go('grabL', 0.08);
      else if (f.air === 'grabRight' && this.state !== 'grabR') this.go('grabR', 0.08);
      else if (f.air === 'none' && (this.state === 'flip' || ((this.state === 'grabL' || this.state === 'grabR') && this.stateTime >= GRAB_MIN_HOLD))) this.go('air', 0.15);
      else if (f.air === 'none' && f.prep && this.state === 'air') this.go('prep', 0.1);
      else if (!f.prep && this.state === 'prep') this.go('air', 0.15);
    }
    // one-shots hand over when done
    const once = STATES[this.state].once;
    if (once) { const a = this.actions.get(once.clip)!; if (a.time >= a.getClip().duration - 1e-3) this.go(once.next === 'loco' && f.mode !== 'grounded' ? DEFAULT[f.mode] : once.next, once.fade); }
    if (this.state === 'fidget') { const a = this.actions.get(this.fidgetClip)!; if (a.time >= a.getClip().duration - 1e-3) this.go('loco', 0.35); }
    // personality idles when slow on the ground
    if (this.state === 'loco' && f.mode === 'grounded' && this.sp < 3) {
      this.slowT += dt;
      if (this.slowT > 2.5) {
        const pool = FIDGETS.filter((n) => n !== this.lastFidget);
        this.fidgetClip = pool[Math.floor(Math.random() * pool.length)]; this.lastFidget = this.fidgetClip;
        this.slowT = -1.5 - Math.random() * 1.5; // cooldown after it ends
        this.go('fidget', 0.4);
      }
    } else if (this.state !== 'fidget') this.slowT = Math.min(this.slowT, 0);
    if (this.state === 'fidget' && (this.sp > 3.5 || f.mode !== 'grounded')) this.go('loco', 0.15);

    // --- moods per state ---
    if (this.state === 'loco') this.moodBase = this.inner.tuck > 0.5 ? 'tuck' : this.sp > 8 ? 'cruise' : 'calm';
    else if (this.state === 'air' || this.state === 'pop' || this.state === 'float') this.moodBase = 'air';
    else if (this.state === 'grind') this.moodBase = 'grind';
    else if (this.state === 'wall') this.moodBase = 'wall';
    else if (this.state === 'skim') this.moodBase = 'skim';
    else if (this.state === 'push') this.moodBase = 'push';
    else if (this.state === 'fidget') this.moodBase = this.fidgetClip === 'fidgetStretch' ? 'relief' : 'calm';
    else if (this.state === 'respawn') this.moodBase = 'calm';

    // --- inner blends ---
    // speed tuck on downhills: capped so it stays an athletic crouch (the clip is a hip hinge with a flat back)
    const tuck = 0.7 * sstep(0.1, 0.32, -this.slope) * sstep(4, 9, this.sp);
    const cruise = sstep(2, 14, this.sp) * (1 - tuck);
    this.inner.tuck = tuck; this.inner.cruise = cruise; this.inner.idle = Math.max(0, 1 - tuck - cruise);
    this.inner.down = sstep(2.5, -3.5, f.vy);

    // --- weights ---
    this.fadeK = Math.min(1, this.fadeK + dt / this.fadeDur);
    const k = smooth(this.fadeK);
    this.stateW.clear();
    for (const [s, w] of this.fadeFrom) if (s !== this.state) this.stateW.set(s, w * (1 - k));
    this.stateW.set(this.state, (this.fadeFrom.get(this.state) ?? 0) * (1 - k) + k);
    const aw = new Map<string, number>();
    for (const [s, w] of this.stateW) {
      if (w < 1e-4) continue;
      for (const [n, inner] of STATES[s].acts) { const name = n === 'fidget' ? this.fidgetClip : n; aw.set(name, (aw.get(name) ?? 0) + w * inner(this)); }
    }
    for (const [name, a] of this.actions) if (name !== 'flinch') a.setEffectiveWeight(aw.get(name) ?? 0);
    // flip is progress-driven: the clip time follows the sim rotation exactly
    const fa = this.actions.get('flip')!; fa.time = THREE.MathUtils.clamp(f.flip, 0, 0.999) * fa.getClip().duration;
    const fl = this.actions.get('flinch')!; fl.setEffectiveWeight(this.flinchW * (fl.time < fl.getClip().duration - 0.01 ? 1 : 0));
    for (const [node, q, p] of this.animCache) { node.quaternion.copy(q); node.position.copy(p); } // see the note after mixer.update
    if (this.debugFreeze) { // review tooling: hold one clip at a time
      for (const [n, a] of this.actions) { a.setEffectiveWeight(n === this.debugFreeze.clip ? 1 : 0); if (n === this.debugFreeze.clip) a.time = this.debugFreeze.t; }
      this.mixer.update(0);
    } else this.mixer.update(dt);
    // (restored just before mixer.update, snapshot here) three's PropertyMixer skips writing a property whose blended value did not change since its last write. Our
    // procedural/IK layers write on top of the mixer output, so an unchanged track (a held pose: cruise hips, a still
    // chest) would keep last frame's *final* value and the additive layers would compound every frame (the "broken
    // spine" spin while coasting, the hip flip after a heel skim). Restore the mixer's own last output first.
    for (const [node, q, p] of this.animCache) { q.copy(node.quaternion); p.copy(node.position); }

    // --- procedural layer ---
    const H = this.vrm.humanoid;
    const F = 10; // squash spring (presentation feel, same recover rate as the old rider)
    this.squashVel += (-this.squash * F * F - this.squashVel * 2 * F * 1.0) * dt; // critically damped: no overshoot wobble
    this.squash += this.squashVel * dt;
    const sq = THREE.MathUtils.clamp(this.squash, -0.25, 0.5);
    const ground = (this.stateW.get('loco') ?? 0) + (this.stateW.get('push') ?? 0) + (this.stateW.get('fidget') ?? 0);
    const hipsN = H.getNormalizedBoneNode('hips')!;
    // squash -> hips drop (the IK bends the knees), lean into speed and uphill, roll with lateral moves
    _v.set(0, -sq * 0.16, 0);
    // lean into speed/uphill hinges from the hips (a tall spine reads graceful; folding the spine read as a crunch)
    const lean = ground * (Math.min(0.09, this.sp * 0.0045) + Math.max(0, this.slope) * 0.2);
    _v.x += ground * (Math.min(0.05, this.sp * 0.0025) + Math.max(0, this.slope) * 0.08);
    _v.applyQuaternion(_q.copy(hipsN.parent!.getWorldQuaternion(_q2)).invert().multiply(this.object.getWorldQuaternion(_q2)));
    hipsN.position.add(_v);
    const roll = THREE.MathUtils.clamp(this.latVel * 0.03, -0.1, 0.1);
    this.addRot('hips', lean * 0.75, 0, 0);
    this.addRot('spine', lean * 0.25 + sq * 0.12, 0, roll);
    this.addRot('chest', 0.015 * Math.sin(this.t * 2 * Math.PI / 3.6), 0, roll * 0.3); // breathing
    this.addRot('head', -sq * 0.08, 0, 0);
    if (this.stateW.has('air')) { // wind flutter on the arms in flight
      const w = (this.stateW.get('air') ?? 0) * Math.min(1, this.sp / 15) * 0.02;
      this.addRot('leftUpperArm', 0, 0, w * Math.sin(this.t * 9.1)); this.addRot('rightUpperArm', 0, 0, w * Math.sin(this.t * 8.3 + 1));
    }
    this.object.updateMatrixWorld(true);
    this.applyPosture(f);

    // --- head + eyes look-at (ahead on the ground, the landing zone in the air) ---
    const ctl = this.rig.ik.ctl.position;
    this.lookW += (THREE.MathUtils.clamp(ctl.z, 0, 1) - this.lookW) * ease(10);
    this.placeLookTarget(f);
    if (this.tier !== 'low') this.headLook(this.lookW);

    // --- leg IK to the deck (last) and grab-hand IK ---
    this.solveLegs();
    if (this.tier !== 'low') this.solveHands(THREE.MathUtils.clamp(ctl.x, 0, 1), THREE.MathUtils.clamp(ctl.y, 0, 1));

    // --- expressions + blink ---
    this.updateFace(dt);

    // --- spring bones: wind with speed, float when falling, stiffer in the tuck ---
    this.updateSprings(f);
    this.springAcc += dt;
    const step = this.tier === 'low' ? 1 / 30 : 0;
    if (!step || this.springAcc >= step) {
      const sdt = step ? this.springAcc : dt; this.springAcc = 0;
      this.vrm.update(sdt);
    } else {
      this.vrm.humanoid.update(); this.vrm.expressionManager?.update(); this.vrm.lookAt?.update(dt);
    }
    this.stats.cpuMs = performance.now() - c0;
  }

  /**
   * Posture guard rails, after every animated/procedural layer and before the IK:
   * 1) the torso leans back toward gravity against the board pitch on slopes / in a heel skim (the figure rides the
   *    pitched board; without this a downhill slope tipped her whole body over with the deck),
   * 2) the hips->neck pitch is soft-limited (25 deg forward / along travel; tricks a little more; crash free).
   * Rotations are applied at the hips about the rider-root axes; the leg IK then re-plants the feet.
   */
  private applyPosture(f: HeroineFrame): void {
    const H = this.vrm.humanoid;
    const hips = H.getNormalizedBoneNode('hips')!, neck = H.getNormalizedBoneNode('neck')!;
    const rootQ = (this.center ?? this.object).getWorldQuaternion(new THREE.Quaternion());
    const invRoot = rootQ.clone().invert();
    // (eased: a mode switch, e.g. the skim exit, must not step the hips)
    const kTarget = f.mode === 'heelSkim' ? 0.35 : f.mode === 'grounded' ? 0.5 : 0;
    this.compK += (kTarget - this.compK) * (1 - Math.exp(-this.lastDt * 10));
    const rel = invRoot.clone().multiply(this.object.getWorldQuaternion(_q));
    const pitch = f.mode === 'grounded' || f.mode === 'heelSkim' || this.compK > 0.01 ? _e.setFromQuaternion(rel, 'XYZ').z : 0;
    const comp = Math.abs(pitch) < 1.2 ? -pitch * this.compK : 0; // never while the pivot is mid-flip
    // the limits are body-relative (figure frame = the board's frame), so flips, wall rides and boardslides are unaffected
    const figQ = this.object.getWorldQuaternion(new THREE.Quaternion());
    const t = neck.getWorldPosition(new THREE.Vector3()).sub(hips.getWorldPosition(_v)).applyQuaternion(figQ.clone().invert());
    t.applyAxisAngle(_ax.set(0, 0, 1), comp);
    let lim = limitsFor(this.state === 'fidget' ? 'loco' : this.state, f.mode);
    if (lim) { // blend the limits with the state crossfade so leaving a skim/trick never snaps the clamp
      const prev = this.postureLim ?? lim; const k = 1 - Math.exp(-this.lastDt * 8);
      lim = { forward: prev.forward + (lim.forward - prev.forward) * k, travel: prev.travel + (lim.travel - prev.travel) * k };
    }
    this.postureLim = lim;
    const c = lim ? postureCorrection(t, lim) : { aboutX: 0, aboutZ: 0 };
    this.stats.posture = [torsoPitch(t).pF / DEG, torsoPitch(t).pT / DEG, c.aboutX / DEG, (comp + c.aboutZ) / DEG];
    const aZ = comp + c.aboutZ, aX = c.aboutX;
    if (Math.abs(aZ) < 1e-5 && Math.abs(aX) < 1e-5) return;
    const rw = new THREE.Quaternion().setFromAxisAngle(_ax.set(1, 0, 0).applyQuaternion(figQ), aX)
      .multiply(_q2.setFromAxisAngle(_ax.set(0, 0, 1).applyQuaternion(figQ), aZ));
    const pw = hips.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hips.quaternion.copy(pw.multiply(rw.multiply(hips.getWorldQuaternion(_q))));
    this.object.updateMatrixWorld(true);
  }

  private addRot(bone: string, x: number, y: number, z: number): void {
    if (!x && !y && !z) return;
    const n = this.vrm.humanoid.getNormalizedBoneNode(bone as never); if (!n) return;
    _q.setFromEuler(_e.set(x, y, z, 'ZYX')); if (this.v0) { _q.x = -_q.x; _q.z = -_q.z; }
    n.quaternion.multiply(_q);
  }

  private placeLookTarget(f: HeroineFrame): void {
    // figure space: +X = travel. Ahead and slightly down on the ground, toward the landing in the air.
    const air = f.mode === 'airborne';
    const ahead = air ? 6 : 9;
    const down = air ? THREE.MathUtils.clamp(-f.vy * 0.35, -1.5, 3) + 0.6 : 0.2;
    this.lookTarget.position.set(ahead, this.rig.hipsRest.y + 0.6 - down, 0.6);
  }

  private headLook(w: number): void {
    if (w < 0.01) return;
    const H = this.vrm.humanoid;
    const head = H.getNormalizedBoneNode('head')!, neck = H.getNormalizedBoneNode('neck')!;
    head.getWorldPosition(_v);
    this.lookTarget.getWorldPosition(_w).sub(_v).normalize();
    head.getWorldQuaternion(_q);
    const fwd = new THREE.Vector3(0, 0, this.v0 ? -1 : 1).applyQuaternion(_q);
    const ang = fwd.angleTo(_w);
    const lim = THREE.MathUtils.degToRad(40);
    _q2.setFromUnitVectors(fwd, _w);
    const amt = (ang > lim ? lim / ang : 1) * w;
    const part = new THREE.Quaternion().slerp(_q2, amt * 0.4);
    for (const [node, share] of [[neck, 0.4], [head, 0.6]] as const) {
      const p = new THREE.Quaternion().slerp(_q2, amt * share);
      const pw = node.parent!.getWorldQuaternion(new THREE.Quaternion());
      const nw = node.getWorldQuaternion(new THREE.Quaternion());
      node.quaternion.copy(pw.invert().multiply(p.multiply(nw)));
      node.updateMatrixWorld(true);
    }
    void part;
  }

  private solveLegs(): void {
    const H = this.vrm.humanoid, ik = this.rig.ik;
    const deck = this.deck;
    const toWorld = (p: THREE.Vector3, out: THREE.Vector3) => {
      out.copy(p);
      if (deck) { out.y -= DECK_Y; return deck.localToWorld(out); }
      return this.object.localToWorld(out);
    };
    const deckQ = deck ? deck.getWorldQuaternion(new THREE.Quaternion()) : this.object.getWorldQuaternion(new THREE.Quaternion());
    const hint = new THREE.Vector3(1, 0, 0).applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion()));
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 'left' : 'right';
      const tgt = toWorld(ik[side].position, new THREE.Vector3());
      const fe = ik[side === 'L' ? 'fL' : 'fR'].position;
      // foot world = deck * yaw/pitch/roll (deck space) * foot rest (relative to the figure)
      const rest = side === 'L' ? this.rig.footRestL : this.rig.footRestR;
      const fw = deckQ.clone().multiply(_q.setFromEuler(_e.set(fe.y, fe.x, fe.z, 'YXZ'))).multiply(rest);
      solveTwoBone(H.getNormalizedBoneNode(`${s}UpperLeg` as never)!, H.getNormalizedBoneNode(`${s}LowerLeg` as never)!, H.getNormalizedBoneNode(`${s}Foot` as never)!, tgt, hint, fw);
      const foot = H.getNormalizedBoneNode(`${s}Foot` as never)!.getWorldPosition(new THREE.Vector3());
      this.stats.ik[side === 'L' ? 0 : 1] = foot.distanceTo(tgt);
    }
  }

  private solveHands(gl: number, gr: number): void {
    if (!this.deck || (gl < 0.01 && gr < 0.01)) return;
    const H = this.vrm.humanoid;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion()));
    if (gl > 0.01) { // toe edge (+Z), just ahead of the front foot
      const t = this.deck.localToWorld(this.grabTargets.L.clone());
      solveTwoBone(H.getNormalizedBoneNode('leftUpperArm')!, H.getNormalizedBoneNode('leftLowerArm')!, H.getNormalizedBoneNode('leftHand')!, t, up, null, gl);
    }
    if (gr > 0.01) { // heel edge (-Z), behind the back foot
      const t = this.deck.localToWorld(this.grabTargets.R.clone());
      solveTwoBone(H.getNormalizedBoneNode('rightUpperArm')!, H.getNormalizedBoneNode('rightLowerArm')!, H.getNormalizedBoneNode('rightHand')!, t, up, null, gr);
    }
  }

  private updateFace(dt: number): void {
    const em = this.vrm.expressionManager; if (!em) return;
    if (this.moodOverAfter && this.t >= this.moodOverAfter.at) { this.moodOver = { name: this.moodOverAfter.name, until: this.t + this.moodOverAfter.hold }; this.moodOverAfter = null; }
    if (this.moodOver && this.t > this.moodOver.until) this.moodOver = null;
    const target = MOOD[this.moodOver?.name ?? this.moodBase] ?? {};
    const names = new Set([...this.faceVals.keys(), ...Object.keys(target)]);
    for (const n of names) {
      const en = this.alias.get(n) ?? n;
      if (!this.exprNames.has(en)) continue;
      const cur = this.faceVals.get(n) ?? 0, tv = target[n] ?? 0;
      const rate = tv > cur ? 14 : 6; // 0.08 s attack, ~0.25 s release
      const v = cur + (tv - cur) * (1 - Math.exp(-dt * rate));
      this.faceVals.set(n, v); em.setValue(en, v);
    }
    // auto-blink (2.5-4.5 s, sometimes a double), suppressed while winking or smiling with closed eyes
    const closed = (this.faceVals.get('happy') ?? 0) > 0.4 || (this.faceVals.get('blinkLeft') ?? 0) > 0.3 || (this.faceVals.get('blink') ?? 0) > 0.3;
    this.blinkT -= dt;
    let b = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const p = this.blinkPhase;
      b = p < 0.05 ? p / 0.05 : p < 0.08 ? 1 : p < 0.17 ? 1 - (p - 0.08) / 0.09 : 0;
      if (p >= 0.17) this.blinkPhase = -1;
    } else if (this.blinkT <= 0 && !closed) {
      this.blinkPhase = 0; this.blinkT = Math.random() < 0.18 ? 0.25 : 2.5 + Math.random() * 2;
    }
    if (!closed) em.setValue('blink', Math.max(b, this.faceVals.get('blink') ?? 0));
  }

  private updateSprings(f: HeroineFrame): void {
    if (!this.joints.length || !this.center) return;
    // wind blows back along the route (world), more with speed; in the air falling lifts hair and skirt
    const travel = new THREE.Vector3(1, 0, 0).transformDirection(this.center.matrixWorld);
    const w = Math.min(1, this.sp / 25);
    const fall = f.mode === 'airborne' ? THREE.MathUtils.clamp(-f.vy / 12, -0.3, 0.6) : 0;
    const tuck = (this.stateW.get('flip') ?? 0) + (this.stateW.get('crash') ?? 0) * 0.5 + this.inner.tuck * (this.stateW.get('loco') ?? 0);
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i], b = this.jointBase[i];
      const gust = 1 + 0.1 * Math.sin(this.t * 3.1 + i * 0.7) * w;
      j.settings.gravityDir.set(0, -1, 0).multiplyScalar(1 - w * 0.8 - fall).addScaledVector(travel, -w * 1.2 * gust).normalize();
      j.settings.gravityPower = b.grav + w * (b.kind === 'hair' ? 0.24 : 0.18);
      j.settings.stiffness = b.stiff * (b.kind === 'hair' ? 1 : 1 + tuck * 0.8);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.object.removeFromParent();
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
