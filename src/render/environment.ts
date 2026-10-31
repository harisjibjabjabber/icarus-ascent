import * as THREE from 'three';
import { mulberry32 } from '../rng';
import { toon } from './materials';
import { toScene, ORIGIN } from './space';

/**
 * 3D environment scaffold: gradient sky dome, warm sun + soft shadows, gentle fog,
 * a sea of clouds far below and low-poly distant scenery (islands, peaks,
 * columns) placed in the world so real perspective provides the parallax.
 * All placeholder — the art pass replaces ENV_STYLE and the scenery builders.
 */
export const ENV_STYLE = {
  skyTop: '#6fa3d8',
  skyHorizon: '#ffd9b3',
  skyBelow: '#e4def0',
  fog: '#f0dcd2',
  fogNear: 70,
  fogFar: 1200,
  hemiSky: '#fff1dc',
  hemiGround: '#a8a6d6',
  hemiIntensity: 1.5,
  sun: '#ffe2b8',
  sunIntensity: 2.4,
  /** Direction the sunlight comes FROM (scene space, normalised in code). Low, warm, from upper-left-behind. */
  sunFrom: new THREE.Vector3(-0.6, 0.75, 0.35),
  cloudSea: '#cfcaee',
  cloudSeaY: -45,
  island: '#e9c9a7',
  islandGrass: '#a9c98a',
  peak: '#c6b4d6',
  column: '#f1e6da',
};

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(ENV_STYLE.skyTop) },
      horizon: { value: new THREE.Color(ENV_STYLE.skyHorizon) },
      below: { value: new THREE.Color(ENV_STYLE.skyBelow) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 below; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(horizon, below, smoothstep(0.0, 0.25, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private sunOffset: THREE.Vector3;

  constructor(private scene: THREE.Scene) {
    scene.fog = new THREE.Fog(ENV_STYLE.fog, ENV_STYLE.fogNear, ENV_STYLE.fogFar);
    this.dome = skyDome();
    scene.add(this.dome);
    scene.add(new THREE.HemisphereLight(ENV_STYLE.hemiSky, ENV_STYLE.hemiGround, ENV_STYLE.hemiIntensity));
    this.sun = new THREE.DirectionalLight(ENV_STYLE.sun, ENV_STYLE.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 4;
    this.sunOffset = ENV_STYLE.sunFrom.clone().normalize().multiplyScalar(60);
    scene.add(this.sun, this.sun.target);
    scene.add(this.group);
  }

  /** Distant low-poly scenery, streamed in 200 m segments around the rider. */
  private sea: THREE.Mesh | null = null;
  private seaBase = ENV_STYLE.cloudSeaY;
  private seaFollow = false;
  private seaY = ENV_STYLE.cloudSeaY;
  private seed = 0;
  private heightAt: (x: number) => number = () => 0;
  private segs = new Map<number, THREE.Group>();
  private shared: { cone: THREE.ConeGeometry; cyl: THREE.CylinderGeometry; cap: THREE.CylinderGeometry; mats: Record<string, THREE.Material> } | null = null;
  static readonly SEG = 200;

  /**
   * `heightAt(x)`: course height near x; `minY`: lowest course point for static courses
   * (the cloud sea sits below it). `follow`: endless courses — the sea tracks the rider.
   */
  buildScenery(seed: number, _length: number, heightAt: (x: number) => number = () => 0, minY = 0, follow = false): void {
    for (const g of this.segs.values()) this.group.remove(g);
    this.segs.clear();
    this.seed = seed;
    this.heightAt = heightAt;
    this.seaFollow = follow;
    this.seaBase = follow ? Infinity : Math.min(ENV_STYLE.cloudSeaY, minY - 32);
    this.seaY = follow ? heightAt(0) - 45 : this.seaBase;
    if (!this.shared) {
      this.shared = {
        cone: new THREE.ConeGeometry(1, 1, 7, 1), cyl: new THREE.CylinderGeometry(0.8, 1, 1, 8), cap: new THREE.CylinderGeometry(1.03, 1, 1, 7),
        mats: { island: toon(ENV_STYLE.island), grass: toon(ENV_STYLE.islandGrass), peak: toon(ENV_STYLE.peak), col: toon(ENV_STYLE.column) },
      };
    }
    if (!this.sea) {
      this.sea = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), toon(ENV_STYLE.cloudSea));
      this.sea.rotation.x = -Math.PI / 2;
      this.scene.add(this.sea);
    }
    this.sea.position.y = this.seaY;
  }

  /** Stream scenery segments around route x (deterministic per seed and segment). */
  streamScenery(x: number, maxX = Infinity): void {
    const S = Environment.SEG;
    // only where the course exists (streamed courses): scenery heights follow the route
    const lo = Math.floor((x - 300) / S), hi = Math.floor((Math.min(x + 1300, maxX) - S) / S);
    for (const [k, g] of this.segs) if (k < lo || k > hi) { this.group.remove(g); this.segs.delete(k); }
    for (let k = lo; k <= hi; k++) if (!this.segs.has(k)) { const g = this.buildSegment(k); this.segs.set(k, g); this.group.add(g); }
  }

  get segmentCount(): number { return this.segs.size; }

  private buildSegment(k: number): THREE.Group {
    const S = Environment.SEG, sh = this.shared!;
    const g = new THREE.Group();
    const rng = mulberry32((this.seed ^ 0x5eed ^ Math.imul(k + 1000003, 0x2545f491)) >>> 0);
    for (let x = k * S + rng() * 20; x < (k + 1) * S; x += 18 + rng() * 22) {
      const lateral = (rng() < 0.5 ? 1 : -1) * (55 + rng() * 380); // both sides of the route, never on it
      const ground = this.heightAt(x);
      const y = ground - 15 - rng() * 35;
      const base = Math.min(this.seaFollow ? ground - 45 : this.seaBase, ground - 45);
      const p = toScene(x, y, lateral);
      const kind = rng();
      if (kind < 0.55) {
        const r = 6 + rng() * 14, H = r * (1.2 + rng());
        const body = new THREE.Mesh(sh.cone, sh.mats.island);
        body.scale.set(r, H, r); body.rotation.x = Math.PI; body.position.copy(p);
        const cap = new THREE.Mesh(sh.cap, sh.mats.grass);
        cap.scale.set(r, 1.6, r); cap.position.copy(p); cap.position.y += H / 2 + 0.8;
        g.add(body, cap);
        if (rng() < 0.5) {
          const h = 6 + rng() * 6;
          const col = new THREE.Mesh(sh.cyl, sh.mats.col);
          col.scale.set(0.8, h, 0.8);
          col.position.copy(cap.position).add(new THREE.Vector3((rng() - 0.5) * r, 4, (rng() - 0.5) * r));
          g.add(col);
        }
      } else if (kind < 0.85) {
        const h = 60 + rng() * 120;
        const peak = new THREE.Mesh(sh.cone, sh.mats.peak);
        peak.scale.set(h * 0.55, h, h * 0.55);
        const b = toScene(x, base + h / 2 - 5, lateral);
        peak.position.copy(b);
        peak.rotation.y = rng() * Math.PI;
        g.add(peak);
      } else {
        const h = 18 + rng() * 25;
        const col = new THREE.Mesh(sh.cyl, sh.mats.col);
        col.scale.set(2, h, 2);
        col.position.copy(toScene(x, base + h / 2, lateral));
        g.add(col);
      }
    }
    return g;
  }

  /** Floating origin moved by `delta` (scene space): shift persistent scenery. */
  shift(delta: THREE.Vector3): void { for (const g of this.segs.values()) g.position.add(delta); this.seaY += delta.y; }

  /** Keep the shadow frustum and sky centred on the action. */
  follow(focus: THREE.Vector3, cameraPos: THREE.Vector3): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
    this.dome.position.copy(cameraPos);
    if (this.sea) {
      if (this.seaFollow) { this.seaY += (focus.y - 45 - this.seaY) * 0.02; }
      this.sea.position.set(cameraPos.x, this.seaFollow ? this.seaY : this.seaBase - ORIGIN.y, cameraPos.z);
    }
  }
}
