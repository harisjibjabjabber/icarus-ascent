import { TEX_ANISO } from './environment';
import * as THREE from 'three';
import { Course, type Bounce, type Chunk, type Obstacle, type Rail, type Surface, type Updraft } from '../course/course';
import { OrbView } from '../course/orbs';
import { toScene, toSceneRaw, ROUTE_DIR, ROUTE_RIGHT, ROUTE_YAW } from './space';
import { loadProps, type PropSet } from './props';
import { townMaterial } from './town/kit';
import type { Vector3 } from 'three';
import { awningRamp, setPieceRamp, toon } from './materials';
import { buildBuntingSpan } from './bunting';
import { setSkyDressingZones, TOWN } from './town/town';
import { SKY_FIXTURE_INTRO } from '../course/skyFixture';
import { overlapsSkyBand } from '../course/sky';
import type { SkySegment, Tuft } from '../course/skyTypes';
import { BalloonCluster } from './sky/balloons';
import { TuftFx } from './sky/tuftFx';
import { buildSkyLine, type SkyPeg } from './sky/skyLines';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder, blob } from './geo';
import { SET_ASSET, poseSoft, type SoftProp } from './setSlots';
import type { PropPiece } from './props';
import { mulberry32 } from '../rng';

/**
 * Course palette (witch town pass): a cobbled street (grey-ochre setts, darker kerbs), terracotta-tiled
 * plazas for the "cloud" surfaces, wrought-iron railings, whitewashed plaster/harbour walls with a
 * terracotta coping and a blue tile band, terracotta flower pots and stacked crates/barrels for the
 * breakables. Gameplay colours (gap lamps, lip lines, required rail/wall tints) keep their contrast.
 */
export const COURSE_STYLE = {
  routeWidth: 3.2,
  cloudTop: '#dcb48a', cloudTopAlt: '#c99a6c', cloudSide: '#c9b19a', cloudPuff: '#ffffff', cloudPuffShade: '#d7c9e8',
  stoneTop: '#bcae9e', stoneTopAlt: '#a99886', stoneTopWarm: '#c4ab8c', stoneCurb: '#8c7c74',
  /** Painted cobble setts (multiplied by the street tint): mortar value and stone size in metres. */
  cobbleMortar: 0.64, cobbleTileU: 2.0, cobbleTileV: 1.6, stoneSide: '#b9a796',
  underside: '#6f6270',
  lipLine: '#4a3f52',
  edgeLine: '#2f7d6d',
  takeoffPost: '#f08a3a',
  receivePost: '#2fb39a',
  postBase: '#3d3a44',
  rail: '#3d3a44', railPost: '#34313b', railRequired: '#ffc44d',
  wall: '#3fa9ad', wallShade: '#2b7f86', wallTrim: '#c96a42', wallFrieze: '#3c6fa8', wallRequired: '#35b3b3', wallRequiredShade: '#23848c',
  wallTile: '#d9f4ee', wallTileEdge: '#f6e7b8', wallCopingShade: '#b8862e',
  wallPlinth: '#a9978a',
  marker: '#5d4f6e',
  pot: '#cf6d3f', potDark: '#a8502c', potBand: '#3c6fa8', potPaint: '#f2d7a8',
  pillar: '#b98552', pillarAlt: '#94653d', pillarCap: '#6e4a2e', pillarBand: '#4a4650',
  flowers: ['#e04b6a', '#f2c14e', '#ffffff', '#b061c9', '#ff7a45'], leaf: '#4f8a3a', leafTop: '#79b04f',
};

const vc = (rim = 1) => mat('#ffffff', { vertexColors: true, rim });

/** Rider lateral while a bounce pad is live (balloon tether point). */
export function bounceRiderLateral(b: Bounce): number {
  return b.lateral;
}
const hash = (a: number, b: number) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

/** Shared materials: streamed chunks reuse them instead of allocating per mesh. */
const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts: { vertexColors?: boolean; side?: THREE.Side; rim?: number; emissive?: string; emissiveIntensity?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}|${opts.vertexColors ? 1 : 0}|${opts.side ?? 0}|${opts.rim ?? 1}|${opts.emissive ?? ''}`;
  let m = matCache.get(key);
  if (!m) { m = toon(color, opts); matCache.set(key, m); }
  return m as THREE.MeshToonMaterial;
}
/**
 * Hand-painted cobblestone setts (procedural canvas, CC0 by construction): rounded stones in offset rows, each with
 * its own value, a soft top-left highlight and a darker rim, on warm mortar. Greyscale so the street tint (vertex
 * colour) decides the palette; one texture for every surface (tileable in both directions).
 */
let _cobble: THREE.Texture | null = null;
/** UV of the first sett's centre (row 0, column 0; canvas y is flipped): a plain stone-coloured texel. */
const COBBLE_PLAIN_UV: [number, number] = [0.5 / 8, 1 - 0.5 / 6];
function cobbleTexture(): THREE.Texture | null {
  if (_cobble || typeof document === 'undefined') return _cobble;
  const S = 1024, c = document.createElement('canvas'); // hi-fi: 1024 (sharp at DPR 3)
  c.width = S; c.height = S;
  const g = c.getContext('2d')!;
  const m = Math.round(COURSE_STYLE.cobbleMortar * 255);
  g.fillStyle = `rgb(${m},${m - 4},${m - 10})`;
  g.fillRect(0, 0, S, S);
  const rng = mulberry32(1337);
  const cols = 8, rows = 6, cw = S / cols, rh = S / rows; // COBBLE_PLAIN_UV assumes these
  const stone = (cx: number, cy: number, w: number, h: number, v: number) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const x = cx + ox, y = cy + oy;
      if (x + w < 0 || x - w > S || y + h < 0 || y - h > S) continue;
      const r = Math.min(w, h) * (0.24 + rng() * 0.14);
      const path = () => { g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, r); };
      path(); g.fillStyle = `rgb(${v * 0.78}, ${v * 0.76}, ${v * 0.74})`; g.fill(); // rim / shadow side
      const gr = g.createRadialGradient(x - w * 0.18, y - h * 0.2, 1, x, y, Math.max(w, h) * 0.62);
      gr.addColorStop(0, `rgb(${Math.min(255, v * 1.08)}, ${Math.min(255, v * 1.07)}, ${Math.min(255, v * 1.04)})`);
      gr.addColorStop(0.75, `rgb(${v}, ${v * 0.99}, ${v * 0.97})`);
      gr.addColorStop(1, `rgb(${v * 0.86}, ${v * 0.84}, ${v * 0.82})`);
      g.save(); g.translate(-w * 0.03, -h * 0.05); path(); g.fillStyle = gr; g.fill(); g.restore();
      // painterly speckles
      for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(${rng() < 0.5 ? '255,250,240' : '60,50,45'},${0.05 + rng() * 0.06})`; g.beginPath(); g.ellipse(x + (rng() - 0.5) * w * 0.6, y + (rng() - 0.5) * h * 0.6, 2 + rng() * 5, 1.5 + rng() * 3, rng() * 3, 0, Math.PI * 2); g.fill(); }
    }
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const cx = (i + 0.5 + (j % 2) * 0.5) * cw + (rng() - 0.5) * cw * 0.1, cy = (j + 0.5) * rh + (rng() - 0.5) * rh * 0.08;
    stone(cx, cy, cw * (0.8 + rng() * 0.14), rh * (0.78 + rng() * 0.12), 196 + rng() * 56);
  }
  // the plain texel for kerbs/sides (COBBLE_PLAIN_UV): flat stone, not a blown-out white band
  g.fillStyle = 'rgb(158,142,128)'; g.beginPath(); g.arc(cw * 0.5, rh * 0.5, 18, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = TEX_ANISO.value; TEX_ANISO.list.push(t);
  _cobble = t;
  return t;
}
function cobbleMat(): THREE.Material {
  let m = matCache.get('cobble');
  if (!m) { const t = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide, rim: 0.6 }); t.map = cobbleTexture(); m = t; matCache.set('cobble', m); }
  return m;
}
function lineMat(color: string): THREE.LineBasicMaterial {
  const key = `line|${color}`;
  let m = matCache.get(key);
  if (!m) { m = new THREE.LineBasicMaterial({ color }); matCache.set(key, m); }
  return m as THREE.LineBasicMaterial;
}

interface ChunkView { chunk: Chunk; group: THREE.Group; pooled: { kind: 'pot' | 'pillar'; obj: THREE.Group }[]; wisps: Wisp[]; glints: THREE.Sprite[]; soft: SoftProp[]; skyTufts: TuftFx[]; skyClusters: BalloonCluster[] }

/** One rising puff. Route metres, parented to its chunk so a rebase carries it. */
interface Wisp {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  x0: number; x1: number; y0: number; y1: number; lat0: number; lat1: number;
  phase: number; speed: number; life: number; spin: number;
  chunkX: number; chunkY: number;
}

/**
 * Builds meshes for a Course chunk by chunk, and streams them: chunks appear as the
 * course generates them and are recycled with them. Geometry inside a chunk is local
 * to the chunk's base point (float32-friendly); the chunk group is placed relative
 * to the floating origin, so a rebase just repositions chunk groups. Obstacle meshes
 * (identical per kind) are pooled; materials are shared.
 */
export class CourseView {
  readonly group = new THREE.Group();
  private views = new Map<number, ChunkView>();
  private obstacleMeshes = new Map<number, THREE.Group>();
  /** Painted CC0 props (high-line rail, beacon). Null until the bake loads. */
  private props: PropSet | null = null;
  private propsGen = 0;
  /** Shared with every high line. */
  private iron = townMaterial();
  /** Pennants on a bunting string. Tips carry a sway weight; the cord and hooks do not. */
  private buntingCloth = toon('#ffffff', { vertexColors: true, sway: true, side: THREE.DoubleSide, rim: 0.85 });
  private beaconGlow = toon('#fff6d4', { vertexColors: true, emissive: '#ff8a2a', emissiveIntensity: 1.15, side: THREE.DoubleSide });
  /**
   * Choice lanterns on the pavement before a risky line. Swing lamps keep beaconGlow.
   * These heads pass close to the chase camera, so a hot emissive turns them into white discs.
   */
  private choiceGlow = toon('#fff1c4', { vertexColors: true, emissive: '#e87830', emissiveIntensity: 0.32, side: THREE.DoubleSide });
  /** Toon steam sheets. One material per puff; the maps are shared. */
  private steamTex: THREE.Texture[] = [];
  private steamTried = false;
  private puffGeo: THREE.PlaneGeometry | null = null;
  private readonly sunWorld = new THREE.Vector3(-0.62, 0.7, -0.18).normalize();
  private readonly sunView = new THREE.Vector3(0.25, 0.78, 0.45);
  /** Atlases: one toon material per map, with the 3-step lavender ramp. */
  private clothMats = new Map<string, THREE.MeshToonMaterial>();
  /** Balloon shells with the floating weight removed. Shares the prop's vertex buffers. */
  private balloonShells = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
  private glints: THREE.Sprite[] = [];
  private now = 0;
  private readonly orbView: OrbView;
  private pool: Record<'pot' | 'pillar', THREE.Group[]> = { pot: [], pillar: [] };
  private bx = 0;
  private by = 0;
  /** Chunk currently being built, so sky art is owned by exactly one chunk. */
  private building: Chunk | null = null;
  private signature = '';
  /** Diagnostics for memory tests: chunks built / disposed, pool sizes. */
  readonly stats = { built: 0, disposed: 0, pooledCreated: 0 };

  /** Local placement inside the chunk being built. */
  private L(x: number, y: number, lat = 0, out?: Vector3): THREE.Vector3 { return toSceneRaw(x - this.bx, y - this.by, lat, out); }

  /** Hide a broken obstacle (debris takes over). */
  setBroken(id: number, broken: boolean): void { const m = this.obstacleMeshes.get(id); if (m) m.visible = !broken; }
  /** An orb was taken. Stays hidden if its chunk is rebuilt. */
  hideOrb(id: number): void { this.orbView.hide(id); }
  resetObstacles(): void { for (const m of this.obstacleMeshes.values()) m.visible = true; }

  constructor(readonly course: Course) {
    this.iron.side = THREE.DoubleSide;
    this.beaconGlow.side = THREE.DoubleSide;
    this.orbView = new OrbView(this.group, course);
    loadProps().then((p) => {
      this.props = p;
      this.propsGen++;
      // Chunks built during the fetch still have the box fallbacks. Dress them again now that the pieces exist.
      for (const v of [...this.views.values()]) this.drop(v);
      this.signature = '';
      this.sync();
      if (typeof window === 'undefined') return;
      const flag = (window as unknown as { icarus?: { props?: boolean } }).icarus;
      if (flag) flag.props = true;
      (window as unknown as { __props?: boolean }).__props = true;
    });
    this.loadSteam();
    this.sync();
  }

  /** One attempt at the steam sheets. A missing file leaves the plume undrawn. */
  private loadSteam(): void {
    if (this.steamTried || this.steamTex.length || typeof document === 'undefined') return;
    this.steamTried = true;
    const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || './';
    const got: THREE.Texture[] = [];
    let pending = SET_ASSET.steam.length;
    const done = () => {
      if (--pending > 0) return;
      if (!got.length) return;
      this.steamTex = got;
      for (const v of [...this.views.values()]) this.drop(v);
      this.signature = '';
      this.sync();
    };
    for (const rel of SET_ASSET.steam) {
      new THREE.TextureLoader().load(base + rel, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        got.push(tex);
        done();
      }, undefined, () => done());
    }
  }

  /** Add meshes for new chunks and recycle those the course dropped. Cheap when nothing changed. */
  sync(): void {
    this.publishSky();
    const cs = this.course.chunks;
    const sig = cs.length ? `${cs[0].id}:${cs[cs.length - 1].id}:${cs.length}:${this.propsGen}` : '';
    if (sig === this.signature) return;
    this.signature = sig;
    const live = new Set(cs.map((c) => c.id));
    for (const [id, v] of this.views) if (!live.has(id)) this.drop(v);
    for (const c of cs) if (!this.views.has(c.id)) this.build(c);
    this.orbView.sync();
  }

  /** Twinkle collectible stars, drift the steam, and pulse hook glints. */
  animate(time: number, cam?: THREE.Camera, screenH = 844): void {
    this.now = time;
    this.orbView.animate(time, cam, screenH);
    if (cam) this.sunView.copy(this.sunWorld).transformDirection(cam.matrixWorldInverse);
    for (const w of this.wisps()) {
      const age = (time + w.phase) % w.life;
      const k = age / w.life;
      const along = Math.min(1, k / 0.35);
      const x = w.x0 + (w.x1 - w.x0) * along + Math.sin(time * 0.35 + w.phase) * 0.22;
      const y = w.y0 + (w.y1 - w.y0) * k;
      const lat = w.lat0 + (w.lat1 - w.lat0) * along + Math.cos(time * 0.28 + w.phase * 1.7) * 0.16;
      w.mesh.position.copy(toSceneRaw(x - w.chunkX, y - w.chunkY, lat));
      if (cam) w.mesh.lookAt(cam.position);
      const size = 1.2 + 1.55 * k;
      w.mesh.scale.set(size * 1.12, size, 1);
      w.mesh.rotateZ(time * (0.18 + w.spin));
      let fade = age < 0.2 ? age / 0.2 : 1;
      if (k > 0.6) fade *= 1 - (k - 0.6) / 0.4;
      w.mat.uniforms.opacity.value = fade;
      w.mat.uniforms.sunDir.value.copy(this.sunView);
    }
    for (const v of this.views.values()) {
      for (const p of v.soft) poseSoft(p, time);
      for (const t of v.skyTufts) t.update(time);
      for (const cl of v.skyClusters) cl.update(time);
    }
    const glint = 0.15 + 0.035 * Math.sin(time * 3.2);
    for (const s of this.glints) s.scale.set(glint, glint, 1);
  }

  /** The canvas, balloon or hull gives under her and springs back. Presentation only. */
  squashPad(id: number): void {
    for (const v of this.views.values()) {
      const p = v.soft.find((s) => s.id === id);
      if (p) { p.hit = this.now; return; }
      const cl = v.skyClusters.find((s) => s.bounceId === id);
      if (cl) { cl.hit = this.now; return; }
    }
  }

  private *wisps(): Generator<Wisp> {
    for (const v of this.views.values()) yield* v.wisps;
  }

  /** The floating origin moved: re-place every chunk. */
  rebase(): void { for (const v of this.views.values()) v.group.position.copy(toScene(v.chunk.x0, v.chunk.y0)); }

  get chunkCount(): number { return this.views.size; }
  get poolSize(): number { return this.pool.pot.length + this.pool.pillar.length; }

  private build(c: Chunk): void {
    const g = new THREE.Group();
    this.bx = c.x0; this.by = c.y0;
    this.building = c;
    const v: ChunkView = { chunk: c, group: g, pooled: [], wisps: [], glints: [], soft: [], skyTufts: [], skyClusters: [] };
    const surfaces = c.surfaces.map((id) => this.course.findSurface(id)).filter((q): q is Surface => !!q);
    const lip: THREE.Vector3[] = [], edge: THREE.Vector3[] = [];
    for (const s of surfaces) { g.add(this.surfaceMesh(s)); this.lipLine(s, lip, edge); }
    for (const [pts, color] of [[lip, COURSE_STYLE.lipLine], [edge, COURSE_STYLE.edgeLine]] as const) if (pts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color)));
    for (const gp of this.course.gaps) if (gp.x0 >= c.x0 - 1e-6 && gp.x0 <= c.x1 + 1e-6) g.add(this.gapPosts(gp.x0, gp.yTakeoff, gp.x1, gp.yReceive));
    for (const id of c.rails) g.add(this.railMesh(this.course.rail(id)));
    for (const id of c.walls) g.add(this.wallMesh(this.course.wall(id)));
    this.dressActivities(c, g, v);
    this.dressSky(c, g, v);
    this.dressShopAwnings(c, g, v);
    if (typeof document !== 'undefined') for (const m of c.markers) g.add(this.marker(m.x, m.label));
    for (const id of c.obstacles) {
      const o = this.course.obstacle(id);
      if (!o) continue;
      const m = this.pool[o.kind].pop() ?? (this.stats.pooledCreated++, this.obstacleMesh(o));
      m.position.copy(this.L(o.x, o.baseY, 0));
      m.visible = true;
      g.add(m);
      v.pooled.push({ kind: o.kind, obj: m });
      this.obstacleMeshes.set(id, m);
    }
    g.position.copy(toScene(c.x0, c.y0));
    this.group.add(g);
    this.views.set(c.id, v);
    this.stats.built++;
  }

  private drop(v: ChunkView): void {
    for (const t of v.skyTufts) t.dispose();
    for (const cl of v.skyClusters) cl.dispose();
    for (const w of v.wisps) {
      w.mesh.removeFromParent();
      w.mat.dispose();
    }
    for (const s of v.glints) {
      s.removeFromParent();
      const i = this.glints.indexOf(s);
      if (i >= 0) this.glints.splice(i, 1);
      (s.material as THREE.Material).dispose();
    }
    for (const p of v.pooled) { v.group.remove(p.obj); p.obj.visible = false; this.pool[p.kind].push(p.obj); }
    for (const id of v.chunk.obstacles) this.obstacleMeshes.delete(id);
    this.group.remove(v.group);
    disposeTree(v.group);
    this.views.delete(v.chunk.id);
    this.stats.disposed++;
  }

  dispose(): void {
    for (const v of [...this.views.values()]) this.drop(v);
    for (const k of ['pot', 'pillar'] as const) for (const m of this.pool[k]) disposeTree(m);
    this.pool = { pot: [], pillar: [] };
    this.orbView.dispose();
    this.iron.dispose();
    this.beaconGlow.dispose();
    this.choiceGlow.dispose();
    for (const t of this.steamTex) t.dispose();
    this.puffGeo?.dispose();
    for (const m of this.clothMats.values()) m.dispose();
    this.clothMats.clear();
    this.steamTex = [];
    this.puffGeo = null;
    this.glints = [];
  }

  private obstacleMesh(o: Obstacle): THREE.Group {
    const g = new THREE.Group();
    const C = COURSE_STYLE, gb = new GeoBuilder();
    const r = o.halfWidth, h = o.height;
    const rng = mulberry32(((o.x * 1000) | 0) >>> 0);
    if (o.kind === 'pot') {
      // terracotta flower pot: tapered lathe with a rolled rim and a painted tile band, flowers to the collider top
      const ph = h * 0.72;
      const prof = [[0, 0], [r * 0.62, 0], [r * 0.7, ph * 0.08], [r * 0.9, ph * 0.86], [r * 1.02, ph * 0.88], [r * 1.02, ph], [r * 0.88, ph], [r * 0.84, ph * 0.95], [0, ph * 0.95]].map(([a, b]) => new THREE.Vector2(a, b));
      gb.add(new THREE.LatheGeometry(prof, 14), [0, 0, 0], C.potDark, { top: C.pot });
      gb.add(new THREE.CylinderGeometry(r * 0.875, r * 0.825, ph * 0.14, 14, 1, true), [0, ph * 0.55, 0], C.potBand);
      gb.add(new THREE.CylinderGeometry(r * 0.885, r * 0.875, ph * 0.03, 14, 1, true), [0, ph * 0.64, 0], C.potPaint);
      gb.add(blob(1, 0.12, rng()), [0, ph * 0.98, 0], C.leaf, { top: C.leafTop, scale: [r * 0.95, (h - ph) * 0.9, r * 0.95] });
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rng(), rr = r * (0.25 + rng() * 0.5), fc = C.flowers[Math.floor(rng() * C.flowers.length)];
        gb.add(blob(0, 0.1, rng()), [Math.cos(a) * rr, ph + (h - ph) * (0.55 + rng() * 0.35), Math.sin(a) * rr], fc, { top: fc, scale: r * 0.2 });
      }
    } else {
      // stacked market crates with a barrel on top (reads as breakable wood; same collider as before)
      const crates = Math.max(1, Math.round((h - 1.0) / 0.95)), ch = (h - 0.95) / crates, cw = r * 2.1;
      for (let i = 0; i < crates; i++) {
        const y = ch * i, rot: [number, number, number] = [0, (rng() - 0.5) * 0.35, 0];
        gb.add(new THREE.BoxGeometry(cw, ch - 0.03, cw), [0, y + ch / 2, 0], i % 2 ? C.pillarAlt : C.pillar, { rot, top: C.pillar });
        for (const yy of [y + 0.12, y + ch - 0.15]) gb.add(new THREE.BoxGeometry(cw + 0.04, 0.07, cw + 0.04), [0, yy, 0], C.pillarCap, { rot });
      }
      const by = ch * crates, br = r * 0.85;
      gb.add(new THREE.CylinderGeometry(br * 0.9, br * 0.9, 0.95, 12), [0, by + 0.475, 0], C.pillarAlt, { top: C.pillar });
      gb.add(new THREE.CylinderGeometry(br * 1.0, br * 0.92, 0.3, 12), [0, by + 0.32, 0], C.pillar, { top: C.pillar });
      for (const yy of [by + 0.12, by + 0.83]) gb.add(new THREE.CylinderGeometry(br * 0.93, br * 0.93, 0.06, 12, 1, true), [0, yy, 0], C.pillarBand);
    }
    const m = new THREE.Mesh(gb.build()!, vc(1.2));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return g;
  }

  private surfaceMesh(s: Surface): THREE.Object3D {
    const W = COURSE_STYLE.routeWidth, C = COURSE_STYLE;
    const cloud = s.material === 'cloud';
    const side = new THREE.Color(cloud ? C.cloudSide : C.stoneSide);
    const under = new THREE.Color(C.underside);
    const tops = (cloud ? [C.cloudTop, C.cloudTopAlt, C.cloudTop] : [C.stoneTop, C.stoneTopAlt, C.stoneTopWarm]).map((q) => new THREE.Color(q));
    const curb = new THREE.Color(cloud ? C.cloudTopAlt : C.stoneCurb);
    // two groups: the cobbled street top (painted sett texture x street tint) and the plain kerbs / sides / caps
    const pos: number[][] = [[], []], col: number[][] = [[], []], uv: number[][] = [[], []];
    const v = new THREE.Vector3();
    let grp = 1;
    const push = (x: number, y: number, lat: number, c: THREE.Color) => {
      this.L(x, y, lat, v); pos[grp].push(v.x, v.y, v.z); col[grp].push(c.r, c.g, c.b);
      // kerbs, sides and caps sample one fixed texel in the middle of a sett: plain colour, same draw call
      if (grp === 0) uv[grp].push(x / C.cobbleTileU, (lat + W / 2) / C.cobbleTileV); else uv[grp].push(COBBLE_PLAIN_UV[0], COBBLE_PLAIN_UV[1]);
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], ca: THREE.Color, cb: THREE.Color = ca) => {
      // a,b top edge; c,d bottom edge (each [x,y,lat])
      push(a[0], a[1], a[2], ca); push(c[0], c[1], c[2], cb); push(b[0], b[1], b[2], ca);
      push(b[0], b[1], b[2], ca); push(c[0], c[1], c[2], cb); push(d[0], d[1], d[2], cb);
    };
    const p = s.points;
    const x0 = p[0].x, x1 = p[p.length - 1].x;
    const bottom = (x: number, y: number) => {
      const t = (x - x0) / (x1 - x0);
      return y - s.thickness - 2.2 * Math.sin(Math.PI * t) ** 0.6 - 0.6 * Math.sin(x * 0.37);
    };
    // top: kerb | cobbled street | kerb. The setts come from the painted texture; the vertex tint only drifts
    // gently along the street (no more checkerboard), stone streets grey-ochre, "cloud" plazas warm sandstone.
    const textured = cobbleTexture() !== null;
    const lats = [-W / 2, -W / 2 + (cloud ? 0.22 : 0.3), W / 2 - (cloud ? 0.22 : 0.3), W / 2];
    const tc = new THREE.Color();
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      for (let k = 0; k < lats.length - 1; k++) {
        const edge = k === 0 || k === lats.length - 2;
        grp = edge || !textured ? 1 : 0;
        if (edge) tc.copy(curb);
        else {
          const m = (a.x + b.x) / 2, w = 0.5 + 0.5 * Math.sin(m * 0.045 + s.id * 1.7) * Math.sin(m * 0.013 + 0.6);
          tc.copy(tops[0]).lerp(tops[cloud ? 1 : 2], w * 0.6).offsetHSL(0, 0, (hash(Math.floor(m / 6), s.id) - 0.5) * 0.03);
        }
        quad([a.x, a.y, lats[k + 1]], [b.x, b.y, lats[k + 1]], [a.x, a.y, lats[k]], [b.x, b.y, lats[k]], tc.clone());
      }
      grp = 1;
      // left and right side faces (the chase camera sees whichever the route curves toward)
      quad([a.x, a.y, -W / 2], [b.x, b.y, -W / 2], [a.x, bottom(a.x, a.y), -W / 2], [b.x, bottom(b.x, b.y), -W / 2], side, under);
      quad([b.x, b.y, W / 2], [a.x, a.y, W / 2], [b.x, bottom(b.x, b.y), W / 2], [a.x, bottom(a.x, a.y), W / 2], side, under);
    }
    grp = 1;
    // end caps: these are the readable gap edges
    for (const [e, sign] of [[p[0], -1], [p[p.length - 1], 1]] as const) {
      if ((sign < 0 && s.prev !== undefined) || (sign > 0 && s.next !== undefined)) continue; // seamless join
      const by = bottom(e.x, e.y);
      const near = [e.x, e.y, -W / 2], far = [e.x, e.y, W / 2];
      if (sign < 0) quad(far, near, [e.x, by, W / 2], [e.x, by, -W / 2], side, under);
      else quad(near, far, [e.x, by, -W / 2], [e.x, by, W / 2], side, under);
    }
    // Kerbs stay off the cobble atlas. A constant UV on that atlas collapses to a pale mip and
    // reads as a white strip along the quay. Vertex colour alone keeps the stone.
    const group = new THREE.Group();
    const add = (p: number[], c: number[], u: number[] | null, material: THREE.Material) => {
      if (!p.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      if (u) geo.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
    };
    const plain = mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, rim: 0.35 });
    add(pos[0], col[0], uv[0], textured ? cobbleMat() : plain);
    add(pos[1], col[1], null, plain);
    return group;
  }

  /** Thin lines on both lips so the riding surface and its edges read crisply at speed. Segments are appended to
   *  the chunk's two merged LineSegments (lip colour, gap-edge colour): two draw calls per chunk, not ~3 per surface. */
  private lipLine(s: Surface, lip: THREE.Vector3[], edge: THREE.Vector3[]): void {
    for (const lat of [-COURSE_STYLE.routeWidth / 2, COURSE_STYLE.routeWidth / 2]) {
      const pts = s.points.map((q) => this.L(q.x, q.y + 0.02, lat));
      for (let i = 0; i + 1 < pts.length; i++) lip.push(pts[i], pts[i + 1]);
    }
    // a line across each chain end marks takeoff and receiving edges of gaps
    for (const e of [...(s.prev === undefined ? [s.points[0]] : []), ...(s.next === undefined ? [s.points[s.points.length - 1]] : [])]) {
      edge.push(this.L(e.x, e.y + 0.03, -COURSE_STYLE.routeWidth / 2), this.L(e.x, e.y + 0.03, COURSE_STYLE.routeWidth / 2));
    }
  }

  /** Edge posts: the void of a gap can hide behind a ramp lip from a chase view,
   *  so both edges get posts (warm = takeoff, teal = receiving). Merged: one draw call. */
  private gapPosts(x0: number, y0: number, x1: number, y1: number): THREE.Mesh {
    const W = COURSE_STYLE.routeWidth, C = COURSE_STYLE, gb = new GeoBuilder();
    const mk = (x: number, y: number, color: string, h: number) => {
      // wrought-iron street lamps with coloured glass: warm = takeoff, teal = receiving
      for (const lat of [-W / 2 - 0.15, W / 2 + 0.15]) {
        gb.add(new THREE.CylinderGeometry(0.15, 0.19, 0.18, 8), this.L(x, y + 0.09, lat), C.postBase);
        gb.add(new THREE.CylinderGeometry(0.05, 0.06, h, 6), this.L(x, y + h / 2, lat), C.postBase);
        gb.add(new THREE.CylinderGeometry(0.13, 0.1, 0.32, 6), this.L(x, y + h + 0.1, lat), color, { top: '#fff4d6' });
        gb.add(new THREE.ConeGeometry(0.2, 0.16, 6), this.L(x, y + h + 0.34, lat), C.postBase);
      }
    };
    mk(x0, y0, C.takeoffPost, 1.1);
    mk(x1, y1, C.receivePost, 1.8);
    const m = new THREE.Mesh(gb.build()!, vc(0.8));
    m.castShadow = true;
    return m;
  }

  private railMesh(r: Rail): THREE.Group {
    if (r.risky && this.props?.piece('rail')) {
      const g = this.highLineMesh(r);
      // The fence is the grind. A bunting dress is a separate string, hooked to both facades.
      if (r.dress === 'bunting') this.addBunting(g, r);
      return g;
    }
    // A wash line with no sourced garments is the ordinary rail. No fake clothes, no stand-in rope.
    if (r.dress && (r.dress !== 'wash' || this.laundryPieces().length)) return this.dressedLineMesh(r);
    const { points, lateral, required } = r;
    const g = new THREE.Group();
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i + 1 < points.length; i++) curve.add(new THREE.LineCurve3(this.L(points[i].x, points[i].y, lateral), this.L(points[i + 1].x, points[i + 1].y, lateral)));
    // required rails read differently before commitment: brighter, thicker
    const railMat = required ? mat(COURSE_STYLE.railRequired, { rim: 2.2, emissive: '#7a4a00', emissiveIntensity: 0.35 }) : mat(COURSE_STYLE.rail, { rim: 2.4 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, 48, required ? 0.1 : 0.07, 6, false), railMat);
    tube.castShadow = true;
    g.add(tube);
    const gb = new GeoBuilder();
    const a = points[0], b = points[points.length - 1];
    for (let x = a.x; x <= b.x + 0.01; x += 4) {
      let y = a.y;
      for (let i = 0; i + 1 < points.length; i++) if (x >= points[i].x && x <= points[i + 1].x) y = points[i].y + ((points[i + 1].y - points[i].y) * (x - points[i].x)) / (points[i + 1].x - points[i].x);
      const gnd = this.course.groundBelow(x, y);
      if (!gnd || y - gnd.sample.y > 6) continue; // over a gap: no post
      const h = y - gnd.sample.y;
      gb.add(new THREE.CylinderGeometry(0.05, 0.05, h, 6), this.L(x, y - h / 2, lateral), COURSE_STYLE.railPost);
      gb.add(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8), this.L(x, y - h + 0.06, lateral), COURSE_STYLE.railPost);
      gb.add(new THREE.SphereGeometry(0.08, 8, 6), this.L(x, y - 0.06, lateral), required ? COURSE_STYLE.railRequired : '#c9a24a');
      gb.add(new THREE.TorusGeometry(Math.min(0.32, h * 0.3), 0.025, 4, 10), this.L(x, y - Math.min(0.32, h * 0.3) - 0.08, lateral), COURSE_STYLE.railPost, { rot: [0, ROUTE_YAW + Math.PI / 2, 0] });
    }
    const posts = gb.build();
    if (posts) { const pm = new THREE.Mesh(posts, vc(1.4)); pm.castShadow = true; g.add(pm); }
    return g;
  }

  private wallMesh(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number; required?: boolean; face?: 'shop' | 'warehouse' | 'hull' }): THREE.Mesh {
    const C = COURSE_STYLE, gb = new GeoBuilder();
    const len = w.x1 - w.x0, h = w.yTop - w.yBottom, mid = w.x0 + len / 2;
    const rot: [number, number, number] = [0, ROUTE_YAW, 0];
    if (w.face === 'warehouse') return this.warehouseWall(w, gb, len, h, mid, rot);
    if (w.face === 'hull') return this.hullWall(w, gb, len, h, mid, rot);
    const face = w.required ? C.wallRequired : C.wall, shade = w.required ? C.wallRequiredShade : C.wallShade;
    // Rideable walls read as their own thing, never as house plaster: a turquoise azulejo-tiled face (diamond tiles
    // on the riding band), a bright gold coping (the same gold as the required rail) and, on walls you must ride,
    // gold chevrons pointing the way. Optional walls are garden/terrace walls with flower boxes on top.
    gb.add(new THREE.BoxGeometry(len, h, 0.5), this.L(mid, w.yBottom + h / 2, w.lateral + 0.25), shade, { rot, top: face });
    const ph = Math.min(1.0, h * 0.12);
    gb.add(new THREE.BoxGeometry(len + 0.2, ph, 0.7), this.L(mid, w.yBottom + ph / 2, w.lateral + 0.25), C.wallPlinth, { rot });
    const g0 = this.course.groundBelow(mid, 1e6)?.sample.y ?? w.yBottom + h / 2;
    const band = [Math.max(w.yBottom + ph + 0.5, Math.min(g0 + 0.6, w.yTop - 2.6)), 0];
    band[1] = Math.min(w.yTop - 0.6, band[0] + 2.4);
    for (let x = w.x0 + 0.45; x < w.x1 - 0.2; x += 0.9) for (let yy = band[0]; yy <= band[1] + 1e-6; yy += 0.8)
      gb.add(new THREE.PlaneGeometry(0.42, 0.42).rotateY(Math.PI), this.L(x + ((yy - band[0]) / 0.8 % 2 ? 0.45 : 0), yy, w.lateral - 0.02), C.wallTile, { rot: [0, ROUTE_YAW, Math.PI / 4] }); // 2-tri tile facing the track
    gb.add(new THREE.BoxGeometry(len, 0.12, 0.05), this.L(mid, band[0] - 0.45, w.lateral - 0.02), C.wallTileEdge, { rot });
    gb.add(new THREE.BoxGeometry(len, 0.12, 0.05), this.L(mid, band[1] + 0.45, w.lateral - 0.02), C.wallTileEdge, { rot });
    if (w.required) for (let x = w.x0 + 1.5; x < w.x1 - 1; x += 3.2) {
      const cy = (band[0] + band[1]) / 2;
      for (const sd of [1, -1]) gb.add(new THREE.BoxGeometry(0.7, 0.16, 0.06), this.L(x + 0.22, cy + sd * 0.22, w.lateral - 0.05), C.railRequired, { rot: [0, ROUTE_YAW, -sd * Math.PI / 4] });
    }
    gb.add(new THREE.BoxGeometry(len + 0.3, 0.24, 0.8), this.L(mid, w.yTop + 0.02, w.lateral + 0.25), C.wallCopingShade, { rot, top: C.railRequired });
    if (!w.required) {
      const rng = mulberry32(((w.x0 * 977) | 0) >>> 0);
      for (let x = w.x0 + 1.2; x < w.x1 - 1; x += 2.6) {
        gb.add(new THREE.BoxGeometry(1.4, 0.3, 0.4), this.L(x, w.yTop + 0.29, w.lateral + 0.35), C.potDark, { rot, top: C.pot });
        for (let k = 0; k < 5; k++) { const fc = C.flowers[Math.floor(rng() * C.flowers.length)]; gb.add(blob(0, 0.1, rng()), this.L(x - 0.5 + k * 0.25, w.yTop + 0.52, w.lateral + 0.35), k % 2 ? C.leaf : fc, { scale: 0.17, top: k % 2 ? C.leafTop : fc }); }
      }
    }
    const m = new THREE.Mesh(gb.build()!, vc(0.9));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  /**
   * The fence boards are stored as sRGB bytes divided by 255, and the pale ones carry no wood layer.
   * Treated as linear they blow out to a white plank. Put them back in linear space and onto the wood grain.
   */
  private dressRail(geo: THREE.BufferGeometry): void {
    const col = geo.getAttribute('color');
    const tl = geo.getAttribute('tl');
    const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < col.count; i++) {
      let r = toLin(col.getX(i)), g = toLin(col.getY(i)), b = toLin(col.getZ(i));
      if (tl.getX(i) < 0) {
        // Authored boards are nearly white (247, 207, 141). The chase camera looks down on that
        // top face, so a mild darken still reads as a flat pale strip beside the cobbles.
        r *= 0.32; g *= 0.32; b *= 0.32;
        tl.setX(i, 2);
      }
      col.setXYZ(i, r, g, b);
    }
    col.needsUpdate = true;
    tl.needsUpdate = true;
  }

  /**
   * The lamp glass and flame are stored as sRGB bytes divided by 255, with no town layer.
   * Treated as linear, and then given a hot emissive, they blow out into white discs beside the cobbles.
   * The rock post is left in the same space as the other props.
   */
  private calmLamp(geo: THREE.BufferGeometry): void {
    const col = geo.getAttribute('color');
    const tl = geo.getAttribute('tl');
    const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if (tl.getX(i) >= 0 && r + g + b < 2.2) continue;
      // The lit toon step is nearly white, so the authored cream still reads as a paper disc.
      const warm = 0.62;
      col.setXYZ(i, toLin(r) * warm, toLin(g) * warm, toLin(b) * warm);
    }
    col.needsUpdate = true;
  }

  /**
   * Risky high line: a painted fence panel (the grind is its top rail) and two post lanterns
   * framing the street before it. The street mesh itself is untouched, so the safe line stays readable.
   */
  private highLineMesh(r: Rail): THREE.Group {
    const g = new THREE.Group();
    const rail = this.props!.piece('rail')!;
    const beacon = this.props!.piece('beacon');
    const ironParts: THREE.BufferGeometry[] = [];
    const glowParts: THREE.BufferGeometry[] = [];
    const x0 = r.points[0].x, x1 = r.points[r.points.length - 1].x;
    const n = Math.max(1, Math.round((x1 - x0) / 1.08));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n, b = x0 + ((x1 - x0) * (i + 1)) / n;
      const mid = (a + b) / 2;
      const top = Course.railSample(r, mid).y;
      const gnd = this.course.groundBelow(mid, top)?.sample.y ?? top - 1.1;
      const panel = this.stamp(rail.body, (u, v, w) => ({ x: a + u * (b - a), y: gnd + v * (top - gnd), lat: r.lateral + w }));
      // The boards ship as flat sRGB bytes with no wood layer, so they render as a white strip beside the street.
      this.dressRail(panel);
      ironParts.push(panel);
    }
    const mouth = x0 - 5.5;
    const base = this.course.groundBelow(mouth, 1e6)?.sample.y ?? r.points[0].y - 1.1;
    // Under 2.6 m, so they stand on the pavement, outside the 1.6 m street. In the lane the
    // chase camera passes over the lamp heads and they fill the bottom corners.
    if (beacon) for (const lat of [-2.05, 2.05]) {
      const sc = 1.15;
      const place = (u: number, v: number, w: number) => ({ x: mouth + u * sc, y: base + v * sc, lat: lat + w * sc });
      const post = this.stamp(beacon.body, place);
      this.calmLamp(post);
      ironParts.push(post);
      if (beacon.glow) {
        const flame = this.stamp(beacon.glow, place);
        this.calmLamp(flame);
        glowParts.push(flame);
      }
    }
    const im = mergeAttrs(ironParts), gm = mergeAttrs(glowParts);
    if (im) { const mesh = new THREE.Mesh(im, this.iron); mesh.castShadow = true; g.add(mesh); }
    if (gm) { const mesh = new THREE.Mesh(gm, this.choiceGlow); mesh.castShadow = false; g.add(mesh); }
    return g;
  }

  /**
   * Elevated line anchored to the right-hand facade: washing line, balcony rail, gutter or bunting.
   * Arms run out to the building, never down through the street. Risky lines use the fence mesh instead.
   */
  private dressedLineMesh(r: Rail): THREE.Group {
    const g = new THREE.Group();
    const gb = new GeoBuilder();
    const dress = r.dress ?? 'wash';
    const rot: [number, number, number] = [0, ROUTE_YAW, 0];
    const pts = r.points;
    const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
    const yAt = (x: number) => Course.railSample(r, Math.min(Math.max(x, x0), x1)).y;
    const facade = 4.65;
    if (dress === 'wash') {
      // The grind stays on this rail. The clothes hang on a higher facade span (see hangSpans).
      const step = 4, sag = 0.2;
      for (let x = x0; x < x1 - 0.05; x += step) {
        const b = Math.min(x1, x + step);
        this.rope(gb, x, yAt(x), r.lateral, b, yAt(b), r.lateral, sag, '#7a5340', 0.02);
      }
    } else if (dress !== 'bunting') {
      const rope = dress === 'gutter' ? '#8a8078' : '#e0b15a';
      for (let x = x0; x < x1 - 0.05; x += 1.15) {
        const b = Math.min(x1, x + 1.15);
        const y = (yAt(x) + yAt(b)) / 2;
        const mid = (x + b) / 2;
        gb.add(new THREE.BoxGeometry(b - x, dress === 'gutter' ? 0.1 : 0.055, 0.06), this.L(mid, y, r.lateral), rope, { rot, top: '#fff6e4' });
        if (dress === 'gutter') gb.add(new THREE.BoxGeometry(b - x, 0.08, 0.18), this.L(mid, y - 0.08, r.lateral + 0.08), '#6a6058', { rot });
        if (dress === 'balcony') gb.add(new THREE.BoxGeometry(b - x, 0.07, Math.max(0.4, facade - r.lateral - 0.45)), this.L(mid, y - 0.82, (r.lateral + 0.4 + facade) / 2), '#e7d7c4', { rot, top: '#f6ecdf' });
      }
    }
    const ironParts: THREE.BufferGeometry[] = [];
    const bracket = this.props?.piece('bracket');
    if (dress !== 'bunting') for (let x = x0; x <= x1 + 0.01; x += (dress === 'wash' ? 4 : 8)) {
      const y = yAt(Math.min(x, x1));
      const arm = facade - r.lateral;
      if (bracket) ironParts.push(this.stamp(bracket.body, (u, v, w) => ({ x: x + w, y: y + v * 0.85, lat: facade - u * (arm / 0.95) })));
      else {
        gb.add(new THREE.BoxGeometry(0.08, 0.07, arm), this.L(x, y, r.lateral + arm / 2), '#3a3642', { rot });
        gb.add(new THREE.BoxGeometry(0.14, 0.4, 0.12), this.L(x, y - 0.12, facade - 0.05), '#4a3c34', { rot });
      }
    }
    if (dress !== 'wash' && dress !== 'bunting') {
      for (let s = 0; s < 6; s++) {
        const yy = yAt(x0) - 1.05 + s * 0.18;
        gb.add(new THREE.BoxGeometry(1.35, 0.14, 1.05), this.L(x0 - 9 + s * 1.45, yy, 3.9), '#cbb89a', { rot, top: '#f3e6d4' });
      }
    }
    if (dress === 'wash') { /* cross-street laundry retired; sky lines peg laundry under along-street ropes */ }
    if (dress === 'bunting') this.addBunting(g, r);
    const built = gb.build();
    if (built) { const mesh = new THREE.Mesh(built, vc(1.05)); mesh.castShadow = true; g.add(mesh); }
    const im = mergeAttrs(ironParts);
    if (im) { const mesh = new THREE.Mesh(im, this.iron); mesh.castShadow = true; g.add(mesh); }
    return g;
  }

  /**
   * Cross-street bunting for a dressed grind. Each string is its own catenary, and both ends
   * are hooks on the facade faces. The grind spline is not moved.
   */
  private addBunting(parent: THREE.Group, r: Rail): void {
    const pts = r.points;
    const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
    if (overlapsSkyBand(this.skySegments(), x0, x1)) return;
    const len = Math.max(1, x1 - x0);
    const yAt = (x: number) => Course.railSample(r, Math.min(Math.max(x, x0), x1)).y;
    const facade = 4.65;
    const rigid: THREE.BufferGeometry[] = [];
    const cloth: THREE.BufferGeometry[] = [];
    const n = Math.max(2, Math.round(len / 8));
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) * len) / n;
      const street = this.streetY(x, yAt(x) - 1.2);
      const span = buildBuntingSpan((rx, ry, lat) => this.L(rx, ry, lat), x, street + 5.7, -facade, facade, 0.78);
      if (span.rigid) rigid.push(span.rigid);
      if (span.cloth) cloth.push(span.cloth);
    }
    const join = (parts: THREE.BufferGeometry[]) => {
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      const m = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      return m;
    };
    const rm = join(rigid), cm = join(cloth);
    if (rm) { const mesh = new THREE.Mesh(rm, vc(1.05)); mesh.name = 'street-bunting'; mesh.userData.x0 = x0; mesh.userData.x1 = x1; mesh.castShadow = true; parent.add(mesh); }
    if (cm) { const mesh = new THREE.Mesh(cm, this.buntingCloth); mesh.name = 'street-bunting'; mesh.userData.x0 = x0; mesh.userData.x1 = x1; mesh.castShadow = true; parent.add(mesh); }
  }

  /** Sourced garments only. An empty slot hangs nothing. */
  private laundryPieces(): PropPiece[] {
    const out: PropPiece[] = [];
    for (const name of SET_ASSET.laundry) {
      const piece = this.props?.piece(name);
      if (piece) out.push(piece);
    }
    return out;
  }

  /** Static shopfront awnings (presentation only; no bounce pads). */
  private dressShopAwnings(c: Chunk, parent: THREE.Group, v: ChunkView): void {
    if (c.zone === 'harbour') return;
    const names = SET_ASSET.awnings;
    for (let x = c.x0 + 8; x < c.x1 - 6; x += 12) {
      if (((Math.floor(x) >> 3) & 1) === 0) continue;
      this.placeShopAwning(x, Math.floor(x / 11) % 997, parent, v, names[Math.floor(x / 9) % names.length]);
    }
  }

  /** Harbour warehouse: corrugated bays and a loading door. The gold coping is the ride. */
  private warehouseWall(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number }, gb: GeoBuilder, len: number, h: number, mid: number, rot: [number, number, number]): THREE.Mesh {
    const C = COURSE_STYLE;
    gb.add(new THREE.BoxGeometry(len, h, 0.55), this.L(mid, w.yBottom + h / 2, w.lateral + 0.28), '#7d8794', { rot, top: '#aeb6c0' });
    gb.add(new THREE.BoxGeometry(len + 0.2, 0.22, 0.7), this.L(mid, w.yBottom + 0.12, w.lateral + 0.28), '#5c534c', { rot });
    for (let y = w.yBottom + 0.55; y < w.yTop - 0.3; y += 0.48)
      gb.add(new THREE.BoxGeometry(len, 0.06, 0.08), this.L(mid, y, w.lateral - 0.02), '#c5ccd4', { rot });
    gb.add(new THREE.BoxGeometry(Math.min(3.2, len * 0.35), h * 0.55, 0.08), this.L(w.x0 + 2.2, w.yBottom + h * 0.32, w.lateral - 0.04), '#2c3138', { rot });
    gb.add(new THREE.BoxGeometry(len + 0.3, 0.22, 0.75), this.L(mid, w.yTop + 0.02, w.lateral + 0.25), C.wallCopingShade, { rot, top: C.railRequired });
    const m = new THREE.Mesh(gb.build()!, vc(0.9));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  /** Moored hull: planked wood and portholes, ridden along the sheer. */
  private hullWall(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number }, gb: GeoBuilder, len: number, h: number, mid: number, rot: [number, number, number]): THREE.Mesh {
    const C = COURSE_STYLE;
    gb.add(new THREE.BoxGeometry(len, h, 0.7), this.L(mid, w.yBottom + h / 2, w.lateral + 0.4), '#5c4030', { rot, top: '#8d6848' });
    for (let y = w.yBottom + 0.4; y < w.yTop - 0.35; y += 0.38)
      gb.add(new THREE.BoxGeometry(len, 0.05, 0.08), this.L(mid, y, w.lateral - 0.02), '#3a281c', { rot });
    for (let x = w.x0 + 1.6; x < w.x1 - 1; x += 2.4)
      gb.add(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 10), this.L(x, w.yBottom + h * 0.55, w.lateral - 0.02), '#9fd0de', { rot: [Math.PI / 2, 0, 0] });
    gb.add(new THREE.BoxGeometry(len + 0.2, 0.16, 0.55), this.L(mid, w.yTop + 0.04, w.lateral + 0.2), '#c4a46a', { rot, top: C.railRequired });
    const m = new THREE.Mesh(gb.build()!, vc(0.95));
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  /** Bounces and updrafts. One activity per chunk. Chimney and vent are baked pieces. */
  private dressActivities(c: Chunk, g: THREE.Group, v: ChunkView): void {
    const gb = new GeoBuilder();
    const iron: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    const pads = (c.bounces ?? []).map((id) => this.course.bounce(id)).filter((b): b is Bounce => !!b);
    for (const b of pads) if (!b.sky) this.balloonDress(b, g, v);
    for (const id of c.updrafts ?? []) { const u = this.course.updraft(id); if (u) this.updraftDress(u, g, v, iron); }
    const built = gb.build();
    if (built) { const mesh = new THREE.Mesh(built, vc(1.05)); mesh.castShadow = true; g.add(mesh); }
    const im = mergeAttrs(iron), gm = mergeAttrs(glow);
    if (im) { const mesh = new THREE.Mesh(im, this.iron); mesh.castShadow = true; g.add(mesh); }
    if (gm) { const mesh = new THREE.Mesh(gm, this.beaconGlow); g.add(mesh); }
  }

  private streetY(x: number, fallback: number): number {
    return this.course.groundBelow(x, 1e6)?.sample.y ?? fallback;
  }

  /** Segments to draw. Endless with nothing authored yet previews the T1 fixture. */
  private skySegments(): SkySegment[] {
    if (this.course.sky.length) return this.course.sky;
    if (this.course.kind === 'endless') return [SKY_FIXTURE_INTRO];
    return [];
  }

  private publishSky(): void {
    setSkyDressingZones(this.skySegments().map((s) => ({ x0: s.x0, x1: s.x1 })));
  }

  /** True when x falls in this chunk and no smaller chunk also covers it. */
  private ownsX(x: number): boolean {
    const here = this.building;
    if (!here || x < here.x0 - 1e-4 || x > here.x1 + 1e-4) return false;
    let best = here;
    let bestSpan = here.x1 - here.x0;
    for (const c of this.course.chunks) {
      if (c.id === here.id) continue;
      if (x < c.x0 - 1e-4 || x > c.x1 + 1e-4) continue;
      const span = c.x1 - c.x0;
      if (span < bestSpan - 1e-4 || (Math.abs(span - bestSpan) <= 1e-4 && c.id < best.id)) {
        best = c;
        bestSpan = span;
      }
    }
    return best.id === here.id;
  }

  private dressSky(c: Chunk, g: THREE.Group, v: ChunkView): void {
    const place = (x: number, y: number, lat: number) => this.L(x, y, lat);
    const segments = this.skySegments().filter((s) => s.x1 >= c.x0 - 1 && s.x0 <= c.x1 + 1);
    const drawn = new Set<number>();
    const clusterX: number[] = [];
    for (const seg of segments) {
      for (const tuft of this.tuftsFor(seg)) {
        const cx = (tuft.x0 + tuft.x1) / 2;
        if (!this.ownsX(cx)) continue;
        const fx = new TuftFx({ place, x: cx, streetY: this.streetY(cx, tuft.yBase), seed: tuft.id + 17, lat: tuft.lateral });
        g.add(fx.group);
        v.skyTufts.push(fx);
      }
      for (const line of seg.lines) {
        if (line.anchors.length < 2) continue;
        const mid = (line.anchors[0].x + line.anchors[line.anchors.length - 1].x) / 2;
        if (!this.ownsX(mid)) continue;
        const rail = this.course.rails.find((r) => r.id === line.railId && r.sky);
        const pieces = line.laundry ? this.laundryPieces() : [];
        const built = buildSkyLine({
          place,
          anchors: line.anchors,
          streetY: (x) => this.streetY(x, seg.yBase),
          sag: !rail,
          laundry: line.laundry,
          proceduralLaundry: line.laundry && pieces.length === 0,
          yOf: (authored, x) => {
            if (rail) {
              const a = rail.points[0].x;
              const b = rail.points[rail.points.length - 1].x;
              return Course.railSample(rail, Math.min(Math.max(x, a), b)).y;
            }
            return authored - seg.yBase + this.streetY(x, seg.yBase);
          },
        });
        if (!built) continue;
        g.add(built.group);
        if (line.laundry && pieces.length) this.hangSkyLaundry(g, built.pegs, pieces);
      }
      for (const cluster of seg.clusters) {
        if (!this.ownsX(cluster.tether.x)) continue;
        drawn.add(cluster.bounceId);
        clusterX.push(cluster.tether.x);
        const street = this.streetY(cluster.tether.x, seg.yBase);
        const knotY = cluster.tether.y - seg.yBase + street - 1.55;
        const fx = new BalloonCluster({
          place, x: cluster.tether.x, knotY, seed: cluster.seed, count: cluster.count,
          bounceId: cluster.bounceId, tether: cluster.tether, streetY: street,
        });
        g.add(fx.group);
        v.skyClusters.push(fx);
      }
    }
    for (const id of c.bounces ?? []) {
      const b = this.course.bounce(id);
      if (!b?.sky || drawn.has(b.id) || !this.ownsX(b.x)) continue;
      if (clusterX.some((x) => Math.abs(x - b.x) < 0.75)) continue;
      const street = this.streetY(b.x, b.y - 2);
      const count = 3 + (Math.abs(b.id) % 5);
      const fx = new BalloonCluster({
        place, x: b.x, knotY: b.y - 1.55, seed: b.id * 17 + 3, count,
        bounceId: b.id, tether: { x: b.x, y: b.y, lateral: b.lateral, kind: b.lateral >= 0 ? 'bracket-right' : 'bracket-left' }, streetY: street,
      });
      g.add(fx.group);
      v.skyClusters.push(fx);
    }
  }

  private tuftsFor(seg: SkySegment): Tuft[] {
    const found = this.course.tufts.filter((t) => t.segmentId === seg.id || t.id === seg.tuftId);
    if (found.length) return found;
    if (this.course.tufts.length) return [];
    return [{
      id: seg.tuftId, x0: seg.gx, x1: seg.gx + 3, yBase: seg.yBase, catchH: 2.5,
      exitX: seg.gx + 9, exitY: seg.yBase + 7, lateral: 0, source: 'grate', segmentId: seg.id,
    }];
  }

  /** Sourced garments instanced under the rope. The peg is the top of the cloth. */
  private hangSkyLaundry(parent: THREE.Group, pegs: SkyPeg[], pieces: PropPiece[]): void {
    if (!pegs.length || !pieces.length) return;
    const up = new THREE.Vector3(0, 1, 0);
    const rot = new THREE.Matrix4().makeBasis(ROUTE_RIGHT, up, ROUTE_DIR.clone().negate());
    for (let p = 0; p < pieces.length; p++) {
      const piece = pieces[p];
      const mine = pegs.filter((_, i) => i % pieces.length === p);
      if (!mine.length) continue;
      const src = piece.body;
      const P = src.getAttribute('position');
      let yMin = Infinity, yMax = -Infinity, xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
      for (let i = 0; i < P.count; i++) {
        yMin = Math.min(yMin, P.getY(i)); yMax = Math.max(yMax, P.getY(i));
        xMin = Math.min(xMin, P.getX(i)); xMax = Math.max(xMax, P.getX(i));
        zMin = Math.min(zMin, P.getZ(i)); zMax = Math.max(zMax, P.getZ(i));
      }
      const drop = Math.max(0.05, yMax - yMin);
      const wide = Math.max(0.05, xMax - xMin, zMax - zMin);
      const sy = Math.min(1, 0.9 / drop);
      const s = Math.min(sy, 0.85 / wide);
      const geo = src.clone();
      geo.translate(-(xMin + xMax) / 2, -yMax, -(zMin + zMax) / 2);
      geo.scale(s, sy, s);
      const tuv = geo.getAttribute('tuv');
      if (piece.map && tuv) geo.setAttribute('uv', tuv.clone());
      const sway = new Float32Array(geo.getAttribute('position').count);
      const Q = geo.getAttribute('position');
      for (let i = 0; i < sway.length; i++) sway[i] = Math.max(0, -Q.getY(i) / 0.9);
      geo.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
      const mat = piece.map ? this.clothMaterial(piece.map, true, 0.85) : this.iron;
      const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
      mesh.name = 'sky-laundry';
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const m = new THREE.Matrix4();
      mine.forEach((peg, i) => {
        m.copy(rot);
        m.setPosition(this.L(peg.x, peg.y, peg.lat));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
    }
  }

  /** Hanging rope in route metres. Sag is the dip at mid-span. */
  private rope(gb: GeoBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag = 0.16, color = '#cbb89a', radius = 0.07): void {
    const n = 7;
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const at = (t: number) => ({
        x: ax + (bx - ax) * t,
        y: ay + (by - ay) * t - Math.sin(Math.PI * t) * sag,
        z: az + (bz - az) * t,
      });
      const a = at(t0), b = at(t1);
      const A = this.L(a.x, a.y, a.z), B = this.L(b.x, b.y, b.z);
      const dir = B.clone().sub(A);
      const len = Math.max(0.04, dir.length());
      q.setFromUnitVectors(up, dir.normalize());
      e.setFromQuaternion(q);
      gb.add(new THREE.CylinderGeometry(radius, radius, len, radius < 0.04 ? 5 : 6), A.clone().add(B).multiplyScalar(0.5), color, { rot: [e.x, e.y, e.z], top: '#f0e0c4' });
    }
  }

  private balloonDress(b: Bounce, g: THREE.Group, v: ChunkView): void {
    const piece = this.props?.piece(SET_ASSET.balloon);
    if (!piece) return;
    const street = this.streetY(b.x, b.y - 1);
    // The bunch stays where the pad is. A post on the pavement replaces the floating weight.
    const postLat = Math.min(TOWN.front - 0.85, b.lateral + 1.05);
    const bollard = this.props?.piece('bollard');
    if (bollard) {
      const post = this.stamp(bollard.body, (u, vv, w) => ({ x: b.x + u, y: street + vv, lat: postLat + w }));
      const mesh = new THREE.Mesh(post, this.iron);
      mesh.castShadow = true;
      g.add(mesh);
    }
    const gb = new GeoBuilder();
    this.rope(gb, b.x, street + 0.95, postLat, b.x, b.y, b.lateral, 0.16, '#5c4638', 0.016);
    const line = gb.build();
    if (line) { const mesh = new THREE.Mesh(line, vc(0.85)); mesh.castShadow = true; g.add(mesh); }
    const shells = { ...piece, body: this.balloonShell(piece.body) };
    this.placeSoft(v, g, shells, (u, vv, w) => ({ x: b.x + u, y: b.y + vv, lat: b.lateral + w }), 'along', b.id, 0.06, 1.5, SET_ASSET.balloon, 1.7);
  }

  /** Drop the weight and the string that ends in it. Shells sit above a gap in the mesh. */
  private balloonShell(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const cached = this.balloonShells.get(src);
    if (cached) return cached;
    const P = src.getAttribute('position');
    const I = src.getIndex()!;
    const keep: number[] = [];
    for (let i = 0; i < I.count; i += 3) {
      const a = I.getX(i), b = I.getX(i + 1), c = I.getX(i + 2);
      if (P.getY(a) < 0.5 || P.getY(b) < 0.5 || P.getY(c) < 0.5) continue;
      keep.push(a, b, c);
    }
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'tuv', 'tl']) {
      const a = src.getAttribute(name);
      if (a) g.setAttribute(name, a);
    }
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
    this.balloonShells.set(src, g);
    return g;
  }

  /** A sourced mesh, centred so a landing can squash it. No stand-in when the slot is empty. */
  private placeSoft(v: ChunkView, parent: THREE.Group, piece: PropPiece, place: (u: number, vv: number, w: number) => { x: number; y: number; lat: number }, frame: 'along' | 'out' | 'cross', id: number, bob: number, bobRate: number, name: string, rim = 0.7, tint?: THREE.Color, ramp: 'set' | 'awning' = 'set'): void {
    const geo = this.stamp(piece.body, place, frame, undefined, tint);
    if (piece.map) geo.setAttribute('uv', geo.getAttribute('tuv').clone());
    geo.computeBoundingBox();
    const c = geo.boundingBox!.getCenter(new THREE.Vector3());
    geo.translate(-c.x, -c.y, -c.z);
    const group = new THREE.Group();
    group.name = name;
    const mat = piece.map ? this.clothMaterial(piece.map, false, rim, ramp) : this.iron;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    group.add(mesh);
    group.position.copy(c);
    parent.add(group);
    v.soft.push({ id, group, hit: -1, phase: id * 0.7, baseY: group.position.y, bob, bobRate });
  }

  /** Restyled atlas. Awnings use a neutral ramp so the stripes stay terracotta, teal or ochre. */
  private clothMaterial(map: THREE.Texture, sway: boolean, rim: number, ramp: 'set' | 'awning' = 'set'): THREE.MeshToonMaterial {
    const key = `${map.uuid}|${sway ? 1 : 0}|${rim}|${ramp}`;
    let m = this.clothMats.get(key);
    if (!m) {
      m = toon('#ffffff', { sway, rim, side: THREE.DoubleSide });
      m.map = map;
      m.gradientMap = ramp === 'awning' ? awningRamp() : setPieceRamp();
      this.clothMats.set(key, m);
    }
    return m;
  }

  /** Doorway canvas on the right shopfront. Decoration only. */
  private placeShopAwning(x: number, id: number, parent: THREE.Group, v: ChunkView, pieceName: string): void {
    const piece = this.props?.piece(pieceName);
    if (!piece) return;
    const src = piece.body.getAttribute('position');
    let yMin = Infinity;
    for (let i = 0; i < src.count; i++) yMin = Math.min(yMin, src.getY(i));
    const street = this.streetY(x, 0);
    const valance = street + 2.8;
    this.placeSoft(v, parent, piece, (u, vv, w) => ({
      x: x + u,
      y: valance - yMin + vv,
      lat: TOWN.front - w,
    }), 'along', id, 0, 0, pieceName, 0.55, undefined, 'awning');
  }

  private updraftDress(u: Updraft, g: THREE.Group, v: ChunkView, iron: THREE.BufferGeometry[]): void {
    const street = this.streetY(u.x0, u.y0 - 1.6);
    let source = { x: u.x0 + 1, y: street + 1.2, lat: 3.4 };
    if (u.source === 'chimney') {
      const cx = (u.x0 + u.x1) / 2;
      const lat = 4.25;
      const chimney = this.props?.piece('chimney');
      const topY = chimney ? this.highest(chimney.body).y : 2;
      if (chimney) iron.push(this.stamp(chimney.body, (uu, vv, w) => ({ x: cx + uu, y: street + 3.2 + vv, lat: lat + w })));
      source = { x: cx, y: street + 3.2 + topY - 0.05, lat };
      const pin = this.props?.piece('pinwheel');
      if (pin) iron.push(this.stamp(pin.body, (uu, vv, w) => ({ x: cx + 0.9 + uu * 0.45, y: street + 3.5 + vv * 0.45, lat: 3.55 + w * 0.45 })));
    } else {
      const lat = 3.25;
      const vent = this.props?.piece('vent');
      if (vent) iron.push(this.stamp(vent.body, (uu, vv, w) => ({ x: u.x0 + 1.5 + uu, y: street + vv, lat: lat + w })));
      source = { x: u.x0 + 1.5, y: street + 0.55, lat };
      const flag = this.props?.piece('pennant');
      if (flag) iron.push(this.stamp(flag.body, (uu, vv, w) => ({ x: u.x0 + 2.2 + uu, y: street + 2.4 + vv, lat: 3.9 + w })));
    }
    if (!this.steamTex.length) return;
    // The pot stays on the facade. The column the player jumps into stands over the street.
    const column = { x: (u.x0 + u.x1) / 2, y: u.y0 + 0.4, lat: 0.7 };
    const top = { x: column.x, y: Math.max(column.y + 7, u.y1), lat: 0.45 };
    this.addPlume(g, v, source, top, u.source === 'chimney' ? 12 : 10);
  }

  /** Camera-facing toon puffs. Shared maps are not disposed with a chunk. */
  private addPlume(g: THREE.Group, v: ChunkView, source: { x: number; y: number; lat: number }, top: { x: number; y: number; lat: number }, n: number): void {
    if (!this.steamTex.length) return;
    if (!this.puffGeo) this.puffGeo = new THREE.PlaneGeometry(1, 1);
    const rise = Math.max(2, top.y - source.y);
    for (let i = 0; i < n; i++) {
      const map = this.steamTex[i % this.steamTex.length];
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: map },
          sunDir: { value: this.sunView },
          opacity: { value: 1 },
        },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform sampler2D map; uniform vec3 sunDir; uniform float opacity; varying vec2 vUv;
          void main() {
            vec4 tex = texture2D(map, vUv);
            vec2 p = vUv * 2.0 - 1.0;
            float lum = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
            // Sheets are white puffs on black. A missing or solid alpha must not keep the black card.
            float coverage = min(lum, tex.a);
            float card = smoothstep(0.96, 0.42, length(p));
            float soft = smoothstep(0.02, 0.55, coverage) * card;
            vec3 sun = length(sunDir) > 0.001 ? normalize(sunDir) : vec3(0.25, 0.86, 0.35);
            vec3 fake = normalize(vec3(p, sqrt(max(0.0, 1.0 - min(dot(p, p), 1.0)))) + vec3((lum - 0.35) * 0.55, (lum - 0.35) * 0.22, 0.0));
            float lit = smoothstep(0.0, 0.72, dot(fake, sun));
            // Edges stay lavender; the lit core is warm cream. Both sit well above black.
            vec3 lavender = vec3(0.73, 0.64, 0.86);
            vec3 cream = vec3(1.0, 0.90, 0.74);
            vec3 col = mix(lavender, cream, lit * smoothstep(0.12, 0.7, coverage));
            // Soft enough that overlapping cards stay cloudy instead of a solid wall.
            gl_FragColor = vec4(col, soft * opacity * 0.72);
          }`,
        transparent: true, depthWrite: false, depthTest: true, fog: false,
        blending: THREE.NormalBlending, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.puffGeo, mat);
      mesh.name = 'set-wisp';
      mesh.renderOrder = 6;
      mesh.frustumCulled = false;
      g.add(mesh);
      const speed = 1.5 + (i % 6) * 0.25;
      v.wisps.push({
        mesh, mat,
        x0: source.x, y0: source.y, lat0: source.lat,
        x1: top.x, y1: top.y, lat1: top.lat,
        phase: (i / n) * (rise / speed),
        speed, life: rise / speed,
        spin: ((i % 7) - 3) * 0.08,
        chunkX: v.chunk.x0, chunkY: v.chunk.y0,
      });
    }
  }

  /** Copy a prop into chunk-local scene space. `place` is in route metres (x, height, lateral).
   *  `out` turns the piece so its +X reaches from a facade toward the street. */
  /** Highest vertex, used to seat the crane jib on the rope. */
  private highest(src: THREE.BufferGeometry): { x: number; y: number; z: number } {
    const P = src.getAttribute('position');
    let y = -1e9, x = 0, z = 0;
    for (let i = 0; i < P.count; i++) if (P.getY(i) > y) { y = P.getY(i); x = P.getX(i); z = P.getZ(i); }
    return { x, y, z };
  }

  private stamp(src: THREE.BufferGeometry, place: (u: number, v: number, w: number) => { x: number; y: number; lat: number }, frame: 'along' | 'out' | 'cross' = 'along', tint?: (u: number, v: number, w: number) => THREE.Color, tintMul?: THREE.Color): THREE.BufferGeometry {
    const P = src.getAttribute('position'), N = src.getAttribute('normal'), C = src.getAttribute('color');
    const U = src.getAttribute('tuv'), T = src.getAttribute('tl');
    const I = src.getIndex()!;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(P.count * 3), nrm = new Float32Array(P.count * 3);
    const col = new Float32Array(P.count * 3), uv = new Float32Array(P.count * 2), tl = new Float32Array(P.count);
    const tmp = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      const q = place(P.getX(i), P.getY(i), P.getZ(i));
      tmp.copy(this.L(q.x, q.y, q.lat));
      // along: piece +X follows the route, +Z is lateral. out: +X reaches toward the street, +Z follows the route.
      const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
      const rx = frame === 'along' ? nx : nz;
      const rz = frame === 'out' ? -nx : frame === 'cross' ? nx : nz;
      nn.set(ROUTE_DIR.x * rx + ROUTE_RIGHT.x * rz, ny, ROUTE_DIR.z * rx + ROUTE_RIGHT.z * rz).normalize();
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
      nrm.set([nn.x, nn.y, nn.z], i * 3);
      if (tint) {
        const c = tint(P.getX(i), P.getY(i), P.getZ(i));
        col.set([c.r, c.g, c.b], i * 3);
      } else if (tintMul) {
        col.set([C.getX(i) * tintMul.r, C.getY(i) * tintMul.g, C.getZ(i) * tintMul.b], i * 3);
      } else col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
      uv.set([U.getX(i), U.getY(i)], i * 2);
      tl[i] = tint ? -1 : T.getX(i);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('tuv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('tl', new THREE.BufferAttribute(tl, 1));
    g.setIndex(new THREE.BufferAttribute(I.array.slice(0), 1));
    return g;
  }

  private marker(x: number, label: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '600 34px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = COURSE_STYLE.marker;
    g.fillText(label, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
    const gnd = this.course.groundBelow(x, 1e6);
    sp.position.copy(this.L(x, (gnd?.sample.y ?? 0) + 2.6, -3.6)); // left of the route; rails/walls live on the right
    sp.scale.set(3.2, 0.8, 1);
    return sp;
  }
}

/** Merge stamped prop copies. Disposes the parts. Empty input returns null. */
function mergeAttrs(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.getAttribute('position').count; ni += p.getIndex()!.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2), tl = new Float32Array(nv), idx = new Uint32Array(ni);
  let v = 0, ii = 0;
  for (const p of parts) {
    const P = p.getAttribute('position'), N = p.getAttribute('normal'), C = p.getAttribute('color');
    const U = p.getAttribute('tuv'), T = p.getAttribute('tl'), I = p.getIndex()!;
    pos.set(P.array as Float32Array, v * 3);
    nrm.set(N.array as Float32Array, v * 3);
    col.set(C.array as Float32Array, v * 3);
    uv.set(U.array as Float32Array, v * 2);
    tl.set(T.array as Float32Array, v);
    for (let k = 0; k < I.count; k++) idx[ii++] = I.getX(k) + v;
    v += P.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('tuv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('tl', new THREE.BufferAttribute(tl, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Dispose geometries (and non-shared textures) under a node. Shared materials stay. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const sm = (o as THREE.Sprite).isSprite ? ((o as THREE.Sprite).material as THREE.SpriteMaterial) : null;
    if (sm) { sm.map?.dispose(); sm.dispose(); }
  });
}
