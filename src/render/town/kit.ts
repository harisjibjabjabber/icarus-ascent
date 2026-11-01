import * as THREE from 'three';
import { toon } from '../materials';
import { TOD_UNIFORMS } from '../timeOfDay';

/**
 * The witch-town kit: premade CC0 pieces (Quaternius Medieval Village MegaKit, Kenney Fantasy Town + Pirate kits),
 * retextured offline by art/pipeline/bake_town.py into vertex colours + a role byte (what may be tinted per house).
 * public/town/kit.json indexes public/town/kit.bin. At runtime pieces are only *placed* and merged per chunk
 * (one draw call per chunk and LOD), never modelled here.
 */
export const ROLE = { FIXED: 0, PLASTER: 1, SHUTTER: 2, ROOF: 3, TRIM: 4 } as const;

export interface Piece { v: number; i: number; min: number[]; max: number[]; pos: Float32Array; nrm: Int8Array; col: Uint8Array; idx: Uint32Array; uv: Float32Array | null; tl: Uint8Array | null }

/**
 * Layers of the painted detail array (public/town/detail-array.webp, art/pipeline/build_detail_array.py). Kit pieces
 * carry their own UVs + layer from the bake; helper geometry (boxes, ribbons) passes a layer to MergeBuffer.geometry and
 * is projected in world space (planar by dominant normal).
 */
export const TEX = { NONE: -1, PLASTER: 0, TILES: 1, WOOD: 2, ROCK: 3, RUBBLE: 4, BRICK: 5, PLANKS: 6, COBBLES: 7 } as const;
export const TEX_LAYERS = 8;
/** World-projected tile size (m) per layer; all divide TEX_WRAP so chunk-local projection is seamless across chunks. */
export const TEX_TILE = [2, 2, 1.5, 2, 2.5, 2, 1.5, 2.5];
export const TEX_WRAP = 60;

export class Kit {
  constructor(readonly pieces: Map<string, Piece>) {}
  static fromBuffers(index: { pieces: Record<string, { v: number; i: number; min: number[]; max: number[]; pos: number; nrm: number; col: number; idx: number; uv?: number; tl?: number }> }, bin: ArrayBuffer): Kit {
    const m = new Map<string, Piece>();
    for (const [k, e] of Object.entries(index.pieces)) {
      m.set(k, {
        v: e.v, i: e.i, min: e.min, max: e.max, pos: new Float32Array(bin, e.pos, e.v * 3), nrm: new Int8Array(bin, e.nrm, e.v * 3), col: new Uint8Array(bin, e.col, e.v * 4), idx: new Uint32Array(bin, e.idx, e.i),
        uv: e.uv !== undefined ? new Float32Array(bin, e.uv, e.v * 2) : null, tl: e.tl !== undefined ? new Uint8Array(bin, e.tl, e.v) : null,
      });
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
  private uv = new Float32Array(1 << 13); // 2 per vertex
  private tl = new Float32Array(1 << 12);
  private idx = new Uint32Array(1 << 14);
  private nv = 0;
  private ni = 0;
  get triangles(): number { return this.ni / 3; }
  private grow(v: number, i: number): void {
    const need = (this.nv + v) * 3;
    if (need > this.pos.length) {
      let n = this.pos.length; while (n < need) n *= 2;
      for (const k of ['pos', 'nrm', 'col'] as const) { const a = new Float32Array(n); a.set(this[k]); this[k] = a; }
    }
    const nv = this.nv + v;
    if (nv > this.tl.length) {
      let n = this.tl.length; while (n < nv) n *= 2;
      const u = new Float32Array(n * 2); u.set(this.uv); this.uv = u;
      const t = new Float32Array(n); t.set(this.tl); this.tl = t;
    }
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
      const L = p.tl ? p.tl[i] : 255;
      this.tl[base + i] = L === 255 ? -1 : L;
      if (p.uv) { this.uv[(base + i) * 2] = p.uv[i * 2]; this.uv[(base + i) * 2 + 1] = p.uv[i * 2 + 1]; }
    }
    for (let i = 0; i < p.i; i++) this.idx[this.ni + i] = p.idx[i] + base;
    this.nv += p.v; this.ni += p.i;
  }
  /** Append a helper geometry (must carry a `color` attribute; GeoBuilder output). `tex`: painted layer (TEX), world-projected. */
  geometry(g: THREE.BufferGeometry, m?: THREE.Matrix4, tex: number = TEX.NONE): void {
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
      this.tl[base + i] = tex < 0 ? -1 : 16 + tex; // >= 16: world-projected layer (tex - 16)
      this.uv[(base + i) * 2] = 0; this.uv[(base + i) * 2 + 1] = 0;
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
    g.setAttribute('tuv', new THREE.BufferAttribute(this.uv.slice(0, this.nv * 2), 2));
    g.setAttribute('tl', new THREE.BufferAttribute(this.tl.slice(0, this.nv), 1));
    g.setIndex(new THREE.BufferAttribute(this.nv > 65535 ? this.idx.slice(0, this.ni) : new Uint16Array(this.idx.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Town material: our toon ramp + rim (same as Ao and the broom), vertex colours from the kit bake (palette + per-house
 * tints), and — the hi-fi pass — the kit's own painted textures sampled from one texture array (`TOWN_TEX`):
 *  - colour: the baked palette colour times the *high-pass* of the painted luminance (texel / its own blurred mip), so
 *    roof tiles, trowelled plaster, stones and wood grain read while the palette stays art-directed;
 *  - normals: the layer's normal map (cotangent frame from screen derivatives: no tangent attribute) on high/ultra.
 * Kit pieces use their UVs; helper geometry is projected in chunk space (+ `uWrap`, the chunk origin mod TEX_WRAP, so
 * the pattern runs on seamlessly across chunks and never jumps when the floating origin rebases).
 * Without the array (low tier / still loading) the old world-space brush detail is used.
 *
 * Anti pop-in: every chunk LOD gets its own material instance (all share one GL program via the cache key) with a
 * `uFade` range: a fragment survives only when its screen-space dither value lies in [uFade.x, uFade.y). The near and
 * far LOD of a chunk get complementary ranges, so a LOD switch is a dithered crossfade over distance rather than a
 * swap, and new chunks dissolve in. The detail texture's strength ramps in (`TOWN_DETAIL.strength`) once it has loaded.
 */
export const TOWN_DETAIL: { tex: THREE.Texture | null; strength: { value: number } } = { tex: null, strength: { value: 0 } };
/** Painted texture array + tier switches (set by Environment.applyQuality; `on` ramps 0..1 once the array is on the GPU). */
export const TOWN_TEX = {
  tex: { value: null as THREE.DataArrayTexture | null },
  on: { value: 0 },
  /** 0 = no normal maps (medium), 1 = on (high/ultra). */
  nrm: { value: 0 },
  enabled: true,
  /** Colour high-pass strength / normal strength per layer. */
  str: { value: [0.8, 0.85, 0.7, 0.75, 0.8, 0.75, 0.7, 0.8] },
  nrmStr: { value: [0.7, 0.9, 0.7, 0.8, 0.9, 0.8, 0.6, 0.8] },
  tile: { value: TEX_TILE },
};
export type TownMaterial = THREE.MeshToonMaterial & { fade: THREE.Vector2; wrap: THREE.Vector3 };
export function townMaterial(): TownMaterial {
  const m = toon('#ffffff', { vertexColors: true, rim: 0.7 }) as TownMaterial;
  const prev = m.onBeforeCompile;
  const uDetail = { value: TOWN_DETAIL.tex };
  m.fade = new THREE.Vector2(0, 1);
  m.wrap = new THREE.Vector3();
  const uFade = { value: m.fade }, uWrap = { value: m.wrap };
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    uDetail.value = TOWN_DETAIL.tex;
    Object.assign(sh.uniforms, {
      uDetail, uDetailStrength: TOWN_DETAIL.strength, uFade, uWrap,
      uNight: TOD_UNIFORMS.night, uTownTex: TOWN_TEX.tex, uTexOn: TOWN_TEX.on, uNrmOn: TOWN_TEX.nrm, uTexStr: TOWN_TEX.str, uTexNrm: TOWN_TEX.nrmStr, uTexTile: TOWN_TEX.tile,
    });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; varying vec3 vTPos; varying vec2 vTuv; varying float vTl;\nattribute vec2 tuv; attribute float tl; uniform vec3 uWrap;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal); vTPos = transformed + uWrap; vTuv = tuv; vTl = tl;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vTPos; varying vec2 vTuv; varying float vTl;
        uniform sampler2D uDetail; uniform float uDetailStrength; uniform vec2 uFade; uniform float uNight;
        uniform highp sampler2DArray uTownTex; uniform float uTexOn; uniform float uNrmOn; uniform float uTexStr[${TEX_LAYERS}]; uniform float uTexNrm[${TEX_LAYERS}]; uniform float uTexTile[${TEX_LAYERS}];
        float townDither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        mat3 townFrame(vec3 N, vec3 p, vec2 uv) {
          vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
          vec3 p2 = cross(dp2, N), p1 = cross(N, dp1);
          vec3 T = p2 * du1.x + p1 * du2.x, B = p2 * du1.y + p1 * du2.y;
          float k = inversesqrt(max(1e-12, max(dot(T, T), dot(B, B))));
          return mat3(T * k, B * k, N);
        }`)
      .replace('void main() {', `void main() {
        float tdh = townDither(floor(gl_FragCoord.xy));
        if (tdh < uFade.x || tdh >= uFade.y) discard;
        vec4 townT = vec4(0.5, 0.5, 0.5, 1.0); float townOn = 0.0; vec2 townUv = vec2(0.0); int townLi = 0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uTexOn > 0.001 && vTl > -0.5) {
          float L = vTl > 15.5 ? vTl - 16.0 : vTl;
          townLi = int(L + 0.5);
          vec2 uv = vTuv;
          if (vTl > 15.5) { vec3 an = abs(vWNrm); uv = (an.y > max(an.x, an.z) ? vTPos.xz : (an.x > an.z ? vTPos.zy : vTPos.xy)) / uTexTile[townLi]; }
          townUv = uv;
          townT = texture(uTownTex, vec3(uv, L));
          float mean = textureLod(uTownTex, vec3(uv, L), 5.0).r;
          float d = clamp(townT.r / max(mean, 0.06), 0.45, 1.7);
          diffuseColor.rgb *= mix(1.0, d, uTexStr[townLi] * uTexOn);
          townOn = uTexOn;
        } else if (uDetailStrength > 0.0) {
          vec3 an = abs(vWNrm);
          vec2 uv = an.y > max(an.x, an.z) ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
          float d = texture2D(uDetail, uv * 0.23).r;
          diffuseColor.rgb *= mix(1.0, 0.82 + d * 0.36, 0.55 * uDetailStrength);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (townOn > 0.001 && uNrmOn > 0.5) {
          vec3 tn = vec3(townT.g * 2.0 - 1.0, 1.0 - townT.b * 2.0, 0.0) * (uTexNrm[townLi] * townOn);
          tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
          normal = normalize(townFrame(normal, -vViewPosition, townUv) * tn);
        }`)
      // time of day (dusk/night): window glass and the dark interiors glow warm (HDR: the bloom picks it up);
      // ~1 in 4 windows stays dark (keyed on origin-free chunk space: stable across rebases). uNight = 0 by day, so the branch is skipped and the shipped look is untouched.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.0) {
          // exact (unshaded) vertex colours: helper interiors T.interior #3a3442 (not the near-identical iron #3b3440 of
          // wires/railings: 0.0035 apart in linear) and the kit's baked window glass #4a6a80 (bake_town.py)
          float tw = max(1.0 - step(0.0015, distance(vColor.rgb, vec3(0.04231, 0.03434, 0.05448))),
                         1.0 - smoothstep(0.015, 0.04, distance(vColor.rgb, vec3(0.0685, 0.1441, 0.2159))));
          float lit = step(0.27, fract(sin(dot(floor(vTPos.xz * 0.45) + floor(vTPos.y * 0.33), vec2(12.9898, 78.233))) * 43758.5453));
          totalEmissiveRadiance += vec3(1.0, 0.6, 0.25) * tw * lit * uNight * 3.0;
        }`)
      // tag dissolving pixels (alpha 0.5 in the HDR target) so the outline pass doesn't ink the dither pattern
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        if (uFade.x > 0.001 || uFade.y < 0.999) gl_FragColor.a = 0.5;`);
  };
  m.customProgramCacheKey = () => 'town-detail-fade-tex-tod';
  return m;
}

/** Build the texture array from the packed image (layers stacked vertically, 512 x 512 each). */
export function detailArray(img: ImageBitmap | HTMLImageElement, layers = TEX_LAYERS): THREE.DataArrayTexture {
  const w = img.width, h = img.height / layers;
  const c = document.createElement('canvas'); c.width = w; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const data = new Uint8Array(g.getImageData(0, 0, w, img.height).data.buffer);
  const t = new THREE.DataArrayTexture(data, w, h, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
