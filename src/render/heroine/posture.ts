/**
 * Posture guard rails (presentation only). Pure maths so it is unit-testable without a model.
 * Frame: the rider root (+X travel, +Y up, +Z her facing / toe side).
 */
export const DEG = Math.PI / 180;

/** Soft limit: identity below 70% of `lim`, then eases (C1-continuous) toward `lim`, never past it. */
export function softLimit(x: number, lim: number): number {
  const a = lim * 0.7, ax = Math.abs(x);
  if (ax <= a) return x;
  return Math.sign(x) * (a + (lim - a) * Math.tanh((ax - a) / (lim - a)));
}

/** Torso pitch of a hips->neck vector: toward her front (pF, +Z) and along travel (pT, +X), radians. */
export function torsoPitch(t: { x: number; y: number; z: number }): { pF: number; pT: number } {
  return { pF: Math.atan2(t.z, t.y), pT: Math.atan2(t.x, t.y) };
}

export interface PostureLimits { forward: number; travel: number }
/** Per-state limits. Deliberate tricks keep more range; the crash is free. */
export function limitsFor(state: string, mode: string): PostureLimits | null {
  if (state === 'crash' || state === 'crashSit' || mode === 'failed') return null;
  if (state === 'flip' || state === 'grabL' || state === 'grabR') return { forward: 40 * DEG, travel: 30 * DEG };
  if (mode === 'heelSkim' || state === 'skim') return { forward: 25 * DEG, travel: 30 * DEG };
  return { forward: 25 * DEG, travel: 25 * DEG };
}

/** Rotations (about root X, then root Z) that bring the torso inside the limits; 0 when already inside. */
export function postureCorrection(t: { x: number; y: number; z: number }, lim: PostureLimits): { aboutX: number; aboutZ: number } {
  const { pF, pT } = torsoPitch(t);
  // rotating about +X by a tips +Y toward +Z (forward); about +Z by b tips +Y toward -X
  return { aboutX: softLimit(pF, lim.forward) - pF, aboutZ: -(softLimit(pT, lim.travel) - pT) };
}
