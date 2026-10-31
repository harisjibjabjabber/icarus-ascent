import * as THREE from 'three';
import { Course, type Chunk, type Obstacle, type Surface } from '../course/course';
import { toScene, toSceneRaw, ROUTE_YAW } from './space';
import type { Vector3 } from 'three';
import { toon } from './materials';

/** Placeholder palette. Art direction swaps this object. */
export const COURSE_STYLE = {
  routeWidth: 3.2,
  cloudTop: '#fff8ee', cloudSide: '#f2c9b4',
  stoneTop: '#f5cf98', stoneSide: '#dea486',
  underside: '#c29ab0',
  lipLine: '#6e5f7c',
  edgeLine: '#2f7d6d',
  takeoffPost: '#e07a3f',
  receivePost: '#2f9d87',
  rail: '#b8864b', railPost: '#8f6a43', railRequired: '#ffb347',
  wall: '#d8cfe6', wallTrim: '#9a8fb6', wallRequired: '#bfe3d6',
  marker: '#5d4f6e',
  pot: '#d27a4f', potBand: '#f3e0b5', pillar: '#e9dccf', pillarAlt: '#ddcdbf', pillarCap: '#c7b2c4',
};


/** Shared materials: streamed chunks reuse them instead of allocating per mesh. */
const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts: { vertexColors?: boolean; side?: THREE.Side } = {}): THREE.MeshToonMaterial {
  const key = `${color}|${opts.vertexColors ? 1 : 0}|${opts.side ?? 0}`;
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
    if (o.kind === 'pot') {
      // terracotta urn: lathe profile + painted band
      const r = o.halfWidth, h = o.height;
      const prof = [[0.0, 0], [r * 0.55, 0], [r * 0.95, h * 0.25], [r, h * 0.5], [r * 0.8, h * 0.78], [r * 0.5, h * 0.9], [r * 0.62, h], [r * 0.5, h]].map(([a, b]) => new THREE.Vector2(a, b));
      const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), mat(COURSE_STYLE.pot));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 0.99, h * 0.1, 14, 1, true), mat(COURSE_STYLE.potBand));
      band.position.y = h * 0.5;
      g.add(body, band);
    } else {
      // stacked drums + capital, slightly off-axis so it reads as breakable masonry
      const r = o.halfWidth, h = o.height, n = 4;
      for (let i = 0; i < n; i++) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(r * (0.94 + (i % 2) * 0.04), r, h / n - 0.04, 10), mat(i % 2 ? COURSE_STYLE.pillarAlt : COURSE_STYLE.pillar));
        d.position.set(Math.sin(i * 2.1) * 0.03, (h / n) * (i + 0.5), Math.cos(i * 1.7) * 0.03);
        d.rotation.y = i * 0.5;
        g.add(d);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.5, 0.22, r * 2.5), mat(COURSE_STYLE.pillarCap));
      cap.position.y = h + 0.06;
      const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, 0.18, r * 2.4), mat(COURSE_STYLE.pillarCap));
      base.position.y = 0.09;
      g.add(cap, base);
    }
    g.traverse((q) => { if ((q as THREE.Mesh).isMesh) { q.castShadow = true; q.receiveShadow = true; } });
    return g;
  }

  private surfaceMesh(s: Surface): THREE.Mesh {
    const W = COURSE_STYLE.routeWidth;
    const top = new THREE.Color(s.material === 'cloud' ? COURSE_STYLE.cloudTop : COURSE_STYLE.stoneTop);
    const side = new THREE.Color(s.material === 'cloud' ? COURSE_STYLE.cloudSide : COURSE_STYLE.stoneSide);
    const under = new THREE.Color(COURSE_STYLE.underside);
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
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      // top: far edge then near edge
      quad([a.x, a.y, W / 2], [b.x, b.y, W / 2], [a.x, a.y, -W / 2], [b.x, b.y, -W / 2], top);
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
    const mesh = new THREE.Mesh(g, mat('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
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
   *  so both edges get posts (warm = takeoff, teal = receiving). */
  private gapPosts(x0: number, y0: number, x1: number, y1: number): THREE.Group {
    const g = new THREE.Group();
    const W = COURSE_STYLE.routeWidth;
    const mk = (x: number, y: number, color: string, h: number) => {
      for (const lat of [-W / 2 - 0.15, W / 2 + 0.15]) {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 6), mat(color));
        m.position.copy(this.L(x, y + h / 2, lat));
        m.castShadow = true;
        g.add(m);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat(color));
        cap.position.copy(this.L(x, y + h, lat));
        g.add(cap);
      }
    };
    mk(x0, y0, COURSE_STYLE.takeoffPost, 1.1);
    mk(x1, y1, COURSE_STYLE.receivePost, 1.8);
    return g;
  }

  private railMesh(points: { x: number; y: number }[], lateral: number, required: boolean): THREE.Group {
    const g = new THREE.Group();
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 0; i + 1 < points.length; i++) curve.add(new THREE.LineCurve3(this.L(points[i].x, points[i].y, lateral), this.L(points[i + 1].x, points[i + 1].y, lateral)));
    // required rails read differently before commitment: brighter, thicker
    const railMat = mat(required ? COURSE_STYLE.railRequired : COURSE_STYLE.rail);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, 48, required ? 0.1 : 0.07, 6, false), railMat);
    tube.castShadow = true;
    g.add(tube);
    const postMat = mat(COURSE_STYLE.railPost);
    const a = points[0], b = points[points.length - 1];
    for (let x = a.x; x <= b.x + 0.01; x += 4) {
      let y = a.y;
      for (let i = 0; i + 1 < points.length; i++) if (x >= points[i].x && x <= points[i + 1].x) y = points[i].y + ((points[i + 1].y - points[i].y) * (x - points[i].x)) / (points[i + 1].x - points[i].x);
      const gnd = this.course.groundBelow(x, y);
      if (!gnd || y - gnd.sample.y > 6) continue; // over a gap: no post
      const h = y - gnd.sample.y;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 5), postMat);
      post.position.copy(this.L(x, y - h / 2, lateral));
      g.add(post);
    }
    return g;
  }

  private wallMesh(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number }): THREE.Group {
    const g = new THREE.Group();
    const len = w.x1 - w.x0, h = w.yTop - w.yBottom;
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.5), mat((w as { required?: boolean }).required ? COURSE_STYLE.wallRequired : COURSE_STYLE.wall));
    box.position.copy(this.L(w.x0 + len / 2, w.yBottom + h / 2, w.lateral + 0.25));
    box.rotation.y = ROUTE_YAW;
    box.castShadow = box.receiveShadow = true;
    g.add(box);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.6), mat(COURSE_STYLE.wallTrim));
    trim.position.copy(this.L(w.x0 + len / 2, w.yTop, w.lateral + 0.25));
    trim.rotation.y = box.rotation.y;
    g.add(trim);
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

/** Dispose geometries (and non-shared textures) under a node. Shared materials stay. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const sm = (o as THREE.Sprite).isSprite ? ((o as THREE.Sprite).material as THREE.SpriteMaterial) : null;
    if (sm) { sm.map?.dispose(); sm.dispose(); }
  });
}
