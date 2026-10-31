// VRM character spike for Icarus's Ascent: three-vrm load, MToon soft-cel tweak, spring-bone hair
// with speed wind, keyframed clips on normalized humanoid bones, AnimationMixer crossfades,
// analytic two-bone IK planting both feet on the board, game chase camera. Not game code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, MToonMaterial } from '@pixiv/three-vrm';

const q = new URLSearchParams(location.search);
const CAM = q.get('cam') ?? 'chase'; // chase | close | side
const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, Number(q.get('pr') ?? 2)));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e9dfd2', 40, 220);

// painterly gradient sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color('#5d9fd6') }, mid: { value: new THREE.Color('#bcdcf0') }, hor: { value: new THREE.Color('#ffe3b8') } },
  vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform vec3 top,mid,hor; varying vec3 vP; void main(){ float h=vP.y; vec3 c=mix(hor,mid,smoothstep(-0.05,0.18,h)); c=mix(c,top,smoothstep(0.18,0.7,h)); gl_FragColor=vec4(c,1.0);}',
}));
scene.add(sky);
scene.add(new THREE.HemisphereLight('#cfe6ff', '#e8c9a8', 1.1));
const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
sun.position.set(-6, 10, -4); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = Number(q.get('nb') ?? 0.02);
scene.add(sun, sun.target);

// marble causeway + bronze rail + cloud floor (placeholders for the real environment)
const path = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 2000), new THREE.MeshToonMaterial({ color: '#f1e7da' }));
path.position.set(0, -0.5, -900); path.receiveShadow = true; scene.add(path);
const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2000), new THREE.MeshToonMaterial({ color: '#8a5a2b' }));
rail.position.set(-1.6, 0.55, -900); scene.add(rail);
{ const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), rail.material, 300); const m = new THREE.Matrix4(); for (let i = 0; i < 300; i++) { m.makeTranslation(-1.6, 0.27, -i * 6); post.setMatrixAt(i, m); } scene.add(post); }
const cloud = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: '#f6efe8' }));
cloud.rotation.x = -Math.PI / 2; cloud.position.y = -30; scene.add(cloud);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2000);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize); resize();

// rider root: travels along scene -Z (route direction for routeYaw 90). Board along travel.
const rider = new THREE.Group(); scene.add(rider);
const board = new THREE.Group(); rider.add(board);
{
  const shape = new THREE.Shape();
  const L = 0.62, W = 0.14; // half length / half width
  shape.moveTo(-L + W, -W); shape.lineTo(L - W, -W); shape.absarc(L - W, 0, W, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-L + W, W); shape.absarc(-L + W, 0, W, Math.PI / 2, Math.PI * 1.5, false);
  const deck = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), new THREE.MeshToonMaterial({ color: '#9a6a3f' }));
  deck.rotation.x = -Math.PI / 2; deck.position.y = 0.105; deck.castShadow = true; board.rotation.y = Math.PI / 2;
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), new THREE.MeshToonMaterial({ color: '#e0b04a', emissive: '#5a3a00' }));
  trim.rotation.x = Math.PI / 2; trim.position.set(0.4, 0.155, 0);
  const glow = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.6, 4, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.55 }));
  glow.rotation.z = Math.PI / 2; glow.position.y = 0.06;
  board.add(deck, trim, glow);
}
const BOARD_TOP = 0.16;

// ---------- keyframed clips on normalized humanoid bones + IK targets ----------
type Pose = Record<string, [number, number, number]>; // bone -> euler (ZYX order) in model space
const E = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
function quat([x, y, z]: [number, number, number]) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'ZYX')); }
// Model space: she faces +Z, her left is +X, up +Y. The model is yawed so her left (front foot) points down the route.
const STANCE: Pose = {
  spine: E(0.12, 0.28, -0.06), chest: E(0.06, 0.12, 0), neck: E(0, 0.25, 0), head: E(0.08, 0.35, -0.05),
  leftUpperArm: E(0.25, 0.2, -1.05), leftLowerArm: E(0, 0.5, 0), rightUpperArm: E(-0.2, -0.25, 1.0), rightLowerArm: E(0, -0.45, 0),
  leftHand: E(0, 0, -0.2), rightHand: E(0, 0, 0.2),
};
interface Key { t: number; hipsY: number; hipsX?: number; pose: Pose; ikL: [number, number, number]; ikR: [number, number, number]; }
const FOOT_Y = BOARD_TOP + 0.1; // ankle height above the deck
const L_ON: [number, number, number] = [0.25, FOOT_Y, 0.03], R_ON: [number, number, number] = [-0.24, FOOT_Y, 0.0];
function merge(a: Pose, b: Pose): Pose { const o: Pose = { ...a }; for (const k in b) o[k] = b[k]; return o; }
function buildClip(name: string, keys: Key[], vrm: VRM, ik: THREE.Object3D[]): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = keys.map((k) => k.t);
  const bones = new Set<string>(); keys.forEach((k) => Object.keys(k.pose).forEach((b) => bones.add(b)));
  for (const b of bones) {
    const node = vrm.humanoid.getNormalizedBoneNode(b as never); if (!node) continue;
    const vals: number[] = [];
    for (const k of keys) { const e = k.pose[b] ?? [0, 0, 0]; vals.push(...quat(e).toArray()); }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, vals));
  }
  const hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
  const rest = hips.position.clone();
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, keys.flatMap((k) => [rest.x + (k.hipsX ?? 0), k.hipsY, rest.z])));
  tracks.push(new THREE.VectorKeyframeTrack(`${ik[0].name}.position`, times, keys.flatMap((k) => k.ikL)));
  tracks.push(new THREE.VectorKeyframeTrack(`${ik[1].name}.position`, times, keys.flatMap((k) => k.ikR)));
  return new THREE.AnimationClip(name, keys[keys.length - 1].t, tracks);
}

// analytic two-bone IK (world space), then flatten the foot onto the deck
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion();
function solveLeg(upper: THREE.Object3D, lower: THREE.Object3D, foot: THREE.Object3D, target: THREE.Vector3, footWorld: THREE.Quaternion, bendHint: THREE.Vector3) {
  upper.getWorldPosition(_a); lower.getWorldPosition(_b); foot.getWorldPosition(_c);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  const at = _t.copy(target).sub(_a); const lat = THREE.MathUtils.clamp(at.length(), 0.01, lab + lcb - 0.001);
  const ac = _c.clone().sub(_a), ab = _b.clone().sub(_a), ba = _a.clone().sub(_b), bc = _c.clone().sub(_b);
  const acab0 = Math.acos(THREE.MathUtils.clamp(ac.clone().normalize().dot(ab.clone().normalize()), -1, 1));
  const babc0 = Math.acos(THREE.MathUtils.clamp(ba.clone().normalize().dot(bc.clone().normalize()), -1, 1));
  const acat0 = Math.acos(THREE.MathUtils.clamp(ac.clone().normalize().dot(at.clone().normalize()), -1, 1));
  const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  let axis0 = ac.clone().cross(ab); if (axis0.lengthSq() < 1e-8) axis0.copy(bendHint); axis0.normalize();
  const axis1 = ac.clone().cross(at); if (axis1.lengthSq() < 1e-10) axis1.copy(axis0); axis1.normalize();
  const r0 = new THREE.Quaternion().setFromAxisAngle(axis0, acab1 - acab0);
  const r1 = new THREE.Quaternion().setFromAxisAngle(axis0, babc1 - babc0);
  const r2 = new THREE.Quaternion().setFromAxisAngle(axis1, acat0);
  upper.getWorldQuaternion(_qa); lower.getWorldQuaternion(_qb); upper.parent!.getWorldQuaternion(_qp);
  const nqa = r2.clone().multiply(r0).multiply(_qa);
  const nqb = r2.clone().multiply(r0).multiply(r1).multiply(_qb);
  upper.quaternion.copy(_qp.clone().invert().multiply(nqa));
  lower.quaternion.copy(nqa.clone().invert().multiply(nqb));
  foot.quaternion.copy(nqb.clone().invert().multiply(footWorld));
  upper.updateMatrixWorld(true);
}

const stats = { frames: 0, cpuCharMs: [] as number[], frameMs: [] as number[], loaded: false, clip: 'idle', ik: [0, 0], hairTip: [0, 0, 0] };
(window as any).spike = stats;

new GLTFLoader().register((p) => new VRMLoaderPlugin(p)).load('./' + (q.get('model') ?? 'heroine') + '.vrm', (gltf) => {
  const vrm: VRM = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  vrm.scene.traverse((o) => { o.frustumCulled = false; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  // soft painterly cel: warm-lavender shade, softer terminator, warm rim, thin outline (BotW/Ghibli-leaning)
  const mats = new Set<MToonMaterial>();
  vrm.scene.traverse((o) => { const m = (o as THREE.Mesh).material; (Array.isArray(m) ? m : [m]).forEach((x) => { if (x && (x as MToonMaterial).isMToonMaterial) mats.add(x as MToonMaterial); }); });
  for (const m of mats) {
    if (m.isOutline) { m.outlineColorFactor.set('#5a3f3a'); if (q.get('outline') === '0') m.visible = false; continue; }
    if (q.get('double') === '1') { m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; }
    m.shadeColorFactor.lerp(new THREE.Color('#b59ab8'), 0.35);
    m.shadingToonyFactor = 0.75; m.shadingShiftFactor = -0.05;
    m.parametricRimColorFactor.set('#ffd9a8'); m.parametricRimFresnelPowerFactor = 3.5; m.parametricRimLiftFactor = 0.05; m.rimLightingMixFactor = 0.6;
  }
  if (q.get('simple') === '1') vrm.scene.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh && (me.material as MToonMaterial).isMToonMaterial) { const mm = me.material as MToonMaterial; me.material = new THREE.MeshLambertMaterial({ map: mm.map }); } });
  // fresh MToon (soft painterly cel + outline) for generated models: keeps only the base texture
  if (q.get('fresh') === '1') vrm.scene.traverse((o) => {
    const me = o as THREE.Mesh; if (!me.isMesh) return;
    const conv = (x: THREE.Material) => { const mm = x as MToonMaterial; if (!mm.isMToonMaterial) return x;
      const n = new MToonMaterial({ map: mm.map, shadeMultiplyTexture: mm.map, shadeColorFactor: new THREE.Color('#d9c2c8'), shadingToonyFactor: 0.75, shadingShiftFactor: -0.05,
        parametricRimColorFactor: new THREE.Color('#ffd9a8'), parametricRimFresnelPowerFactor: 4, rimLightingMixFactor: 0.4, giEqualizationFactor: 0.9 });
      if (mm.isOutline) { n.isOutline = true; n.outlineWidthMode = 'worldCoordinates' as never; n.outlineWidthFactor = 0.0035; n.outlineColorFactor.set('#5a3f3a'); n.outlineLightingMixFactor = 1; n.side = THREE.BackSide; }
      return n; };
    me.material = Array.isArray(me.material) ? me.material.map(conv) : conv(me.material);
  });
  vrm.scene.rotation.y = Math.PI / 2; // her +Z (face) -> scene +X; her left (+X) -> scene -Z (down the route)
  rider.add(vrm.scene);
  const ikL = new THREE.Object3D(); ikL.name = 'ikL'; const ikR = new THREE.Object3D(); ikR.name = 'ikR';
  vrm.scene.add(ikL, ikR);

  const idleA = merge(STANCE, {}), idleB = merge(STANCE, { spine: E(0.1, 0.32, -0.02), head: E(0.12, 0.42, 0.03), leftUpperArm: E(0.3, 0.25, -1.15), rightUpperArm: E(-0.25, -0.3, 1.1) });
  const idle = buildClip('idle', [
    { t: 0, hipsY: 0.86, pose: idleA, ikL: L_ON, ikR: R_ON },
    { t: 1.2, hipsY: 0.84, hipsX: 0.02, pose: idleB, ikL: L_ON, ikR: R_ON },
    { t: 2.4, hipsY: 0.86, pose: idleA, ikL: L_ON, ikR: R_ON },
  ], vrm, [ikL, ikR]);
  // push: weight onto the front foot, back foot drops beside the deck and sweeps back, returns
  const pushLean = merge(STANCE, { spine: E(0.3, 0.5, -0.12), chest: E(0.1, 0.2, 0), head: E(0.05, 0.55, -0.05), leftUpperArm: E(0.6, 0.4, -1.0), rightUpperArm: E(-0.7, -0.4, 1.0) });
  const push = buildClip('push', [
    { t: 0, hipsY: 0.84, pose: STANCE, ikL: L_ON, ikR: R_ON },
    { t: 0.18, hipsY: 0.74, hipsX: 0.08, pose: pushLean, ikL: L_ON, ikR: [-0.05, 0.18, 0.22] },
    { t: 0.38, hipsY: 0.72, hipsX: 0.1, pose: pushLean, ikL: L_ON, ikR: [-0.05, 0.1, 0.24] },
    { t: 0.6, hipsY: 0.74, hipsX: 0.06, pose: pushLean, ikL: L_ON, ikR: [-0.55, 0.12, 0.2] },
    { t: 0.8, hipsY: 0.8, pose: STANCE, ikL: L_ON, ikR: [-0.35, 0.32, 0.06] },
    { t: 1.0, hipsY: 0.84, pose: STANCE, ikL: L_ON, ikR: R_ON },
  ], vrm, [ikL, ikR]);
  const crouchPose = merge(STANCE, { spine: E(0.45, 0.3, -0.05), chest: E(0.2, 0.1, 0), neck: E(-0.2, 0.2, 0), head: E(-0.25, 0.4, 0), leftUpperArm: E(0.9, 0.3, -0.9), leftLowerArm: E(0, 1.0, 0), rightUpperArm: E(0.6, -0.5, 0.9), rightLowerArm: E(0, -1.0, 0) });
  const crouch = buildClip('crouch', [
    { t: 0, hipsY: 0.6, pose: crouchPose, ikL: L_ON, ikR: R_ON },
    { t: 0.5, hipsY: 0.58, pose: merge(crouchPose, { spine: E(0.48, 0.32, -0.05) }), ikL: L_ON, ikR: R_ON },
    { t: 1.0, hipsY: 0.6, pose: crouchPose, ikL: L_ON, ikR: R_ON },
  ], vrm, [ikL, ikR]);

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions: Record<string, THREE.AnimationAction> = { idle: mixer.clipAction(idle), push: mixer.clipAction(push), crouch: mixer.clipAction(crouch) };
  for (const a of Object.values(actions)) { a.play(); a.weight = 0; }
  actions.idle.weight = 1;
  let current = 'idle';
  const FADE: Record<string, number> = { 'idle>push': 0.15, 'push>crouch': 0.12, 'crouch>idle': 0.3, 'push>idle': 0.25, 'idle>crouch': 0.12, 'crouch>push': 0.15 };
  const play = (name: string) => {
    if (name === current) return;
    const from = actions[current], to = actions[name];
    to.reset().play(); to.setEffectiveWeight(1);
    from.crossFadeTo(to, FADE[`${current}>${name}`] ?? 0.2, false);
    current = name; stats.clip = name;
  };
  (window as any).play = play;

  // speed -> "wind" on spring bones (presentation only): gravity pushed backwards along the route
  const joints = [...(vrm.springBoneManager?.joints ?? [])];
  const base = joints.map((j) => ({ p: j.settings.gravityPower, d: j.settings.gravityDir.clone() }));
  const H = vrm.humanoid;
  const n = (b: string) => H.getNormalizedBoneNode(b as never)!;
  const hairTip = joints[joints.length - 1]?.bone;

  let speed = Number(q.get('speed') ?? 12), z = 0, t = 0;
  const auto = q.get('auto') !== '0';
  let last = performance.now();
  const footQ = new THREE.Quaternion();
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (auto) { // scripted demo timeline: idle -> push x2 -> crouch -> idle(happy)
      const k = t % 9;
      play(k < 2 ? 'idle' : k < 4.5 ? 'push' : k < 6 ? 'crouch' : 'idle');
    }
    z -= speed * dt; rider.position.set(0, 0, z);
    const c0 = performance.now();
    joints.forEach((j, i) => { const w = Math.min(1, speed / 25); j.settings.gravityDir.copy(base[i].d).multiplyScalar(1 - w).add(new THREE.Vector3(0, -0.15, 1).multiplyScalar(w)).normalize(); j.settings.gravityPower = base[i].p + w * 0.3; });
    mixer.update(dt);
    vrm.scene.updateMatrixWorld(true);
    vrm.scene.getWorldQuaternion(footQ);
    solveLeg(n('leftUpperLeg'), n('leftLowerLeg'), n('leftFoot'), ikL.getWorldPosition(new THREE.Vector3()), footQ, new THREE.Vector3(1, 0, 0));
    solveLeg(n('rightUpperLeg'), n('rightLowerLeg'), n('rightFoot'), ikR.getWorldPosition(new THREE.Vector3()), footQ, new THREE.Vector3(1, 0, 0));
    // expressions: blink + happy after the crouch
    const ex = vrm.expressionManager!;
    ex.setValue('blink', (t % 3.1) < 0.12 ? 1 : 0);
    ex.setValue('happy', current === 'idle' && t % 9 > 6 ? 0.8 : 0.15);
    vrm.update(dt);
    // IK error (proof that the feet are planted on the deck)
    vrm.scene.updateMatrixWorld(true);
    const lf = H.getRawBoneNode('leftFoot')!.getWorldPosition(new THREE.Vector3()), tl = ikL.getWorldPosition(new THREE.Vector3());
    const rf = H.getRawBoneNode('rightFoot')!.getWorldPosition(new THREE.Vector3()), tr = ikR.getWorldPosition(new THREE.Vector3());
    stats.ik = [lf.distanceTo(tl), rf.distanceTo(tr)];
    if (hairTip) { const p = hairTip.getWorldPosition(new THREE.Vector3()).sub(rider.position); stats.hairTip = [p.x, p.y, p.z]; }
    stats.cpuCharMs.push(performance.now() - c0); if (stats.cpuCharMs.length > 600) stats.cpuCharMs.shift();
    // camera (game chase rig values) or closer appeal views
    sun.position.set(-6, 10, z - 4); sun.target.position.set(0, 0, z);
    if (CAM === 'chase') { camera.fov = 52; camera.position.set(0, 7, z + 11.5); camera.rotation.set(-17 * Math.PI / 180, 0, 0); }
    else if (CAM === 'close') { camera.fov = 40; camera.position.set(0.4, 2.2, z + 4.2); camera.rotation.set(-12 * Math.PI / 180, 0, 0); }
    else { camera.fov = 35; camera.position.set(5.2, 1.3, z - 0.4); camera.lookAt(0, 0.75, z - 0.2); }
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    stats.frames++; stats.frameMs.push(now - (stats as any).lastNow || 0); (stats as any).lastNow = now; if (stats.frameMs.length > 600) stats.frameMs.shift();
    if (stats.frames % 15 === 0) hud.textContent = `${current} · ik ${stats.ik.map((v) => (v * 100).toFixed(1)).join('/')} cm · char ${(stats.cpuCharMs.reduce((a, b) => a + b, 0) / stats.cpuCharMs.length).toFixed(2)} ms · calls ${renderer.info.render.calls} · tris ${renderer.info.render.triangles}`;
  };
  stats.loaded = true;
  loop();
}, undefined, (e) => { hud.textContent = 'load error ' + e; console.error(e); });
