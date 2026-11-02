import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SkyAnchor } from '../../course/skyTypes';
import { toon } from '../materials';

/**
 * One hot-air balloon per sky rung. `mountBalloon` hangs whatever object it is
 * given; the game passes the Grab3D envelope. The crown sits on the bounce
 * height so a landing from above meets cream. The basket and its ropes hang below.
 *
 * A bounce squashes the envelope, springs it back, then deflates the whole
 * balloon once. It does not come back.
 */

/** Envelope width. The crown is the top of the teardrop, about 1.2× this tall. */
export const ENVELOPE_DIAMETER = 4.5;
const ENVELOPE_ASPECT = 1.2;

const TERRACOTTA = '#c96a42';
const DEEP_TEAL = '#3d8c8a';
const MUSTARD = '#c6a04a';
const COLOURWAYS = [TERRACOTTA, DEEP_TEAL, MUSTARD];
const CREAM = '#f6efe2';
const INSIDE = '#2a242c';
const WICKER = '#6e4224';
const INK = '#2a1a14';

const SQUASH_S = 0.08;
const SPRING_S = 0.2;
const DEFLATE_S = 0.6;
const SQUASH_Y = 0.68;
const SQUASH_XZ = 1.16;
const BOB = 0.15;
const BOB_PERIOD = 3;

export interface BalloonMount {
  readonly group: THREE.Group;
  readonly bounceId: number;
  /** Sim bounce handler. Squash, spring, then deflate. Once only. */
  pop(time: number): void;
  update(time: number, cam?: THREE.Camera): void;
  dispose(): void;
}

let templatePromise: Promise<THREE.Object3D> | null = null;

/** The Grab3D envelope, parsed once. Materials on the template are unused. */
export function loadHotAirBalloon(): Promise<THREE.Object3D> {
  if (!templatePromise) templatePromise = readTemplate();
  return templatePromise;
}

async function readTemplate(): Promise<THREE.Object3D> {
  if (typeof globalThis.self === 'undefined') (globalThis as { self?: unknown }).self = globalThis;
  const buf = await modelBytes();
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  gltf.scene.name = 'hot-air-template';
  return gltf.scene;
}

async function modelBytes(): Promise<ArrayBuffer> {
  if (typeof document === 'undefined') {
    const nodeFs = 'node:fs';
    const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync(p: string): Uint8Array };
    const b = fs.readFileSync('public/models/hot-air-balloon.glb');
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const res = await fetch(`${base}models/hot-air-balloon.glb`);
  if (!res.ok) throw new Error(`hot-air balloon ${res.status}`);
  return res.arrayBuffer();
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function inflate(geo: THREE.BufferGeometry, meters: number): THREE.BufferGeometry {
  const g = geo.clone();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * meters, p.getY(i) + n.getY(i) * meters, p.getZ(i) + n.getZ(i) * meters);
  }
  p.needsUpdate = true;
  return g;
}

/**
 * Radius of a classic envelope, 0 at the mouth and 1 at the crown.
 * Round dome on top, full through the upper half, then a long throat
 * that is already narrower than the basket for the bottom metre.
 */
function envelopeProfile(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  const mouth = 0.09;
  const shoulder = 0.52;
  if (u >= 0.78) {
    const s = (u - 0.78) / 0.22;
    return Math.sqrt(Math.max(0, 1 - s * s));
  }
  if (u >= shoulder) return 1;
  const s = u / shoulder;
  return mouth + (1 - mouth) * Math.pow(s, 1.75);
}

interface EnvelopeShape {
  mouthY: number;
  mouthR: number;
  crownY: number;
}

/** Pull the Grab3D ball into a teardrop. Geometries are cloned so the template stays put. */
function shapeEnvelope(envelope: THREE.Object3D, owned: THREE.BufferGeometry[]): EnvelopeShape {
  const meshes: THREE.Mesh[] = [];
  envelope.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry.clone();
    mesh.geometry = g;
    owned.push(g);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (r > maxR) maxR = r;
    }
  }
  const height0 = Math.max(1e-4, maxY - minY);
  let shapedMaxR = 0;
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-3) continue;
      const t = (y - minY) / height0;
      const want = envelopeProfile(t) * maxR;
      const k = want / r;
      p.setXYZ(i, x * k, y, z * k);
      if (want > shapedMaxR) shapedMaxR = want;
    }
    p.needsUpdate = true;
  }
  const width = Math.max(1e-4, shapedMaxR * 2);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      yMin = Math.min(yMin, p.getY(i));
      yMax = Math.max(yMax, p.getY(i));
    }
  }
  const yMul = (ENVELOPE_ASPECT * width) / Math.max(1e-4, yMax - yMin);
  const crown = yMax;
  const mouthY = crown - (crown - yMin) * yMul;
  const band = (crown - mouthY) * 0.04;
  let mouthR = 0;
  for (const mesh of meshes) {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = crown - (crown - p.getY(i)) * yMul;
      p.setY(i, y);
      const r = Math.hypot(p.getX(i), p.getZ(i));
      if (y < mouthY + band && r > mouthR) mouthR = r;
    }
    p.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  return { mouthY, mouthR: Math.max(0.45, mouthR), crownY: crown };
}

function paint(root: THREE.Object3D, seed: number, inkMeters: number): { envelope: THREE.Object3D; mats: THREE.Material[]; owned: THREE.BufferGeometry[] } {
  const accent = COLOURWAYS[Math.min(COLOURWAYS.length - 1, Math.floor(hash(seed) * COLOURWAYS.length))];
  const envelope = root.getObjectByName('hot-air-balloon_envelope');
  const body = root.getObjectByName('hot-air-balloon_body');
  if (!envelope || !body) throw new Error('hot-air balloon is missing its envelope');
  envelope.name = 'sky-balloon-envelope';
  body.name = 'sky-balloon-body';
  const mats: THREE.Material[] = [];
  const owned: THREE.BufferGeometry[] = [];
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, toneMapped: false, transparent: true });
  inkMat.polygonOffset = true;
  inkMat.polygonOffsetFactor = 1;
  inkMat.polygonOffsetUnits = 1;
  mats.push(inkMat);
  let gore = 0;
  const meshes: THREE.Mesh[] = [];
  envelope.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const mesh of meshes) {
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
    const label = src?.name ?? mesh.name;
    let color = CREAM;
    if (label.includes('inside')) color = INSIDE;
    else if (label.includes('cream')) color = CREAM;
    else {
      color = gore % 2 === 0 ? accent : CREAM;
      gore++;
    }
    const mat = toon(color, { rim: 1.15 });
    mat.transparent = true;
    mat.name = label;
    mesh.material = mat;
    mesh.castShadow = !label.includes('inside');
    mesh.receiveShadow = false;
    mats.push(mat);
    if (!label.includes('inside')) {
      const shell = new THREE.Mesh(inflate(mesh.geometry, inkMeters), inkMat);
      shell.name = 'sky-balloon-ink';
      shell.castShadow = false;
      mesh.add(shell);
      owned.push(shell.geometry);
    }
  }
  const bodyMesh = body as THREE.Mesh;
  if (bodyMesh.isMesh) {
    const mat = toon(WICKER, { rim: 0.9 });
    mat.transparent = true;
    mat.name = 'hot-air-basket';
    bodyMesh.material = mat;
    bodyMesh.castShadow = true;
    mats.push(mat);
    const shell = new THREE.Mesh(inflate(bodyMesh.geometry, inkMeters), inkMat);
    shell.name = 'sky-balloon-ink';
    bodyMesh.add(shell);
    owned.push(shell.geometry);
  }
  return { envelope, mats, owned };
}

/** Toon steam card. Same lavender-to-cream puff the updrafts use. */
function steamMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, opacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D map; uniform float opacity; varying vec2 vUv;
      void main() {
        vec4 tex = texture2D(map, vUv);
        vec2 p = vUv * 2.0 - 1.0;
        float lum = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
        float coverage = min(lum, tex.a);
        float card = smoothstep(0.96, 0.42, length(p));
        float soft = smoothstep(0.02, 0.55, coverage) * card;
        float lit = smoothstep(0.15, 0.75, lum);
        vec3 lavender = vec3(0.73, 0.64, 0.86);
        vec3 cream = vec3(1.0, 0.90, 0.74);
        vec3 col = mix(lavender, cream, lit);
        gl_FragColor = vec4(col, soft * opacity * 0.72);
      }`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
}

const HEMP = '#e7c98a';

/**
 * The stock basket sits under the street once the envelope is scaled.
 * Scale the wicker up to about 1.2 m, hang the rim just under the mouth,
 * and ease it toward the chase camera so the basket and ropes read below
 * the pinch instead of inside the throat.
 */
function hangBasket(body: THREE.Object3D, root: THREE.Object3D, shape: EnvelopeShape, scale: number, streetRel: number, mats: THREE.Material[], owned: THREE.BufferGeometry[]): void {
  // Grab3D body: wicker is y 0–1.19 (about 1.47 wide), burner sits above 2.6.
  const wickerTop = 1.19;
  const localW = 1.47;
  // Wide and shallow, so the hamper sits under the pinch instead of up inside it.
  const sx = 1.2 / (localW * scale);
  let sy = 0.58 / (wickerTop * scale);
  const rimY = shape.mouthY - 0.02 / scale;
  const streetBottom = (streetRel + 0.14) / scale + shape.crownY;
  if (rimY - wickerTop * sy < streetBottom) {
    sy = Math.max(0.34 / (wickerTop * scale), (rimY - streetBottom) / wickerTop);
  }
  body.scale.set(sx, sy, sx);
  // Rim stays at the mouth. +Z is toward the chase camera (the route runs −Z).
  body.position.y += rimY - wickerTop * sy;
  body.position.z += 0.45 / scale;
  const hemp = toon(HEMP, { rim: 0.35, emissive: '#f3ddb0', emissiveIntensity: 0.72 });
  hemp.transparent = true;
  hemp.name = 'hot-air-rope';
  mats.push(hemp);
  const inkMat = mats[0];
  const half = (localW * 0.5) * sx * 0.78;
  const lip = body.position.y + wickerTop * sy;
  const z0 = body.position.z;
  const rim = [
    [-half, lip, z0 - half * 0.72],
    [half, lip, z0 - half * 0.72],
    [half * 0.86, lip, z0 + half * 0.78],
    [-half * 0.86, lip, z0 + half * 0.78],
  ];
  const up = new THREE.Vector3(0, 1, 0);
  const throat = Math.max(0.35, shape.mouthR * 0.82);
  for (const r of rim) {
    const a = new THREE.Vector3(r[0], r[1], r[2]);
    const dir = new THREE.Vector3(r[0], 0, r[2] - z0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(throat);
    const b = new THREE.Vector3(dir.x, shape.mouthY + 0.08, dir.z);
    const span = b.clone().sub(a);
    const len = Math.max(0.2, span.length());
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(up, span.clone().multiplyScalar(1 / len));
    const geo = new THREE.CylinderGeometry(0.02 / scale, 0.02 / scale, len, 5);
    const rope = new THREE.Mesh(geo, hemp);
    rope.name = 'sky-balloon-rope';
    rope.position.copy(mid);
    rope.quaternion.copy(q);
    rope.castShadow = true;
    root.add(rope);
    owned.push(geo);
    const shellGeo = new THREE.CylinderGeometry(0.034 / scale, 0.034 / scale, len, 5);
    const shell = new THREE.Mesh(shellGeo, inkMat);
    shell.name = 'sky-balloon-ink';
    shell.position.copy(mid);
    shell.quaternion.copy(q);
    root.add(shell);
    owned.push(shellGeo);
  }
}

/**
 * Hang one balloon. `source` is the loaded model (a clone is taken).
 * The crown is placed at `y`, in the lane.
 */
export function mountBalloon(source: THREE.Object3D, opts: {
  place: (x: number, y: number, lat: number) => THREE.Vector3;
  x: number;
  /** Bounce height. The cream crown sits here. */
  y: number;
  seed: number;
  bounceId: number;
  tether: SkyAnchor;
  streetY: number;
  quay?: boolean;
  /** Updraft puff maps. Read at deflate time so a late load still blows steam. */
  steam?: () => THREE.Texture[];
}): BalloonMount {
  const root = source.clone(true);
  const owned: THREE.BufferGeometry[] = [];
  const envNode = root.getObjectByName('hot-air-balloon_envelope');
  if (!envNode) throw new Error('hot-air balloon is missing its envelope');
  const shaped = shapeEnvelope(envNode, owned);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(envNode);
  const size = box.getSize(new THREE.Vector3());
  const diameter = Math.max(size.x, size.z);
  const scale = ENVELOPE_DIAMETER / Math.max(1e-4, diameter);
  const painted = paint(root, opts.seed, 0.012 / scale);
  const { envelope, mats } = painted;
  owned.push(...painted.owned);
  root.scale.setScalar(scale);
  root.position.y = -box.max.y * scale;
  const bodyNode = root.getObjectByName('sky-balloon-body');
  if (bodyNode) hangBasket(bodyNode, root, shaped, scale, opts.streetY - opts.y, mats, owned);

  const rig = new THREE.Group();
  rig.name = 'sky-balloon-rig';
  rig.rotation.x = (hash(opts.seed + 4) - 0.5) * 0.16;
  rig.rotation.z = (hash(opts.seed + 9) - 0.5) * 0.14;
  rig.add(root);

  const group = new THREE.Group();
  group.name = 'sky-balloon';
  group.userData = {
    bounceId: opts.bounceId,
    diameter: ENVELOPE_DIAMETER,
    height: size.y * scale,
    lateral: 0,
    popped: false,
    spent: false,
  };
  group.position.copy(opts.place(opts.x, opts.y, 0));
  group.add(rig);

  const puffGeo = new THREE.PlaneGeometry(1, 1);
  owned.push(puffGeo);
  const puffs: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; dir: THREE.Vector3; spin: number }[] = [];
  let poppedAt = -1;
  let steamSpawned = false;

  const spawnSteam = () => {
    const maps = opts.steam?.() ?? [];
    if (!maps.length || steamSpawned) return;
    steamSpawned = true;
    for (let i = 0; i < 8; i++) {
      const mat = steamMaterial(maps[i % maps.length]);
      const mesh = new THREE.Mesh(puffGeo, mat);
      mesh.name = 'sky-balloon-steam';
      mesh.position.set((hash(opts.seed + i) - 0.5) * 1.4, -1.2 - hash(opts.seed + i * 3) * 1.6, (hash(opts.seed + i * 5) - 0.5) * 1.4);
      mesh.scale.setScalar(0.4);
      rig.add(mesh);
      const dir = new THREE.Vector3(hash(i + 2) - 0.5, 0.8 + hash(i + 4) * 0.7, hash(i + 6) - 0.5).normalize();
      puffs.push({ mesh, mat, dir, spin: hash(i + 8) * 2 });
      mats.push(mat);
    }
  };

  const mount: BalloonMount = {
    group,
    bounceId: opts.bounceId,
    pop(time: number) {
      if (poppedAt >= 0) return;
      poppedAt = time;
      group.userData.popped = true;
      group.userData.spent = true;
    },
    update(time: number, cam?: THREE.Camera) {
      const age = poppedAt < 0 ? -1 : time - poppedAt;
      if (age < 0) {
        rig.position.y = Math.sin((time / BOB_PERIOD) * Math.PI * 2 + opts.seed) * BOB;
        return;
      }
      rig.position.y = 0;
      if (age < SQUASH_S) {
        const k = age / SQUASH_S;
        envelope.scale.set(1 + (SQUASH_XZ - 1) * k, 1 + (SQUASH_Y - 1) * k, 1 + (SQUASH_XZ - 1) * k);
        return;
      }
      if (age < SQUASH_S + SPRING_S) {
        const u = (age - SQUASH_S) / SPRING_S;
        const s = 1 - (1 - u) * (1 - u);
        const over = Math.sin(u * Math.PI) * 0.05 * (1 - u);
        const xz = SQUASH_XZ + (1 - SQUASH_XZ) * s - over;
        const y = SQUASH_Y + (1 - SQUASH_Y) * s + over;
        envelope.scale.set(xz, y, xz);
        return;
      }
      const t = Math.min(1, (age - SQUASH_S - SPRING_S) / DEFLATE_S);
      const ease = t * t * (3 - 2 * t);
      envelope.scale.set(1 - 0.42 * ease, Math.max(0.08, 1 - 0.88 * ease), 1 - 0.42 * ease);
      rig.position.y = -ease * 2.4;
      const fade = 1 - ease;
      for (const mat of mats) {
        const m = mat as THREE.Material & { opacity: number };
        m.opacity = fade;
      }
      spawnSteam();
      for (const puff of puffs) {
        const rise = ease * 3.2;
        const baseY = -1.4;
        puff.mesh.position.y = baseY + rise + puff.dir.y * rise * 0.35;
        puff.mesh.position.x = puff.dir.x * (0.4 + rise * 0.45);
        puff.mesh.position.z = puff.dir.z * (0.4 + rise * 0.45);
        const w = 1.1 + rise * 0.85;
        puff.mesh.scale.setScalar(w);
        puff.mat.uniforms.opacity.value = fade * (0.35 + 0.65 * Math.sin(Math.min(1, ease * 1.4) * Math.PI));
        if (cam) puff.mesh.lookAt(cam.position);
        puff.mesh.rotateZ(puff.spin * ease);
      }
      group.visible = fade > 0.02;
    },
    dispose() {
      for (const g of owned) g.dispose();
      owned.length = 0;
      for (const mat of mats) mat.dispose();
    },
  };
  mount.update(0);
  return mount;
}
