import { TEX_ANISO } from './environment';
import * as THREE from 'three';
import { Course, type Chunk, type Obstacle, type Surface } from '../course/course';
import { toScene, toSceneRaw, ROUTE_YAW } from './space';
import type { Vector3 } from 'three';
import { toon } from './materials';
import { GeoBuilder, blob } from './geo';
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
  // the plain texel for kerbs/sides (COBBLE_PLAIN_UV): a small flat spot of near-white stone
  g.fillStyle = 'rgb(242,240,236)'; g.beginPath(); g.arc(cw * 0.5, rh * 0.5, 14, 0, Math.PI * 2); g.fill();
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

interface ChunkView { chunk: Chunk; group: THREE.Group; pooled: { kind: 'pot' | 'pillar'; obj: THREE.Group }[] }

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
  private pool: Record<'pot' | 'pillar', THREE.Group[]> = { pot: [], pillar: [] };
  private bx = 0;
  private by = 0;
  private signature = '';
  /** Diagnostics for memory tests: chunks built / disposed, pool sizes. */
  readonly stats = { built: 0, disposed: 0, pooledCreated: 0 };

  /** Local placement inside the chunk being built. */
  private L(x: number, y: number, lat = 0, out?: Vector3): THREE.Vector3 { return toSceneRaw(x - this.bx, y - this.by, lat, out); }

  /** Hide a broken obstacle (debris takes over). */
  setBroken(id: number, broken: boolean): void { const m = this.obstacleMeshes.get(id); if (m) m.visible = !broken; }
  resetObstacles(): void { for (const m of this.obstacleMeshes.values()) m.visible = true; }

  constructor(readonly course: Course) { this.sync(); }

  /** Add meshes for new chunks and recycle those the course dropped. Cheap when nothing changed. */
  sync(): void {
    const cs = this.course.chunks;
    const sig = cs.length ? `${cs[0].id}:${cs[cs.length - 1].id}:${cs.length}` : '';
    if (sig === this.signature) return;
    this.signature = sig;
    const live = new Set(cs.map((c) => c.id));
    for (const [id, v] of this.views) if (!live.has(id)) this.drop(v);
    for (const c of cs) if (!this.views.has(c.id)) this.build(c);
  }

  /** The floating origin moved: re-place every chunk. */
  rebase(): void { for (const v of this.views.values()) v.group.position.copy(toScene(v.chunk.x0, v.chunk.y0)); }

  get chunkCount(): number { return this.views.size; }
  get poolSize(): number { return this.pool.pot.length + this.pool.pillar.length; }

  private build(c: Chunk): void {
    const g = new THREE.Group();
    this.bx = c.x0; this.by = c.y0;
    const v: ChunkView = { chunk: c, group: g, pooled: [] };
    const surfaces = c.surfaces.map((id) => this.course.findSurface(id)).filter((q): q is Surface => !!q);
    const lip: THREE.Vector3[] = [], edge: THREE.Vector3[] = [];
    for (const s of surfaces) { g.add(this.surfaceMesh(s)); this.lipLine(s, lip, edge); }
    for (const [pts, color] of [[lip, COURSE_STYLE.lipLine], [edge, COURSE_STYLE.edgeLine]] as const) if (pts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color)));
    for (const gp of this.course.gaps) if (gp.x0 >= c.x0 - 1e-6 && gp.x0 <= c.x1 + 1e-6) g.add(this.gapPosts(gp.x0, gp.yTakeoff, gp.x1, gp.yReceive));
    for (const id of c.rails) { const r = this.course.rail(id); g.add(this.railMesh(r.points, r.lateral, r.required)); }
    for (const id of c.walls) g.add(this.wallMesh(this.course.wall(id)));
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
    const g = new THREE.BufferGeometry();
    const n0 = pos[0].length / 3, n1 = pos[1].length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute([...pos[0], ...pos[1]], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([...col[0], ...col[1]], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv[0], ...uv[1]], 2));
    g.computeVertexNormals();
    void n0; void n1;
    // one mesh, one material (the textured street and its plain kerbs/sides share a draw call)
    const mesh = new THREE.Mesh(g, textured ? cobbleMat() : mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, rim: 0.6, emissive: undefined }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
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

  private railMesh(points: { x: number; y: number }[], lateral: number, required: boolean): THREE.Group {
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

  private wallMesh(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number; required?: boolean }): THREE.Mesh {
    const C = COURSE_STYLE, gb = new GeoBuilder();
    const len = w.x1 - w.x0, h = w.yTop - w.yBottom, mid = w.x0 + len / 2;
    const rot: [number, number, number] = [0, ROUTE_YAW, 0];
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

/** Dispose geometries (and non-shared textures) under a node. Shared materials stay. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const sm = (o as THREE.Sprite).isSprite ? ((o as THREE.Sprite).material as THREE.SpriteMaterial) : null;
    if (sm) { sm.map?.dispose(); sm.dispose(); }
  });
}
