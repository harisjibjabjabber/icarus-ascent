import * as THREE from 'three';
import { GeoBuilder } from './geo';
import { ROUTE_YAW } from './space';

/** Town palette: terracotta, cream, teal, ochre. The tip is the darker of each pair. */
const PENNANTS: [string, string][] = [
  ['#c96a42', '#8d422c'],
  ['#fff8ee', '#e4d3b8'],
  ['#3f8f8a', '#24635f'],
  ['#d9a441', '#8f6820'],
];

const IRON = '#3b3440';

/**
 * One cross-street string. `lat0` and `lat1` are the facade faces; both ends get an iron hook
 * buried in that face, and the cord between them is a catenary. Pennants are folded triangles
 * (cloth, not cones) hanging off the cord. `place` maps route metres into the mesh's space.
 */
export function buildBuntingSpan(
  place: (x: number, y: number, lat: number) => THREE.Vector3,
  x: number, y: number, lat0: number, lat1: number, sag = 0.72,
): { rigid: THREE.BufferGeometry | null; cloth: THREE.BufferGeometry | null } {
  const lo = Math.min(lat0, lat1);
  const hi = Math.max(lat0, lat1);
  const gb = new GeoBuilder();
  const rot: [number, number, number] = [0, ROUTE_YAW, 0];
  const hook = (lat: number, outward: number) => {
    const plate = lat + outward * 0.04;
    const tip = lat - outward * 0.26;
    gb.add(new THREE.BoxGeometry(0.16, 0.32, 0.07), place(x, y, plate), IRON, { rot, top: '#6a6270' });
    gb.add(new THREE.BoxGeometry(0.05, 0.045, 0.3), place(x, y + 0.02, (plate + tip) / 2), IRON, { rot, top: '#8a8494' });
    gb.add(new THREE.BoxGeometry(0.045, 0.14, 0.045), place(x, y - 0.06, tip), IRON, { rot, top: '#8a8494' });
  };
  hook(lo, -1);
  hook(hi, 1);

  const latA = lo + 0.26;
  const latB = hi - 0.26;
  const at = (t: number) => ({
    x,
    y: y - Math.sin(Math.PI * t) * sag,
    lat: latA + (latB - latA) * t,
  });
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = at(i / n), b = at((i + 1) / n);
    const A = place(a.x, a.y, a.lat), B = place(b.x, b.y, b.lat);
    const dir = B.clone().sub(A);
    const len = Math.max(0.04, dir.length());
    q.setFromUnitVectors(up, dir.normalize());
    e.setFromQuaternion(q);
    gb.add(new THREE.CylinderGeometry(0.016, 0.016, len, 5), A.clone().add(B).multiplyScalar(0.5), '#5c4638', { rot: [e.x, e.y, e.z], top: '#a07858' });
  }

  const pos: number[] = [], col: number[] = [], sw: number[] = [], idx: number[] = [];
  const count = Math.max(5, Math.round((latB - latA) / 0.74));
  let v = 0;
  const push = (px: number, py: number, plat: number, color: THREE.Color, sway: number) => {
    const p = place(px, py, plat);
    pos.push(p.x, p.y, p.z);
    col.push(color.r, color.g, color.b);
    sw.push(sway);
    return v++;
  };
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const c = at(t);
    const slot = ((Math.round(x * 3) + i) % PENNANTS.length + PENNANTS.length) % PENNANTS.length;
    const [hem, tip] = PENNANTS[slot];
    const light = new THREE.Color(hem), dark = new THREE.Color(tip);
    const w = 0.5, drop = 0.62;
    const billow = (i % 2 === 0 ? 1 : -1) * 0.07;
    const y0 = c.y - 0.01;
    const a = push(c.x, y0, c.lat - w / 2, light, 0);
    const b = push(c.x, y0, c.lat + w / 2, light, 0);
    const fold = push(c.x + billow, y0 - drop * 0.42, c.lat, light.clone().lerp(dark, 0.45), 0.22);
    const point = push(c.x + billow * 1.4, y0 - drop, c.lat + (i % 2 === 0 ? 0.02 : -0.02), dark, 0.42);
    idx.push(a, b, fold, a, fold, point, b, point, fold);
  }
  const cloth = new THREE.BufferGeometry();
  cloth.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  cloth.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  cloth.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  cloth.setIndex(idx);
  cloth.computeVertexNormals();
  return { rigid: gb.build(), cloth };
}
