import * as THREE from 'three';
import { Course, type Surface } from '../course/course';
import { toScene, ROUTE_YAW } from './space';
import { toon } from './materials';

/** Placeholder palette. Art direction swaps this object. */
export const COURSE_STYLE = {
  routeWidth: 3.2,
  cloudTop: '#fff8ee', cloudSide: '#f2c9b4',
  stoneTop: '#f5cf98', stoneSide: '#dea486',
  underside: '#c29ab0',
  lipLine: '#6e5f7c',
  rail: '#b8864b', railPost: '#8f6a43',
  wall: '#d8cfe6', wallTrim: '#9a8fb6',
  marker: '#5d4f6e',
};

/** Builds static meshes for a Course. Observes course data only. */
export class CourseView {
  readonly group = new THREE.Group();

  constructor(readonly course: Course) {
    for (const s of course.surfaces) this.group.add(this.surfaceMesh(s));
    for (const s of course.surfaces) this.group.add(this.lipLine(s));
    for (const r of course.rails) this.group.add(this.railMesh(r.points, r.lateral));
    for (const w of course.walls) this.group.add(this.wallMesh(w));
    for (const m of course.markers) this.group.add(this.marker(m.x, m.label));
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
      // near (camera-side) face
      quad([a.x, a.y, -W / 2], [b.x, b.y, -W / 2], [a.x, bottom(a.x, a.y), -W / 2], [b.x, bottom(b.x, b.y), -W / 2], side, under);
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

  /** Thin line on the near lip so the riding surface reads crisply at speed. */
  private lipLine(s: Surface): THREE.Line {
    const pts = s.points.map((q) => toScene(q.x, q.y + 0.02, -COURSE_STYLE.routeWidth / 2));
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COURSE_STYLE.lipLine }));
  }

  private railMesh(points: { x: number; y: number }[], lateral: number): THREE.Group {
    const g = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(points.map((q) => toScene(q.x, q.y, lateral)));
    const mat = toon(COURSE_STYLE.rail);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.07, 6, false), mat);
    tube.castShadow = true;
    g.add(tube);
    const postMat = toon(COURSE_STYLE.railPost);
    const a = points[0], b = points[points.length - 1];
    for (let x = a.x; x <= b.x + 0.01; x += 4) {
      const t = (x - a.x) / (b.x - a.x);
      const y = a.y + (b.y - a.y) * t;
      const gnd = this.course.groundBelow(x, y);
      const h = gnd ? y - gnd.sample.y : 3;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 5), postMat);
      post.position.copy(toScene(x, y - h / 2, lateral));
      g.add(post);
    }
    return g;
  }

  private wallMesh(w: { x0: number; x1: number; yBottom: number; yTop: number; lateral: number }): THREE.Group {
    const g = new THREE.Group();
    const len = w.x1 - w.x0, h = w.yTop - w.yBottom;
    const box = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.5), toon(COURSE_STYLE.wall));
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
    sp.position.copy(toScene(x, (gnd?.sample.y ?? 0) + 3.4, 1.2));
    sp.scale.set(4, 1, 1);
    return sp;
  }
}
