import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges many small procedural pieces into one vertex-coloured geometry (one draw
 * call). Each piece gets a flat colour (optionally a vertical gradient) and a `sway`
 * weight for wind (0 = rigid; foliage scales with height above the piece base).
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  /** Add `g` (consumed) at position/rotation/scale with a colour; `top` gives a vertical gradient. */
  add(g: THREE.BufferGeometry, pos: THREE.Vector3 | [number, number, number], color: THREE.ColorRepresentation, opts: { rot?: [number, number, number]; scale?: [number, number, number] | number; top?: THREE.ColorRepresentation; sway?: number } = {}): this {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const c0 = new THREE.Color(color), c1 = new THREE.Color(opts.top ?? color);
    const p = geo.getAttribute('position');
    const col = new Float32Array(p.count * 3), sw = new Float32Array(p.count);
    const h = Math.max(1e-6, bb.max.y - bb.min.y);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - bb.min.y) / h;
      tmp.copy(c0).lerp(c1, t);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      sw[i] = (opts.sway ?? 0) * t * t;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    const s = opts.scale === undefined ? [1, 1, 1] : typeof opts.scale === 'number' ? [opts.scale, opts.scale, opts.scale] : opts.scale;
    const r = opts.rot ?? [0, 0, 0];
    const v = Array.isArray(pos) ? new THREE.Vector3(...pos) : pos;
    this.q.setFromEuler(this.e.set(r[0], r[1], r[2]));
    this.m.compose(v, this.q, new THREE.Vector3(s[0], s[1], s[2]));
    geo.applyMatrix4(this.m);
    this.parts.push(geo);
    return this;
  }

  get size(): number { return this.parts.length; }

  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return g;
  }
}

/** Jitter vertices of a geometry (organic low-poly rock/cloud shapes). Deterministic per rng. */
export function jitter(g: THREE.BufferGeometry, amount: number, rng: () => number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const seen = new Map<number, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1000) * 73856093 ^ Math.round(p.getY(i) * 1000) * 19349663 ^ Math.round(p.getZ(i) * 1000) * 83492791;
    let d = seen.get(k);
    if (!d) { d = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount]; seen.set(k, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Fluted column shaft: a cylinder whose radius dips at every other radial vertex. */
export function flutedShaft(r: number, h: number, flutes = 16, depth = 0.07, taper = 0.9): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * taper, r, h, flutes * 2, 1, false);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.round((a / (2 * Math.PI)) * flutes * 2);
    if (k % 2 !== 0 && Math.hypot(x, z) > 1e-4) { p.setX(i, x * (1 - depth)); p.setZ(i, z * (1 - depth)); }
  }
  g.computeVertexNormals();
  return g;
}

/** A few pre-jittered unit blobs (clouds, foliage, rocks), cloned on use: cheap streaming. */
const blobCache = new Map<string, THREE.BufferGeometry[]>();
export function blob(detail: number, amount: number, pick: number): THREE.BufferGeometry {
  const key = `${detail}|${amount}`;
  let v = blobCache.get(key);
  if (!v) {
    v = [];
    const r = mulberry(detail * 1000 + Math.round(amount * 100));
    for (let i = 0; i < 6; i++) {
      const g = jitter(new THREE.IcosahedronGeometry(1, detail), amount, r);
      // smooth, puffy shading from few triangles: normals point out from the centre
      const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), n = new THREE.Vector3();
      for (let k = 0; k < pos.count; k++) { n.fromBufferAttribute(pos, k).normalize(); nrm.setXYZ(k, n.x, n.y, n.z); }
      v.push(g);
    }
    blobCache.set(key, v);
  }
  return v[Math.floor(pick * v.length) % v.length].clone();
}
function mulberry(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
