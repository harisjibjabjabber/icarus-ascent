import * as THREE from 'three';
import { toon } from './materials';
import { GeoBuilder, jitter } from './geo';
import { mulberry32 } from '../rng';

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
  tail: new THREE.Vector3(-1.32, 0, 0),
  /** Grab targets on the handle (broom space): front hand ahead of the front foot, back hand behind the back foot. */
  grabL: new THREE.Vector3(0.36, 0.05, 0.03), grabR: new THREE.Vector3(-0.36, 0.05, -0.01),
  /** How far (m) the broom comes up to her hand in a grab (feet stay planted, so the knees tuck). */
  grabLift: 0.3,
};

const C = {
  oak: '#9a6a3c', oakTop: '#c4925a', handle: '#7c5030', handleTop: '#a8743f', wrap: '#4e3324', wrapTop: '#6c4a34',
  straw: '#c99a3e', strawTop: '#f0cf78', ribbon: '#c8323a', ribbonTop: '#e2525a', gold: '#e9b949',
};

export class Broom {
  /** Pass this to Heroine.attach as the deck (feet plant on it, hands grab it). */
  readonly group = new THREE.Group();
  private bristles = new THREE.Group();
  private charm = new THREE.Group();
  private t = 0;

  constructor() {
    const mat = toon('#ffffff', { vertexColors: true, rim: 1.3 });
    const H = Math.PI / 2;
    const g = new GeoBuilder()
      // round handle, binding to nose, with an upturned kick at the nose
      .add(new THREE.CylinderGeometry(0.028, 0.03, 1.72, 8), [0.14, 0.004, 0], C.handle, { rot: [0, 0, H], top: C.handleTop })
      .add(new THREE.CylinderGeometry(0.022, 0.028, 0.34, 8), [1.13, 0.06, 0], C.handle, { rot: [0, 0, -(H - 0.42)], top: C.handleTop })
      .add(new THREE.SphereGeometry(0.03, 8, 6), [1.28, 0.125, 0], C.handleTop)
      // flattened oak deck section under the feet (the concept sheet's "plank"), tapered ends
      .add(new THREE.BoxGeometry(0.66, 0.026, 0.1), [0, 0.022, 0], C.oak, { top: C.oakTop })
      .add(new THREE.CylinderGeometry(0.05, 0.05, 0.026, 10, 1, false, 0, Math.PI), [0.33, 0.022, 0], C.oak, { top: C.oakTop })
      .add(new THREE.CylinderGeometry(0.05, 0.05, 0.026, 10, 1, false, Math.PI, Math.PI), [-0.33, 0.022, 0], C.oak, { top: C.oakTop })
      // two leather foot wraps (read as bindings; her boots sit on them)
      .add(new THREE.BoxGeometry(0.075, 0.012, 0.112), [0.23, 0.037, 0], C.wrap, { top: C.wrapTop })
      .add(new THREE.BoxGeometry(0.075, 0.012, 0.112), [-0.23, 0.037, 0], C.wrap, { top: C.wrapTop })
      // binding: red cord and gold band where the straw starts
      .add(new THREE.CylinderGeometry(0.052, 0.052, 0.05, 10), [-0.71, 0.004, 0], C.ribbon, { rot: [0, 0, H], top: C.ribbonTop })
      .add(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 10), [-0.77, 0.004, 0], C.gold, { rot: [0, 0, H] });
    const handle = new THREE.Mesh(g.build()!, mat);
    this.group.add(handle);
    // straw bundle: narrow at the binding, flaring to the tail; its own group so it can bend up when dragging
    this.bristles.position.set(-0.74, 0.004, 0);
    const rng = mulberry32(11);
    // a core plus tufts of straw (narrow cones) fanning out to a ragged brush end, so it reads as straw, not a solid cone
    const b = new GeoBuilder()
      .add(jitter(new THREE.CylinderGeometry(0.055, 0.11, 0.5, 10, 3), 0.01, rng), [-0.25, 0, 0], C.straw, { rot: [0, 0, -H], top: C.strawTop, scale: [0.8, 1, 1] });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + rng() * 0.3, r = 0.05 + rng() * 0.03, len = 0.5 + rng() * 0.16;
      const fy = Math.sin(a) * 0.8, fz = Math.cos(a);
      // each tuft: a thin cone, point at the binding, wide toward the tail, splayed outward
      b.add(new THREE.ConeGeometry(0.045 + rng() * 0.015, len, 5, 1), [-0.05 - len / 2, fy * r * 1.6, fz * r * 1.6], i % 3 ? C.straw : C.strawTop,
        { rot: [-fz * 0.12, 0, -H + fy * 0.14], top: C.strawTop, scale: [1, 1, 1] });
    }
    this.bristles.add(new THREE.Mesh(b.build()!, mat));
    this.group.add(this.bristles);
    // ribbon + gold star charm, hanging from the binding (swings a little)
    this.charm.position.set(-0.7, -0.02, 0.05);
    const r = new GeoBuilder()
      .add(new THREE.BoxGeometry(0.03, 0.16, 0.006), [0.01, -0.08, 0], C.ribbon, { rot: [0, 0, 0.18], top: C.ribbonTop })
      .add(new THREE.BoxGeometry(0.03, 0.12, 0.006), [-0.03, -0.06, 0.01], C.ribbon, { rot: [0, 0, -0.35], top: C.ribbonTop })
      .add(new THREE.OctahedronGeometry(0.03, 0), [0.025, -0.17, 0], C.gold, { scale: [1, 1, 0.5] });
    this.charm.add(new THREE.Mesh(r.build()!, mat));
    this.group.add(this.charm);
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** drag 0..1: bristles bend up toward the ground line (heel skim); swing: charm sway from speed/turns. */
  update(dt: number, drag: number, speed: number): void {
    this.t += dt;
    this.bristles.rotation.z = drag * 0.16 + Math.sin(this.t * 7) * 0.006 * Math.min(1, speed / 10);
    this.charm.rotation.x = Math.sin(this.t * 3.1) * 0.12 + Math.min(0.5, speed * 0.02);
    this.charm.rotation.z = -Math.min(0.6, speed * 0.03) + Math.sin(this.t * 4.3) * 0.08;
  }
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
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private next = 0; private acc = [0, 0, 0];
  private rng = mulberry32(5);
  private static COLORS: [number, number, number][] = [[1, 0.88, 0.55], [0.86, 0.74, 0.55], [1, 0.62, 0.25]];

  constructor(n = 160) {
    this.n = n;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.kind = new Uint8Array(n);
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
        void main() { vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha > 0.0 ? aSize * uScale / max(0.5, -mv.z) : 0.0; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = vA * smoothstep(1.0, 0.0, d); if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
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
      this.alpha[i] = k === 1 ? 0.45 * u * Math.min(1, (1 - u) * 6) : (k === 2 ? 1 : 0.85) * u * tw;
      this.size[i] = k === 1 ? 0.09 + (1 - u) * 0.16 : k === 2 ? 0.035 : 0.05 * (0.6 + u * 0.6);
    }
    const g = this.points.geometry;
    for (const a of ['position', 'color', 'aSize', 'aAlpha']) g.getAttribute(a).needsUpdate = true;
  }

  dispose(): void { this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose(); }
}
const _v2 = new THREE.Vector2();
