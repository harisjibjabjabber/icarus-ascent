/**
 * Ao posture regression (Haris, Oct 2026): "after a heel ride she bends down and flips from the hips to the other side"
 * and "coasting a while she ducks down like her spine broke". Root cause: three's AnimationMixer skips writing a
 * property whose blended value did not change, so the procedural layers compounded on held tracks every frame.
 * These tests run the real character (the shipped VRM, no renderer) through a long downhill coast and a heel skim exit.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { softLimit, postureCorrection, torsoPitch, DEG } from '../src/render/heroine/posture';

describe('posture guard maths', () => {
  it('softLimit is identity in range, monotone, and never passes the limit', () => {
    const lim = 25 * DEG;
    expect(softLimit(10 * DEG, lim)).toBeCloseTo(10 * DEG, 9);
    let prev = -Infinity;
    for (let x = -3; x <= 3; x += 0.01) { const y = softLimit(x, lim); expect(Math.abs(y)).toBeLessThanOrEqual(lim + 1e-9); expect(y).toBeGreaterThanOrEqual(prev - 1e-12); prev = y; }
  });
  it('postureCorrection brings a folded torso back inside the limit', () => {
    const t = new THREE.Vector3(0, Math.cos(70 * DEG), Math.sin(70 * DEG)); // 70 deg forward fold
    const c = postureCorrection(t, { forward: 25 * DEG, travel: 25 * DEG });
    t.applyAxisAngle(new THREE.Vector3(1, 0, 0), c.aboutX);
    expect(torsoPitch(t).pF / DEG).toBeLessThanOrEqual(25.01);
  });
});

// ---- the real character, headless ----
type HeroineT = import('../src/render/heroine/heroine').Heroine;
let Heroine: typeof import('../src/render/heroine/heroine').Heroine;
let makeVrm: () => Promise<import('@pixiv/three-vrm').VRM>;

beforeAll(async () => {
  // textures are irrelevant here: hand GLTFLoader a fake ImageBitmap so it never needs a DOM
  (globalThis as any).createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
  (globalThis as any).self ??= globalThis;
  const mod = await import('../src/render/heroine/heroine');
  Heroine = mod.Heroine;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
  const nodeFs = 'node:fs'; const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync('public/heroine/ao-longhair.vrm');
  makeVrm = async () => {
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
    const vrm = gltf.userData.vrm; VRMUtils.rotateVRM0(vrm); return vrm;
  };
}, 60000);

/** The RiderView hierarchy in miniature: root -> pivot (board pitch) -> stance -> figure, board under stance. */
function rig(h: HeroineT) {
  const root = new THREE.Group(), pivot = new THREE.Group(), stance = new THREE.Group(), board = new THREE.Group();
  root.add(pivot); pivot.add(stance); stance.add(board); board.position.y = 0.06;
  h.attach(stance, board, root);
  return { root, pivot };
}
const bone = (h: HeroineT, b: string) => (h as any).vrm.humanoid.getNormalizedBoneNode(b) as THREE.Object3D;
function measure(h: HeroineT, root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const hp = bone(h, 'hips').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const nk = bone(h, 'neck').getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const { pF, pT } = torsoPitch(nk.sub(hp));
  const q = root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bone(h, 'hips').getWorldQuaternion(new THREE.Quaternion()));
  return { pF: pF / DEG, pT: pT / DEG, q };
}
const frame = (mode: string, speed: number, angle: number) => ({ mode, air: 'none', flip: 0, speed, vy: 0, angle, prep: false, lateralVel: 0 }) as any;

describe('Ao posture over time (real VRM, no renderer)', () => {
  it('a 40 s coast (flat, then a long downhill) stays upright with no hip jumps', async () => {
    const h = new Heroine(await makeVrm()); const { root, pivot } = rig(h);
    const dt = 1 / 30; let prevQ: THREE.Quaternion | null = null; let maxF = 0, maxT = 0, maxJump = 0, at = -1;
    let board = 0;
    for (let i = 0; i < 40 * 30; i++) {
      const downhill = i > 300 ? -0.3 : 0; // ~17 deg slope after 10 s
      const speed = Math.min(26, 12 + i * 0.02);
      board += (downhill - board) * (1 - Math.exp(-dt * 25)); // RiderView's board-pitch ease
      pivot.rotation.z = board;
      h.update(dt, frame('grounded', speed, downhill));
      const m = measure(h, root);
      maxF = Math.max(maxF, Math.abs(m.pF)); maxT = Math.max(maxT, Math.abs(m.pT));
      if (prevQ && i > 15 && prevQ.angleTo(m.q) / DEG > maxJump) { maxJump = prevQ.angleTo(m.q) / DEG; at = i; } // (skip the first-frame settle from the rest pose)
      prevQ = m.q.clone();
    }
    expect(maxF).toBeLessThanOrEqual(26);
    expect(maxT).toBeLessThanOrEqual(26);
    // the board itself pitches up to ~10 deg in one frame when a 17 deg slope starts (RiderView ease); the hips ride it
    expect(maxJump, `max hip step at frame ${at}`).toBeLessThan(6); // deg per frame at 30 fps
  }, 60000);

  it('a heel skim and its exit stay in bounds and never flip the hips', async () => {
    const h = new Heroine(await makeVrm()); const { root, pivot } = rig(h);
    const dt = 1 / 30; let prevQ: THREE.Quaternion | null = null; let maxF = 0, maxT = 0, maxJump = 0;
    let heel = 0, at = -1, exitJump = 0;
    for (let i = 0; i < 8 * 30; i++) {
      const skim = i >= 60 && i < 105; // 1.5 s skim
      if (i === 60) h.event({ type: 'skim-start' } as any);
      if (i === 105) h.event({ type: 'skim-end', reason: 'release' } as any);
      heel += ((skim ? 1 : 0) - heel) * (1 - Math.exp(-dt * (skim ? 18 : 9))); // RiderView's heel ease (lift / return)
      pivot.rotation.z = heel * 0.42;
      h.update(dt, frame(skim ? 'heelSkim' : 'grounded', 14, 0));
      const m = measure(h, root);
      maxF = Math.max(maxF, Math.abs(m.pF));
      if (!skim) maxT = Math.max(maxT, Math.abs(m.pT));
      if (prevQ && i > 15 && prevQ.angleTo(m.q) / DEG > maxJump) { maxJump = prevQ.angleTo(m.q) / DEG; at = i; }
      if (prevQ && i >= 105) exitJump = Math.max(exitJump, prevQ.angleTo(m.q) / DEG);
      prevQ = m.q.clone();
    }
    expect(maxF).toBeLessThanOrEqual(26);
    expect(maxT).toBeLessThanOrEqual(26);
    // entry: the deliberate nose lift rotates the board ~10 deg in a frame and she rides it; the exit must be gentler
    expect(maxJump, `max hip step at frame ${at}`).toBeLessThan(8);
    expect(exitJump).toBeLessThan(5);
  }, 60000);
});
