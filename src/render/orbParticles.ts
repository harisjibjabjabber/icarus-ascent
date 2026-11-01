import * as THREE from 'three';
import { ORB_ASSETS, ORB_SPRITE } from '../orb/orbAssets';
import { orbRand } from '../orb/orbRand';
import { ROUTE_DIR, toScene } from './space';

const ATLAS_COLS = 8;
const MAX = 128;

interface Slot {
  life: number;
  max: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  size0: number;
  size1: number;
  sprite: number;
  r: number;
  g: number;
  b: number;
}

/** Pooled billboard particles (one instanced draw, Kenney atlas). */
export class OrbParticles {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private head = 0;
  private mesh: THREE.InstancedMesh | null = null;
  private spriteAttr: THREE.InstancedBufferAttribute | null = null;
  private colorAttr: THREE.InstancedBufferAttribute | null = null;
  private dummy = new THREE.Object3D();
  private c = new THREE.Color();
  private low = false;
  private camQ = new THREE.Quaternion();

  constructor() {
    for (let i = 0; i < MAX; i++) this.slots.push({ life: 0, max: 1, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, size0: 0.1, size1: 0.1, sprite: 0, r: 1, g: 1, b: 1 });
    void this.loadAtlas();
  }

  setLowTier(on: boolean): void { this.low = on; }

  private async loadAtlas(): Promise<void> {
    const url = ORB_ASSETS.tex.atlas;
    if (!url) return;
    const tex = await new Promise<THREE.Texture | null>((resolve) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearFilter;
        resolve(t);
      }, undefined, () => resolve(null));
    });
    if (!tex) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, cols: { value: ATLAS_COLS } },
      vertexShader: `
        attribute float sprite;
        attribute vec3 iColor;
        varying vec2 vUv;
        varying vec3 vColor;
        uniform float cols;
        void main() {
          vColor = iColor;
          float col = floor(sprite + 0.01);
          vUv = vec2((col + uv.x) / cols, uv.y);
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, vUv);
          if (t.a < 0.02) discard;
          gl_FragColor = vec4(vColor, t.a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.spriteAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('sprite', this.spriteAttr);
    geo.setAttribute('iColor', this.colorAttr);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 650;
    this.mesh.count = 0;
    this.group.add(this.mesh);
    this.syncInstances();
  }

  private claim(): Slot {
    const s = this.slots[this.head];
    this.head = (this.head + 1) % MAX;
    return s;
  }

  private emit(
    id: number,
    tick: number,
    x: number,
    y: number,
    lateral: number,
    n: number,
    life: number,
    size: number,
    sprite: number,
    color: string,
    vel: (i: number, r: number) => { vx: number; vy: number; vz: number },
  ): void {
    if (this.low && n > 4) n = 4;
    const base = toScene(x, y, lateral);
    this.c.set(color);
    for (let i = 0; i < n; i++) {
      const r = orbRand(id, tick * 17 + i * 31 + sprite * 7);
      const s = this.claim();
      s.life = s.max = life * (0.85 + r * 0.3);
      s.px = base.x + (r - 0.5) * 0.15;
      s.py = base.y + (orbRand(id, i + 3) - 0.5) * 0.15;
      s.pz = base.z + (orbRand(id, i + 9) - 0.5) * 0.15;
      const v = vel(i, r);
      s.vx = v.vx; s.vy = v.vy; s.vz = v.vz;
      s.size0 = size * (0.7 + r * 0.5);
      s.size1 = size * (0.2 + r * 0.15);
      s.sprite = sprite;
      s.r = this.c.r; s.g = this.c.g; s.b = this.c.b;
    }
  }

  /** Gold pickup: tiny spark burst + a few HUD-ward streaks (<200 ms). */
  pickupGold(e: { id: number; tick: number; x: number; y: number; lateral: number }, color: string): void {
    this.emit(e.id, e.tick, e.x, e.y + 0.32, e.lateral, 5, 0.16, 0.1, ORB_SPRITE.sparkle, color, (i, r) => {
      const a = (i / 5) * Math.PI * 2 + r * 0.4;
      return { vx: Math.cos(a) * 2.8, vy: Math.sin(a) * 2.8 + 0.9, vz: (r - 0.5) * 0.8 };
    });
    this.emit(e.id, e.tick, e.x, e.y + 0.35, e.lateral, 2, 0.18, 0.08, ORB_SPRITE.streak, color, (i, r) => ({
      vx: -ROUTE_DIR.x * (1.8 + r * 1.5) + (r - 0.5) * 0.4,
      vy: 2 + i * 0.5 + r * 0.3,
      vz: -ROUTE_DIR.z * (1.8 + r * 1.5),
    }));
  }

  pickupRare(e: { id: number; tick: number; x: number; y: number; lateral: number }, color: string): void {
    this.emit(e.id, e.tick, e.x, e.y + 0.32, e.lateral, 7, 0.18, 0.12, ORB_SPRITE.star, color, (i, r) => {
      const a = (i / 7) * Math.PI * 2;
      return { vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2 + 1.2, vz: (r - 0.5) * 1.2 };
    });
    this.emit(e.id, e.tick, e.x, e.y + 0.35, e.lateral, 2, 0.2, 0.09, ORB_SPRITE.streak, color, (i, r) => ({
      vx: -ROUTE_DIR.x * (2 + r) + (r - 0.5) * 0.4,
      vy: 2.2 + i * 0.45,
      vz: -ROUTE_DIR.z * (2 + r),
    }));
  }

  trailComplete(e: { id: number; tick: number; x: number; y: number; lateral: number }, color: string): void {
    this.emit(e.id, e.tick, e.x, e.y + 0.45, e.lateral, 6, 0.22, 0.11, ORB_SPRITE.sparkle, color, (i, r) => {
      const a = (i / 6) * Math.PI * 2;
      return { vx: Math.cos(a) * 2, vy: 2.2 + r, vz: Math.sin(a) * 1.2 };
    });
  }

  /** Unused in-run (stars twinkle in OrbView); kept for API compatibility. */
  idleTwinkle(_id: number, _tick: number, _x: number, _y: number, _lateral: number, _color: string): void {}

  update(dt: number): void {
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) continue;
      s.px += s.vx * dt;
      s.py += s.vy * dt;
      s.pz += s.vz * dt;
      s.vx *= Math.exp(-2.8 * dt);
      s.vy *= Math.exp(-2.2 * dt);
      s.vz *= Math.exp(-2.8 * dt);
    }
    if (this.mesh) this.syncInstances();
  }

  private syncInstances(): void {
    if (!this.mesh || !this.spriteAttr || !this.colorAttr) return;
    let i = 0;
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      const t = 1 - s.life / s.max;
      const scale = s.size0 * (1 - t) + s.size1 * t;
      this.dummy.position.set(s.px, s.py, s.pz);
      this.dummy.quaternion.copy(this.camQ);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.spriteAttr.setX(i, s.sprite);
      this.colorAttr.setXYZ(i, s.r, s.g, s.b);
      i++;
      if (i >= MAX) break;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.spriteAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.mesh.count = i;
  }

  /** Face the active camera each frame. */
  faceCamera(q: THREE.Quaternion): void {
    this.camQ.copy(q);
  }

  clear(): void {
    for (const s of this.slots) s.life = 0;
    if (this.mesh) this.mesh.count = 0;
  }
}
