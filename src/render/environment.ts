import * as THREE from 'three';
import { mulberry32 } from '../rng';
import { toon, ART_UNIFORMS } from './materials';
import { toScene, ORIGIN } from './space';
import { GeoBuilder, jitter, blob } from './geo';
import type { Quality } from './quality';

/**
 * Environment (art pass): a warm late-afternoon sky with a low sun glow, a shader
 * cloud sea with billowy, slowly drifting tops, soft volume puffs, and distant
 * floating islands carrying Greek ruins, cypress and olive trees.
 *
 * Draw-call budget: sky 1, sea 1, puffs 1 (instanced), one merged mesh per 200 m
 * scenery segment (~8 live). Everything is procedural.
 */
export const ENV_STYLE = {
  skyTop: '#76a6d6',
  skyMid: '#b9cfe0',
  skyHorizon: '#ffd6aa',
  skyBelow: '#f1d9d4',
  sunGlow: '#fff0c8',
  /** Visible sun position in the sky (scene direction). Low, ahead-left of the route. */
  sunSky: new THREE.Vector3(-0.42, 0.16, -1),
  fog: '#f2dccd',
  fogNear: 60,
  fogFar: 950,
  hemiSky: '#ffeedd',
  hemiGround: '#a296cc',
  hemiIntensity: 1.15,
  sun: '#ffd9a8',
  sunIntensity: 2.6,
  /** Direction the sunlight comes FROM (scene space). Warm, low, from the left and a little ahead. */
  sunFrom: new THREE.Vector3(-0.62, 0.62, -0.18),
  cloudLit: '#fff6ee',
  cloudShade: '#c4b0da',
  cloudWarm: '#ffe1c2',
  cloudSeaY: -45,
  rock: '#d9a77c', rockDeep: '#a78db3', grass: '#9fbf6e', grassTop: '#c4d68a',
  marble: '#f4ece0', marbleShade: '#e6d6c6', terracotta: '#cf7a4f',
  cypress: '#4f7a4e', cypressTop: '#6f9a5e', olive: '#9fb08a', oliveTop: '#c2cfa6', trunk: '#8a6a52',
  peak: '#c9b6d8', peakTop: '#efe2ee',
};

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(ENV_STYLE.skyTop) }, mid: { value: new THREE.Color(ENV_STYLE.skyMid) },
      horizon: { value: new THREE.Color(ENV_STYLE.skyHorizon) }, below: { value: new THREE.Color(ENV_STYLE.skyBelow) },
      glow: { value: new THREE.Color(ENV_STYLE.sunGlow) }, sunDir: { value: ENV_STYLE.sunSky.clone().normalize() },
      uTime: ART_UNIFORMS.uTime,
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 below; uniform vec3 glow; uniform vec3 sunDir; uniform float uTime; varying vec3 vDir;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, mix(mid, top, smoothstep(0.18, 0.7, h)), smoothstep(0.0, 0.22, h)) : mix(horizon, below, smoothstep(0.0, 0.2, -h));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6);
        c = mix(c, vec3(1.0, 0.98, 0.92), smoothstep(0.9975, 0.999, s)); // soft sun disc
        // faint high cirrus streaks
        if (h > 0.05) { vec2 uv = d.xz / (h + 0.25) * 2.2 + vec2(uTime * 0.004, 0.0); float k = n2(uv * vec2(1.0, 6.0)) * n2(uv * 2.3); c = mix(c, vec3(1.0, 0.97, 0.94), smoothstep(0.35, 0.75, k) * 0.28 * smoothstep(0.05, 0.3, h)); }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  m.renderOrder = -100;
  m.frustumCulled = false;
  return m;
}

/** Cloud sea: one large disc around the camera; billows come from fbm in world space. */
function cloudSea(octaves: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    fog: false, depthWrite: true,
    defines: { OCTAVES: octaves },
    uniforms: {
      uTime: ART_UNIFORMS.uTime, uShift: { value: new THREE.Vector2() },
      lit: { value: new THREE.Color(ENV_STYLE.cloudLit) }, shade: { value: new THREE.Color(ENV_STYLE.cloudShade) },
      warm: { value: new THREE.Color(ENV_STYLE.cloudWarm) }, horizon: { value: new THREE.Color(ENV_STYLE.fog) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec2 uShift; uniform vec3 lit; uniform vec3 shade; uniform vec3 warm; uniform vec3 horizon; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<OCTAVES;i++){ s += a * n2(p); p = mat2(1.6,1.2,-1.2,1.6) * p; a *= 0.5; } return s; }
      void main(){
        vec2 w = vW.xz + uShift;
        vec2 p = w * 0.012 + vec2(uTime * 0.02, uTime * 0.007);
        float d = fbm(p);
        // billow: rounded tops from a remapped density, light from the left (sun side)
        float b = smoothstep(0.28, 0.78, d);
        float dl = fbm(p + vec2(-0.08, 0.03));
        float light = clamp(0.5 + (d - dl) * 5.0, 0.0, 1.0);
        vec3 c = mix(shade, lit, b * 0.8 + light * 0.25);
        c = mix(c, warm, light * b * 0.35);
        float dist = length(vW - cameraPosition);
        c = mix(c, horizon, smoothstep(220.0, 1250.0, dist));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(1500, 48), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -50;
  return m;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private dome: THREE.Mesh;
  private sunOffset: THREE.Vector3;
  private sea: THREE.Mesh | null = null;
  private puffs: THREE.InstancedMesh;
  private puffData: { x: number; lat: number; dy: number; s: number; ph: number }[] = [];
  private seaBase = ENV_STYLE.cloudSeaY;
  private seaFollow = false;
  private seaY = ENV_STYLE.cloudSeaY;
  private seed = 0;
  private heightAt: (x: number) => number = () => 0;
  private segs = new Map<number, THREE.Mesh>();
  private sceneryMat = toon('#ffffff', { vertexColors: true, sway: true, rim: 0.7 });
  private octaves = 4;
  static readonly SEG = 200;

  constructor(private scene: THREE.Scene) {
    scene.fog = new THREE.Fog(ENV_STYLE.fog, ENV_STYLE.fogNear, ENV_STYLE.fogFar);
    this.dome = skyDome();
    scene.add(this.dome);
    scene.add(new THREE.HemisphereLight(ENV_STYLE.hemiSky, ENV_STYLE.hemiGround, ENV_STYLE.hemiIntensity));
    this.sun = new THREE.DirectionalLight(ENV_STYLE.sun, ENV_STYLE.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.sunOffset = ENV_STYLE.sunFrom.clone().normalize().multiplyScalar(60);
    scene.add(this.sun, this.sun.target);
    scene.add(this.group);
    // soft cloud puffs that give the sea volume (one instanced draw call)
    const pg = blob(1, 0.15, 0.5);
    this.puffs = new THREE.InstancedMesh(pg, toon(ENV_STYLE.cloudLit, { rim: 1.4 }), 48);
    this.puffs.frustumCulled = false;
    const r = mulberry32(99);
    for (let i = 0; i < this.puffs.count; i++) this.puffData.push({ x: r() * 1400 - 200, lat: (r() < 0.5 ? -1 : 1) * (40 + r() * 520), dy: r() * 6, s: 10 + r() * 34, ph: r() * 6.28 });
    scene.add(this.puffs);
  }

  applyQuality(q: Quality): void {
    this.sun.castShadow = q.shadowMap > 0;
    if (q.shadowMap > 0 && this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    if (q.cloudOctaves !== this.octaves) {
      this.octaves = q.cloudOctaves;
      if (this.sea) { const y = this.sea.position.y; this.scene.remove(this.sea); (this.sea.material as THREE.Material).dispose(); this.sea = cloudSea(this.octaves); this.sea.position.y = y; this.scene.add(this.sea); }
    }
    this.puffs.count = q.puffs;
  }

  /**
   * `heightAt(x)`: course height near x; `minY`: lowest course point for static courses
   * (the cloud sea sits below it). `follow`: endless courses — the sea tracks the rider.
   */
  buildScenery(seed: number, _length: number, heightAt: (x: number) => number = () => 0, minY = 0, follow = false): void {
    for (const g of this.segs.values()) { this.group.remove(g); g.geometry.dispose(); }
    this.segs.clear();
    this.seed = seed;
    this.heightAt = heightAt;
    this.seaFollow = follow;
    this.seaBase = follow ? Infinity : Math.min(ENV_STYLE.cloudSeaY, minY - 32);
    this.seaY = follow ? heightAt(0) - 45 : this.seaBase;
    if (!this.sea) { this.sea = cloudSea(this.octaves); this.scene.add(this.sea); }
    this.sea.position.y = this.seaY;
  }

  /** Stream scenery segments around route x (deterministic per seed and segment). */
  streamScenery(x: number, maxX = Infinity): void {
    const S = Environment.SEG;
    const lo = Math.floor((x - 300) / S), hi = Math.floor((Math.min(x + 1300, maxX) - S) / S);
    for (const [k, g] of this.segs) if (k < lo || k > hi) { this.group.remove(g); g.geometry.dispose(); this.segs.delete(k); }
    for (let k = lo; k <= hi; k++) if (!this.segs.has(k)) { const g = this.buildSegment(k); if (g) { this.segs.set(k, g); this.group.add(g); } }
  }

  get segmentCount(): number { return this.segs.size; }

  private buildSegment(k: number): THREE.Mesh | null {
    const S = Environment.SEG, E = ENV_STYLE;
    const b = new GeoBuilder();
    const rng = mulberry32((this.seed ^ 0x5eed ^ Math.imul(k + 1000003, 0x2545f491)) >>> 0);
    for (let x = k * S + rng() * 30; x < (k + 1) * S; x += 34 + rng() * 40) {
      const side = rng() < 0.5 ? 1 : -1;
      const lateral = side * (48 + rng() * 360); // both sides of the route, never on it
      const ground = this.heightAt(x);
      const near = Math.abs(lateral) < 140;
      const y = ground - (near ? 12 + rng() * 18 : 6 + rng() * 40);
      const base = this.seaFollow ? ground - 45 : Math.min(this.seaBase, ground - 45);
      const kind = rng();
      if (kind < 0.7) this.island(b, toScene(x, y, lateral), 7 + rng() * (near ? 10 : 18), rng);
      else if (kind < 0.88) {
        const h = 50 + rng() * 110; // far lavender crags rising out of the clouds (rounded, not pyramids)
        const p = toScene(x, base - h * 0.15, lateral * 1.6);
        for (let i = 0; i < 3; i++) {
          const s = h * (0.55 - i * 0.12);
          b.add(blob(1, 0.3, rng()), [p.x + (rng() - 0.5) * h * 0.5, p.y + i * h * 0.28, p.z + (rng() - 0.5) * h * 0.3], E.peak, { top: E.peakTop, scale: [s * 0.8, s * 1.1, s * 0.7] });
        }
      } else {
        // a cumulus tower: stacked soft lumps
        const p = toScene(x, base + 4, lateral * 1.3);
        const s = 14 + rng() * 18;
        for (let i = 0; i < 4; i++) b.add(blob(1, 0.2, rng()), [p.x + (rng() - 0.5) * s, p.y + i * s * 0.55, p.z + (rng() - 0.5) * s], E.cloudShade, { scale: s * (1 - i * 0.18), top: E.cloudLit });
      }
    }
    const g = b.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, this.sceneryMat);
    m.frustumCulled = true;
    m.matrixAutoUpdate = true;
    return m;
  }

  /** A floating island: rocky underside, grassy top, and Greek ruins / trees. */
  private island(b: GeoBuilder, p: THREE.Vector3, r: number, rng: () => number): void {
    const E = ENV_STYLE;
    const H = r * (1.3 + rng() * 0.9);
    // rocky underside: a main crag plus two offset lumps so the silhouette never reads as a plain cone
    b.add(jitter(new THREE.ConeGeometry(r, H, 10, 4), r * 0.22, rng), [p.x, p.y - H / 2, p.z], E.rockDeep, { rot: [Math.PI, rng() * 3, 0], top: E.rock });
    for (let i = 0; i < 2; i++) {
      const rr = r * (0.45 + rng() * 0.2), hh = H * (0.45 + rng() * 0.25);
      b.add(jitter(new THREE.ConeGeometry(rr, hh, 7, 2), rr * 0.25, rng), [p.x + (rng() - 0.5) * r, p.y - hh / 2 - 0.3, p.z + (rng() - 0.5) * r * 0.8], E.rockDeep, { rot: [Math.PI, rng() * 3, 0], top: E.rock });
    }
    b.add(new THREE.CylinderGeometry(r * 1.02, r * 0.98, 1.2, 12), [p.x, p.y + 0.4, p.z], E.grass, { top: E.grassTop });
    const top = p.y + 1.0;
    const what = rng();
    if (what < 0.4) {
      // ruined colonnade on a stylobate
      const n = 4 + Math.floor(rng() * 4), R = r * 0.55;
      b.add(new THREE.BoxGeometry(R * 2.3, 0.6, R * 1.3), [p.x, top + 0.3, p.z], E.marbleShade, { top: E.marble });
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, cx = p.x + Math.cos(a) * R, cz = p.z + Math.sin(a) * R * 0.5;
        const h = rng() < 0.3 ? 1.5 + rng() * 2 : 5 + rng();
        b.add(new THREE.CylinderGeometry(0.42, 0.5, h, 10), [cx, top + 0.6 + h / 2, cz], E.marbleShade, { top: E.marble });
        if (h > 4) b.add(new THREE.BoxGeometry(1.2, 0.35, 1.2), [cx, top + 0.6 + h + 0.17, cz], E.marble);
      }
      if (rng() < 0.6) b.add(new THREE.BoxGeometry(R * 1.6, 0.5, 0.9), [p.x, top + 6.6, p.z], E.marble, { rot: [0, 0, (rng() - 0.5) * 0.15] });
    } else if (what < 0.6) {
      // little temple: steps, columns, pediment, terracotta roof
      const w = r * 0.9, d = r * 0.6;
      b.add(new THREE.BoxGeometry(w, 0.8, d), [p.x, top + 0.4, p.z], E.marbleShade, { top: E.marble });
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.add(new THREE.CylinderGeometry(0.35, 0.4, 4.2, 10), [p.x - w * 0.4 + (i * w * 0.8) / 3, top + 2.9, p.z + s * d * 0.38], E.marbleShade, { top: E.marble });
      b.add(new THREE.BoxGeometry(w * 1.02, 0.5, d * 1.02), [p.x, top + 5.25, p.z], E.marble);
      const roof = new THREE.CylinderGeometry(0.01, d * 0.62, w * 1.05, 3, 1); // triangular prism
      b.add(roof, [p.x, top + 6.1, p.z], E.terracotta, { rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.55] });
    }
    // trees: cypress (tall, dark) and olive (round, silvery); foliage sways
    const trees = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < trees; i++) {
      const a = rng() * Math.PI * 2, rr = r * (0.3 + rng() * 0.55);
      const tx = p.x + Math.cos(a) * rr, tz = p.z + Math.sin(a) * rr * 0.6;
      if (rng() < 0.55) {
        const h = 4 + rng() * 4;
        b.add(new THREE.ConeGeometry(0.85, h, 7, 2), [tx, top + h / 2, tz], E.cypress, { top: E.cypressTop, sway: 1.2, scale: [1, 1, 1] });
      } else {
        b.add(new THREE.CylinderGeometry(0.18, 0.28, 1.6, 6), [tx, top + 0.8, tz], E.trunk);
        for (let j = 0; j < 3; j++) b.add(blob(1, 0.25, rng()), [tx + (rng() - 0.5) * 1.6, top + 2.1 + rng() * 0.8, tz + (rng() - 0.5) * 1.2], E.olive, { top: E.oliveTop, scale: [1.3, 0.85, 1.1], sway: 0.6 });
      }
    }
  }

  /** Floating origin moved by `delta` (scene space): shift persistent scenery. */
  shift(delta: THREE.Vector3): void {
    for (const g of this.segs.values()) g.position.add(delta);
    this.seaY += delta.y;
    if (this.sea) { const u = (this.sea.material as THREE.ShaderMaterial).uniforms.uShift.value as THREE.Vector2; u.x -= delta.x; u.y -= delta.z; }
  }

  /** Keep the shadow frustum, sky, sea and puffs centred on the action. */
  follow(focus: THREE.Vector3, cameraPos: THREE.Vector3, routeX = 0, routeY = 0): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(this.sunOffset);
    this.dome.position.copy(cameraPos);
    if (this.sea) {
      if (this.seaFollow) this.seaY += (focus.y - 45 - this.seaY) * 0.02;
      this.sea.position.set(cameraPos.x, this.seaFollow ? this.seaY : this.seaBase - ORIGIN.y, cameraPos.z);
    }
    // puffs: recycled around the rider in route space, bobbing gently on the sea surface
    const seaRoute = this.sea ? this.sea.position.y + ORIGIN.y : routeY - 45;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const t = ART_UNIFORMS.uTime.value;
    for (let i = 0; i < this.puffs.count; i++) {
      const d = this.puffData[i];
      while (d.x < routeX - 250) d.x += 1500;
      while (d.x > routeX + 1250) d.x -= 1500;
      toScene(d.x, seaRoute + d.dy + Math.sin(t * 0.3 + d.ph) * 0.8, d.lat, v);
      s.set(d.s * 1.4, d.s * 0.55, d.s);
      m.compose(v, q, s);
      this.puffs.setMatrixAt(i, m);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
  }
}
