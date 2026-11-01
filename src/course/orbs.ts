/**
 * Collectible orbs: placement, deterministic pickup, scoring, and instanced rendering.
 * Optional pickups — missing one never fails the run.
 */
import * as THREE from 'three';
import type { RiderState } from '../sim/types';
import type { Course } from './course';
import { toon } from '../render/materials';
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

export const ORB = {
  /** Per gold orb (banked immediately). */
  gold: 75,
  /** Per purple orb. */
  rare: 1200,
  /** Bonus when every orb in a trail is collected. */
  trailComplete: 400,
  /** Extra gold per consecutive pickup within the streak window (capped). */
  streakStep: 8,
  streakMax: 64,
  /** Sim seconds: longer gap resets the streak pitch. */
  streakGap: 0.6,
  /** A step longer than this (m) is a teleport, not a pickup. */
  stepMax: 4,
  /** Feet may be this far below / above an air orb (m). */
  airBelow: 1.15,
  airAbove: 2.4,
  /** Grind lock vs a rail / high-line orb (m). */
  grindBand: 0.85,
  /** Route orb: vertical band around the floating orb (m). */
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
  return tier === 'rare' ? '#6ecfd4' : '#ffd36b';
}

/** Set pieces and phrase builders push placements here; ids are assigned when the chunk is built. */
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

/**
 * Did this tick pass an orb? Air orbs need a real launch arc; grind orbs need a grind;
 * route orbs need the rider near the band. Teleports collect nothing.
 */
export function orbTouched(o: Orb, prevX: number, st: RiderState): boolean {
  if (!(st.x > prevX) || st.x - prevX > ORB.stepMax) return false;
  if (o.x <= prevX - 0.05 || o.x > st.x + 0.2) return false;
  if (o.pickup === 'grind') return st.mode === 'grinding' && Math.abs(st.y - o.y) <= ORB.grindBand;
  if (o.pickup === 'wall') return st.mode === 'wallRiding' && Math.abs(st.y - o.y) <= ORB.grindBand + 0.4;
  if (o.pickup === 'air') return st.mode === 'airborne' && st.y >= o.y - ORB.airBelow && st.y <= o.y + ORB.airAbove;
  return Math.abs(st.y - o.y) <= ORB.routeBand;
}

const COMMON_BODY = '#ffc857';
const COMMON_EMI = '#ff9a2a';
const RARE_BODY = '#7a6cff';
const RARE_EMI = '#4ecdc4';
const HALO_COMMON = '#ffe9a8';
const HALO_RARE = '#9ef0f0';

/** Instanced emissive spheres + soft halo sprites. */
export class OrbView {
  private taken = new Set<number>();
  private list: Orb[] = [];
  private dummy = new THREE.Object3D();
  private common: THREE.InstancedMesh | null = null;
  private rare: THREE.InstancedMesh | null = null;
  private haloCommon: THREE.InstancedMesh | null = null;
  private haloRare: THREE.InstancedMesh | null = null;
  private commonMat = toon(COMMON_BODY, { emissive: COMMON_EMI, emissiveIntensity: 1.45 });
  private rareMat = toon(RARE_BODY, { emissive: RARE_EMI, emissiveIntensity: 1.65 });
  private haloMatCommon = new THREE.MeshBasicMaterial({ color: HALO_COMMON, transparent: true, opacity: 0.58, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  private haloMatRare = new THREE.MeshBasicMaterial({ color: HALO_RARE, transparent: true, opacity: 0.68, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  private bodyGeo = new THREE.SphereGeometry(1, 10, 8);
  private haloGeo = new THREE.SphereGeometry(1, 8, 6);
  private signature = '';

  constructor(readonly parent: THREE.Group, readonly course: Course) {
    this.commonMat.side = THREE.DoubleSide;
    this.rareMat.side = THREE.DoubleSide;
    this.commonMat.fog = false;
    this.rareMat.fog = false;
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

  animate(time: number): void {
    const pulse = 1 + Math.sin(time * 5.5) * 0.04;
    this.commonMat.emissiveIntensity = 1.02 + Math.sin(time * 5.5) * 0.18;
    this.rareMat.emissiveIntensity = 1.15 + Math.sin(time * 4.2) * 0.22;
    let ic = 0, ir = 0;
    for (const o of this.list) {
      const bob = Math.sin(time * 2.3 + o.id * 0.17) * 0.11;
      const base = o.tier === 'rare' ? 0.52 : 0.36;
      const s = base * pulse * (1 + Math.sin(time * 5.5 + o.id) * 0.035);
      this.dummy.position.copy(toScene(o.x, o.y + bob, o.lateral));
      this.dummy.rotation.set(Math.sin(time * 2.8 + o.id * 0.2) * 0.22, time * 2.1 + o.id * 0.11, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      const idx = o.tier === 'rare' ? ir++ : ic++;
      const mesh = o.tier === 'rare' ? this.rare : this.common;
      const halo = o.tier === 'rare' ? this.haloRare : this.haloCommon;
      mesh?.setMatrixAt(idx, this.dummy.matrix);
      if (halo) {
        this.dummy.scale.setScalar(s * (o.tier === 'rare' ? 3.8 : 3.2));
        this.dummy.rotation.y += 0.4;
        this.dummy.updateMatrix();
        halo.setMatrixAt(idx, this.dummy.matrix);
      }
    }
    if (this.common?.instanceMatrix) this.common.instanceMatrix.needsUpdate = true;
    if (this.rare?.instanceMatrix) this.rare.instanceMatrix.needsUpdate = true;
    if (this.haloCommon?.instanceMatrix) this.haloCommon.instanceMatrix.needsUpdate = true;
    if (this.haloRare?.instanceMatrix) this.haloRare.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.common, this.rare, this.haloCommon, this.haloRare]) {
      if (!m) continue;
      this.parent.remove(m);
      m.dispose();
    }
    this.common = this.rare = this.haloCommon = this.haloRare = null;
    this.bodyGeo.dispose();
    this.haloGeo.dispose();
    this.commonMat.dispose();
    this.rareMat.dispose();
    this.haloMatCommon.dispose();
    this.haloMatRare.dispose();
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
    const nC = Math.max(1, list.filter((o) => o.tier === 'common').length);
    const nR = Math.max(1, list.filter((o) => o.tier === 'rare').length);
    this.common = this.ensureTier(this.common, this.commonMat, nC, 'common');
    this.rare = this.ensureTier(this.rare, this.rareMat, nR, 'rare');
    this.haloCommon = this.ensureHalo(this.haloCommon, this.haloMatCommon, nC, 'common');
    this.haloRare = this.ensureHalo(this.haloRare, this.haloMatRare, nR, 'rare');
    let ic = 0, ir = 0;
    for (const o of list) {
      const idx = o.tier === 'rare' ? ir++ : ic++;
      const mesh = o.tier === 'rare' ? this.rare! : this.common!;
      const bob = 0;
      const base = o.tier === 'rare' ? 0.52 : 0.36;
      this.dummy.position.copy(toScene(o.x, o.y + bob, o.lateral));
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(base);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(idx, this.dummy.matrix);
      const halo = o.tier === 'rare' ? this.haloRare! : this.haloCommon!;
      this.dummy.scale.setScalar(base * (o.tier === 'rare' ? 3.8 : 3.2));
      this.dummy.updateMatrix();
      halo.setMatrixAt(idx, this.dummy.matrix);
    }
    if (this.common) this.common.count = list.filter((o) => o.tier === 'common').length;
    if (this.rare) this.rare.count = list.filter((o) => o.tier === 'rare').length;
    if (this.haloCommon) this.haloCommon.count = this.common?.count ?? 0;
    if (this.haloRare) this.haloRare.count = this.rare?.count ?? 0;
    this.animate(typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  }

  private ensureTier(prev: THREE.InstancedMesh | null, mat: THREE.Material, cap: number, tier: OrbTier): THREE.InstancedMesh | null {
    if (!this.list.some((o) => o.tier === tier)) {
      if (prev) { this.parent.remove(prev); prev.dispose(); }
      return null;
    }
    if (prev && prev.count >= cap) return prev;
    if (prev) { this.parent.remove(prev); prev.dispose(); }
    const m = new THREE.InstancedMesh(this.bodyGeo, mat, cap);
      m.frustumCulled = false;
      m.castShadow = false;
      m.renderOrder = 520;
    this.parent.add(m);
    return m;
  }

  private ensureHalo(prev: THREE.InstancedMesh | null, mat: THREE.Material, cap: number, tier: OrbTier): THREE.InstancedMesh | null {
    if (!this.list.some((o) => o.tier === tier)) {
      if (prev) { this.parent.remove(prev); prev.dispose(); }
      return null;
    }
    if (prev && prev.count >= cap) return prev;
    if (prev) { this.parent.remove(prev); prev.dispose(); }
    const m = new THREE.InstancedMesh(this.haloGeo, mat, cap);
      m.frustumCulled = false;
      m.castShadow = false;
      m.renderOrder = 520;
    this.parent.add(m);
    return m;
  }
}
