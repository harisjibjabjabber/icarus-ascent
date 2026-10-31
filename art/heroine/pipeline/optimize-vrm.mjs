// Offline optimiser for the Ao VRM 0.0 files (VRoid Hub, by 白い白米 / siroihakumai).
// Keeps the VRM JSON intact (humanoid, spring bones, colliders, blend shapes, first person) and:
//  1. deletes body-skin triangles hidden under tight clothing (ray test against the cloth),
//  2. simplifies the hair cards (meshoptimizer, UV/seam aware) to a triangle budget,
//  3. prunes face morph targets no expression uses (plus adds a few custom expressions),
//  4. atlases body+cloth and all hair into one material each (colour factors baked in),
//     drops normal maps (no visible effect with Ao's toon ramp) and the 2048 thumbnail,
//  5. re-encodes textures as WebP (EXT_texture_webp) at budgeted sizes,
//  6. compresses all geometry with EXT_meshopt_compression.
// Usage: node optimize-vrm.mjs in.vrm out.vrm [--hair 0.45] [--atlas 2048] [--hairAtlas 2048]
import fs from 'node:fs';
import sharp from 'sharp';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const args = process.argv.slice(2);
const IN = args[0], OUT = args[1];
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const HAIR_RATIO = opt('hair', 0.4), ATLAS = opt('atlas', 2048), HAIR_ATLAS = opt('hairAtlas', 2048), FACE_MAX = opt('faceMax', 1024), WEBP_Q = opt('q', 88);
const log = (...a) => console.log(...a);

// ---------- GLB io ----------
const glb = fs.readFileSync(IN);
const jsonLen = glb.readUInt32LE(12);
const J = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const BIN = glb.subarray(20 + jsonLen + 8);
const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAcc(i) {
  const a = J.accessors[i], T = CT[a.componentType], n = NC[a.type];
  const out = new T(a.count * n);
  const bv = J.bufferViews[a.bufferView];
  const stride = bv.byteStride || n * T.BYTES_PER_ELEMENT;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  for (let k = 0; k < a.count; k++) {
    const src = new T(BIN.buffer.slice(BIN.byteOffset + base + k * stride, BIN.byteOffset + base + k * stride + n * T.BYTES_PER_ELEMENT));
    out.set(src, k * n);
  }
  return { arr: out, n, ct: a.componentType, normalized: a.normalized };
}
const readImage = (i) => { const bv = J.bufferViews[J.images[i].bufferView]; return Buffer.from(BIN.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); };

const VRM = J.extensions.VRM;
const MP = VRM.materialProperties;
const matName = (m) => J.materials[m].name;

// ---------- load meshes into editable form ----------
const meshes = J.meshes.map((me) => {
  const p0 = me.primitives[0];
  const attrs = {}; for (const [k, i] of Object.entries(p0.attributes)) if (k !== 'TANGENT') attrs[k] = readAcc(i);
  const targets = (p0.targets ?? []).map((t) => { const o = {}; for (const [k, i] of Object.entries(t)) o[k] = readAcc(i); return o; });
  const prims = me.primitives.map((p) => ({ idx: Uint32Array.from(readAcc(p.indices).arr), mat: p.material }));
  return { name: me.name, attrs, targets, prims, targetNames: me.extras?.targetNames ?? p0.extras?.targetNames ?? [], vcount: attrs.POSITION.arr.length / 3 };
});
const triCount = () => meshes.reduce((s, m) => s + m.prims.reduce((t, p) => t + p.idx.length / 3, 0), 0);
log('tris in', triCount());
const meshByName = (re) => meshes.find((m) => re.test(m.name));
const face = meshByName(/^Face/), body = meshByName(/^Body/), hair = meshByName(/^Hair/);

// ---------- 1. hidden skin under tight cloth ----------
{
  const P = body.attrs.POSITION.arr;
  const skin = body.prims.find((p) => /Body_00_SKIN/.test(matName(p.mat)));
  const cloth = body.prims.filter((p) => /CLOTH/.test(matName(p.mat)));
  const ci = []; for (const p of cloth) ci.push(...p.idx);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(P), 3)); g.setIndex(ci);
  const bvh = new MeshBVH(g);
  const keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), ctr = new THREE.Vector3();
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), d = new THREE.Vector3();
  const ray = new THREE.Ray();
  const MAXD = opt('skinDist', 0.035);
  let removed = 0;
  for (let k = 0; k < skin.idx.length; k += 3) {
    a.fromArray(P, skin.idx[k] * 3); b.fromArray(P, skin.idx[k + 1] * 3); c.fromArray(P, skin.idx[k + 2] * 3);
    n.subVectors(c, b).cross(t1.subVectors(a, b)).normalize();
    ctr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    t1.set(0, 1, 0); if (Math.abs(n.y) > 0.9) t1.set(1, 0, 0); t1.cross(n).normalize(); t2.crossVectors(n, t1);
    // all of: the normal and 8 directions tilted 40 deg must hit cloth within MAXD (both orientations, the winding is not trusted)
    let hidden = true;
    for (const sgn of [1]) {
      const dirs = [[0, 0]]; for (let q = 0; q < 8; q++) dirs.push([Math.cos(q * Math.PI / 4), Math.sin(q * Math.PI / 4)]);
      for (const [u, v] of dirs) {
        d.copy(n).multiplyScalar(sgn).addScaledVector(t1, u * 0.84).addScaledVector(t2, v * 0.84).normalize();
        ray.origin.copy(ctr).addScaledVector(n, 0.0005 * sgn); ray.direction.copy(d);
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, MAXD);
        if (!hit) { hidden = false; break; }
      }
    }
    // the triangle's outward normal could be reversed; also test from the vertices (a corner peeking out keeps the tri)
    if (hidden) {
      for (const vtx of [a, b, c]) {
        ray.origin.copy(vtx).addScaledVector(n, 0.0005); ray.direction.copy(n);
        if (!bvh.raycastFirst(ray, THREE.DoubleSide, 0, MAXD)) { hidden = false; break; }
      }
    }
    if (hidden) removed++; else keep.push(skin.idx[k], skin.idx[k + 1], skin.idx[k + 2]);
  }
  log(`hidden skin removed ${removed}/${skin.idx.length / 3}`);
  skin.idx = Uint32Array.from(keep);
}

// ---------- 2. simplify hair ----------
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;
{
  const P = hair.attrs.POSITION.arr, UV = hair.attrs.TEXCOORD_0.arr, N = hair.attrs.NORMAL.arr;
  const attr = new Float32Array(hair.vcount * 5);
  for (let v = 0; v < hair.vcount; v++) { attr[v * 5] = UV[v * 2]; attr[v * 5 + 1] = UV[v * 2 + 1]; attr[v * 5 + 2] = N[v * 3] ; attr[v * 5 + 3] = N[v * 3 + 1]; attr[v * 5 + 4] = N[v * 3 + 2]; }
  for (const p of hair.prims) {
    const before = p.idx.length / 3;
    const target = Math.floor(p.idx.length * HAIR_RATIO / 3) * 3;
    const [res, err] = MeshoptSimplifier.simplifyWithAttributes(p.idx, P, 3, attr, 5, [0.5, 0.5, 0.05, 0.05, 0.05], null, target, opt('hairErr', 0.02), []);
    p.idx = Uint32Array.from(res);
    log(`hair ${matName(p.mat)}: ${before} -> ${p.idx.length / 3} (err ${(err * MeshoptSimplifier.getScale(P, 3) * 100).toFixed(2)} cm)`);
  }
}

// ---------- 3. morph targets: keep the bound ones + the ones our custom expressions use ----------
const CUSTOM = {
  // custom expressions used by the game (VRM0 'unknown' preset -> three-vrm custom expression by name)
  mouthSmile: { Fcl_MTH_Fun: 100 },
  mouthGrin: { Fcl_MTH_Joy: 100 },
  mouthSmall: { Fcl_MTH_Small: 100 },
  mouthOpen: { Fcl_MTH_Surprised: 100 },
  browFocus: { Fcl_BRW_Angry: 100 },
  browUp: { Fcl_BRW_Surprised: 100 },
  browSoft: { Fcl_BRW_Fun: 100 },
  eyeSmile: { Fcl_EYE_Fun: 100 },
  eyeWide: { Fcl_EYE_Surprised: 100 },
  eyeFocus: { Fcl_EYE_Angry: 100 },
  fang: { Fcl_MTH_SkinFung: 100 },
};
{
  const fi = meshes.indexOf(face);
  const groups = VRM.blendShapeMaster.blendShapeGroups;
  for (const [name, binds] of Object.entries(CUSTOM)) {
    const bl = Object.entries(binds).map(([tn, w]) => ({ mesh: fi, index: face.targetNames.indexOf(tn), weight: w })).filter((x) => x.index >= 0);
    if (bl.length) groups.push({ name, presetName: 'unknown', binds: bl, materialValues: [], isBinary: false });
  }
  const used = [...new Set(groups.flatMap((g) => g.binds.filter((b) => b.mesh === fi).map((b) => b.index)))].sort((x, y) => x - y);
  const remap = new Map(used.map((o, nIdx) => [o, nIdx]));
  for (const g of groups) for (const b of g.binds) if (b.mesh === fi) b.index = remap.get(b.index);
  face.targets = used.map((o) => face.targets[o]);
  face.targetNames = used.map((o) => face.targetNames[o]);
  log(`morphs kept ${used.length}/57`);
}

// ---------- texture helpers ----------
const texOf = (m, key) => { const t = MP[m].textureProperties[key]; return t === undefined ? null : J.textures[t].source; };
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const LUT = new Float32Array(256).map((_, i) => srgbToLin(i / 255));
async function rawImage(img) { const { data, info } = await sharp(readImage(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
/** Crop a region of an image (pixel rect), multiply by a linear colour factor, scale to w x h; returns raw RGBA. */
async function region(img, rect, factor, w, h) {
  const src = img === null ? { data: Buffer.alloc(4 * 4, 0), w: 2, h: 2 } : await rawImage(img);
  const sx = Math.max(0, Math.floor(rect[0] * src.w)), sy = Math.max(0, Math.floor(rect[1] * src.h));
  const ex = Math.min(src.w, Math.ceil(rect[2] * src.w)), ey = Math.min(src.h, Math.ceil(rect[3] * src.h));
  let s = sharp(src.data, { raw: { width: src.w, height: src.h, channels: 4 } }).extract({ left: sx, top: sy, width: Math.max(1, ex - sx), height: Math.max(1, ey - sy) }).resize(w, h, { fit: 'fill', kernel: 'lanczos3' });
  const { data } = await s.raw().toBuffer({ resolveWithObject: true });
  if (factor && factor.some((f, i) => i < 3 && Math.abs(f - 1) > 1e-3)) {
    for (let p = 0; p < data.length; p += 4) for (let ch = 0; ch < 3; ch++) data[p + ch] = Math.round(255 * linToSrgb(Math.min(1, LUT[data[p + ch]] * factor[ch])));
  }
  return data;
}

// ---------- 4. atlas groups ----------
const newImages = []; // { png/webp buffer, name }
const atlasMats = []; // new merged materials: {name, props, gltf}
async function atlasGroup(mesh, label, size, withEmission) {
  const P = mesh.prims.filter((p) => p.idx.length);
  const UV = mesh.attrs.TEXCOORD_0.arr;
  // per material UV bounds (wrap ignored: VRoid UVs are in 0..1)
  const rects = P.map((p) => {
    let u0 = 1, v0 = 1, u1 = 0, v1 = 0;
    for (const i of p.idx) { const u = UV[i * 2], v = UV[i * 2 + 1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const img = texOf(p.mat, '_MainTex');
    const meta = img === null ? { width: 64, height: 64 } : null;
    return { p, u0: Math.max(0, u0 - 0.004), v0: Math.max(0, v0 - 0.004), u1: Math.min(1, u1 + 0.004), v1: Math.min(1, v1 + 0.004), img, meta };
  });
  for (const r of rects) { if (r.img !== null) { const m = await sharp(readImage(r.img)).metadata(); r.meta = m; } r.pw = (r.u1 - r.u0) * r.meta.width; r.ph = (r.v1 - r.v0) * r.meta.height; }
  // shelf pack at scale s; binary search the largest s <= 1 that fits
  const PAD = 6;
  const pack = (s) => {
    const items = rects.map((r, i) => ({ i, w: Math.max(4, Math.ceil(r.pw * s)), h: Math.max(4, Math.ceil(r.ph * s)) })).sort((x, y) => y.h - x.h);
    let x = 0, y = 0, rowH = 0; const pos = [];
    for (const it of items) {
      if (it.w + PAD > size) return null;
      if (x + it.w + PAD > size) { x = 0; y += rowH + PAD; rowH = 0; }
      if (y + it.h + PAD > size) return null;
      pos[it.i] = { x: x + PAD / 2, y: y + PAD / 2, w: it.w, h: it.h }; x += it.w + PAD; rowH = Math.max(rowH, it.h);
    }
    return pos;
  };
  let lo = 0.05, hi = 1, best = pack(lo);
  for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; const r = pack(mid); if (r) { best = r; lo = mid; } else hi = mid; }
  log(`${label} atlas ${size}: scale ${lo.toFixed(3)} for ${rects.length} materials`);
  const layers = { main: Buffer.alloc(size * size * 4, 0), emis: withEmission ? Buffer.alloc(size * size * 4, 0) : null };
  const blit = (dst, data, ps) => { for (let yy = 0; yy < ps.h; yy++) data.copy(dst, ((ps.y + yy) * size + ps.x) * 4, yy * ps.w * 4, (yy + 1) * ps.w * 4); };
  // the shade texture is the (colour-baked) main texture; the shade colour becomes one area-weighted factor
  const shadeAcc = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i], ps = best[i], m = r.p.mat, vp = MP[m].vectorProperties;
    const rect = [r.u0, r.v0, r.u1, r.v1];
    const col = vp._Color ?? [1, 1, 1, 1], sh = vp._ShadeColor ?? [1, 1, 1, 1], em = vp._EmissionColor ?? [0, 0, 0, 1];
    blit(layers.main, await region(r.img, rect, col, ps.w, ps.h), ps);
    shadeAcc.push([sh, ps.w * ps.h]);
    if (withEmission) {
      const ei = texOf(m, '_EmissionMap');
      const black = em.slice(0, 3).every((v) => v < 1e-3);
      if (ei !== null && !black) blit(layers.emis, await region(ei, rect, em, ps.w, ps.h), ps);
    }
    // remap the UVs of this material's vertices (duplicate any vertex shared with another material first)
    r.ps = ps;
  }
  // vertex ownership
  const owner = new Int32Array(mesh.vcount).fill(-1);
  const dup = [];
  for (let i = 0; i < rects.length; i++) {
    const idx = rects[i].p.idx;
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k];
      if (owner[v] === -1 || owner[v] === i) { owner[v] = i; continue; }
      // shared with another material: clone
      const key = v + ':' + i; let nv = dup.find((d) => d.key === key)?.nv;
      if (nv === undefined) { nv = mesh.vcount + dup.length; dup.push({ key, src: v, nv, owner: i }); }
      idx[k] = nv;
    }
  }
  if (dup.length) {
    log(`${label}: duplicated ${dup.length} shared verts`);
    const grow = (A) => { const out = new A.arr.constructor((mesh.vcount + dup.length) * A.n); out.set(A.arr); for (const d of dup) for (let c = 0; c < A.n; c++) out[d.nv * A.n + c] = A.arr[d.src * A.n + c]; A.arr = out; };
    for (const A of Object.values(mesh.attrs)) grow(A); for (const t of mesh.targets) for (const A of Object.values(t)) grow(A);
    const o2 = new Int32Array(mesh.vcount + dup.length); o2.set(owner); for (const d of dup) o2[d.nv] = d.owner;
    mesh.vcount += dup.length;
    owner.set; // eslint
    var ownerAll = o2;
  } else var ownerAll = owner;
  const U = mesh.attrs.TEXCOORD_0.arr;
  for (let v = 0; v < mesh.vcount; v++) {
    const o = ownerAll[v]; if (o < 0) continue; const r = rects[o];
    const u = (U[v * 2] - r.u0) / (r.u1 - r.u0), w = (U[v * 2 + 1] - r.v0) / (r.v1 - r.v0);
    U[v * 2] = (r.ps.x + u * r.ps.w) / size; U[v * 2 + 1] = (r.ps.y + w * r.ps.h) / size;
  }
  // dilate (4 passes) so the padding gets the neighbouring colour
  for (const L of Object.values(layers)) if (L) dilate(L, size, 4);
  const enc = async (buf, alpha) => sharp(buf, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: WEBP_Q, alphaQuality: 90, effort: 6, ...(alpha ? {} : {}) }).toBuffer();
  const mainI = newImages.push({ name: `${label}_main`, data: await enc(layers.main) }) - 1;
  const shadeI = mainI;
  const tot = shadeAcc.reduce((s, [, a]) => s + a, 0);
  const shadeAvg = [0, 1, 2].map((c) => shadeAcc.reduce((s, [col, a]) => s + col[c] * a, 0) / tot).concat(1);
  const emisI = layers.emis ? newImages.push({ name: `${label}_emission`, data: await enc(layers.emis) }) - 1 : -1;
  // merged material: params of the first material, colours baked to white
  const base = JSON.parse(JSON.stringify(MP[rects[0].p.mat]));
  base.name = `Ao_${label}`;
  base.textureProperties = { _MainTex: { img: mainI }, _ShadeTexture: { img: shadeI }, ...(emisI >= 0 ? { _EmissionMap: { img: emisI } } : {}) };
  base.vectorProperties._Color = [1, 1, 1, 1]; base.vectorProperties._ShadeColor = shadeAvg;
  base.vectorProperties._EmissionColor = emisI >= 0 ? [1, 1, 1, 1] : [0, 0, 0, 1];
  for (const k of ['_MainTex', '_ShadeTexture', '_EmissionMap', '_BumpMap', '_SphereAdd']) if (base.vectorProperties[k]) base.vectorProperties[k] = [0, 0, 1, 1];
  delete base.keywordMap._NORMALMAP;
  base.floatProperties._CullMode = 0;
  const mi = atlasMats.push({ props: base, gltf: { name: base.name, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true } }) - 1;
  const all = []; for (const r of rects) all.push(...r.p.idx);
  mesh.prims = [{ idx: Uint32Array.from(all), mat: { atlas: mi } }];
}
function dilate(buf, size, passes) {
  for (let p = 0; p < passes; p++) {
    const src = Buffer.from(buf);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4; if (src[o + 3] > 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const q = (yy * size + xx) * 4; if (src[q + 3] > 0) { buf[o] = src[q]; buf[o + 1] = src[q + 1]; buf[o + 2] = src[q + 2]; buf[o + 3] = 0; break; }
      }
    }
  }
}
// note: dilated texels keep alpha 0 (cutout stays exact) but carry colour, so bilinear edges do not go dark
await atlasGroup(body, 'body', ATLAS, false);
await atlasGroup(hair, 'hair', HAIR_ATLAS, true);
log('tris out', triCount());

// ---------- compact vertices ----------
for (const m of meshes) {
  const used = new Int32Array(m.vcount).fill(-1); let n = 0;
  for (const p of m.prims) for (const v of p.idx) if (used[v] < 0) used[v] = n++;
  for (const p of m.prims) for (let k = 0; k < p.idx.length; k++) p.idx[k] = used[p.idx[k]];
  const shrink = (A) => { const out = new A.arr.constructor(n * A.n); for (let v = 0; v < m.vcount; v++) if (used[v] >= 0) for (let c = 0; c < A.n; c++) out[used[v] * A.n + c] = A.arr[v * A.n + c]; A.arr = out; };
  for (const A of Object.values(m.attrs)) shrink(A); for (const t of m.targets) for (const A of Object.values(t)) shrink(A);
  log(`${m.name}: verts ${m.vcount} -> ${n}`); m.vcount = n;
}

// ---------- face textures (kept per material, WebP, capped) + material table ----------
const imgMap = new Map(); // old image -> new image index
async function keepImage(old, maxSide) {
  const key = old + ':' + maxSide; if (imgMap.has(key)) return imgMap.get(key);
  const meta = await sharp(readImage(old)).metadata();
  const s = Math.min(1, maxSide / Math.max(meta.width, meta.height));
  const data = await sharp(readImage(old)).resize(Math.round(meta.width * s), Math.round(meta.height * s), { kernel: 'lanczos3' }).webp({ quality: WEBP_Q + 4, alphaQuality: 95, effort: 6 }).toBuffer();
  const i = newImages.push({ name: J.images[old].name, data }) - 1; imgMap.set(key, i); return i;
}
const outMats = [], outProps = [];
const matRemap = new Map();
for (const p of face.prims) {
  if (matRemap.has(p.mat)) continue;
  const props = JSON.parse(JSON.stringify(MP[p.mat]));
  const tp = {};
  for (const [k, t] of Object.entries(props.textureProperties)) {
    if (k === '_BumpMap') continue; // normal maps dropped
    const old = J.textures[t].source;
    tp[k] = { img: await keepImage(old, k === '_OutlineWidthTexture' ? 256 : FACE_MAX) };
  }
  props.textureProperties = tp; delete props.keywordMap._NORMALMAP;
  const g = J.materials[p.mat];
  matRemap.set(p.mat, outMats.length);
  outMats.push({ name: g.name, alphaMode: g.alphaMode, ...(g.alphaCutoff !== undefined ? { alphaCutoff: g.alphaCutoff } : {}), doubleSided: !!g.doubleSided }); outProps.push(props);
}
for (const p of face.prims) p.mat = matRemap.get(p.mat);
for (const m of [body, hair]) for (const p of m.prims) { const a = atlasMats[p.mat.atlas]; p.mat = outMats.length; outMats.push(a.gltf); outProps.push(a.props); }
// textures: one per (image) with the webp extension; material props point at texture indices
const textures = newImages.map((_, i) => ({ sampler: 0, extensions: { EXT_texture_webp: { source: i } } }));
for (const pr of outProps) for (const k of Object.keys(pr.textureProperties)) pr.textureProperties[k] = pr.textureProperties[k].img;
for (let i = 0; i < outMats.length; i++) { const mt = outProps[i].textureProperties._MainTex; outMats[i].pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], ...(mt !== undefined ? { baseColorTexture: { index: mt } } : {}), metallicFactor: 0, roughnessFactor: 1 }; outMats[i].extensions = { KHR_materials_unlit: {} }; }

// ---------- write: accessors + meshopt-compressed buffer views ----------
await MeshoptEncoder.ready;
const chunks = []; let binLen = 0; // buffer 0 (GLB BIN): compressed geometry + images
const fbLen = { v: 0 }; // buffer 1: meshopt fallback (virtual)
const bufferViews = [], accessors = [];
const align4 = (n) => (n + 3) & ~3;
function pushBin(u8) { const off = binLen; chunks.push(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)); binLen += u8.byteLength; const pad = align4(binLen) - binLen; if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; } return off; }
function addView(u8, count, stride, mode) {
  const enc = MeshoptEncoder.encodeGltfBuffer(u8, count, stride, mode);
  const off = pushBin(enc);
  const fo = fbLen.v; fbLen.v = align4(fbLen.v + u8.byteLength);
  return bufferViews.push({ buffer: 1, byteOffset: fo, byteLength: u8.byteLength, ...(mode === 'ATTRIBUTES' && stride % 4 === 0 && count > 0 && !(mode === 'ATTRIBUTES' && false) ? {} : {}), extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: off, byteLength: enc.byteLength, byteStride: stride, count, mode } } }) - 1;
}
const TYPE = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4' };
function addAccessor(A, { minmax = false, target } = {}) {
  let arr = A.arr, ct = A.ct;
  const count = arr.length / A.n;
  const elt = arr.BYTES_PER_ELEMENT * A.n;
  let u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  if (elt % 4 !== 0) { // pad (e.g. u16 vec3) -- not needed for VRoid data
    throw new Error('stride not multiple of 4');
  }
  const bv = addView(u8, count, elt, 'ATTRIBUTES');
  if (target) bufferViews[bv].target = target;
  const acc = { bufferView: bv, componentType: ct, count, type: TYPE[A.n], ...(A.normalized ? { normalized: true } : {}) };
  if (minmax) { const mn = Array(A.n).fill(Infinity), mx = Array(A.n).fill(-Infinity); for (let i = 0; i < count; i++) for (let c = 0; c < A.n; c++) { mn[c] = Math.min(mn[c], arr[i * A.n + c]); mx[c] = Math.max(mx[c], arr[i * A.n + c]); } acc.min = mn; acc.max = mx; }
  return accessors.push(acc) - 1;
}
function addIndices(idx, vcount) {
  const arr = vcount < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);
  const u8 = new Uint8Array(arr.buffer);
  const bv = addView(u8, arr.length, arr.BYTES_PER_ELEMENT, 'TRIANGLES');
  bufferViews[bv].target = 34963;
  return accessors.push({ bufferView: bv, componentType: arr.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, count: arr.length, type: 'SCALAR' }) - 1;
}
// meshoptimizer reorder for better compression: vertex fetch order per mesh
for (const m of meshes) {
  const all = new Uint32Array(m.prims.reduce((s, p) => s + p.idx.length, 0)); let o = 0; for (const p of m.prims) { all.set(p.idx, o); o += p.idx.length; }
  const [remap, unique] = MeshoptEncoder.reorderMesh(all, false, false);
  // reorderMesh(triangles=false) rewrote `all` in place; copy back per primitive
  o = 0; for (const p of m.prims) { p.idx = all.slice(o, o + p.idx.length); o += p.idx.length; }
  const re = (A) => { const out = new A.arr.constructor(unique * A.n); for (let v = 0; v < m.vcount; v++) { const nv = remap[v]; if (nv === 0xffffffff) continue; for (let c = 0; c < A.n; c++) out[nv * A.n + c] = A.arr[v * A.n + c]; } A.arr = out; };
  for (const A of Object.values(m.attrs)) re(A); for (const t of m.targets) for (const A of Object.values(t)) re(A);
  m.vcount = unique;
}
const outMeshes = meshes.map((m, mi) => {
  const attributes = {};
  for (const [k, A] of Object.entries(m.attrs)) attributes[k] = addAccessor(A, { minmax: k === 'POSITION', target: 34962 });
  const targets = m.targets.map((t) => { const o = {}; for (const [k, A] of Object.entries(t)) o[k] = addAccessor(A, { minmax: k === 'POSITION', target: 34962 }); return o; });
  const primitives = m.prims.filter((p) => p.idx.length).map((p) => ({ attributes, indices: addIndices(p.idx, m.vcount), material: p.mat, mode: 4, ...(targets.length ? { targets, extras: { targetNames: m.targetNames } } : {}) }));
  return { name: J.meshes[mi].name, primitives, ...(targets.length ? { weights: m.targetNames.map(() => 0), extras: { targetNames: m.targetNames } } : {}) };
});
// skins: inverse bind matrices
const skins = J.skins.map((s) => ({ ...s, inverseBindMatrices: addAccessor(readAcc(s.inverseBindMatrices)) }));
// images (uncompressed, in buffer 0)
const images = newImages.map((im) => { const off = pushBin(new Uint8Array(im.data)); return { name: im.name, mimeType: 'image/webp', bufferView: bufferViews.push({ buffer: 0, byteOffset: off, byteLength: im.data.length }) - 1 }; });

const out = {
  ...J,
  extensionsUsed: [...new Set([...(J.extensionsUsed || []).filter((e) => e !== 'KHR_texture_transform'), 'EXT_meshopt_compression', 'EXT_texture_webp'])],
  extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp'],
  accessors, bufferViews, meshes: outMeshes, skins, images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], materials: outMats,
  buffers: [{ byteLength: binLen }, { byteLength: fbLen.v, extensions: { EXT_meshopt_compression: { fallback: true } } }],
};
out.extensions.VRM.materialProperties = outProps;
out.extensions.VRM.meta.texture = -1;
out.extensions.VRM.meta.title = (out.extensions.VRM.meta.title || '') + ' (Icarus web build)';
out.asset = { ...J.asset, generator: (J.asset.generator || '') + ' + icarus optimize-vrm' };
const jsonBuf = Buffer.from(JSON.stringify(out)); const jpad = align4(jsonBuf.length) - jsonBuf.length;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
const binChunk = Buffer.concat(chunks);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
fs.writeFileSync(OUT, Buffer.concat([header, ch(jsonChunk.length, 0x4e4f534a), jsonChunk, ch(binChunk.length, 0x004e4942), binChunk]));
const imgBytes = newImages.reduce((s, i) => s + i.data.length, 0);
log(`wrote ${OUT}: ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB (images ${(imgBytes / 1048576).toFixed(2)} MB, geometry ${((binLen - imgBytes) / 1048576).toFixed(2)} MB), tris ${triCount()}, materials ${outMats.length}`);
