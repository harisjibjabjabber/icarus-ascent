import type { OrbFxEvent } from '../orb/orbFxEvent';
import type { OrbTier } from '../course/orbs';
import { orbBurstColor } from '../course/orbs';
import { OrbParticles } from './orbParticles';

/** Pickup + idle orb VFX (atlas particles; quality-aware). */
export class OrbPickupFx {
  readonly particles = new OrbParticles();

  onCollect(e: OrbFxEvent): void {
    const color = orbBurstColor(e.tier);
    if (e.tier === 'rare') this.particles.pickupRare(e, color);
    else this.particles.pickupGold(e, color);
    if (e.trailDone) this.particles.trailComplete(e, color);
  }

  idleTwinkle(id: number, tick: number, x: number, y: number, lateral: number, tier: OrbTier): void {
    this.particles.idleTwinkle(id, tick, x, y, lateral, orbBurstColor(tier));
  }

  setLowTier(on: boolean): void { this.particles.setLowTier(on); }

  update(dt: number, camQ: import('three').Quaternion): void {
    this.particles.faceCamera(camQ);
    this.particles.update(dt);
  }

  clear(): void { this.particles.clear(); }
}
