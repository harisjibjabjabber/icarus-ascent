/**
 * Collectible orbs: placement, deterministic pickup, scoring, and instanced rendering.
 * Optional pickups — missing one never fails the run.
 */
import * as THREE from 'three';
import type { RiderState } from '../sim/types';
import type { Course } from './course';
import { ORB_ASSETS, ORB_SPRITE } from '../orb/orbAssets';
import { toScene } from '../render/space';

export type OrbTier = 'common' | 'rare';
/** How the rider must pass the orb to collect it. */
export type OrbPickup = 'air' | 'grind' | 'route' | 'wall';

export interface Orb {
  id: number;
  x: number;
  y: number;
  lateral: number;
  tier: OrbTier;
  pickup: OrbPickup;
  /** Trail grouping for streak / completion bonuses (0 if solo). */
  trailId: number;
  trailIdx: number;
  trailLen: number;
}

export type OrbPlacement = Omit<Orb, 'id'>;

/** World / screen presentation (dainty 4-point stars, legible at 390×844). */
export const ORB_VIS = {
  /** ~1.7× the previous 0.26 m body, so a mid-distance gold star is about 8–10 px. */
  goldSize: 0.442,
  /** 1.5× gold. */
  rareSize: 0.663,
  /** Screen cap near Ao. Was 14 px; raised so a close gold star can reach ~18 px. */
  maxBodyPx: 18,
  /** Purple keeps the 1.5× ratio when the cap is active. */
  rareMaxBodyPx: 27,
  nearFadeStart: 0.9,
  nearFadeEnd: 3,
} as const;

export const ORB = {
  gold: 75,
  rare: 1200,
  trailComplete: 400,
  streakStep: 8,
  streakMax: 64,
  streakGap: 0.6,
  stepMax: 4,
  airBelow: 1.15,
  airAbove: 2.4,
  grindBand: 0.85,
  routeBand: 1.25,
} as const;

export function orbPoints(tier: OrbTier, streak = 1): number {
  const base = tier === 'rare' ? ORB.rare : ORB.gold;
  if (tier === 'rare') return base;
  return base + Math.min(ORB.streakMax, Math.max(0, streak - 1) * ORB.streakStep);
}

export function orbPopup(tier: OrbTier): string {
  return tier === 'rare' ? 'Rare orb' : 'Orb';
}

export function orbBurstColor(tier: OrbTier): string {
  return tier === 'rare' ? '#8a3dff' : '#ffc857';
}

export function addOrb(placements: OrbPlacement[], tier: OrbTier, x: number, y: number, lateral: number, pickup: OrbPickup): void {
  placements.push({ x, y, lateral, tier, pickup, trailId: 0, trailIdx: 0, trailLen: 1 });
}

export function placementCommonAir(x: number, y: number, lateral = 0): OrbPlacement {
  return { x, y, lateral, tier: 'common', pickup: 'air', trailId: 0, trailIdx: 0, trailLen: 1 };
}

export function placementCommonGrind(x: number, y: number, lateral: number): OrbPlacement {
  return { x, y, lateral, tier: 'common', pickup: 'grind', trailId: 0, trailIdx: 0, trailLen: 1 };
}

export function placementRareGrind(x: number, y: number, lateral: number): OrbPlacement {
  return { x, y, lateral, tier: 'rare', pickup: 'grind', trailId: 0, trailIdx: 0, trailLen: 1 };
}

export function placementCommonRoute(x: number, y: number, lateral = 0): OrbPlacement {
  return { x, y, lateral, tier: 'common', pickup: 'route', trailId: 0, trailIdx: 0, trailLen: 1 };
}

export function orbTouched(o: Orb, prevX: number, st: RiderState): boolean {
  if (!(st.x > prevX) || st.x - prevX > ORB.stepMax) return false;
  if (o.x <= prevX - 0.05 || o.x > st.x + 0.2) return false;
  if (o.pickup === 'grind') return st.mode === 'grinding' && Math.abs(st.y - o.y) <= ORB.grindBand;
  if (o.pickup === 'wall') return st.mode === 'wallRiding' && Math.abs(st.y - o.y) <= ORB.grindBand + 0.4;
  if (o.pickup === 'air') {
    const aloft = st.mode === 'airborne' || st.mode === 'flying' || st.mode === 'gusting';
    return aloft && st.y >= o.y - ORB.airBelow && st.y <= o.y + ORB.airAbove;
  }
  return Math.abs(st.y - o.y) <= ORB.routeBand;
}

const ATLAS_COLS = 8;
/** Halo (rare only) + star body + bright core + thin cross glints. */
const PARTS_PER_ORB = 5;

const GOLD_STAR = new THREE.Color('#ffc857');
const GOLD_CORE = new THREE.Color('#fff6d0');
const GOLD_GLINT = new THREE.Color('#ffe8a0');
const RARE_STAR = new THREE.Color('#7a2cff');
const RARE_CORE = new THREE.Color('#f4e8ff');
const RARE_GLINT = new THREE.Color('#c9a0ff');
const RARE_HALO = new THREE.Color('#9a4dff');

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function worldSizeForScreen(cam: THREE.Camera, pos: THREE.Vector3, base: number, maxPx: number, screenH: number): number {
  if (!(cam instanceof THREE.PerspectiveCamera)) return base;
  const dist = Math.max(0.6, cam.position.distanceTo(pos));
  let s = base * smooth(ORB_VIS.nearFadeStart, ORB_VIS.nearFadeEnd, dist);
  const vFov = (cam.fov * Math.PI) / 180;
  const pxPerM = screenH / (2 * Math.tan(vFov / 2)) / dist;
  const px = s * pxPerM;
  if (px > maxPx) s *= maxPx / px;
  return s;
}

/** Kenney atlas billboards: 4-point star, core, cross glint; camera-facing. */
export class OrbView {
  private taken = new Set<number>();
  private list: Orb[] = [];
  private dummy = new THREE.Object3D();
  private worldPos = new THREE.Vector3();
  private rollQ = new THREE.Quaternion();
  private mesh: THREE.InstancedMesh | null = null;
  private spriteAttr: THREE.InstancedBufferAttribute | null = null;
  private colorAttr: THREE.InstancedBufferAttribute | null = null;
  private camQ = new THREE.Quaternion();
  private signature = '';

  constructor(readonly parent: THREE.Group, readonly course: Course) {
    void this.loadAtlas();
  }

  hide(id: number): void {
    this.taken.add(id);
    this.layout();
  }

  resetTaken(): void {
    this.taken.clear();
    this.layout();
  }

  sync(): void {
    const cs = this.course.chunks;
    const sig = cs.length ? `${cs[0].id}:${cs[cs.length - 1].id}:${cs.length}:${this.taken.size}` : '';
    if (sig === this.signature) return;
    this.signature = sig;
    this.layout();
  }

  /** `cam` used for billboarding, near-camera fade and screen-space size clamp. */
  animate(time: number, cam?: THREE.Camera, screenH = 844): void {
    if (cam) cam.getWorldQuaternion(this.camQ);
    if (!this.mesh || !this.shaderMat) return;
    let i = 0;
    for (const o of this.list) {
      const rare = o.tier === 'rare';
      const base = rare ? ORB_VIS.rareSize : ORB_VIS.goldSize;
      // Neighbours along a trail shimmer out of phase.
      const phase = o.trailIdx * 1.35 + o.id * 0.41;
      const twAmp = rare ? 0.24 : 0.16;
      const tw = 1
        + Math.sin(time * 3.1 + phase) * twAmp
        + (rare ? Math.sin(time * 5.4 + phase * 1.4) * 0.1 : 0);
      const bob = Math.sin(time * 2.0 + o.id * 0.13) * 0.035;
      toScene(o.x, o.y + bob, o.lateral, this.worldPos);
      let starS: number = base;
      if (cam) starS = worldSizeForScreen(cam, this.worldPos, base, rare ? ORB_VIS.rareMaxBodyPx : ORB_VIS.maxBodyPx, screenH);
      starS *= tw;
      const roll = time * 0.48 + phase;
      this.rollQ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll);
      const parts: { sprite: number; scale: number; color: THREE.Color; bright: number; spin: number }[] = [];
      if (rare) parts.push({ sprite: ORB_SPRITE.glow, scale: starS * 1.7, color: RARE_HALO, bright: 0.38, spin: 0 });
      const body = parts.length;
      parts.push(
        { sprite: ORB_SPRITE.star, scale: starS, color: rare ? RARE_STAR : GOLD_STAR, bright: tw, spin: 0 },
        { sprite: ORB_SPRITE.sparkle, scale: starS * 0.4, color: rare ? RARE_CORE : GOLD_CORE, bright: 1.2 + twAmp, spin: 0 },
        { sprite: ORB_SPRITE.streak, scale: starS * 0.16, color: rare ? RARE_GLINT : GOLD_GLINT, bright: 0.55, spin: 0 },
        { sprite: ORB_SPRITE.streak, scale: starS * 0.16, color: rare ? RARE_GLINT : GOLD_GLINT, bright: 0.55, spin: Math.PI / 2 },
      );
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        let scale = part.scale;
        if (p >= body + 2) scale *= 0.85 + 0.15 * Math.sin(time * 4.1 + phase + p);
        this.dummy.position.copy(this.worldPos);
        this.dummy.quaternion.copy(this.camQ);
        this.dummy.quaternion.multiply(this.rollQ);
        if (part.spin) this.dummy.rotateZ(part.spin);
        const bright = part.bright;
        this.dummy.scale.set(scale, scale, 1);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.spriteAttr!.setX(i, part.sprite);
        this.colorAttr!.setXYZ(i, part.color.r * bright, part.color.g * bright, part.color.b * bright);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.spriteAttr!.needsUpdate = true;
    this.colorAttr!.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    this.spriteAttr = this.colorAttr = null;
  }

  private layout(): void {
    const list: Orb[] = [];
    for (const c of this.course.chunks) {
      for (const id of c.orbs ?? []) {
        if (this.taken.has(id)) continue;
        const o = this.course.orb(id);
        if (o) list.push(o);
      }
    }
    this.list = list;
    const cap = Math.max(1, list.length * PARTS_PER_ORB);
    this.ensureCapacity(cap);
    this.animate(typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  }

  private ensureCapacity(cap: number): void {
    if (!this.shaderMat) return;
    if (this.mesh && this.mesh.instanceMatrix.count >= cap) return;
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const geo = new THREE.PlaneGeometry(1, 1);
    this.spriteAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    geo.setAttribute('sprite', this.spriteAttr);
    geo.setAttribute('iColor', this.colorAttr);
    this.mesh = new THREE.InstancedMesh(geo, this.shaderMat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 521;
    this.mesh.count = 0;
    this.parent.add(this.mesh);
  }

  private shaderMat: THREE.ShaderMaterial | null = null;

  private createAtlasMaterial(tex: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
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
  }

  private async loadAtlas(): Promise<void> {
    const url = ORB_ASSETS.tex.atlas;
    if (!url || typeof document === 'undefined') return;
    const tex = await new Promise<THREE.Texture | null>((resolve) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearFilter;
        resolve(t);
      }, undefined, () => resolve(null));
    });
    if (!tex) return;
    this.shaderMat = this.createAtlasMaterial(tex);
    this.layout();
  }
}
