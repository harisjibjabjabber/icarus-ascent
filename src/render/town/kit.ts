import * as THREE from 'three';
import { toon } from '../materials';

/**
 * The witch-town kit: premade CC0 pieces (Quaternius Medieval Village MegaKit, Kenney Fantasy Town + Pirate kits),
 * retextured offline by art/pipeline/bake_town.py into vertex colours + a role byte (what may be tinted per house).
 * public/town/kit.json indexes public/town/kit.bin. At runtime pieces are only *placed* and merged per chunk
 * (one draw call per chunk and LOD), never modelled here.
 */
export const ROLE = { FIXED: 0, PLASTER: 1, SHUTTER: 2, ROOF: 3, TRIM: 4 } as const;

export interface Piece { v: number; i: number; min: number[]; max: number[]; pos: Float32Array; nrm: Int8Array; col: Uint8Array; idx: Uint32Array }

export class Kit {
  constructor(readonly pieces: Map<string, Piece>) {}
  static fromBuffers(index: { pieces: Record<string, { v: number; i: number; min: number[]; max: number[]; pos: number; nrm: number; col: number; idx: number }> }, bin: ArrayBuffer): Kit {
    const m = new Map<string, Piece>();
    for (const [k, e] of Object.entries(index.pieces)) {
      m.set(k, { v: e.v, i: e.i, min: e.min, max: e.max, pos: new Float32Array(bin, e.pos, e.v * 3), nrm: new Int8Array(bin, e.nrm, e.v * 3), col: new Uint8Array(bin, e.col, e.v * 4), idx: new Uint32Array(bin, e.idx, e.i) });
    }
    return new Kit(m);
  }
  static async load(base: string): Promise<Kit> {
    const [j, b] = await Promise.all([fetch(base + 'kit.json').then((r) => r.json()), fetch(base + 'kit.bin').then((r) => r.arrayBuffer())]);
    return Kit.fromBuffers(j, b);
  }
  has(name: string): boolean { return this.pieces.has(name); }
  tris(name: string): number { return (this.pieces.get(name)?.i ?? 0) / 3; }
}

/** Per-placement tints (linear colours) applied by role. */
export interface Tints { plaster?: THREE.Color; shutter?: THREE.Color; roof?: number; trim?: THREE.Color }

const SRGB = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3(), _c = new THREE.Color();

/** Growable merge buffer: kit pieces + small helper geometries -> one indexed BufferGeometry (position, normal, color). */
export class MergeBuffer {
  /** Optional per-piece triangle tally (debug/perf breakdown). */
  static stats: Map<string, number> | null = null;
  private pos = new Float32Array(1 << 14);
  private nrm = new Float32Array(1 << 14);
  private col = new Float32Array(1 << 14);
  private idx = new Uint32Array(1 << 14);
  private nv = 0;
  private ni = 0;
  get triangles(): number { return this.ni / 3; }
  private grow(v: number, i: number): void {
    const need = (this.nv + v) * 3;
    if (need > this.pos.length) { let n = this.pos.length; while (n < need) n *= 2; for (const k of ['pos', 'nrm', 'col'] as const) { const a = new Float32Array(n); a.set(this[k]); this[k] = a; } }
    if (this.ni + i > this.idx.length) { let n = this.idx.length; while (n < this.ni + i) n *= 2; const a = new Uint32Array(n); a.set(this.idx); this.idx = a; }
  }
  /** Place a kit piece with matrix `m`. */
  piece(kit: Kit, name: string, m: THREE.Matrix4, t: Tints = {}): void {
    const p = kit.pieces.get(name);
    if (!p) return;
    if (MergeBuffer.stats) MergeBuffer.stats.set(name, (MergeBuffer.stats.get(name) ?? 0) + p.i / 3);
    this.grow(p.v, p.i);
    _nm.getNormalMatrix(m);
    const base = this.nv;
    for (let i = 0; i < p.v; i++) {
      _v.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]).applyMatrix4(m);
      _n.set(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]).applyMatrix3(_nm).normalize();
      _c.setRGB(SRGB[p.col[i * 4]], SRGB[p.col[i * 4 + 1]], SRGB[p.col[i * 4 + 2]]);
      const role = p.col[i * 4 + 3];
      if (role === ROLE.PLASTER && t.plaster) _c.multiply(t.plaster);
      else if (role === ROLE.SHUTTER && t.shutter) _c.multiply(t.shutter);
      else if (role === ROLE.ROOF && t.roof !== undefined) _c.multiplyScalar(t.roof);
      else if (role === ROLE.TRIM && t.trim) _c.multiply(t.trim);
      const o = (base + i) * 3;
      this.pos[o] = _v.x; this.pos[o + 1] = _v.y; this.pos[o + 2] = _v.z;
      this.nrm[o] = _n.x; this.nrm[o + 1] = _n.y; this.nrm[o + 2] = _n.z;
      this.col[o] = _c.r; this.col[o + 1] = _c.g; this.col[o + 2] = _c.b;
    }
    for (let i = 0; i < p.i; i++) this.idx[this.ni + i] = p.idx[i] + base;
    this.nv += p.v; this.ni += p.i;
  }
  /** Append a helper geometry (must carry a `color` attribute; GeoBuilder output). */
  geometry(g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    if (MergeBuffer.stats) MergeBuffer.stats.set('#geo', (MergeBuffer.stats.get('#geo') ?? 0) + (g.index ? g.index.count : g.getAttribute('position').count) / 3);
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('color');
    const I = g.index;
    const ni = I ? I.count : P.count;
    this.grow(P.count, ni);
    if (m) _nm.getNormalMatrix(m);
    const base = this.nv;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i);
      if (m) { _v.applyMatrix4(m); _n.applyMatrix3(_nm).normalize(); }
      const o = (base + i) * 3;
      this.pos[o] = _v.x; this.pos[o + 1] = _v.y; this.pos[o + 2] = _v.z;
      this.nrm[o] = _n.x; this.nrm[o + 1] = _n.y; this.nrm[o + 2] = _n.z;
      this.col[o] = C ? C.getX(i) : 1; this.col[o + 1] = C ? C.getY(i) : 1; this.col[o + 2] = C ? C.getZ(i) : 1;
    }
    for (let i = 0; i < ni; i++) this.idx[this.ni + i] = (I ? I.getX(i) : i) + base;
    this.nv += P.count; this.ni += ni;
  }
  build(): THREE.BufferGeometry | null {
    if (!this.ni) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.nv * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(0, this.nv * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.nv * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.nv > 65535 ? this.idx.slice(0, this.ni) : new Uint16Array(this.idx.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Town material: our toon ramp + rim (same as Ao and the broom), vertex colours from the kit bake, and a painted
 * brush-texture detail projected in world space (planar by dominant normal) so flat plaster reads painted.
 *
 * Anti pop-in: every chunk LOD gets its own material instance (all share one GL program via the cache key) with a
 * `uFade` range: a fragment survives only when its screen-space dither value lies in [uFade.x, uFade.y). The near and
 * far LOD of a chunk get complementary ranges, so a LOD switch is a dithered crossfade over distance rather than a
 * swap, and new chunks dissolve in. The detail texture's strength ramps in (`TOWN_DETAIL.strength`) once it has loaded.
 */
export const TOWN_DETAIL: { tex: THREE.Texture | null; strength: { value: number } } = { tex: null, strength: { value: 0 } };
export type TownMaterial = THREE.MeshToonMaterial & { fade: THREE.Vector2 };
export function townMaterial(): TownMaterial {
  const m = toon('#ffffff', { vertexColors: true, rim: 0.7 }) as TownMaterial;
  const prev = m.onBeforeCompile;
  const uDetail = { value: TOWN_DETAIL.tex };
  m.fade = new THREE.Vector2(0, 1);
  const uFade = { value: m.fade };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    uDetail.value = TOWN_DETAIL.tex;
    sh.uniforms.uDetail = uDetail; sh.uniforms.uDetailStrength = TOWN_DETAIL.strength; sh.uniforms.uFade = uFade;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; uniform sampler2D uDetail; uniform float uDetailStrength; uniform vec2 uFade;
        float townDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`)
      .replace('void main() {', `void main() {
        float tdh = townDither(floor(gl_FragCoord.xy));
        if (tdh < uFade.x || tdh >= uFade.y) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uDetailStrength > 0.0) {
          vec3 an = abs(vWNrm);
          vec2 uv = an.y > max(an.x, an.z) ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
          float d = texture2D(uDetail, uv * 0.23).r;
          diffuseColor.rgb *= mix(1.0, 0.82 + d * 0.36, 0.55 * uDetailStrength);
        }`);
  };
  m.customProgramCacheKey = () => 'town-detail-fade';
  return m;
}
