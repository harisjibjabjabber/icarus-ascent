import * as THREE from 'three';
import { GeoBuilder } from './geo';
import { toon } from './materials';
import { ROUTE_YAW } from './space';

/**
 * Painted set-piece cloth. Same toon ramp, rim and wind sway as the town foliage.
 * The Kenney awning and the Pixor garment meshes are flat game props; these are built
 * the way the town is, so the stripes, folds and hems take the same light.
 */
export const clothMaterial = toon('#ffffff', { vertexColors: true, sway: true, side: THREE.DoubleSide, rim: 0.85 });

const CREAM = new THREE.Color('#f4ead8');
const STRIPES = ['#c4543a', '#2f6d86', '#c47a32'].map((h) => new THREE.Color(h));
const WOOD = new THREE.Color('#5c4030');
const WOOD_LIT = new THREE.Color('#8d7360');
const IRON = new THREE.Color('#3a3642');
const IRON_LIT = new THREE.Color('#6a6270');

export interface SoftProp {
  id: number;
  group: THREE.Group;
  hit: number;
  phase: number;
  baseY: number;
  bob: number;
  bobRate: number;
}

/** Doorway awning: scalloped canvas, a sag, and stripes. Local +X along the route, local -Z toward the street. */
export function awningLocal(index: number): THREE.Group {
  const width = 2.05, depth = 1.15, sag = 0.28, scallops = 5;
  const cols = 16, rows = 9;
  const stripe = STRIPES[index % STRIPES.length];
  const n = cols * rows;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sway = new Float32Array(n);
  const idx: number[] = [];
  const at = (i: number, j: number) => {
    const u = i / (cols - 1), v = j / (rows - 1);
    const dip = Math.sin(Math.PI * u) * sag * v * v;
    const hem = v > 0.72 ? Math.sin(u * Math.PI * scallops) * 0.12 * ((v - 0.72) / 0.28) : 0;
    return { x: (u - 0.5) * width, y: -dip - hem, z: -v * depth, u, v, dip };
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = at(i, j), k = j * cols + i;
      pos.set([p.x, p.y, p.z], k * 3);
      const band = Math.floor(p.u * 7) % 2 === 0;
      const c = band ? CREAM : stripe;
      // valleys of the sag and the fold between stripes sit in softer shade
      const shade = (0.7 + 0.3 * (1 - p.dip / sag)) * (0.93 + 0.07 * Math.cos(p.u * Math.PI * 7));
      col.set([c.r * shade, c.g * shade, c.b * shade], k * 3);
      sway[k] = p.v * p.v * 0.42;
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const g = new THREE.Group();
  const canvas = new THREE.Mesh(geo, clothMaterial);
  canvas.castShadow = true;
  g.add(canvas);
  const gb = new GeoBuilder();
  gb.add(new THREE.BoxGeometry(width + 0.12, 0.07, 0.08), [0, 0.03, 0.03], WOOD, { top: WOOD_LIT });
  for (const s of [-1, 1]) {
    const x = s * (width * 0.46);
    gb.add(new THREE.BoxGeometry(0.035, 0.035, depth * 0.96), [x, -sag * 0.42, -depth * 0.48], IRON, { top: IRON_LIT });
    gb.add(new THREE.TorusGeometry(0.06, 0.012, 5, 8), [x, 0.02, -0.02], IRON, { rot: [0, Math.PI / 2, 0], top: IRON_LIT });
  }
  const frame = gb.build();
  if (frame) {
    const m = new THREE.Mesh(frame, clothMaterial);
    m.castShadow = true;
    g.add(m);
  }
  g.rotation.y = ROUTE_YAW;
  return g;
}

const PASTELS: [string, string][] = [
  ['#f7f1e6', '#e4d3c0'],
  ['#f2b8c6', '#d4899a'],
  ['#a8d4e8', '#6aa4c4'],
  ['#f6e3a0', '#e0c56e'],
  ['#c8e6c0', '#8fbf8a'],
  ['#e7eef8', '#c5d0e2'],
];

export type GarmentKind = 'sheet' | 'shirt' | 'sock' | 'towel';

/**
 * One piece of laundry. Peg at the origin (on the rope); the cloth hangs toward the facade
 * so the hem stays off the street. Width runs along the route, so the face reads side-on.
 */
export function garmentLocal(kind: GarmentKind, n: number): THREE.Group {
  const tint = new THREE.Color(PASTELS[n % PASTELS.length][0]);
  const deep = new THREE.Color(PASTELS[n % PASTELS.length][1]);
  const spec = kind === 'sheet' ? { w: 0.72, h: 0.98, su: 10, sv: 12, folds: 4, billow: 0.07 }
    : kind === 'shirt' ? { w: 0.46, h: 0.58, su: 10, sv: 10, folds: 3, billow: 0.045, shirt: true }
    : kind === 'towel' ? { w: 0.42, h: 0.55, su: 8, sv: 8, folds: 2, billow: 0.035, stripe: true }
    : { w: 0.12, h: 0.32, su: 4, sv: 7, folds: 1, billow: 0.02 };
  const out = 0.7;
  const geos = [clothSheet(spec, tint, deep)];
  if (kind === 'sock') geos.push(clothSheet({ ...spec, w: 0.1 }, tint, deep));
  const g = new THREE.Group();
  geos.forEach((geo, i) => {
    const mesh = new THREE.Mesh(geo, clothMaterial);
    mesh.castShadow = true;
    mesh.position.z = out + (kind === 'sock' ? (i === 0 ? -0.09 : 0.09) : 0);
    g.add(mesh);
  });
  const peg = new GeoBuilder();
  peg.add(new THREE.BoxGeometry(0.025, 0.04, kind === 'sheet' ? 0.08 : 0.05), [0.01, 0.02, 0], WOOD, { top: WOOD_LIT });
  peg.add(new THREE.BoxGeometry(0.018, 0.018, out), [0, 0.01, out / 2], IRON, { top: IRON_LIT });
  const built = peg.build();
  if (built) g.add(new THREE.Mesh(built, clothMaterial));
  g.rotation.y = ROUTE_YAW;
  return g;
}

function clothSheet(spec: { w: number; h: number; su: number; sv: number; folds: number; billow: number; shirt?: boolean; stripe?: boolean }, tint: THREE.Color, deep: THREE.Color): THREE.BufferGeometry {
  const { w, h, su, sv, folds, billow } = spec;
  const cols = su + 1, rows = sv + 1, n = cols * rows;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), swayA = new Float32Array(n);
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j < rows; j++) {
    const v = j / sv;
    for (let i = 0; i < cols; i++) {
      const u = i / su;
      let width = w;
      if (spec.shirt) width = 0.34 + 0.12 * v;
      // Width across the street (local +Z, rider's right). The chase camera looks along the route,
      // so the cloth face is what she rides toward. +X is only the fold.
      let z = (u - 0.5) * width;
      let y = -v * h;
      let x = Math.sin(u * Math.PI * folds) * billow * Math.sin(v * Math.PI);
      y -= Math.sin(u * Math.PI * 3) * 0.018 * v;
      if (spec.shirt) {
        const sleeve = u < 0.16 ? (0.16 - u) / 0.16 : u > 0.84 ? (u - 0.84) / 0.16 : 0;
        if (v < 0.42) {
          z += Math.sign(u - 0.5) * sleeve * 0.16;
          y -= sleeve * 0.12 * (1 - v / 0.42);
        }
        if (v < 0.12 && Math.abs(u - 0.5) < 0.18) y -= 0.05 * (1 - v / 0.12);
      }
      const k = j * cols + i;
      pos.set([x, y, z], k * 3);
      const fold = 0.88 + 0.12 * (0.5 + 0.5 * Math.cos(u * Math.PI * folds));
      c.copy(tint).lerp(deep, v * 0.62);
      if (spec.stripe && Math.floor(u * 5) % 2 === 0) c.lerp(CREAM, 0.55);
      c.multiplyScalar(fold * (0.86 + 0.14 * (1 - v)));
      col.set([c.r, c.g, c.b], k * 3);
      swayA[k] = v * v * 0.8;
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('sway', new THREE.BufferAttribute(swayA, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A cluster of painted balloons around the origin. Smooth spheres, not the faceted puff mesh. */
export function balloonLocal(seed: number): THREE.Group {
  const dyes = ['#e4546a', '#f2c14e', '#7eb6c8', '#f7f3ee'];
  const deep = ['#a83a2c', '#c47a32', '#2f6d86', '#d9cfc4'];
  const puffs: [number, number, number, number][] = [[0, 0.08, 0, 1], [-0.38, -0.16, 0.05, 0.76], [0.36, -0.12, -0.02, 0.72], [0.02, 0.44, 0.02, 0.54]];
  const gb = new GeoBuilder();
  const r = 0.64;
  void seed;
  for (let i = 0; i < puffs.length; i++) {
    const [ox, oy, oz, sc] = puffs[i];
    gb.add(new THREE.SphereGeometry(1, 18, 14), [ox, oy, oz], deep[i], { scale: [r * sc * 0.92, r * sc, r * sc * 0.92], top: dyes[i], sway: 0.05 });
    gb.add(new THREE.SphereGeometry(0.045, 8, 6), [ox, oy - r * sc * 0.98, oz], '#3a3642');
    gb.add(new THREE.ConeGeometry(0.045, 0.11, 6), [ox, oy - r * sc * 1.12, oz], deep[i]);
  }
  const g = new THREE.Group();
  const built = gb.build();
  if (built) {
    const m = new THREE.Mesh(built, clothMaterial);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Squash, a little rebound, then a resting bob. `hit` is the time of the last landing, or -1. */
export function poseSoft(p: SoftProp, time: number): void {
  const age = p.hit < 0 ? 10 : time - p.hit;
  const s = p.hit < 0 ? 0 : Math.exp(-age * 5.5) * Math.cos(age * 14);
  p.group.scale.set(1 + 0.1 * s, 1 - 0.3 * s, 1 + 0.08 * s);
  if (p.bob) p.group.position.y = p.baseY + Math.sin(time * p.bobRate + p.phase) * p.bob;
}
