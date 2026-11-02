import * as THREE from 'three';
import type { SkyAnchor } from '../../course/skyTypes';
import { ROUTE_DIR, ROUTE_RIGHT, ROUTE_YAW } from '../space';
import { TOWN } from '../town/town';
import { GeoBuilder } from '../geo';
import { toon } from '../materials';

/**
 * Sky laundry lines. The rope follows each anchor's lateral along travel
 * (interpolated between anchors). Every span is held by a bracket from the
 * facade named by `kind` out to that lateral, or by a pole standing on it,
 * so nothing floats. Laundry hangs from pegs on the rope.
 */

const COTTON = '#efe2c8';
const COTTON_LIT = '#fff6e4';
const INK = '#2a1a14';
const IRON = '#3b3440';
const IRON_LIT = '#6e6578';
const CLOTH = ['#ffffff', '#f2b8c6', '#a8d4e8', '#f6e3a0', '#c8e6c0', '#e8899a', '#c96a42'];

const Y_UP = new THREE.Vector3(0, 1, 0);
const ropeMat = toon('#ffffff', { vertexColors: true, rim: 0.8 });
const inkMat = toon('#ffffff', { vertexColors: true });
inkMat.polygonOffset = true;
inkMat.polygonOffsetFactor = 1;
inkMat.polygonOffsetUnits = 1;

export interface SkyPeg { x: number; y: number; lat: number; }

export interface SkyLineBuild {
  group: THREE.Group;
  pegs: SkyPeg[];
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function sample(anchors: SkyAnchor[], x: number, key: 'y' | 'lateral'): number {
  const a = [...anchors].sort((p, q) => p.x - q.x);
  if (x <= a[0].x) return a[0][key];
  if (x >= a[a.length - 1].x) return a[a.length - 1][key];
  for (let i = 0; i < a.length - 1; i++) {
    if (x >= a[i].x && x <= a[i + 1].x) {
      const t = (x - a[i].x) / Math.max(1e-4, a[i + 1].x - a[i].x);
      return a[i][key] + (a[i + 1][key] - a[i][key]) * t;
    }
  }
  return a[0][key];
}

interface Support { x: number; y: number; kind: SkyAnchor['kind']; lateral: number; }

function supportsOf(anchors: SkyAnchor[]): Support[] {
  const a = [...anchors].sort((p, q) => p.x - q.x);
  const out: Support[] = a.map((p) => ({ x: p.x, y: p.y, kind: p.kind, lateral: p.lateral }));
  const x0 = a[0].x;
  const x1 = a[a.length - 1].x;
  for (let x = x0 + 7; x < x1 - 2.5; x += 7) {
    if (a.some((p) => Math.abs(p.x - x) < 2.4)) continue;
    const nearest = a.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
    out.push({ x, y: sample(a, x, 'y'), kind: nearest.kind, lateral: sample(a, x, 'lateral') });
  }
  out.sort((p, q) => p.x - q.x);
  return out;
}

function clothGeometry(kind: number): THREE.BufferGeometry {
  const cols = kind === 2 ? 4 : 7;
  const rows = kind === 2 ? 5 : 8;
  const w = kind === 2 ? 0.28 : kind === 1 ? 0.48 : 0.7;
  const h = kind === 2 ? 0.42 : 0.82;
  const pos: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  const tint = new THREE.Color(CLOTH[kind % CLOTH.length]);
  const shade = tint.clone().multiplyScalar(0.78);
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const v = j / rows;
      const fold = Math.sin(u * Math.PI) * 0.07 * (0.25 + v);
      const pinch = kind === 1 && v < 0.18 ? (0.18 - v) * 0.35 : 0;
      pos.push((u - 0.5) * w * (1 - pinch), -v * h, fold);
      const c = tint.clone().lerp(shade, v * 0.65);
      col.push(c.r, c.g, c.b);
      sway.push(v * v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const clothGeos = new Map<number, THREE.BufferGeometry>();
function cloth(kind: number): THREE.BufferGeometry {
  let g = clothGeos.get(kind);
  if (!g) { g = clothGeometry(kind); clothGeos.set(kind, g); }
  return g;
}

const clothMat = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide, sway: true, rim: 0.9 });

/**
 * Build one line into chunk space. The rope follows each anchor's lateral
 * (interpolated between them). `yOf` turns an authored height into a height
 * above the local street. Brackets run from the facade named by `kind` to that rope.
 */
export function buildSkyLine(opts: {
  place: (x: number, y: number, lat: number) => THREE.Vector3;
  anchors: SkyAnchor[];
  yOf: (authoredY: number, x: number) => number;
  streetY: (x: number) => number;
  laundry: boolean;
  proceduralLaundry: boolean;
  /** False when `yOf` is already the grind height (a sky rail). */
  sag?: boolean;
}): SkyLineBuild | null {
  if (opts.anchors.length < 2) return null;
  const supports = supportsOf(opts.anchors);
  const group = new THREE.Group();
  group.name = 'sky-line';
  const rope = new GeoBuilder();
  const ink = new GeoBuilder();
  const pegsGb = new GeoBuilder();

  const yAt = (x: number) => {
    for (let i = 0; i < supports.length - 1; i++) {
      const a = supports[i];
      const b = supports[i + 1];
      if (x >= a.x - 1e-4 && x <= b.x + 1e-4) {
        const t = (x - a.x) / Math.max(1e-4, b.x - a.x);
        const sag = opts.sag === false ? 0 : 0.08 * ((b.x - a.x) / 8) * Math.sin(Math.PI * t);
        const authored = a.y + (b.y - a.y) * t;
        return opts.yOf(authored, x) - sag;
      }
    }
    const last = supports[supports.length - 1];
    return opts.yOf(last.y, x);
  };
  const latAt = (x: number) => sample(opts.anchors, x, 'lateral');

  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    const span = b.x - a.x;
    const n = Math.max(3, Math.round(span / 0.7));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const x0 = a.x + span * t0;
      const x1 = a.x + span * t1;
      addSpan(rope, opts.place, x0, yAt(x0), latAt(x0), x1, yAt(x1), latAt(x1), 0.022, COTTON, COTTON_LIT);
      addSpan(ink, opts.place, x0, yAt(x0), latAt(x0), x1, yAt(x1), latAt(x1), 0.03, INK, INK);
    }
  }

  const rot: [number, number, number] = [0, ROUTE_YAW, 0];
  for (const s of supports) group.add(hold(opts.place, s, yAt(s.x), opts.streetY(s.x), rot));

  const ropeGeo = rope.build();
  const inkGeo = ink.build();
  if (ropeGeo) {
    const mesh = new THREE.Mesh(ropeGeo, ropeMat);
    mesh.name = 'sky-rope';
    mesh.userData.lateral = opts.anchors[0].lateral;
    mesh.userData.laterals = opts.anchors.map((a) => a.lateral);
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (inkGeo) {
    const mesh = new THREE.Mesh(inkGeo, inkMat);
    mesh.name = 'sky-rope-ink';
    mesh.castShadow = true;
    group.add(mesh);
  }

  const pegs: SkyPeg[] = [];
  if (opts.laundry) {
    const x0 = supports[0].x;
    const x1 = supports[supports.length - 1].x;
    let x = x0 + 0.55;
    let n = 0;
    while (x < x1 - 0.4) {
      const y = yAt(x) - 0.05;
      const lat = latAt(x);
      pegs.push({ x, y, lat });
      pegsGb.add(new THREE.BoxGeometry(0.045, 0.1, 0.045), opts.place(x, y + 0.04, lat), IRON, { top: IRON_LIT });
      x += 0.9 + hash(x0 * 10 + n * 17) * 0.4;
      n++;
    }
    const pegsGeo = pegsGb.build();
    if (pegsGeo) {
      const mesh = new THREE.Mesh(pegsGeo, ropeMat);
      mesh.name = 'sky-pegs';
      mesh.castShadow = true;
      group.add(mesh);
    }
    if (opts.proceduralLaundry && pegs.length) hangCloth(group, opts.place, pegs, Math.round(supports[0].x));
  }
  return { group, pegs };
}

function addSpan(gb: GeoBuilder, place: (x: number, y: number, lat: number) => THREE.Vector3, x0: number, y0: number, lat0: number, x1: number, y1: number, lat1: number, radius: number, color: string, top: string): void {
  const A = place(x0, y0, lat0);
  const B = place(x1, y1, lat1);
  const dir = B.clone().sub(A);
  const len = Math.max(0.04, dir.length());
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.multiplyScalar(1 / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  gb.add(new THREE.CylinderGeometry(radius, radius, len, 6), A.clone().add(B).multiplyScalar(0.5), color, { rot: [e.x, e.y, e.z], top });
}

/** Facade bracket or a pole with a crossbar. The ring sits on the rope. */
function hold(place: (x: number, y: number, lat: number) => THREE.Vector3, s: Support, y: number, street: number, rot: [number, number, number]): THREE.Group {
  const anchor = new THREE.Group();
  anchor.name = 'sky-anchor';
  anchor.userData.kind = s.kind;
  const local = new GeoBuilder();
  const ropeLat = s.lateral;
  if (s.kind === 'mast' || s.kind === 'ship-mast') {
    const h = Math.max(3.2, y - street + 0.35);
    local.add(new THREE.CylinderGeometry(0.07, 0.1, h, 8), place(s.x, street + h / 2, ropeLat), '#8a623c', { top: '#c4a46a' });
    local.add(new THREE.SphereGeometry(0.09, 8, 6), place(s.x, street + h, ropeLat), '#6e4a2e');
    stay(local, place, s.x, street + 0.4, ropeLat, y - 0.15, ropeLat);
  } else {
    const facade = s.kind === 'bracket-right' ? TOWN.front : -TOWN.front;
    const side = Math.sign(facade) || 1;
    const span = facade - ropeLat;
    local.add(new THREE.BoxGeometry(0.28, 0.55, 0.1), place(s.x, y, facade - side * 0.02), IRON, { rot, top: IRON_LIT });
    for (const dy of [-0.16, 0.16]) local.add(new THREE.SphereGeometry(0.035, 6, 5), place(s.x, y + dy, facade - side * 0.08), IRON_LIT);
    if (Math.abs(span) > 0.05) {
      local.add(new THREE.BoxGeometry(0.07, 0.055, Math.abs(span)), place(s.x, y, (facade + ropeLat) / 2), IRON, { rot, top: IRON_LIT });
      stay(local, place, s.x, y - 0.95, facade - side * 0.05, y - 0.02, facade + (ropeLat - facade) * 0.42);
    }
  }
  local.add(new THREE.TorusGeometry(0.09, 0.016, 6, 12), place(s.x, y, ropeLat), IRON, { rot: [Math.PI / 2, 0, 0], top: IRON_LIT });
  const built = local.build();
  if (built) {
    const mesh = new THREE.Mesh(built, ropeMat);
    mesh.castShadow = true;
    anchor.add(mesh);
  }
  return anchor;
}

function stay(gb: GeoBuilder, place: (x: number, y: number, lat: number) => THREE.Vector3, x: number, y1: number, lat1: number, y2: number, lat2: number): void {
  const A = place(x, y1, lat1);
  const B = place(x, y2, lat2);
  const dir = B.clone().sub(A);
  const len = dir.length();
  if (len < 0.05) return;
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.multiplyScalar(1 / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  gb.add(new THREE.CylinderGeometry(0.018, 0.018, len, 5), A.clone().add(B).multiplyScalar(0.5), IRON, { rot: [e.x, e.y, e.z], top: IRON_LIT });
}

function hangCloth(parent: THREE.Group, place: (x: number, y: number, lat: number) => THREE.Vector3, pegs: SkyPeg[], seed: number): void {
  const face = ROUTE_DIR.clone().negate();
  const rot = new THREE.Matrix4().makeBasis(ROUTE_RIGHT, Y_UP, face);
  for (const kind of [0, 1, 2]) {
    const mine = pegs.filter((_, i) => i % 3 === kind);
    if (!mine.length) continue;
    const mesh = new THREE.InstancedMesh(cloth(kind).clone(), clothMat, mine.length);
    mesh.name = 'sky-laundry';
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    mine.forEach((peg, i) => {
      const yaw = ((hash(seed + i * 9 + kind) - 0.5) * 8 * Math.PI) / 180;
      m.multiplyMatrices(rot, new THREE.Matrix4().makeRotationY(yaw));
      m.setPosition(place(peg.x, peg.y, peg.lat));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  }
}
