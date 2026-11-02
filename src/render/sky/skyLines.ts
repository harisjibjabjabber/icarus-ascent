import * as THREE from 'three';
import type { SkyAnchor } from '../../course/skyTypes';
import { ROUTE_DIR, ROUTE_RIGHT, ROUTE_YAW } from '../space';
import { TOWN } from '../town/town';
import { GeoBuilder } from '../geo';
import { toon } from '../materials';

/**
 * Sky laundry lines, in the Kiki sense: a hemp rope with a visible sag,
 * held every 12–16 m by a thin cross-street cord tied to wooden shutters
 * (or, on the harbour, a crane whose foot stands on the quay). Dense
 * garments hang below the rope. Ao rides the rope; the cloth is under it.
 * The grind rail stays where the sim put it — the sag here is the picture.
 */

const HEMP = '#e7c98a';
const HEMP_LIT = '#fff3d2';
const WOOD = '#a8743c';
const WOOD_LIT = '#e7c48a';
const WOOD_DARK = '#6e4a2c';
const STONE = '#b9a796';
const STONE_LIT = '#e6d7c6';
const INK = '#2a1a14';
const DYES = ['#efe4d2', '#c48b6a', '#6e9084', '#c6a15a', '#8e8aa8', '#d8c6b0', '#7f93a6'];

const Y_UP = new THREE.Vector3(0, 1, 0);
const ropeMat = toon('#ffffff', { vertexColors: true, rim: 0.75 });
/** The rideable rope stays hemp-coloured even in the toon shadow band. */
const hempMat = toon(HEMP, { rim: 0.2, emissive: '#f3ddb0', emissiveIntensity: 0.72 });
const clothMat = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide, sway: true, rim: 0.85, nearFade: true });
const clothInk = toon(INK, { sway: true, side: THREE.FrontSide, nearFade: true });
clothInk.polygonOffset = true;
clothInk.polygonOffsetFactor = 1;
clothInk.polygonOffsetUnits = 1;

export interface SkyPeg { x: number; y: number; lat: number; kind: number; }

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

/** Visual ties every 12–16 m. Short lines keep their two ends even if that bay is a little over 16. */
function supportsOf(anchors: SkyAnchor[]): Support[] {
  const a = [...anchors].sort((p, q) => p.x - q.x);
  const x0 = a[0].x;
  const x1 = a[a.length - 1].x;
  const span = Math.max(0, x1 - x0);
  let gaps = 1;
  if (span > 16) {
    gaps = Math.max(1, Math.round(span / 14));
    if (span / gaps > 16.5) gaps = Math.ceil(span / 16);
    if (gaps > 1 && span / gaps < 12) gaps = Math.floor(span / 12);
    gaps = Math.max(1, gaps);
  }
  const out: Support[] = [];
  for (let i = 0; i <= gaps; i++) {
    const x = x0 + (span * i) / gaps;
    const nearest = a.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
    out.push({ x, y: sample(a, x, 'y'), kind: nearest.kind, lateral: sample(a, x, 'lateral') });
  }
  return out;
}

function shade(v: number, fold: number): THREE.Color {
  const t = Math.min(1, Math.max(0.35, 0.95 - v * 0.28 - fold));
  return new THREE.Color(t, t * 0.98, t * 0.94);
}

function appendGrid(
  pos: number[], col: number[], sway: number[], idx: number[],
  cols: number, rows: number, height: number,
  xAt: (u: number, v: number) => number,
  colorAt: (u: number, v: number) => THREE.Color,
  foldAt: (u: number, v: number) => number,
  sagAt: (u: number, v: number) => number = () => 0,
): void {
  const base = pos.length / 3;
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      pos.push(xAt(u, v), -v * height + sagAt(u, v), foldAt(u, v));
      const c = colorAt(u, v);
      if (j === rows || i === 0 || i === cols) c.multiplyScalar(0.72);
      col.push(c.r, c.g, c.b);
      sway.push(v * v * 1.25);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = base + j * (cols + 1) + i;
      idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
    }
  }
}

function finishCloth(pos: number[], col: number[], sway: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Small sheet, shirt, gingham dress, trousers, striped socks. Origin is the peg; cloth hangs in −Y. Each piece is 0.4–1.0 m. */
function clothGeometry(kind: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const sway: number[] = [];
  const idx: number[] = [];
  const fold = (u: number, v: number, amp: number, waves: number) => Math.sin(u * Math.PI * waves) * amp * (0.35 + v);
  const hem = (u: number, v: number, amp: number) => -Math.sin(u * Math.PI) * amp * v * v;
  const neck = (u: number, v: number) => (v < 0.14 ? -Math.cos((u - 0.5) * Math.PI) * 0.055 * (1 - v / 0.14) : 0);
  if (kind === 1) {
    // Torso, then a sleeve each side so the silhouette is a shirt even from the chase camera.
    appendGrid(pos, col, sway, idx, 8, 12, 0.74,
      (u, v) => {
        const chest = v < 0.16 ? 0.2 : 0.155 + 0.035 * Math.sin(Math.min(1, v) * Math.PI);
        return (u - 0.5) * 2 * chest;
      },
      (u, v) => shade(v, Math.abs(u - 0.5) < 0.08 ? 0.12 : Math.abs(u - 0.5) * 0.06),
      (u, v) => fold(u, v, 0.03, 2),
      (u, v) => hem(u, v, 0.045) + neck(u, v));
    for (const side of [-1, 1]) {
      appendGrid(pos, col, sway, idx, 6, 4, 0.2,
        (u, v) => side * (0.15 + u * 0.3 + v * 0.02),
        (u, v) => {
          const c = shade(0.15 + v * 0.3, 0.04);
          if (u > 0.78) c.multiplyScalar(0.78);
          return c;
        },
        (u, v) => Math.sin(u * Math.PI) * 0.02 * (0.4 + v),
        (u, v) => -0.02 - v * 0.05 + Math.sin(u * Math.PI) * 0.008);
    }
  } else if (kind === 2) {
    appendGrid(pos, col, sway, idx, 10, 16, 0.92,
      (u, v) => {
        const flare = v < 0.26 ? 0.15 + v * 0.12 : 0.18 + Math.pow((v - 0.26) / 0.74, 1.2) * 0.3;
        return (u - 0.5) * 2 * Math.min(0.47, flare);
      },
      (u, v) => {
        const c = shade(v, Math.abs(u - 0.5) * 0.05);
        const check = (Math.floor(u * 7) + Math.floor(v * 10)) % 2 === 0;
        if (!check) c.multiplyScalar(0.55);
        if (v < 0.26) c.multiplyScalar(0.92);
        return c;
      },
      (u, v) => fold(u, v, v < 0.26 ? 0.015 : 0.04, 2),
      (u, v) => hem(u, v, 0.06) + neck(u, v));
  } else if (kind === 3) {
    appendGrid(pos, col, sway, idx, 6, 2, 0.1,
      (u) => (u - 0.5) * 0.56,
      (u, v) => shade(v, Math.abs(u - 0.5) * 0.04),
      (u, v) => fold(u, v, 0.012, 1),
      () => 0);
    for (const side of [-1, 1]) {
      appendGrid(pos, col, sway, idx, 4, 12, 0.76,
        (u, v) => side * (0.07 + u * 0.2 + (v > 0.82 ? 0.015 : 0)),
        (u, v) => shade(v, Math.abs(u - 0.5) * 0.07 + (v > 0.9 ? 0.08 : 0)),
        (u, v) => fold(u, v, 0.02, 1),
        (u, v) => -0.1 + hem(u, v, 0.04));
    }
  } else if (kind === 4) {
    for (const side of [-1, 1]) {
      appendGrid(pos, col, sway, idx, 3, 8, 0.5,
        (u, v) => side * (0.055 + u * 0.11) + (v > 0.86 ? side * 0.012 : 0),
        (u, v) => {
          const c = shade(v, Math.abs(u - 0.5) * 0.05);
          if (Math.floor(v * 6) % 2 === 0) c.multiplyScalar(0.7);
          return c;
        },
        (u, v) => fold(u, v, 0.01, 1),
        (u, v) => hem(u, v, 0.02));
    }
  } else {
    appendGrid(pos, col, sway, idx, 8, 12, 0.8,
      (u, v) => (u - 0.5) * 0.66 * (1 + v * 0.06),
      (u, v) => {
        const c = shade(v, Math.abs(Math.sin(u * Math.PI * 2)) * 0.08);
        if (v > 0.9 || u < 0.06 || u > 0.94) c.multiplyScalar(0.75);
        return c;
      },
      (u, v) => fold(u, v, 0.04, 2) + Math.sin(u * Math.PI) * 0.03 * v,
      (u, v) => hem(u, v, 0.05));
  }
  return finishCloth(pos, col, sway, idx);
}

/** A thin ink line that follows the garment silhouette, including sleeves and hems. */
function outlineOf(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.clone();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const index = g.getIndex();
  if (!index) return g;
  const counts = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let e = 0; e < 3; e++) {
      const k = key(tri[e], tri[(e + 1) % 3]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const acc = Array.from({ length: p.count }, () => [0, 0]);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < p.count; i++) { cx += p.getX(i); cy += p.getY(i); }
  cx /= p.count;
  cy /= p.count;
  for (const [k, n] of counts) {
    if (n !== 1) continue;
    const [as, bs] = k.split(':');
    const a = Number(as);
    const b = Number(bs);
    const dx = p.getX(b) - p.getX(a);
    const dy = p.getY(b) - p.getY(a);
    const len = Math.hypot(dx, dy) || 1;
    let ox = -dy / len;
    let oy = dx / len;
    const mx = (p.getX(a) + p.getX(b)) * 0.5 - cx;
    const my = (p.getY(a) + p.getY(b)) * 0.5 - cy;
    if (ox * mx + oy * my < 0) { ox = -ox; oy = -oy; }
    acc[a][0] += ox; acc[a][1] += oy;
    acc[b][0] += ox; acc[b][1] += oy;
  }
  for (let i = 0; i < p.count; i++) {
    const x = acc[i][0];
    const y = acc[i][1];
    const len = Math.hypot(x, y);
    if (len < 1e-5) continue;
    p.setXYZ(i, p.getX(i) + (x / len) * 0.014, p.getY(i) + (y / len) * 0.014, p.getZ(i));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

const clothGeos: THREE.BufferGeometry[] = [];
const inkGeos: THREE.BufferGeometry[] = [];
function cloth(kind: number): { cloth: THREE.BufferGeometry; ink: THREE.BufferGeometry } {
  if (!clothGeos[kind]) {
    clothGeos[kind] = clothGeometry(kind);
    inkGeos[kind] = outlineOf(clothGeos[kind]);
  }
  return { cloth: clothGeos[kind], ink: inkGeos[kind] };
}

/**
 * One line in chunk space. The rope follows each anchor's lateral.
 * `yOf` turns an authored height into a height above the local street.
 */
export function buildSkyLine(opts: {
  place: (x: number, y: number, lat: number) => THREE.Vector3;
  anchors: SkyAnchor[];
  yOf: (authoredY: number, x: number) => number;
  streetY: (x: number) => number;
  laundry: boolean;
  proceduralLaundry: boolean;
  /** Kept so a grind can ask for a slightly shallower picture. The sag stays visible either way. */
  sag?: boolean;
  /** Harbour chunk: cranes standing on the quay, even if the anchors were not retagged. */
  quay?: boolean;
}): SkyLineBuild | null {
  if (opts.anchors.length < 2) return null;
  const supports = supportsOf(opts.anchors);
  const group = new THREE.Group();
  group.name = 'sky-line';
  const rope = new GeoBuilder();
  const pegsGb = new GeoBuilder();
  const sagMul = opts.sag === false ? 0.85 : 1;

  const yAt = (x: number) => {
    for (let i = 0; i < supports.length - 1; i++) {
      const a = supports[i];
      const b = supports[i + 1];
      if (x < a.x - 1e-4 || x > b.x + 1e-4) continue;
      const t = (x - a.x) / Math.max(1e-4, b.x - a.x);
      const bay = b.x - a.x;
      const amp = Math.min(0.5, Math.max(0.28, bay * 0.032)) * sagMul;
      const authored = a.y + (b.y - a.y) * t;
      return opts.yOf(authored, x) - amp * Math.sin(Math.PI * t);
    }
    const last = supports[supports.length - 1];
    return opts.yOf(last.y, x);
  };
  const latAt = (x: number) => sample(opts.anchors, x, 'lateral');

  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    const span = b.x - a.x;
    const n = Math.max(4, Math.round(span / 0.55));
    for (let k = 0; k < n; k++) {
      const x0 = a.x + span * (k / n);
      const x1 = a.x + span * ((k + 1) / n);
      addSpan(rope, opts.place, x0, yAt(x0), latAt(x0), x1, yAt(x1), latAt(x1), 0.034, HEMP, HEMP_LIT);
    }
  }

  for (const s of supports) {
    const y = yAt(s.x);
    const quay = opts.quay || s.kind === 'ship-mast';
    group.add(hold(opts.place, s, y, opts.streetY(s.x), quay));
  }

  const ropeGeo = rope.build();
  if (ropeGeo) {
    const mesh = new THREE.Mesh(ropeGeo, hempMat);
    mesh.name = 'sky-rope';
    mesh.userData.lateral = opts.anchors[0].lateral;
    mesh.userData.laterals = opts.anchors.map((a) => a.lateral);
    mesh.castShadow = true;
    group.add(mesh);
  }

  const pegs: SkyPeg[] = [];
  if (opts.laundry) {
    const x0 = supports[0].x;
    const x1 = supports[supports.length - 1].x;
    let x = x0 + 0.85;
    let n = 0;
    while (x < x1 - 0.6) {
      if (!supports.some((s) => Math.abs(s.x - x) < 0.4)) {
        const y = yAt(x);
        const lat = latAt(x);
        const kind = n % 5;
        pegs.push({ x, y, lat, kind });
        for (const side of [-1, 1]) {
          pegsGb.add(new THREE.BoxGeometry(0.045, 0.09, 0.05), opts.place(x, y + 0.02, lat + side * 0.12), WOOD, { rot: [0, ROUTE_YAW, 0.4 * side], top: WOOD_LIT });
        }
      }
      x += 1.22 + hash(x0 * 0.17 + n * 13.1) * 0.55;
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
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.clone().multiplyScalar(1 / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  gb.add(new THREE.CylinderGeometry(radius, radius, len, 6), A.clone().add(B).multiplyScalar(0.5), color, { rot: [e.x, e.y, e.z], top });
}

function hold(place: (x: number, y: number, lat: number) => THREE.Vector3, s: Support, y: number, street: number, quay: boolean): THREE.Group {
  const anchor = new THREE.Group();
  anchor.name = 'sky-anchor';
  anchor.userData.kind = quay ? 'ship-mast' : s.kind;
  anchor.userData.x = s.x;
  const local = new GeoBuilder();
  if (quay) quayCrane(local, place, s.x, y, street, s.lateral);
  else facadeTie(local, place, s.x, y, s.lateral);
  local.add(new THREE.SphereGeometry(0.055, 8, 6), place(s.x, y, s.lateral), WOOD_DARK, { top: WOOD_LIT });
  const built = local.build();
  if (built) {
    const mesh = new THREE.Mesh(built, ropeMat);
    mesh.castShadow = true;
    anchor.add(mesh);
  }
  return anchor;
}

/** Wooden shutter and a short balcony pole on each facade, with a thin rope between them. */
function facadeTie(gb: GeoBuilder, place: (x: number, y: number, lat: number) => THREE.Vector3, x: number, y: number, ropeLat: number): void {
  const rot: [number, number, number] = [0, ROUTE_YAW, 0];
  for (const facade of [-TOWN.front, TOWN.front]) {
    const side = Math.sign(facade) || 1;
    const lat = facade - side * 0.06;
    const dye = DYES[Math.abs(Math.round(x + facade)) % DYES.length];
    gb.add(new THREE.BoxGeometry(0.2, 0.72, 0.08), place(x, y, lat), WOOD, { rot, top: WOOD_LIT });
    gb.add(new THREE.BoxGeometry(0.12, 0.52, 0.05), place(x, y + 0.02, lat - side * 0.04), dye, { rot });
    const poleH = 1.55;
    const poleLat = lat - side * 0.1;
    gb.add(new THREE.CylinderGeometry(0.04, 0.055, poleH, 6), place(x + 0.16, y - 0.35, poleLat), WOOD, { top: WOOD_LIT });
    addSpan(gb, place, x + 0.16, y + 0.15, poleLat, x, y + 0.22, lat, 0.012, HEMP, HEMP_LIT);
    addSpan(gb, place, x + 0.16, y - 0.45, poleLat, x, y - 0.2, lat, 0.012, HEMP, HEMP_LIT);
  }
  const a = -TOWN.front + 0.2;
  const b = TOWN.front - 0.2;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const lat0 = a + (b - a) * t0;
    const lat1 = a + (b - a) * t1;
    const dip = (t: number) => Math.sin(Math.PI * t) * 0.14;
    addSpan(gb, place, x, y + 0.08 - dip(t0), lat0, x, y + 0.08 - dip(t1), lat1, 0.016, HEMP, HEMP_LIT);
  }
  addSpan(gb, place, x, y + 0.08 - 0.14, ropeLat, x, y, ropeLat, 0.014, HEMP, HEMP_LIT);
}

/**
 * Harbour: a wooden crane whose foot is on the quay stones, jib reaching the rope.
 * A light stay still ties the rope to the house side so the span is held at both ends.
 */
function quayCrane(gb: GeoBuilder, place: (x: number, y: number, lat: number) => THREE.Vector3, x: number, y: number, street: number, ropeLat: number): void {
  const rot: [number, number, number] = [0, ROUTE_YAW, 0];
  const foot = (TOWN.streetEdge + TOWN.front) * 0.5;
  // One boom from a stone foot on the quay up to the rope. A row of horizontal arms reads as a rail.
  const tip = y + 0.85;
  gb.add(new THREE.BoxGeometry(1.7, 0.34, 1.7), place(x, street + 0.15, foot), STONE, { rot, top: STONE_LIT });
  gb.add(new THREE.CylinderGeometry(0.2, 0.28, 1.15, 8), place(x, street + 0.75, foot), WOOD, { top: WOOD_LIT });
  timber(gb, place, x, street + 1.15, foot, x, tip, ropeLat, 0.24, WOOD, WOOD_LIT);
  addSpan(gb, place, x, tip, ropeLat, x, y, ropeLat, 0.016, HEMP, HEMP_LIT);
  gb.add(new THREE.SphereGeometry(0.16, 8, 6), place(x, tip, ropeLat), WOOD_DARK, { top: WOOD_LIT });
  const wall = -TOWN.front;
  gb.add(new THREE.BoxGeometry(0.18, 0.55, 0.08), place(x, y, wall + 0.06), WOOD, { rot, top: WOOD_LIT });
  gb.add(new THREE.BoxGeometry(0.1, 0.38, 0.05), place(x, y, wall + 0.1), DYES[Math.abs(Math.round(x)) % DYES.length], { rot });
  addSpan(gb, place, x, y + 0.05, wall + 0.12, x, y, ropeLat, 0.014, HEMP, HEMP_LIT);
}

/** A square timber, long axis along the span. Reads as a beam, not a rail. */
function timber(gb: GeoBuilder, place: (x: number, y: number, lat: number) => THREE.Vector3, x0: number, y0: number, lat0: number, x1: number, y1: number, lat1: number, thick: number, color: string, top: string): void {
  const A = place(x0, y0, lat0);
  const B = place(x1, y1, lat1);
  const dir = B.clone().sub(A);
  const len = Math.max(0.05, dir.length());
  const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.clone().multiplyScalar(1 / len));
  const e = new THREE.Euler().setFromQuaternion(q);
  gb.add(new THREE.BoxGeometry(thick, len, thick * 0.7), A.clone().add(B).multiplyScalar(0.5), color, { rot: [e.x, e.y, e.z], top });
}

const clothBasis = new THREE.Matrix4();
{
  const tilt = new THREE.Matrix4().makeRotationX(-0.68);
  const facing = new THREE.Matrix4().makeBasis(ROUTE_RIGHT, Y_UP, ROUTE_DIR.clone().negate());
  clothBasis.multiplyMatrices(facing, tilt);
}

function hangCloth(parent: THREE.Group, place: (x: number, y: number, lat: number) => THREE.Vector3, pegs: SkyPeg[], seed: number): void {
  const dye = new THREE.Color();
  for (let kind = 0; kind < 5; kind++) {
    const mine = pegs.filter((p) => p.kind === kind);
    if (!mine.length) continue;
    const src = cloth(kind);
    const color = new THREE.InstancedMesh(src.cloth.clone(), clothMat, mine.length);
    const ink = new THREE.InstancedMesh(src.ink.clone(), clothInk, mine.length);
    color.name = 'sky-laundry';
    ink.name = 'sky-laundry-ink';
    color.userData.kind = kind;
    color.castShadow = true;
    color.frustumCulled = ink.frustumCulled = false;
    color.renderOrder = 2;
    ink.renderOrder = 1;
    const m = new THREE.Matrix4();
    const yaw = new THREE.Matrix4();
    mine.forEach((peg, i) => {
      yaw.makeRotationY((hash(seed + i * 9 + kind * 3) - 0.5) * 0.22);
      m.multiplyMatrices(clothBasis, yaw);
      m.setPosition(place(peg.x, peg.y - 0.07, peg.lat));
      color.setMatrixAt(i, m);
      ink.setMatrixAt(i, m);
      if (kind === 4) dye.set('#ffffff');
      else dye.set(DYES[Math.abs(Math.round(seed + peg.x * 3 + i * 5)) % DYES.length]);
      color.setColorAt(i, dye);
    });
    color.instanceMatrix.needsUpdate = true;
    ink.instanceMatrix.needsUpdate = true;
    if (color.instanceColor) color.instanceColor.needsUpdate = true;
    parent.add(ink, color);
  }
}
