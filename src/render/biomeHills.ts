import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toScene } from './space';
import { toon } from './materials';
import { mulberry32 } from '../rng';

/**
 * Vision mock: a rough "Ghibli rolling hills" biome. Replaces the town with one procedural terrain mesh
 * (rolling meadow hills that cradle the route, a ravine under every gap) and instanced CC0 trees, bushes, flowers and
 * rocks from Quaternius' Stylized Nature MegaKit (public/spike-biome, CC0; see art/LICENSES.md). Select with `?biome=hills` (static courses only; combine with `?tod=`).
 * Not production: no streaming (built once for the opening's length), no LOD, textures downscaled to 512 px.
 */
type GroundFn = (x: number) => { y: number; gap: boolean };

export type BiomeName = 'town' | 'hills';
/** Biome from a query string (`?biome=`); anything unknown or missing is the town. */
export function biomeName(search: string): BiomeName {
  return new URLSearchParams(search).get('biome') === 'hills' ? 'hills' : 'town';
}

const C = { grass: '#86b85a', grassLight: '#b3d46e', grassDark: '#5e9147', verge: '#cdb98d', far: '#7aa3a0', flower: ['#f4f1e8', '#f2c94c', '#e98aa3', '#b79be0'] };

function h21(x: number, y: number): number { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Terrain height (route space) beside the route at lateral `lat`. */
export function hillHeight(ground: GroundFn, x: number, lat: number): number {
  const g = ground(x), a = Math.abs(lat);
  let y = g.y - 0.3;
  if (g.gap) y -= 9 * (1 - ss(4, 12, a)); // a ravine under every gap
  const roll = 0.5 + 0.5 * Math.sin(x * 0.021 + lat * 0.013) * Math.cos(lat * 0.031 - x * 0.006);
  y += ss(4, 34, a) * (3 + 9 * noise(x * 0.018, lat * 0.022) + 6 * roll);
  y += ss(70, 260, a) * (30 + 40 * noise(x * 0.006 + 7, lat * 0.008));
  return y;
}

export function buildHillsTerrain(ground: GroundFn, x0: number, x1: number): THREE.Mesh {
  const lats: number[] = [];
  for (let l = -380; l <= 380; ) { lats.push(l); const a = Math.abs(l); l += a > 120 ? 20 : a > 40 ? 8 : a > 10 ? 3 : 1.5; }
  const xs: number[] = [];
  for (let x = x0; x <= x1; x += 4) xs.push(x);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3(), c = new THREE.Color(), base = new THREE.Color(C.grass), light = new THREE.Color(C.grassLight), dark = new THREE.Color(C.grassDark), verge = new THREE.Color(C.verge), far = new THREE.Color(C.far);
  for (const x of xs) for (const l of lats) {
    const y = hillHeight(ground, x, l);
    toScene(x, y, l, v); pos.push(v.x, v.y, v.z);
    const n = noise(x * 0.05, l * 0.07), a = Math.abs(l);
    c.copy(base).lerp(n > 0.5 ? light : dark, Math.abs(n - 0.5) * 1.4);
    if (a < 4.6) c.copy(verge).lerp(base, ss(3.6, 4.6, a));
    c.lerp(far, ss(90, 300, a) * 0.6);
    if (a > 5 && a < 60 && h21(x * 3.1, l * 1.7) > 0.93) c.set(C.flower[Math.floor(h21(l, x) * 4)]);
    col.push(c.r, c.g, c.b);
  }
  const W = lats.length;
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < W; j++) {
    const a = i * W + j, b = a + 1, d = a + W, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide, rim: 0.4 }));
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

const MODELS: { file: string; scale: [number, number]; latMin: number; latMax: number; count: number }[] = [
  { file: 'CommonTree_1', scale: [1.4, 2.2], latMin: 10, latMax: 90, count: 70 },
  { file: 'CommonTree_3', scale: [1.4, 2.2], latMin: 10, latMax: 90, count: 50 },
  { file: 'TwistedTree_1', scale: [1.3, 1.9], latMin: 8, latMax: 40, count: 18 },
  { file: 'Pine_1', scale: [1.5, 2.4], latMin: 30, latMax: 160, count: 70 },
  { file: 'Pine_3', scale: [1.5, 2.4], latMin: 30, latMax: 160, count: 50 },
  { file: 'Bush_Common_Flowers', scale: [1.2, 1.8], latMin: 5.5, latMax: 30, count: 90 },
  { file: 'Flower_3_Group', scale: [1.4, 2.0], latMin: 4.8, latMax: 22, count: 160 },
  { file: 'Rock_Medium_1', scale: [0.8, 1.6], latMin: 6, latMax: 40, count: 40 },
];

/** Load the CC0 models and scatter them as instanced meshes (one draw call per model part). */
export async function buildHillsProps(base: string, ground: GroundFn, x0: number, x1: number): Promise<THREE.Group> {
  const group = new THREE.Group();
  const loader = new GLTFLoader();
  const rng = mulberry32(4242);
  const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const md of MODELS) {
    const gl = await loader.loadAsync(`${base}spike-biome/${md.file}.gltf`);
    gl.scene.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    gl.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      mats.forEach((src, k) => {
        const s = src as THREE.MeshStandardMaterial;
        const leaf = /leaf|leaves|flower/i.test(s.name) || !!s.map?.format && s.transparent;
        const t = toon('#ffffff', { rim: 0.8, side: leaf ? THREE.DoubleSide : THREE.FrontSide });
        t.map = s.map ?? null; t.color.copy(s.color ?? new THREE.Color('#ffffff'));
        if (leaf || s.alphaTest > 0 || s.transparent) { t.alphaTest = 0.5; t.transparent = false; }
        let g = geo;
        if (mats.length > 1 && geo.groups.length) { const gr = geo.groups[k]; g = geo.clone(); g.setIndex((geo.index!.array as Uint16Array | Uint32Array).slice(gr.start, gr.start + gr.count) as unknown as number[]); g.clearGroups(); }
        parts.push({ geo: g, mat: t });
      });
    });
    const placements: THREE.Matrix4[] = [];
    for (let i = 0, tries = 0; i < md.count && tries < md.count * 6; tries++) {
      const x = x0 + rng() * (x1 - x0), side = rng() < 0.5 ? -1 : 1, lat = side * (md.latMin + rng() * (md.latMax - md.latMin));
      if (side > 0 && Math.abs(lat) < 7) continue; // keep the rideable-wall side clear
      const y = hillHeight(ground, x, lat);
      toScene(x, y - 0.15, lat, _p);
      const sc = md.scale[0] + rng() * (md.scale[1] - md.scale[0]);
      _q.setFromAxisAngle(up, rng() * Math.PI * 2); _s.setScalar(sc);
      placements.push(new THREE.Matrix4().compose(_p.clone(), _q.clone(), _s.clone()));
      i++;
    }
    for (const p of parts) {
      const im = new THREE.InstancedMesh(p.geo, p.mat, placements.length);
      placements.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = md.file !== 'Flower_3_Group'; im.receiveShadow = true; im.frustumCulled = false;
      group.add(im);
    }
  }
  return group;
}
