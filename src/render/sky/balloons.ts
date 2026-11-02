import * as THREE from 'three';
import type { SkyAnchor } from '../../course/skyTypes';
import { ROUTE_YAW } from '../space';
import { TOWN } from '../town/town';
import { GeoBuilder } from '../geo';
import { toon } from '../materials';

/**
 * Sky-layer balloon clusters. Each balloon is a lathe teardrop (latex body, neck, knot)
 * with a thin string to one shared knot. The knot is tied to a facade bracket or a pole,
 * so the bunch never floats. Toon latex: 3-band lavender shadow, stepped specular, rim.
 */

export const BALLOON_COLORS = ['#c96a42', '#3f8f8a', '#d9a441', '#e8899a', '#f7ecd4', '#a99ad0', '#7fb7d9'] as const;
const OUTLINE = '#2a1a14';
const STRING = '#5c4638';
const IRON = '#3b3440';
const IRON_LIT = '#6e6578';

const Y_UP = new THREE.Vector3(0, 1, 0);
const anchorMat = toon('#ffffff', { vertexColors: true, rim: 0.7 });

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Body 0.55 × 0.68 (ratio 1.24), neck Ø 0.05, knot Ø 0.06. 32×24 lathe. */
function balloonGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const knot: [number, number][] = [
    [0.004, 0],
    [0.02, 0.012],
    [0.031, 0.026],
    [0.02, 0.04],
    [0.011, 0.05],
    [0.025, 0.068],
  ];
  for (const [r, y] of knot) pts.push(new THREE.Vector2(r, y));
  const bodyH = 0.68;
  const bodyR = 0.275;
  const n = 18;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const y = 0.068 + u * bodyH;
    const bell = Math.sin(Math.PI * Math.pow(u, 0.62));
    const r = 0.025 + (bodyR - 0.025) * bell * (1 - 0.15 * u);
    pts.push(new THREE.Vector2(Math.max(0.006, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 32);
  g.computeVertexNormals();
  return g;
}

let sharedBody: THREE.BufferGeometry | null = null;
function bodyGeo(): THREE.BufferGeometry {
  if (!sharedBody) sharedBody = balloonGeometry();
  return sharedBody;
}

function hull(src: THREE.BufferGeometry, meters: number): THREE.BufferGeometry {
  const g = src.clone();
  const p = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + nrm.getX(i) * meters, p.getY(i) + nrm.getY(i) * meters, p.getZ(i) + nrm.getZ(i) * meters);
  }
  p.needsUpdate = true;
  return g;
}

let rampTex: THREE.DataTexture | null = null;
function balloonRamp(): THREE.DataTexture {
  if (rampTex) return rampTex;
  const stops = [[0x8a, 0x7f, 0xa0], [0xe8, 0xd4, 0xc6], [0xff, 0xf8, 0xee]];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach(([r, g, b], i) => data.set([r, g, b, 255], i * 4));
  rampTex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  rampTex.minFilter = rampTex.magFilter = THREE.NearestFilter;
  rampTex.colorSpace = THREE.SRGBColorSpace;
  rampTex.needsUpdate = true;
  return rampTex;
}

const latexCache = new Map<string, THREE.MeshToonMaterial>();
function latex(color: string): THREE.MeshToonMaterial {
  let m = latexCache.get(color);
  if (m) return m;
  m = new THREE.MeshToonMaterial({ color, gradientMap: balloonRamp() });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        vec3 n = normalize(normal);
        vec3 V = normalize(vViewPosition);
        vec3 L = normalize(vec3(0.34, 0.82, 0.46));
        vec3 H = normalize(L + V);
        float spec = pow(clamp(dot(n, H), 0.0, 1.0), 60.0);
        float band = spec > 0.55 ? 1.0 : spec > 0.16 ? 0.42 : 0.0;
        float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.4) * 0.35;
        float back = pow(clamp(dot(-n, L), 0.0, 1.0), 1.7) * 0.15;
        outgoingLight += vec3(1.0, 0.98, 0.94) * band * 0.95;
        outgoingLight += vec3(1.0, 0.94, 0.88) * fres;
        outgoingLight += diffuseColor.rgb * back;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'balloon-latex';
  latexCache.set(color, m);
  return m;
}

let outlineMat: THREE.MeshBasicMaterial | null = null;
function outlineMaterial(): THREE.MeshBasicMaterial {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide, toneMapped: false });
    outlineMat.polygonOffset = true;
    outlineMat.polygonOffsetFactor = 1;
    outlineMat.polygonOffsetUnits = 1;
  }
  return outlineMat;
}

let stringMat: THREE.MeshToonMaterial | null = null;
function stringMaterial(): THREE.MeshToonMaterial {
  if (!stringMat) stringMat = new THREE.MeshToonMaterial({ color: STRING });
  return stringMat;
}

export interface BalloonSpot {
  /** Route offset from the common knot: along-route, up, lateral. */
  fx: number; y: number; lat: number;
  color: string;
  phase: number;
  hz: number;
}

/** Loose phyllotaxis dome, 2.0–2.4 m across. Strings from these knots land in 1.4–2.2 m. */
export function layoutCluster(count: number, seed: number): BalloonSpot[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const across = 2.05 + hash(seed) * 0.3;
  const R = across * 0.5;
  const spots: BalloonSpot[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const ang = i * golden + hash(seed + 3) * Math.PI * 2;
    const rad = R * (0.28 + 0.72 * Math.sqrt(t));
    const y = 1.48 + (1 - t) * 0.42 + hash(seed + i * 9) * 0.08;
    spots.push({
      fx: Math.cos(ang) * rad * 0.82,
      y,
      lat: Math.sin(ang) * rad * 0.62,
      color: BALLOON_COLORS[(seed + i) % BALLOON_COLORS.length],
      phase: hash(seed + i * 13) * Math.PI * 2,
      hz: 0.5 + hash(seed + i * 17) * 0.2,
    });
  }
  return spots;
}

export function stringLength(s: BalloonSpot): number {
  return Math.hypot(s.fx, s.y, s.lat);
}

interface BalloonNode {
  obj: THREE.Group;
  phase: number;
  hz: number;
  base: THREE.Vector3;
  string: THREE.Mesh;
}

/**
 * One cluster. `place` maps route metres into the parent chunk. The common knot sits
 * on the bracket tip; balloons rise above it.
 */
export class BalloonCluster {
  readonly group = new THREE.Group();
  readonly bounceId: number;
  readonly count: number;
  /** Scene-space common knot. Strings and the bracket meet here. */
  readonly knot: THREE.Vector3;
  hit = -1;
  private balloons: BalloonNode[] = [];
  private owned: THREE.BufferGeometry[] = [];

  constructor(opts: {
    place: (x: number, y: number, lat: number) => THREE.Vector3;
    x: number;
    knotY: number;
    seed: number;
    count: number;
    bounceId: number;
    tether: SkyAnchor;
    streetY: number;
  }) {
    this.bounceId = opts.bounceId;
    this.count = opts.count;
    this.group.name = 'sky-cluster';
    const spots = layoutCluster(opts.count, opts.seed);
    const ropeLat = opts.tether.lateral;
    this.knot = opts.place(opts.x, opts.knotY, ropeLat);
    this.group.userData = { count: opts.count, stringCount: spots.length, bounceId: opts.bounceId, lengths: spots.map(stringLength) };

    const strings = new THREE.Group();
    strings.name = 'sky-strings';
    const src = bodyGeo();
    for (const s of spots) {
      const at = opts.place(opts.x + s.fx, opts.knotY + s.y, ropeLat + s.lat);
      const obj = new THREE.Group();
      obj.name = 'sky-balloon';
      obj.position.copy(at);
      const shell = src.clone();
      const ink = hull(src, 0.012);
      this.owned.push(shell, ink);
      const mesh = new THREE.Mesh(shell, latex(s.color));
      mesh.castShadow = true;
      const line = new THREE.Mesh(ink, outlineMaterial());
      obj.add(line, mesh);
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 5), stringMaterial());
      str.castShadow = true;
      str.userData.length = stringLength(s);
      strings.add(str);
      this.group.add(obj);
      this.balloons.push({ obj, phase: s.phase, hz: s.hz, base: at.clone(), string: str });
      this.tieString(str, this.knot, at);
    }
    this.group.add(strings);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 12), latex('#f7ecd4'));
    ring.position.copy(this.knot);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    this.anchor(opts);
    this.update(0);
  }

  private tieString(str: THREE.Mesh, knot: THREE.Vector3, at: THREE.Vector3): void {
    const dir = at.clone().sub(knot);
    const len = Math.max(0.05, dir.length());
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.multiplyScalar(1 / len));
    str.position.copy(knot).add(at).multiplyScalar(0.5);
    str.quaternion.copy(q);
    str.scale.set(1, len, 1);
  }

  /** Bracket from the facade, or a pole with a crossbar, ending on the knot. */
  private anchor(opts: { place: (x: number, y: number, lat: number) => THREE.Vector3; x: number; knotY: number; tether: SkyAnchor; streetY: number }): void {
    const gb = new GeoBuilder();
    const rot: [number, number, number] = [0, ROUTE_YAW, 0];
    const kind = opts.tether.kind;
    const g = new THREE.Group();
    g.name = 'sky-anchor';
    g.userData.kind = kind;
    const ropeLat = opts.tether.lateral;
    if (kind === 'mast' || kind === 'ship-mast') {
      const h = kind === 'ship-mast' ? Math.max(6.2, opts.knotY - opts.streetY + 1.2) : Math.max(4.4, opts.knotY - opts.streetY + 0.4);
      const base = opts.streetY;
      gb.add(new THREE.CylinderGeometry(0.09, 0.12, h, 8), opts.place(opts.x, base + h / 2, ropeLat), '#8a623c', { top: '#c4a46a' });
      gb.add(new THREE.SphereGeometry(0.1, 8, 6), opts.place(opts.x, base + h, ropeLat), '#6e4a2e');
    } else {
      const facade = kind === 'bracket-right' ? TOWN.front : -TOWN.front;
      const side = Math.sign(facade) || 1;
      const span = facade - ropeLat;
      gb.add(new THREE.BoxGeometry(0.22, 0.46, 0.08), opts.place(opts.x, opts.knotY, facade - side * 0.02), IRON, { rot, top: IRON_LIT });
      if (Math.abs(span) > 0.05) {
        gb.add(new THREE.BoxGeometry(0.06, 0.05, Math.abs(span)), opts.place(opts.x, opts.knotY, (facade + ropeLat) / 2), IRON, { rot, top: IRON_LIT });
        const stay = this.stay(opts.place, opts.x, opts.knotY - 0.85, facade - side * 0.04, opts.knotY - 0.04, facade + (ropeLat - facade) * 0.45);
        if (stay) gb.add(stay.geo, stay.at, IRON, { rot: stay.rot, top: IRON_LIT });
      }
    }
    const built = gb.build();
    if (built) {
      const mesh = new THREE.Mesh(built, anchorMat);
      mesh.castShadow = true;
      g.add(mesh);
    }
    this.group.add(g);
  }

  private stay(place: (x: number, y: number, lat: number) => THREE.Vector3, x: number, y1: number, lat1: number, y2: number, lat2: number): { geo: THREE.BufferGeometry; at: THREE.Vector3; rot: [number, number, number] } | null {
    const a = place(x, y1, lat1);
    const b = place(x, y2, lat2);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.05) return null;
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, dir.multiplyScalar(1 / len));
    const e = new THREE.Euler().setFromQuaternion(q);
    return { geo: new THREE.CylinderGeometry(0.02, 0.02, len, 5), at: a.clone().add(b).multiplyScalar(0.5), rot: [e.x, e.y, e.z] };
  }

  update(time: number): void {
    const age = this.hit < 0 ? 10 : time - this.hit;
    let k = 0;
    if (this.hit >= 0) {
      if (age < 0.08) k = age / 0.08;
      else k = Math.exp(-(age - 0.08) / 0.09) * Math.cos((age - 0.08) * 12);
    }
    for (const b of this.balloons) {
      const bob = Math.sin(time * b.hz * Math.PI * 2 + b.phase) * 0.05;
      const sway = Math.sin(time * b.hz * Math.PI * 2 * 0.85 + b.phase) * (4 * Math.PI / 180);
      b.obj.position.copy(b.base);
      b.obj.position.y += bob * (1 - Math.min(1, Math.abs(k)));
      b.obj.rotation.set(sway * 0.65, sway * 0.2, sway);
      const sy = THREE.MathUtils.clamp(1 - 0.25 * k, 0.72, 1.12);
      const sx = THREE.MathUtils.clamp(1 + 0.12 * k, 0.9, 1.16);
      b.obj.scale.set(sx, sy, sx);
      const tug = b.obj.position.clone();
      if (k > 0.2) tug.y -= 0.04 * k;
      this.tieString(b.string, this.knot, tug);
    }
  }

  dispose(): void {
    for (const g of this.owned) g.dispose();
    this.owned = [];
  }
}
