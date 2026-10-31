import * as THREE from 'three';
import { Course, type Obstacle, type Surface } from '../course/course';
import { toScene, ROUTE_YAW } from './space';
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

/** Builds static meshes for a Course. Observes course data only. */
export class CourseView {
  readonly group = new THREE.Group();
  private obstacleMeshes: THREE.Group[] = [];

  /** Hide a broken obstacle (debris takes over). */
  setBroken(id: number, broken: boolean): void { const m = this.obstacleMeshes[id]; if (m) m.visible = !broken; }
  resetObstacles(): void { for (const m of this.obstacleMeshes) m.visible = true; }

  private obstacleMesh(o: Obstacle): THREE.Group {
    const g = new THREE.Group();
    if (o.kind === 'pot') {
      // terracotta urn: lathe profile + painted band
      const r = o.halfWidth, h = o.height;
      const prof = [[0.0, 0], [r * 0.55, 0], [r * 0.95, h * 0.25], [r, h * 0.5], [r * 0.8, h * 0.78], [r * 0.5, h * 0.9], [r * 0.62, h], [r * 0.5, h]].map(([a, b]) => new THREE.Vector2(a, b));
      const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), toon(COURSE_STYLE.pot));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 0.99, h * 0.1, 14, 1, true), toon(COURSE_STYLE.potBand));
      band.position.y = h * 0.5;
      g.add(body, band);
    } else {
      // stacked drums + capital, slightly off-axis so it reads as breakable masonry
      const r = o.halfWidth, h = o.height, n = 4;
      for (let i = 0; i < n; i++) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(r * (0.94 + (i % 2) * 0.04), r, h / n - 0.04, 10), toon(i % 2 ? COURSE_STYLE.pillarAlt : COURSE_STYLE.pillar));
        d.position.set(Math.sin(i * 2.1) * 0.03, (h / n) * (i + 0.5), Math.cos(i * 1.7) * 0.03);
        d.rotation.y = i * 0.5;
        g.add(d);
      }
      const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.5, 0.22, r * 2.5), toon(COURSE_STYLE.pillarCap));
      cap.position.y = h + 0.06;
      const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, 0.18, r * 2.4), toon(COURSE_STYLE.pillarCap));
      base.position.y = 0.09;
      g.add(cap, base);
    }
    g.traverse((q) => { if ((q as THREE.Mesh).isMesh) { q.castShadow = true; q.receiveShadow = true; } });
    g.position.copy(toScene(o.x, o.baseY, 0));
    return g;
  }

  constructor(readonly course: Course) {
    for (const s of course.surfaces) this.group.add(this.surfaceMesh(s));
    for (const s of course.surfaces) this.group.add(this.lipLine(s));
    for (const g of course.gaps) this.group.add(this.gapPosts(g.x0, g.yTakeoff, g.x1, g.yReceive));
    for (const r of course.rails) this.group.add(this.railMesh(r.points, r.lateral, r.required));
    for (const w of course.walls) this.group.add(this.wallMesh(w));
    for (const m of course.markers) this.group.add(this.marker(m.x, m.label));
    for (const o of course.obstacles) { const m = this.obstacleMesh(o); this.obstacleMeshes.push(m); this.group.add(m); }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }

  private surfaceMesh(s: Surface): THREE.Mesh {
    const W = COURSE_STYLE.routeWidth;
    const top = new THREE.Color(s.material === 'cloud' ? COURSE_STYLE.cloudTop : COURSE_STYLE.stoneTop);
    const side = new THREE.Color(s.material === 'cloud' ? COURSE_STYLE.cloudSide : COURSE_STYLE.stoneSide);
    const under = new THREE.Color(COURSE_STYLE.underside);
    const pos: number[] = [], col: number[] = [];
    const v = new THREE.Vector3();
    const push = (x: number, y: number, lat: number, c: THREE.Color) => { toScene(x, y, lat, v); pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); };
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
      const by = bottom(e.x, e.y);
      const near = [e.x, e.y, -W / 2], far = [e.x, e.y, W / 2];
      if (sign < 0) quad(far, near, [e.x, by, W / 2], [e.x, by, -W / 2], side, under);
      else quad(near, far, [e.x, by, -W / 2], [e.x, by, W / 2], side, under);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /** Thin lines on both lips so the riding surface and its edges read crisply at speed. */
  private lipLine(s: Surface): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: COURSE_STYLE.lipLine });
    for (const lat of [-COURSE_STYLE.routeWidth / 2, COURSE_STYLE.routeWidth / 2]) {
      const pts = s.points.map((q) => toScene(q.x, q.y + 0.02, lat));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
    // a line across each chain end marks takeoff and receiving edges of gaps
    for (const e of [s.points[0], s.points[s.points.length - 1]]) {
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toScene(e.x, e.y + 0.03, -COURSE_STYLE.routeWidth / 2), toScene(e.x, e.y + 0.03, COURSE_STYLE.routeWidth / 2)]), new THREE.LineBasicMaterial({ color: COURSE_STYLE.edgeLine })));
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
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 6), toon(color));
        m.position.copy(toScene(x, y + h / 2, lat));
        m.castShadow = true;
        g.add(m);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), toon(color));
        cap.position.copy(toScene(x, y + h, lat));
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
    for (let i = 0; i + 1 < points.length; i++) curve.add(new THREE.LineCurve3(toScene(points[i].x, points[i].y, lateral), toScene(points[i + 1].x, points[i + 1].y, lateral)));
    // required rails read differently before commitment: brighter, thicker
    const mat = toon(required ? COURSE_STYLE.railRequired : COURSE_STYLE.rail);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, 48, required ? 0.1 : 0.07, 6, false), mat);
    tube.castShadow = true;
    g.add(tube);
    const postMat = toon(COURSE_STYLE.railPost);
    const a = points[0], b = points[points.length - 1];
    for (let x = a.x; x <= b.x + 0.01; x += 4) {
      let y = a.y;
      for (let i = 0; i + 1 < points.length; i++) if (x >= points[i].x && x <= points[i + 1].x) y = points[i].y + ((points[i + 1].y - points[i].y) * (x - points[i].x)) / (points[i + 1].x - points[i].x);
      const gnd = this.course.groundBelow(x, y);
      if (!gnd || y - gnd.sample.y > 6) continue; // over a gap: no post
      const h = y - gnd.sample.y;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 5), postMat);
      post.position.copy(toScene(x, y - h / 2, lateral));
      g.add(post);
    }
    return g;
  }

  private wallMesh(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number }): THREE.Group {
    const g = new THREE.Group();
    const len = w.x1 - w.x0, h = w.yTop - w.yBottom;
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.5), toon((w as { required?: boolean }).required ? COURSE_STYLE.wallRequired : COURSE_STYLE.wall));
    box.position.copy(toScene(w.x0 + len / 2, w.yBottom + h / 2, w.lateral + 0.25));
    box.rotation.y = ROUTE_YAW;
    box.castShadow = box.receiveShadow = true;
    g.add(box);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.6), toon(COURSE_STYLE.wallTrim));
    trim.position.copy(toScene(w.x0 + len / 2, w.yTop, w.lateral + 0.25));
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
    sp.position.copy(toScene(x, (gnd?.sample.y ?? 0) + 2.6, -3.6)); // left of the route; rails/walls live on the right
    sp.scale.set(3.2, 0.8, 1);
    return sp;
  }
}
