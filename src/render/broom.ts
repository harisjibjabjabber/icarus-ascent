import * as THREE from 'three';
import { toon } from './materials';
import { GeoBuilder } from './geo';
import { mulberry32 } from '../rng';
import { BROOM_HANDLE, BROOM_STRAW, type BakedPart } from './broomMesh';

/**
 * The witch's broom, ridden like a skateboard (proto/broom). Local frame = the old deck's frame:
 * +X = nose / direction of travel, +Y up, +Z rider's right; y = 0 is the deck centre and the
 * flattened oak "deck" section under her feet tops out at y = 0.035 (Heroine's deckTop), so the
 * leg IK plants exactly as it did on the board. Nose kicks up like a skate nose; the straw
 * bristles are the tail (they drag in a heel skim). Presentation only: no gameplay or physics.
 */
export const BROOM = {
  /** Hover gap above the ground/rail (m) and the idle bob amplitude (m) / rate (rad/s). */
  hover: 0.05, bob: 0.012, bobRate: 2.6,
  /** Bristle tip in broom space (sparkle / dust / spark emitter). */
  tail: new THREE.Vector3(-1.5, 0.03, 0),
  /** Open-stance yaw (rad) so the chase camera sees the broom's length, not just its end. */
  yaw: 0.12,
  /** Grab targets on the handle (broom space): front hand ahead of the front foot, back hand behind the back foot. */
  grabL: new THREE.Vector3(0.27, 0.11, 0.1), grabR: new THREE.Vector3(-0.17, 0.11, 0.1), // wrist targets (palm wraps the handle)
  /** How far (m) the broom comes up to her hand in a grab (feet stay planted, so the knees tuck). */
  grabLift: 0.2,
};

const C = {
  oak: '#9a6a3c', oakTop: '#c4925a', handle: '#7c5030', handleTop: '#a8743f', wrap: '#4e3324', wrapTop: '#6c4a34',
  straw: '#c99a3e', strawTop: '#f0cf78', ribbon: '#c8323a', ribbonTop: '#e2525a', gold: '#e9b949',
};

export class Broom {
  /** Pass this to Heroine.attach as the deck (feet plant on it, hands grab it). */
  readonly group = new THREE.Group();
  readonly bristles = new THREE.Group();
  private charm = new THREE.Group();
  private t = 0;
  /** Ground contact shadow: add to the stance group (ground-aligned), see riderView. */
  readonly shadow: THREE.Mesh;
  private strawSamples: THREE.Vector3[] = [];

  constructor() {
    const mat = toon('#ffffff', { vertexColors: true, rim: 2.2 });
    // town build (Haris approved): the premade MiniPoly "Witch Broom" (CC0), palette-retextured and baked to vertex
    // colours by art/pipeline/bake_broom.py: curled oak handle, red cord binding, fat golden straw bulb.
    const handleGeo = baked(BROOM_HANDLE);
    // a slim oak footplate + two leather wraps where her boots plant (keeps the leg IK contact at deckTop = 0.035)
    const deck = new GeoBuilder()
      .add(new THREE.BoxGeometry(0.62, 0.016, 0.075), [0, 0.027, 0], C.oak, { top: C.oakTop })
      .add(new THREE.BoxGeometry(0.075, 0.01, 0.09), [0.23, 0.037, 0], C.wrap, { top: C.wrapTop })
      .add(new THREE.BoxGeometry(0.075, 0.01, 0.09), [-0.23, 0.037, 0], C.wrap, { top: C.wrapTop })
      .build()!;
    this.group.add(new THREE.Mesh(handleGeo, mat), new THREE.Mesh(deck, mat));
    // straw: its own group so the heel skim can bend it up (pivot at the binding)
    this.bristles.position.set(-0.72, 0, 0);
    const strawGeo = baked(BROOM_STRAW); strawGeo.translate(0.72, 0, 0);
    // ground-clamp samples: the lowest straw vertices along the length (bristle space)
    const sp = strawGeo.getAttribute('position'); const buckets = new Map<number, THREE.Vector3>();
    for (let i = 0; i < sp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(sp, i), k = Math.round(v.x * 10);
      const cur = buckets.get(k); if (!cur || v.y < cur.y) buckets.set(k, v);
    }
    this.strawSamples = [...buckets.values()];
    this.bristles.add(new THREE.Mesh(strawGeo, mat));
    this.group.add(this.bristles);
    // ribbon + gold star charm, hanging from the binding (swings a little)
    this.charm.position.set(-0.66, -0.02, 0.06);
    const r = new GeoBuilder()
      .add(new THREE.BoxGeometry(0.035, 0.17, 0.006), [0.01, -0.085, 0], C.ribbon, { rot: [0, 0, 0.18], top: C.ribbonTop })
      .add(new THREE.BoxGeometry(0.035, 0.13, 0.006), [-0.03, -0.065, 0.01], C.ribbon, { rot: [0, 0, -0.35], top: C.ribbonTop })
      .add(new THREE.OctahedronGeometry(0.038, 0), [0.025, -0.18, 0], C.gold, { scale: [1, 1, 0.5] });
    this.charm.add(new THREE.Mesh(r.build()!, mat));
    this.group.add(this.charm);
    // soft contact shadow (lives on the ground under the rider, not on the hovering broom; riderView places it)
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.62), new THREE.MeshBasicMaterial({
      map: blobTexture(), color: '#4a2e1c', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(-0.05, 0.004, 0);
    this.shadow.renderOrder = 1;
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.outline) o.castShadow = true; });
  }

  /** drag 0..1: bristles bend up toward the ground line (heel skim); swing: charm sway from speed/turns. */
  update(dt: number, drag: number, speed: number): void {
    this.t += dt;
    this.bristles.rotation.z = -drag * 0.16 + Math.sin(this.t * 7) * 0.006 * Math.min(1, speed / 10);
    this.charm.rotation.x = Math.sin(this.t * 3.1) * 0.12 + Math.min(0.5, speed * 0.02);
    this.charm.rotation.z = -Math.min(0.6, speed * 0.03) + Math.sin(this.t * 4.3) * 0.08;
  }

  /** Keep the straw out of the ground: bend the bristles up until their lowest point is >= `clear` above
   *  ground (y = 0 in `ground`'s space, the rider root). Returns how far it was below before the clamp (m). */
  clampToGround(ground: THREE.Object3D, clear = 0.012): number {
    let depth = 0;
    for (let i = 0; i < 4; i++) {
      this.bristles.updateMatrixWorld(true);
      let low = Infinity;
      for (const q of this.strawSamples) low = Math.min(low, ground.worldToLocal(this.bristles.localToWorld(_p.copy(q))).y);
      const under = clear - low;
      if (i === 0) depth = Math.max(0, under);
      if (under <= 0.001) break;
      this.bristles.rotation.z = Math.max(-0.45, this.bristles.rotation.z - Math.min(0.3, under / 0.6)); // -z lifts the tail end (bend capped)
    }
    return depth;
  }
}

const _p = new THREE.Vector3();
/** Baked part (positions, normals, 0-255 vertex colours in sRGB, indices) -> geometry (linear vertex colours). */
function baked(b: BakedPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  const c = new THREE.Color(), col = new Float32Array(b.c.length);
  for (let i = 0; i < b.c.length; i += 3) { c.setRGB(b.c[i] / 255, b.c[i + 1] / 255, b.c[i + 2] / 255, THREE.SRGBColorSpace); col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(b.i);
  return g;
}
let _blob: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (_blob) return _blob;
  if (typeof document === 'undefined') return (_blob = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _blob = new THREE.CanvasTexture(c); _blob.colorSpace = THREE.SRGBColorSpace;
  return _blob;
}

/**
 * Bristle trail: soft gold sparkles while hovering, straw-coloured dust in a heel skim / wall ride,
 * hot sparks on a grind. Particles live in route coordinates (x along the route, y height, lateral),
 * so the trail stays behind in the world as she moves, and are drawn relative to the rider root
 * (so floating-origin rebases need no extra handling).
 */
type Kind = 0 | 1 | 2; // sparkle, dust, spark
export class BristleTrail {
  readonly points: THREE.Points;
  private n: number;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private max: Float32Array; private kind: Uint8Array;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array; private kindF: Float32Array;
  private next = 0; private acc = [0, 0, 0];
  private rng = mulberry32(5);
  private static COLORS: [number, number, number][] = [[1, 0.84, 0.42], [0.86, 0.64, 0.42], [1, 0.6, 0.22]];

  constructor(n = 220) {
    this.n = n;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.kind = new Uint8Array(n);
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.kindF = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aKind', new THREE.BufferAttribute(this.kindF, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aKind; attribute vec3 color; varying vec3 vC; varying float vA; varying float vK; uniform float uScale;
        void main() { vC = color; vA = aAlpha; vK = aKind; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.5, -mv.z) : 0.0; }`,
      // sparkles / sparks: a hot white-gold core inside a soft amber halo (normal blending, so they still read on a
      // bright track where additive glow washes out); dust: a soft warm puff
      fragmentShader: `varying vec3 vC; varying float vA; varying float vK;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (vK > 0.5 && vK < 1.5) { float a = vA * smoothstep(1.0, 0.1, d) * 0.8; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); return; }
          float core = smoothstep(0.42, 0.12, d), halo = smoothstep(1.0, 0.35, d);
          vec3 col = mix(vC * vec3(0.78, 0.45, 0.16), vec3(1.0, 0.97, 0.82), core);
          float a = vA * max(halo * 0.6, core); if (a < 0.01) discard; gl_FragColor = vec4(col, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.onBeforeRender = (r, _s, cam) => {
      mat.uniforms.uScale.value = ((cam as THREE.PerspectiveCamera).projectionMatrix.elements[5] * r.getDrawingBufferSize(_v2).y) / 2;
    };
  }

  /** rates per second for each kind; emitter in route coordinates; rx/ry/rl = rider route coords (draw origin). */
  update(dt: number, rates: [number, number, number], ex: number, ey: number, el: number, rx: number, ry: number, rl: number, speed: number): void {
    const R = this.rng;
    for (let k = 0 as Kind; k < 3; k++) {
      this.acc[k] += rates[k] * dt;
      while (this.acc[k] >= 1) {
        this.acc[k] -= 1;
        const i = this.next; this.next = (this.next + 1) % this.n;
        const j = i * 3;
        this.p[j] = ex + (R() - 0.5) * 0.15; this.p[j + 1] = ey + (R() - 0.3) * 0.12; this.p[j + 2] = el + (R() - 0.5) * 0.25;
        const fwd = speed * (k === 2 ? 0.35 : k === 1 ? 0.15 : 0.05); // keep a little of her speed, then drag behind
        this.v[j] = fwd + (R() - 0.5) * 0.6;
        this.v[j + 1] = k === 2 ? 0.8 + R() * 1.6 : k === 1 ? 0.25 + R() * 0.4 : 0.1 + R() * 0.35;
        this.v[j + 2] = (R() - 0.5) * (k === 2 ? 2.2 : 0.8);
        this.max[i] = this.life[i] = k === 2 ? 0.25 + R() * 0.2 : k === 1 ? 0.55 + R() * 0.4 : 0.5 + R() * 0.5;
        this.kind[i] = k;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = this.kind[i];
      const damp = Math.exp(-dt * (k === 1 ? 3 : 1.5));
      this.v[j] *= damp; this.v[j + 2] *= damp;
      this.v[j + 1] += (k === 2 ? -9 : k === 1 ? -0.2 : 0.15) * dt;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const u = Math.max(0, this.life[i] / this.max[i]); // 1 -> 0
      this.pos[j] = this.p[j] - rx; this.pos[j + 1] = this.p[j + 1] - ry; this.pos[j + 2] = this.p[j + 2] - rl;
      const c = BristleTrail.COLORS[k];
      const tw = k === 0 ? 0.6 + 0.4 * Math.sin(this.life[i] * 40 + i) : 1; // sparkles twinkle
      this.col[j] = c[0]; this.col[j + 1] = c[1]; this.col[j + 2] = c[2];
      this.alpha[i] = k === 1 ? 0.28 * u * Math.min(1, (1 - u) * 6) : (k === 2 ? 1 : 0.95) * Math.min(1, u * 1.6) * tw;
      this.size[i] = k === 1 ? 0.05 + (1 - u) * 0.08 : k === 2 ? 0.075 : 0.13 * (0.55 + u * 0.6); // sized to read from the chase camera (~9 m)
      this.kindF[i] = k;
    }
    const g = this.points.geometry;
    for (const a of ['position', 'color', 'aSize', 'aAlpha', 'aKind']) g.getAttribute(a).needsUpdate = true;
  }

  dispose(): void { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}
const _v2 = new THREE.Vector2();
