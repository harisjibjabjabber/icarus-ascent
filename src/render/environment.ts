import * as THREE from 'three';
import { mulberry32 } from '../rng';
import { toon, ART_UNIFORMS } from './materials';
import { toScene, toSceneRaw, ORIGIN, ROUTE_DIR, ROUTE_RIGHT, ROUTE_YAW } from './space';
import { GeoBuilder, blob } from './geo';
import type { Quality } from './quality';
import { Kit, townMaterial, TOWN_DETAIL, TOWN_TEX, TEX_WRAP, detailArray, type TownMaterial } from './town/kit';
import { buildTownChunk, TOWN, TOWN_LOD as TOWN_GEO, type GroundFn, type ChunkOpts } from './town/town';

/**
 * Environment: the witch town (Kiki-style seaside town on a hill). Layers, back to front:
 *  - sky dome (gradient) + a painted sky/sea panorama band (camera-anchored, i.e. at infinity);
 *  - a painted far-town layer on the hill to the left (slow parallax);
 *  - a shader sea far below that fades into the painted sea;
 *  - distant hillside town blocks (impostor LOD, one merged mesh per 200 m segment);
 *  - the near town: premade kit pieces merged per 40 m chunk, with a near and a far LOD (src/render/town).
 * Draw calls: sky 1-2, layers 1, sea 1, clouds 1 (instanced), ~8 far segments, ~8 town chunks.
 */
export const ENV_STYLE = {
  skyTop: '#4f93d0',
  skyMid: '#86b8e0',
  skyHorizon: '#dbe9ef',
  skyBelow: '#9ccbd2',
  sunGlow: '#fff4d8',
  sunSky: new THREE.Vector3(-0.42, 0.3, -1),
  fog: '#d9e7ee',
  fogNear: 70,
  fogFar: 520,
  hemiSky: '#fff3e2',
  hemiGround: '#b4a6c6',
  hemiIntensity: 1.2,
  sun: '#ffe2b8',
  sunIntensity: 2.5,
  sunFrom: new THREE.Vector3(-0.62, 0.7, -0.18),
  cloudLit: '#ffffff',
  cloudShade: '#c8c4e2',
  sea: '#2fa6b2', seaDeep: '#1f7f99', seaFoam: '#e8fbff',
  hill: '#b9b27a', hillTop: '#d3c98e', cypress: '#3f6a45', cypressTop: '#5f8a55', olive: '#93a87a', oliveTop: '#b8c99a', trunk: '#7a5e48',
  blockRoof: '#cf6f45', blockRoofTop: '#e88a58', blockWall: ['#f6ead8', '#f2dcc2', '#efe3e0', '#fbf0d6', '#e6ece4'],
  /** Painted panorama band: horizontal arc (deg) centred on the route direction; horizon height in the image (0 = top). */
  panoArc: 74, panoHorizon: 0.565,
};

/** Texture loads in flight (Environment.ready waits for them; each loaded texture is pre-uploaded to the GPU). */
const PENDING: Promise<THREE.Texture | null>[] = [];
const loadTex = (url: string, cb?: (t: THREE.Texture) => void): THREE.Texture | null => {
  if (typeof document === 'undefined') return null;
  let done: (t: THREE.Texture | null) => void = () => {};
  PENDING.push(new Promise((r) => { done = r; }));
  const t = new THREE.TextureLoader().load(url, (tx) => { cb?.(tx); done(tx); }, undefined, () => done(null));
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = TEX_ANISO.value; TEX_ANISO.list.push(t);
  return t;
};
const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || './';

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(ENV_STYLE.skyTop) }, mid: { value: new THREE.Color(ENV_STYLE.skyMid) },
      horizon: { value: new THREE.Color(ENV_STYLE.skyHorizon) }, below: { value: new THREE.Color(ENV_STYLE.skyBelow) },
      glow: { value: new THREE.Color(ENV_STYLE.sunGlow) }, sunDir: { value: ENV_STYLE.sunSky.clone().normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, mix(mid, top, smoothstep(0.15, 0.6, h)), smoothstep(0.0, 0.2, h)) : mix(horizon, below, smoothstep(0.0, 0.08, -h));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (pow(s, 8.0) * 0.25 + pow(s, 80.0) * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}

/** A painted layer on a vertical cylinder segment around the camera (inside the dome). Edges fade into the sky. */
function paintedBand(url: string, radius: number, arcDeg: number, horizon: number, centre: THREE.Vector3, keyed: boolean, order: number): THREE.Mesh {
  const arc = (arcDeg * Math.PI) / 180, H = radius * arc * (9 / 16);
  const theta0 = Math.atan2(centre.x, centre.z) - arc / 2;
  const g = new THREE.CylinderGeometry(radius, radius, H, 48, 1, true, theta0, arc);
  // image horizon at camera height: shift so that (1 - horizon) of the height is below y = 0
  g.translate(0, H / 2 - horizon * H, 0);
  const tex = loadTex(url);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    uniforms: { map: { value: tex }, keyed: { value: keyed ? 1 : 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float keyed; varying vec2 vUv;
      void main(){
        vec2 uv = vec2(1.0 - vUv.x, vUv.y);
        vec4 c = texture2D(map, uv);
        float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
        float a = (keyed > 0.5 ? c.a : 1.0) * edge * smoothstep(1.0, 0.94, uv.y);
        gl_FragColor = vec4(c.rgb, a);
        #include <colorspace_fragment>
      }`,
  });
  if (!tex) mat.visible = false;
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = order;
  m.frustumCulled = false;
  return m;
}

/** The sea far below: painted-looking teal water with drifting streaks and glints, fading out into the panorama. */
function seaPlane(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    fog: false, transparent: true, depthWrite: true,
    uniforms: {
      uTime: ART_UNIFORMS.uTime, uShift: { value: new THREE.Vector2() },
      sea: { value: new THREE.Color(ENV_STYLE.sea) }, deep: { value: new THREE.Color(ENV_STYLE.seaDeep) }, foam: { value: new THREE.Color(ENV_STYLE.seaFoam) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec2 uShift; uniform vec3 sea; uniform vec3 deep; uniform vec3 foam; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 w = vW.xz + uShift;
        float dist = length(vW.xz - cameraPosition.xz);
        float s = n2(w * vec2(0.02, 0.08) + vec2(uTime * 0.03, 0.0)) * 0.6 + n2(w * vec2(0.05, 0.2) - vec2(0.0, uTime * 0.05)) * 0.4;
        vec3 c = mix(deep, sea, smoothstep(0.25, 0.75, s));
        float g = smoothstep(0.82, 0.9, n2(w * vec2(0.18, 0.6) + uTime * vec2(0.2, 0.05)));
        c = mix(c, foam, g * 0.5 * (1.0 - smoothstep(150.0, 600.0, dist)));
        float a = 1.0 - smoothstep(700.0, 1350.0, dist);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1450, 48), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -50;
  return m;
}

interface TownView { group: THREE.Group; near: THREE.Mesh | null; far: THREE.Mesh | null; nearMat: TownMaterial; farMat: TownMaterial; x0: number; tris: [number, number]; born: number; gen: number }

/**
 * Town LOD/streaming distances (route metres, measured from the rider to a chunk's centre) and fade times.
 * Near detail dithers in between `nearFadeEnd` and `nearFull` ahead; new chunks are built `ahead` metres out and
 * dissolve in over the last `spawnFade` metres (deep in the haze) or `spawnTime` seconds (whichever is later), so
 * nothing swaps or appears in one frame. Behind the camera (< `nearBehind`) the switch back to far is hard: unseen.
 */
export const TOWN_LOD = { behind: 60, ahead: 480, spawnFade: 110, nearFull: 50, nearFadeEnd: 92, nearBehind: -25, spawnTime: 0.7 };
/** Base near-detail distances; high/ultra scale them out (Quality.lodScale) so the dithered LOD blend happens deep in the haze. */
const TOWN_LOD_BASE = { nearFull: TOWN_LOD.nearFull, nearFadeEnd: TOWN_LOD.nearFadeEnd };
/** Anisotropy for every ground/wall texture we own (set per tier). */
export const TEX_ANISO = { value: 4, list: [] as THREE.Texture[] };

/** Dither ranges for a chunk's near and far meshes. `d`: chunk centre minus rider x; `age`: seconds since built. */
export function townFade(d: number, age: number): { near: [number, number]; far: [number, number] } {
  const L = TOWN_LOD, ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const present = Math.min(1 - ss(L.ahead - L.spawnFade, L.ahead - 20, d), Math.min(1, Math.max(0, age / L.spawnTime)));
  const share = d < L.nearBehind ? 0 : 1 - ss(L.nearFull, L.nearFadeEnd, d);
  const cut = present * share;
  return { near: [0, cut], far: [cut, present] };
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private pano: THREE.Mesh;
  private farTown: THREE.Mesh;
  private sunOffset: THREE.Vector3;
  private sea: THREE.Mesh;
  private puffs: THREE.InstancedMesh;
  private puffData: { x: number; lat: number; dy: number; s: number; ph: number }[] = [];
  private seaBase = -60;
  private seaFollow = false;
  private seaY = -60;
  private seed = 0;
  private heightAt: (x: number) => number = () => 0;
  private groundAt: GroundFn = (x) => ({ y: this.heightAt(x), gap: false });
  private townOpts: ChunkOpts = {};
  private segs = new Map<number, THREE.Mesh>();
  private town = new Map<number, TownView>();
  private kit: Kit | null = null;
  private sceneryMat = toon('#ffffff', { vertexColors: true, sway: true, rim: 0.6 });
  static readonly SEG = 200;
  /** Town streaming window: see TOWN_LOD. */
  static readonly TOWN = TOWN_LOD;
  private renderer: THREE.WebGLRenderer | null = null;
  private townShadows = false;
  /** Resolves once the kit and every painted texture have loaded (or failed); see View's load veil. */
  ready: Promise<void> = Promise.resolve();

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.Fog(ENV_STYLE.fog, ENV_STYLE.fogNear, ENV_STYLE.fogFar);
    this.dome = skyDome();
    scene.add(this.dome);
    this.pano = paintedBand(`${BASE}town/sky-sea.webp`, 1400, ENV_STYLE.panoArc, ENV_STYLE.panoHorizon, ROUTE_DIR, false, -90);
    scene.add(this.pano);
    // far town on the hill: left of the route ahead, slightly nearer so it parallaxes against the panorama
    const left = ROUTE_DIR.clone().multiplyScalar(0.8).addScaledVector(ROUTE_RIGHT, -0.6).normalize();
    this.farTown = paintedBand(`${BASE}town/far-town.webp`, 1100, 58, 0.62, left, true, -80);
    scene.add(this.farTown);
    scene.add(new THREE.HemisphereLight(ENV_STYLE.hemiSky, ENV_STYLE.hemiGround, ENV_STYLE.hemiIntensity));
    this.sun = new THREE.DirectionalLight(ENV_STYLE.sun, ENV_STYLE.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 160; // reaches ~45 m ahead: prop shadows appear in the haze, not beside Ao
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.sun.shadow.intensity = 0.85; // painted shade: a touch of bounce light stays in the shadows
    this.sunOffset = ENV_STYLE.sunFrom.clone().normalize().multiplyScalar(60);
    scene.add(this.sun, this.sun.target);
    scene.add(this.group);
    this.sea = seaPlane();
    scene.add(this.sea);
    // a few soft cumulus over the sea far ahead (one instanced draw call)
    this.puffs = new THREE.InstancedMesh(blob(1, 0.15, 0.5), toon(ENV_STYLE.cloudLit, { rim: 1.2 }), 24);
    this.puffs.frustumCulled = false;
    const r = mulberry32(99);
    for (let i = 0; i < this.puffs.count; i++) this.puffData.push({ x: r() * 1400 - 200, lat: 250 + r() * 500, dy: 60 + r() * 120, s: 14 + r() * 30, ph: r() * 6.28 });
    scene.add(this.puffs);
    if (typeof document !== 'undefined' && typeof fetch !== 'undefined') {
      TOWN_DETAIL.tex = loadTex(`${BASE}town/detail.jpg`, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; });
      if (TOWN_DETAIL.tex) { TOWN_DETAIL.tex.colorSpace = THREE.NoColorSpace; TOWN_DETAIL.tex.wrapS = TOWN_DETAIL.tex.wrapT = THREE.RepeatWrapping; }
      (globalThis as unknown as { __townTex?: unknown }).__townTex = TOWN_TEX; // diagnostics (review scripts)
      // hi-fi: the kit's painted textures as one array (colour high-pass + normals); ramps in once uploaded
      PENDING.push(fetch(`${BASE}town/detail-array.webp`).then((r) => r.blob()).then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
        .then((img) => { const t = detailArray(img); t.anisotropy = TEX_ANISO.value; TEX_ANISO.list.push(t); TOWN_TEX.tex.value = t; return t as THREE.Texture; })
        .catch((e) => { console.warn('town textures failed to load', e); return null; }));
      const kit = Kit.load(`${BASE}town/`).then((k) => this.setKit(k)).catch((e) => console.warn('town kit failed to load', e));
      this.ready = Promise.all([kit, ...PENDING.map((p) => p.then((t) => { if (t && this.renderer) this.renderer.initTexture(t); }))]).then(() => {});
    }
  }

  /** Renderer for pre-uploading textures as they arrive (no first-view upload hitch / late texture). */
  prepare(renderer: THREE.WebGLRenderer): void { this.renderer = renderer; }

  /** Use a loaded kit (tests can inject one); rebuilds the town chunks. */
  setKit(k: Kit): void {
    this.kit = k;
    for (const v of this.town.values()) this.dropTown(v);
    this.town.clear();
    this.lastX = NaN;
  }
  get kitReady(): boolean { return !!this.kit; }

  /**
   * Anisotropy for every texture we own, set once at load (before the textures reach the GPU). Changing it later
   * re-uploads each texture (two 4096x2304 panoramas + the texture array), so tier switches never touch it.
   */
  setAnisotropy(a: number): void {
    TEX_ANISO.value = Math.max(1, a);
    for (const t of TEX_ANISO.list) if (t.anisotropy !== TEX_ANISO.value) { t.anisotropy = TEX_ANISO.value; if (t.image) t.needsUpdate = true; }
  }

  applyQuality(q: Quality): void {
    this.sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap > 0 && this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    // softness in world units stays about the same across map sizes (radius is in texels)
    this.sun.shadow.radius = q.shadowSoft;
    const sc = this.sun.shadow.camera, R = q.shadowRange;
    if (sc.right !== R) {
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.far = 100 + R * 2; sc.updateProjectionMatrix();
      this.sunOffset.setLength(Math.max(60, R * 1.2));
      // keep the depth bias about one texel in world units
      this.sun.shadow.normalBias = 0.04 * ((2 * R) / Math.max(1, q.shadowMap)) / (56 / 1024);
    }
    this.townShadows = q.townShadows && q.shadowMap > 0;
    for (const v of this.town.values()) { if (v.near) v.near.castShadow = this.townShadows; if (v.far) v.far.castShadow = this.townShadows; }
    this.puffs.count = Math.min(24, q.puffs);
    TOWN_TEX.enabled = q.textures > 0;
    TOWN_TEX.nrm.value = q.textures > 1 ? 1 : 0;
    TOWN_LOD.nearFull = TOWN_LOD_BASE.nearFull * q.lodScale;
    TOWN_LOD.nearFadeEnd = TOWN_LOD_BASE.nearFadeEnd * q.lodScale;
    if (TOWN_GEO.fullRoofs !== q.fullRoofs) {
      // the other roof set: chunks are rebuilt one per frame by streamScenery (nearest first), not all in this frame
      TOWN_GEO.fullRoofs = q.fullRoofs;
      this.roofGen++;
    }
  }
  /** Bumped when the roof set changes; chunks built under an older value are rebuilt gradually. */
  private roofGen = 0;

  /**
   * `heightAt(x)`: course height near x; `minY`: lowest course point for static courses (the sea sits below it).
   * `follow`: endless courses — the sea tracks the rider. `groundAt`: street level + gap flag; `opts`: harbour etc.
   */
  buildScenery(seed: number, _length: number, heightAt: (x: number) => number = () => 0, minY = 0, follow = false, groundAt?: GroundFn, opts: ChunkOpts = {}): void {
    for (const g of this.segs.values()) { this.group.remove(g); g.geometry.dispose(); }
    this.segs.clear();
    for (const v of this.town.values()) this.dropTown(v);
    this.town.clear();
    this.seed = seed;
    this.heightAt = heightAt;
    this.groundAt = groundAt ?? ((x) => ({ y: heightAt(x), gap: false }));
    this.townOpts = opts;
    this.seaFollow = follow;
    this.seaBase = follow ? Infinity : minY - 9;
    this.seaY = follow ? heightAt(0) - 45 : this.seaBase;
    this.sea.position.y = this.seaY;
    this.lastX = NaN;
  }

  private lastX = NaN;
  /** Stream scenery around route x (deterministic per seed): far segments (200 m) and town chunks (40 m). */
  streamScenery(x: number, maxX = Infinity): void {
    const S = Environment.SEG;
    const lo = Math.floor((x - 300) / S), hi = Math.floor((Math.min(x + 1300, maxX) - S) / S);
    for (const [k, g] of this.segs) if (k < lo || k > hi) { this.group.remove(g); g.geometry.dispose(); this.segs.delete(k); }
    for (let k = lo; k <= hi; k++) if (!this.segs.has(k)) { const g = this.buildSegment(k); if (g) { this.segs.set(k, g); this.group.add(g); } }
    // town chunks: at most one new chunk per call (spreads the merge cost over frames)
    if (!this.kit) return;
    const L = TOWN.chunk, T = Environment.TOWN;
    const tlo = Math.floor((x - T.behind) / L), thi = Math.floor((Math.min(x + T.ahead, maxX + 20)) / L);
    for (const [k, v] of this.town) if (k < tlo || k > thi) { this.dropTown(v); this.town.delete(k); }
    let built = 0;
    const order: number[] = [];
    for (let k = tlo; k <= thi; k++) if (!this.town.has(k)) order.push(k);
    order.sort((a, b) => Math.abs(a * L + L / 2 - x) - Math.abs(b * L + L / 2 - x));
    const first = Number.isNaN(this.lastX);
    for (const k of order) {
      if (built >= (first ? 99 : 1)) break;
      this.town.set(k, this.buildTown(k)); built++;
    }
    if (built === 0) {
      // roof set changed (tier switch): swap one stale chunk per call, nearest first, keeping its age (no re-dissolve)
      let stale: number | null = null, best = Infinity;
      for (const [k, v] of this.town) { const d = Math.abs(k * L + L / 2 - x); if (v.gen !== this.roofGen && d < best) { best = d; stale = k; } }
      if (stale !== null) {
        const old = this.town.get(stale)!, v = this.buildTown(stale);
        v.born = old.born; this.dropTown(old); this.town.set(stale, v);
      }
    }
    this.lastX = x;
  }

  get segmentCount(): number { return this.segs.size; }
  get townChunkCount(): number { return this.town.size; }
  /** Triangles in the visible town LODs (diagnostics). */
  townTris(): number { let t = 0; for (const v of this.town.values()) t += (v.near?.visible ? v.tris[0] : 0) + (v.far?.visible ? v.tris[1] : 0); return t; }

  private buildTown(k: number): TownView {
    const c = buildTownChunk(this.kit!, k, this.seed, this.groundAt, this.townOpts);
    const group = new THREE.Group();
    const nearMat = townMaterial(), farMat = townMaterial();
    const mk = (g: THREE.BufferGeometry | null, mat: TownMaterial) => { if (!g) return null; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = this.townShadows; m.visible = false; group.add(m); return m; };
    const near = mk(c.near, nearMat), far = mk(c.far, farMat);
    group.position.copy(toScene(k * TOWN.chunk, c.y0));
    // chunk origin in origin-free scene space, wrapped: world-projected textures continue seamlessly across chunks
    const o = toSceneRaw(k * TOWN.chunk, c.y0), wrapOf = (v: number) => ((v % TEX_WRAP) + TEX_WRAP) % TEX_WRAP;
    nearMat.wrap.set(wrapOf(o.x), wrapOf(o.y), wrapOf(o.z)); farMat.wrap.copy(nearMat.wrap);
    this.group.add(group);
    return { group, near, far, nearMat, farMat, x0: k * TOWN.chunk, tris: [c.trisNear, c.trisFar], born: ART_UNIFORMS.uTime.value, gen: this.roofGen };
  }
  private dropTown(v: TownView): void { this.group.remove(v.group); v.near?.geometry.dispose(); v.far?.geometry.dispose(); v.nearMat.dispose(); v.farMat.dispose(); }

  /** Opening course: open sea on the right from the harbour on (no hill/blocks standing in the water). */
  private seaRight(x: number): boolean { return this.townOpts.harbourFrom !== undefined && x >= this.townOpts.harbourFrom - 30; }

  /** Distant hillside: impostor blocks (box + hip roof) on terraces rising to the left, a few dropping toward the sea on the right. */
  private buildSegment(k: number): THREE.Mesh | null {
    const S = Environment.SEG, E = ENV_STYLE;
    const b = new GeoBuilder();
    const rng = mulberry32((this.seed ^ 0x5eed ^ Math.imul(k + 1000003, 0x2545f491)) >>> 0);
    const x0 = k * S, x1 = x0 + S;
    // hill ground (left: rises; right: a short slope down to the shore)
    for (let x = x0; x < x1; x += 20) {
      const y = this.heightAt(x + 10);
      for (let r = 0; r < 4; r++) b.add(new THREE.BoxGeometry(20.5, 4, 24), toScene(x + 10, y + r * 6.5 - 0.6, -(32 + r * 22 + 8)), E.hill, { top: E.hillTop, rot: [0, ROUTE_YAW, 0] });
      if (!this.seaRight(x + 10)) b.add(new THREE.BoxGeometry(20.5, 4, 40), toScene(x + 10, y - 5, 46), E.hill, { top: E.hillTop, rot: [0, ROUTE_YAW, 0] });
    }
    for (let x = x0 + rng() * 6; x < x1; x += 5 + rng() * 5) {
      for (let row = 0; row < 5; row++) {
        const side = row < 4 ? -1 : 1;
        const lat = side * (32 + row * 22 + rng() * 14);
        if (side > 0 && (rng() < 0.5 || this.seaRight(x))) continue;
        const ground = this.heightAt(x) + (side < 0 ? 1.5 + row * 6.5 : -3) + rng() * 2;
        const w = 4 + rng() * 4, h = 5 + rng() * 6, d = 4.5 + rng() * 2;
        const p = toScene(x, ground + h / 2 - 1, lat);
        const wall = E.blockWall[Math.floor(rng() * E.blockWall.length)];
        b.add(new THREE.BoxGeometry(w, h, d), p, wall, { top: wall });
        b.add(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.2, 4, 1), [p.x, p.y + h / 2 + 1.1, p.z], E.blockRoof, { top: E.blockRoofTop, rot: [0, Math.PI / 4, 0], scale: [w / Math.max(w, d), 1, d / Math.max(w, d)] });
        if (rng() < 0.18) { const th = 6 + rng() * 5; b.add(new THREE.ConeGeometry(0.9, th, 6, 1), [p.x + w * 0.7, ground + th / 2, p.z], E.cypress, { top: E.cypressTop, sway: 0.6 }); }
      }
    }
    const g = b.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, this.sceneryMat);
    m.frustumCulled = true;
    return m;
  }

  /** Floating origin moved by `delta` (scene space): shift persistent scenery. */
  shift(delta: THREE.Vector3): void {
    for (const g of this.segs.values()) g.position.add(delta);
    for (const v of this.town.values()) v.group.position.add(delta);
    this.seaY += delta.y;
    const u = (this.sea.material as THREE.ShaderMaterial).uniforms.uShift.value as THREE.Vector2; u.x -= delta.x; u.y -= delta.z;
  }

  /** Keep the shadow frustum, sky layers, sea and clouds centred on the action; switch town LODs. */
  follow(focus: THREE.Vector3, cameraPos: THREE.Vector3, routeX = 0, routeY = 0): void {
    // bigger shadow boxes (high/ultra) are centred further ahead: the rider and the street in front get the coverage
    const ahead = Math.max(0, this.sun.shadow.camera.right - 28) * 0.45;
    this.sun.target.position.copy(focus).addScaledVector(ROUTE_DIR, ahead);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.dome.position.copy(cameraPos);
    this.pano.position.copy(cameraPos);
    // the far-town layer sits at a fixed height below the horizon band (it is a hillside, not the horizon)
    this.farTown.position.set(cameraPos.x, cameraPos.y - 40, cameraPos.z);
    if (this.seaFollow) this.seaY += (focus.y - 45 - this.seaY) * 0.02;
    this.sea.position.set(cameraPos.x, this.seaFollow ? this.seaY : this.seaBase - ORIGIN.y, cameraPos.z);
    const now = ART_UNIFORMS.uTime.value;
    for (const v of this.town.values()) {
      const f = townFade(v.x0 + TOWN.chunk / 2 - routeX, now - v.born);
      if (!v.far) f.near[1] = f.far[1]; // no far LOD: near covers it all
      v.nearMat.fade.set(f.near[0], f.near[1]); v.farMat.fade.set(f.far[0], f.far[1]);
      if (v.near) v.near.visible = f.near[1] - f.near[0] > 0.002;
      if (v.far) v.far.visible = f.far[1] - f.far[0] > 0.002;
    }
    // painted detail on the plaster eases in once its texture is on the GPU (never snaps)
    const tex = TOWN_DETAIL.tex, loaded = !!(tex && (tex.image as { width?: number } | undefined)?.width);
    TOWN_DETAIL.strength.value = loaded ? Math.min(1, TOWN_DETAIL.strength.value + 0.04) : 0;
    const arr = TOWN_TEX.tex.value, arrReady = !!(arr && TOWN_TEX.enabled && this.renderer && this.renderer.properties.get(arr) && (this.renderer.properties.get(arr) as { __webglTexture?: unknown }).__webglTexture);
    TOWN_TEX.on.value = arrReady ? Math.min(1, TOWN_TEX.on.value + 0.05) : 0;
    const seaRoute = this.sea.position.y + ORIGIN.y;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const t = ART_UNIFORMS.uTime.value;
    for (let i = 0; i < this.puffs.count; i++) {
      const d = this.puffData[i];
      while (d.x < routeX + 200) d.x += 1400;
      while (d.x > routeX + 1600) d.x -= 1400;
      toScene(d.x, seaRoute + d.dy + Math.sin(t * 0.2 + d.ph) * 2, d.lat, p);
      s.set(d.s * 1.6, d.s * 0.7, d.s);
      m.compose(p, q, s);
      this.puffs.setMatrixAt(i, m);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    void routeY;
  }
}
