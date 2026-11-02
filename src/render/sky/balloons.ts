import * as THREE from 'three';
import type { SkyAnchor } from '../../course/skyTypes';
import { ROUTE_YAW } from '../space';
import { TOWN } from '../town/town';
import { GeoBuilder } from '../geo';
import { toon } from '../materials';

/**
 * One sky balloon per bounce. The body is whatever mesh the caller passes
 * (a sourced model, when it arrives). This file only hangs it, ties the
 * string, and pops it. `placeholderBalloonGeometry` is a temporary stand-in,
 * not the balloon we ship.
 *
 * The body is fitted so it stands about 1.8 m tall, origin at the centre,
 * which is the bounce point. `pop()` is what the sim's bounce event calls.
 */

export const BALLOON_HEIGHT = 1.8;
const DYES = ['#c96a42', '#3f8f8a', '#d9a441', '#e8899a', '#f7ecd4', '#a99ad0', '#7fb7d9'];
const CONFETTI = ['#fff8ee', '#c96a42', '#3f8f8a', '#d9a441', '#a99ad0', '#e8899a', '#f2b8c6'];
const OUTLINE = '#2a1a14';
const STRING = '#5c4638';
const WOOD = '#a8743c';
const WOOD_LIT = '#e7c48a';
const Y_UP = new THREE.Vector3(0, 1, 0);

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Temporary teardrop. Swap the argument of `mountBalloon` when the CC0 mesh lands. */
export function placeholderBalloonGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const knot: [number, number][] = [
    [0.004, 0], [0.02, 0.012], [0.031, 0.026], [0.02, 0.04], [0.011, 0.05], [0.025, 0.068],
  ];
  for (const [r, y] of knot) pts.push(new THREE.Vector2(r, y));
  const bodyH = 0.68;
  const bodyR = 0.275;
  for (let i = 1; i <= 18; i++) {
    const u = i / 18;
    const y = 0.068 + u * bodyH;
    const bell = Math.sin(Math.PI * Math.pow(u, 0.62));
    const r = 0.025 + (bodyR - 0.025) * bell * (1 - 0.15 * u);
    pts.push(new THREE.Vector2(Math.max(0.006, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  g.computeVertexNormals();
  return g;
}

function hull(src: THREE.BufferGeometry, meters: number): THREE.BufferGeometry {
  const g = src.clone();
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + nrm.getX(i) * meters, p.getY(i) + nrm.getY(i) * meters, p.getZ(i) + nrm.getZ(i) * meters);
  }
  p.needsUpdate = true;
  return g;
}

let rampTex: THREE.DataTexture | null = null;
function balloonRamp(): THREE.DataTexture {
  if (rampTex) return rampTex;
  const stops = [[0x8a, 0x7f, 0xa0], [0xe8, 0xd4, 0xc6], [0xff, 0xf8, 0xee]];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  rampTex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  rampTex.minFilter = rampTex.magFilter = THREE.NearestFilter;
  rampTex.colorSpace = THREE.SRGBColorSpace;
  rampTex.needsUpdate = true;
  return rampTex;
}

const latexCache = new Map<string, THREE.MeshToonMaterial>();
function latex(color: string): THREE.MeshToonMaterial {
  let m = latexCache.get(color);
  if (m) return m;
  m = new THREE.MeshToonMaterial({ color, gradientMap: balloonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 n = normalize(normal);
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize(vec3(0.34, 0.82, 0.46));
        vec3 H = normalize(L + V);
        float spec = pow(clamp(dot(n, H), 0.0, 1.0), 60.0);
        float band = spec > 0.55 ? 1.0 : spec > 0.16 ? 0.42 : 0.0;
        float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.4) * 0.35;
        float back = pow(clamp(dot(-n, L), 0.0, 1.0), 1.7) * 0.15;
        outgoingLight += vec3(1.0, 0.98, 0.94) * band * 0.95;
        outgoingLight += vec3(1.0, 0.94, 0.88) * fres;
        outgoingLight += diffuseColor.rgb * back;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'balloon-latex';
  latexCache.set(color, m);
  return m;
}

let outlineMat: THREE.MeshBasicMaterial | null = null;
function outlineMaterial(): THREE.MeshBasicMaterial {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, toneMapped: false });
    outlineMat.polygonOffset = true;
    outlineMat.polygonOffsetFactor = 1;
    outlineMat.polygonOffsetUnits = 1;
  }
  return outlineMat;
}

let stringMat: THREE.MeshToonMaterial | null = null;
function stringMaterial(): THREE.MeshToonMaterial {
  if (!stringMat) stringMat = new THREE.MeshToonMaterial({ color: STRING });
  return stringMat;
}

const tieMat = toon('#ffffff', { vertexColors: true, rim: 0.65 });

export interface BalloonMount {
  readonly group: THREE.Group;
  readonly bounceId: number;
  /** Sim bounce handler. Squash, then shreds and confetti. Once only. */
  pop(time: number): void;
  update(time: number): void;
  dispose(): void;
}

interface Bit {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

function fitGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const h = Math.max(1e-4, bb.max.y - bb.min.y);
  const s = BALLOON_HEIGHT / h;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  g.scale(s, s, s);
  return g;
}

function fitObject(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const h = Math.max(1e-4, box.max.y - box.min.y);
  const s = BALLOON_HEIGHT / h;
  obj.scale.multiplyScalar(s);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(c);
}

/**
 * Hang one balloon. `source` is the body: a geometry (shaded here) or a
 * loaded object (kept as authored). Either is scaled to {@link BALLOON_HEIGHT}.
 */
export function mountBalloon(source: THREE.Object3D | THREE.BufferGeometry, opts: {
  place: (x: number, y: number, lat: number) => THREE.Vector3;
  x: number;
  /** Bounce height. The balloon is centred here. */
  y: number;
  seed: number;
  bounceId: number;
  tether: SkyAnchor;
  streetY: number;
  quay?: boolean;
}): BalloonMount {
  const color = DYES[Math.abs(opts.seed) % DYES.length];
  const owned: THREE.BufferGeometry[] = [];
  const group = new THREE.Group();
  group.name = 'sky-balloon';
  group.userData = { bounceId: opts.bounceId, height: BALLOON_HEIGHT, popped: false };
  const center = opts.place(opts.x, opts.y, opts.tether.lateral);
  group.position.copy(center);

  const body = new THREE.Group();
  body.name = 'sky-balloon-body';
  if (source instanceof THREE.BufferGeometry) {
    const fitted = fitGeometry(source);
    const ink = hull(fitted, 0.012);
    owned.push(fitted, ink);
    const shell = new THREE.Mesh(fitted, latex(color));
    shell.castShadow = true;
    body.add(new THREE.Mesh(ink, outlineMaterial()), shell);
  } else {
    const obj = source.clone(true);
    fitObject(obj);
    body.add(obj);
  }
  group.add(body);

  const quay = opts.quay || opts.tether.kind === 'ship-mast';
  const cleatLat = quay ? (TOWN.streetEdge + TOWN.front) * 0.5 : opts.tether.lateral;
  const cleatY = opts.y - BALLOON_HEIGHT / 2 - 1.05;
  const cleat = opts.place(opts.x, cleatY, cleatLat).sub(center);
  const bottom = new THREE.Vector3(0, -BALLOON_HEIGHT / 2, 0);

  const strings = new THREE.Group();
  strings.name = 'sky-strings';
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 5), stringMaterial());
  str.castShadow = true;
  strings.add(str);
  group.add(strings);

  const tie = new THREE.Group();
  tie.name = 'sky-anchor';
  tie.userData.kind = quay ? 'ship-mast' : opts.tether.kind;
  const gb = new GeoBuilder();
  const rot: [number, number, number] = [0, ROUTE_YAW, 0];
  if (quay) {
    const foot = cleatLat;
    const top = cleatY;
    const h = Math.max(0.8, top - opts.streetY);
    gb.add(new THREE.BoxGeometry(0.7, 0.16, 0.7), opts.place(opts.x, opts.streetY + 0.08, foot), '#b9a796', { rot, top: '#e6d7c6' });
    gb.add(new THREE.CylinderGeometry(0.05, 0.08, h, 7), opts.place(opts.x, opts.streetY + h / 2, foot), WOOD, { top: WOOD_LIT });
  } else {
    for (const facade of [-TOWN.front, TOWN.front]) {
      const side = Math.sign(facade) || 1;
      gb.add(new THREE.BoxGeometry(0.16, 0.36, 0.07), opts.place(opts.x, cleatY, facade - side * 0.05), WOOD, { rot, top: WOOD_LIT });
      const A = opts.place(opts.x, cleatY, facade - side * 0.08);
      const B = opts.place(opts.x, cleatY, opts.tether.lateral);
      const dir = B.clone().sub(A);
      const len = Math.max(0.05, dir.length());
      const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.clone().multiplyScalar(1 / len));
      const e = new THREE.Euler().setFromQuaternion(q);
      gb.add(new THREE.CylinderGeometry(0.012, 0.012, len, 5), A.clone().add(B).multiplyScalar(0.5), '#e7c98a', { rot: [e.x, e.y, e.z], top: '#fff3d2' });
    }
  }
  gb.add(new THREE.SphereGeometry(0.06, 8, 6), opts.place(opts.x, cleatY, cleatLat), WOOD, { top: WOOD_LIT });
  const built = gb.build();
  if (built) {
    const mesh = new THREE.Mesh(built, tieMat);
    mesh.castShadow = true;
    tie.add(mesh);
  }
  group.add(tie);

  const bits: Bit[] = [];
  let poppedAt = -1;
  const scratch = new THREE.Vector3();

  const tieString = (from: THREE.Vector3, to: THREE.Vector3) => {
    const dir = to.clone().sub(from);
    const len = Math.max(0.05, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.multiplyScalar(1 / len));
    str.position.copy(from).add(to).multiplyScalar(0.5);
    str.quaternion.copy(q);
    str.scale.set(1, len, 1);
  };
  tieString(bottom, cleat);

  const spawn = (name: string, w: number, h: number, n: number, speed: number, dye: (i: number) => string) => {
    const geo = new THREE.PlaneGeometry(w, h);
    owned.push(geo);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshToonMaterial({ color: dye(i), side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.visible = false;
      mesh.castShadow = true;
      const dir = new THREE.Vector3(hash(opts.seed + i * 3) - 0.5, 0.35 + hash(opts.seed + i * 5) * 0.9, hash(opts.seed + i * 7) - 0.5);
      if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      dir.normalize().multiplyScalar(speed * (0.65 + hash(opts.seed + i * 11) * 0.7));
      group.add(mesh);
      bits.push({
        mesh,
        vel: dir,
        spin: new THREE.Vector3(hash(i + 1) * 8, hash(i + 2) * 6, hash(i + 3) * 8),
      });
    }
  };

  const mount: BalloonMount = {
    group,
    bounceId: opts.bounceId,
    pop(time: number) {
      if (poppedAt >= 0) return;
      poppedAt = time;
      group.userData.popped = true;
      if (!bits.length) {
        spawn('sky-balloon-shred', 0.22, 0.34, 12, 3.4, () => color);
        spawn('sky-balloon-confetti', 0.08, 0.12, 16, 4.2, (i) => CONFETTI[i % CONFETTI.length]);
      }
    },
    update(time: number) {
      const age = poppedAt < 0 ? -1 : time - poppedAt;
      if (age < 0) {
        const bob = Math.sin(time * 0.6 * Math.PI * 2 + opts.seed) * 0.05;
        body.position.y = bob;
        body.rotation.z = Math.sin(time * 0.5 * Math.PI * 2 + opts.seed) * (4 * Math.PI / 180);
        tieString(bottom.clone().setY(bottom.y + bob), cleat);
        return;
      }
      if (age < 0.08) {
        const k = age / 0.08;
        body.scale.set(1 + 0.22 * k, 1 - 0.42 * k, 1 + 0.22 * k);
        return;
      }
      body.visible = false;
      strings.visible = false;
      const t = age - 0.08;
      const fade = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.45);
      for (const bit of bits) {
        bit.mesh.visible = fade > 0.02;
        scratch.copy(bit.vel).multiplyScalar(t);
        scratch.y += -6.5 * t * t;
        bit.mesh.position.copy(scratch);
        bit.mesh.rotation.set(bit.spin.x * t, bit.spin.y * t, bit.spin.z * t);
        const mat = bit.mesh.material as THREE.MeshToonMaterial;
        mat.opacity = fade;
      }
    },
    dispose() {
      for (const g of owned) g.dispose();
      owned.length = 0;
      for (const bit of bits) (bit.mesh.material as THREE.Material).dispose();
    },
  };
  mount.update(0);
  return mount;
}
