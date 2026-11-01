import type { OrbTier } from '../course/orbs';

/** Presentation-only orb pickup (deterministic from sim tick + orb id). */
export interface OrbFxEvent {
  tick: number;
  id: number;
  x: number;
  y: number;
  lateral: number;
  tier: OrbTier;
  streak: number;
  trailDone: boolean;
  /** Orbs in the trail (for sting pick). */
  trailLen: number;
}
