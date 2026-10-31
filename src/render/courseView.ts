import * as THREE from 'three';
import { Course, type Chunk, type Obstacle, type Surface } from '../course/course';
import { toScene, toSceneRaw, ROUTE_YAW } from './space';
import type { Vector3 } from 'three';
import { toon } from './materials';
import { GeoBuilder, blob, flutedShaft } from './geo';
import { mulberry32 } from '../rng';

/**
 * Course palette (art pass): sun-bleached marble and travertine paths, cloud
 * platforms, bronze/gold rails, marble walls with a painted frieze, terracotta
 * amphorae and fluted columns. Gameplay colours (gap posts, lip lines, required
 * rail/wall tints) keep their contrast against the warm world.
 */
export const COURSE_STYLE = {
  routeWidth: 3.2,
  cloudTop: '#fffaf4', cloudTopAlt: '#fbeef0', cloudSide: '#f4dde4', cloudPuff: '#ffffff', cloudPuffShade: '#d7c9e8',
  stoneTop: '#efdcc0', stoneTopAlt: '#e5c9a3', stoneTopWarm: '#ecd2ae', stoneCurb: '#c48a5e', stoneSide: '#d9a57f',
  underside: '#8f78ad',
  lipLine: '#6a5878',
  edgeLine: '#2f7d6d',
  takeoffPost: '#e07a3f',
  receivePost: '#2f9d87',
  postBase: '#efe3d2',
  rail: '#b77a3a', railPost: '#7d5a3c', railRequired: '#ffc44d',
  wall: '#f1e8dc', wallShade: '#dccbbb', wallTrim: '#c96f47', wallFrieze: '#4f6f9a', wallRequired: '#cdeadc', wallRequiredShade: '#a9d3c0',
  marker: '#5d4f6e',
  pot: '#cf6d3f', potDark: '#a8502c', potBand: '#2e2420', potPaint: '#f2d7a8',
  pillar: '#ecd8bc', pillarAlt: '#dfc6a6', pillarCap: '#c99f7a', pillarBand: '#c2593a',
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
    for (const s of surfaces) g.add(this.surfaceMesh(s), this.lipLine(s));
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
    if (o.kind === 'pot') {
      // amphora: lathe body with neck and lip, two handles, black painted band
      const prof = [[0.0, 0], [r * 0.32, 0], [r * 0.4, h * 0.05], [r * 0.85, h * 0.25], [r, h * 0.45], [r * 0.9, h * 0.62], [r * 0.55, h * 0.76], [r * 0.34, h * 0.84], [r * 0.32, h * 0.94], [r * 0.46, h * 0.97], [r * 0.44, h], [r * 0.3, h]].map(([a, b]) => new THREE.Vector2(a, b));
      gb.add(new THREE.LatheGeometry(prof, 16), [0, 0, 0], C.potDark, { top: C.pot });
      gb.add(new THREE.CylinderGeometry(r * 1.005, r * 0.99, h * 0.09, 16, 1, true), [0, h * 0.44, 0], C.potBand);
      gb.add(new THREE.CylinderGeometry(r * 0.93, r * 0.98, h * 0.035, 16, 1, true), [0, h * 0.535, 0], C.potPaint);
      gb.add(new THREE.CylinderGeometry(r * 0.88, r * 0.84, h * 0.03, 16, 1, true), [0, h * 0.62, 0], C.potBand);
      for (const sd of [-1, 1]) gb.add(new THREE.TorusGeometry(h * 0.1, r * 0.06, 5, 10, Math.PI), [0, h * 0.8, sd * r * 0.48], C.potDark, { rot: [0, Math.PI / 2, sd > 0 ? -Math.PI / 2.4 : Math.PI / 2.4] });
    } else {
      // fluted column: base, drums slightly off-axis (reads as breakable masonry), echinus, abacus
      const n = 4, base = 0.2, shaft = h - base - 0.36;
      gb.add(new THREE.CylinderGeometry(r * 1.2, r * 1.3, base, 16), [0, base / 2, 0], C.pillarCap, { top: C.pillarAlt });
      for (let i = 0; i < n; i++) {
        const dh = shaft / n - 0.03;
        gb.add(flutedShaft(r * (1 - (i + 1) * 0.025), dh, 12, 0.08, (1 - (i + 1) * 0.025) / (1 - i * 0.025)), [Math.sin(i * 2.1) * 0.03, base + (shaft / n) * (i + 0.5), Math.cos(i * 1.7) * 0.03], i % 2 ? C.pillarAlt : C.pillar, { rot: [0, i * 0.5, 0] });
      }
      gb.add(new THREE.CylinderGeometry(r * 1.25, r * 0.9, 0.18, 16), [0, base + shaft + 0.09, 0], C.pillarAlt, { top: C.pillar });
      gb.add(new THREE.BoxGeometry(r * 2.6, 0.18, r * 2.6), [0, base + shaft + 0.27, 0], C.pillarCap, { top: C.pillar });
      gb.add(new THREE.BoxGeometry(r * 2.64, 0.08, r * 2.64), [0, base + shaft + 0.27, 0], C.pillarBand);
      gb.add(new THREE.CylinderGeometry(r * 1.0, r * 1.0, 0.1, 16, 1, true), [0, base + shaft - 0.08, 0], C.pillarBand);
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
    const pos: number[] = [], col: number[] = [];
    const v = new THREE.Vector3();
    const push = (x: number, y: number, lat: number, c: THREE.Color) => { this.L(x, y, lat, v); pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); };
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
    // top split into strips: curb | slabs | curb (flagstones by colour variation; cloud: soft mottling)
    const lats = [-W / 2, -W / 2 + 0.28, 0.1, W / 2 - 0.28, W / 2];
    const tc = new THREE.Color();
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      for (let k = 0; k < lats.length - 1; k++) {
        const edge = k === 0 || k === lats.length - 2;
        if (edge) tc.copy(curb);
        else {
          const key = Math.floor((a.x + b.x) / 2 / (cloud ? 5 : 1.5) + k * 0.5);
          const hv = hash(key, k + s.id * 7);
          tc.copy(tops[Math.floor(hv * 3) % 3]).offsetHSL(0, 0, (hash(key, k + 3) - 0.5) * (cloud ? 0.015 : 0.035));
        }
        quad([a.x, a.y, lats[k + 1]], [b.x, b.y, lats[k + 1]], [a.x, a.y, lats[k]], [b.x, b.y, lats[k]], tc.clone());
      }
      // left and right side faces (the chase camera sees whichever the route curves toward)
      quad([a.x, a.y, -W / 2], [b.x, b.y, -W / 2], [a.x, bottom(a.x, a.y), -W / 2], [b.x, bottom(b.x, b.y), -W / 2], side, under);
      quad([b.x, b.y, W / 2], [a.x, a.y, W / 2], [b.x, bottom(b.x, b.y), W / 2], [a.x, bottom(a.x, a.y), W / 2], side, under);
    }
    // end caps: these are the readable gap edges
    for (const [e, sign] of [[p[0], -1], [p[p.length - 1], 1]] as const) {
      if ((sign < 0 && s.prev !== undefined) || (sign > 0 && s.next !== undefined)) continue; // seamless join
      const by = bottom(e.x, e.y);
      const near = [e.x, e.y, -W / 2], far = [e.x, e.y, W / 2];
      if (sign < 0) quad(far, near, [e.x, by, W / 2], [e.x, by, -W / 2], side, under);
      else quad(near, far, [e.x, by, -W / 2], [e.x, by, W / 2], side, under);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, rim: 0.6, emissive: cloud ? '#33282c' : undefined }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    if (!cloud) return mesh;
    // cloud platforms: soft puffs hugging the sides and underside, always below the riding line
    const grp = new THREE.Group();
    grp.add(mesh);
    const gb = new GeoBuilder();
    const rng = mulberry32((s.id * 2654435761) >>> 0);
    const ysAt = (x: number) => { for (let i = 0; i + 1 < p.length; i++) if (x <= p[i + 1].x) return p[i].y + ((p[i + 1].y - p[i].y) * (x - p[i].x)) / Math.max(1e-6, p[i + 1].x - p[i].x); return p[p.length - 1].y; };
    for (let x = x0 + 0.9; x < x1 - 0.9; x += 3.4 + rng() * 1.6) {
      const y = ysAt(x);
      for (const sd of [-1, 1]) {
        const rr = 0.6 + rng() * 0.45;
        gb.add(blob(1, 0.1, rng()), this.L(x, y - rr - 0.1, sd * (W / 2 + rr * 0.05)), C.cloudPuffShade, { top: C.cloudPuff, scale: [rr * 1.35, rr * 0.95, rr * 1.2] });
      }
      if (rng() < 0.4) { const rr = 0.9 + rng() * 0.8; gb.add(blob(0, 0.15, rng()), this.L(x, bottom(x, y) + rr * 0.5, (rng() - 0.5) * W * 0.6), C.cloudPuffShade, { top: C.cloudSide, scale: rr }); }
    }
    const pg = gb.build();
    if (pg) { const pm = new THREE.Mesh(pg, mat('#ffffff', { vertexColors: true, rim: 1.6, emissive: '#3b2f3a' })); pm.receiveShadow = true; grp.add(pm); }
    return grp;
  }

  /** Thin lines on both lips so the riding surface and its edges read crisply at speed. */
  private lipLine(s: Surface): THREE.Group {
    const g = new THREE.Group();
    const mat = lineMat(COURSE_STYLE.lipLine);
    for (const lat of [-COURSE_STYLE.routeWidth / 2, COURSE_STYLE.routeWidth / 2]) {
      const pts = s.points.map((q) => this.L(q.x, q.y + 0.02, lat));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    // a line across each chain end marks takeoff and receiving edges of gaps
    for (const e of [...(s.prev === undefined ? [s.points[0]] : []), ...(s.next === undefined ? [s.points[s.points.length - 1]] : [])]) {
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.L(e.x, e.y + 0.03, -COURSE_STYLE.routeWidth / 2), this.L(e.x, e.y + 0.03, COURSE_STYLE.routeWidth / 2)]), lineMat(COURSE_STYLE.edgeLine)));
    }
    return g;
  }

  /** Edge posts: the void of a gap can hide behind a ramp lip from a chase view,
   *  so both edges get posts (warm = takeoff, teal = receiving). Merged: one draw call. */
  private gapPosts(x0: number, y0: number, x1: number, y1: number): THREE.Mesh {
    const W = COURSE_STYLE.routeWidth, C = COURSE_STYLE, gb = new GeoBuilder();
    const mk = (x: number, y: number, color: string, h: number) => {
      for (const lat of [-W / 2 - 0.15, W / 2 + 0.15]) {
        gb.add(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 8), this.L(x, y + 0.09, lat), C.postBase);
        gb.add(new THREE.CylinderGeometry(0.07, 0.07, h, 6), this.L(x, y + h / 2, lat), color);
        gb.add(new THREE.SphereGeometry(0.17, 10, 7), this.L(x, y + h, lat), color);
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
    const railMat = required ? mat(COURSE_STYLE.railRequired, { rim: 2.2, emissive: '#7a4a00', emissiveIntensity: 0.35 }) : mat(COURSE_STYLE.rail, { rim: 1.8 });
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
      gb.add(new THREE.SphereGeometry(0.09, 8, 6), this.L(x, y - 0.06, lateral), COURSE_STYLE.railRequired);
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
    // marble slab (riding face at w.lateral), plinth, frieze band with triglyphs, cornice
    gb.add(new THREE.BoxGeometry(len, h, 0.5), this.L(mid, w.yBottom + h / 2, w.lateral + 0.25), shade, { rot, top: face });
    gb.add(new THREE.BoxGeometry(len + 0.2, 0.3, 0.7), this.L(mid, w.yBottom + 0.15, w.lateral + 0.25), shade, { rot });
    const fb = Math.min(0.55, h * 0.16), fy = w.yTop - 0.18 - fb / 2;
    gb.add(new THREE.BoxGeometry(len, fb, 0.04), this.L(mid, fy, w.lateral - 0.01), C.wallTrim, { rot });
    for (let x = w.x0 + 0.6; x < w.x1 - 0.3; x += 1.2) gb.add(new THREE.BoxGeometry(0.34, fb * 0.9, 0.06), this.L(x, fy, w.lateral - 0.03), C.wallFrieze, { rot });
    gb.add(new THREE.BoxGeometry(len + 0.3, 0.22, 0.75), this.L(mid, w.yTop + 0.02, w.lateral + 0.25), C.wallShade, { rot, top: C.wall });
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
