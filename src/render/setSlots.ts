import type { Group } from 'three';

/**
 * Set-piece visuals. Gameplay (the rail, the bounce, the updraft) does not consult this file.
 *
 * A slot is empty when `PropSet.piece(name)` is missing, or when the steam sheets fail to load.
 * Do not fill an empty slot with procedural geometry, flat colour, or a box.
 *
 * Expected axes, in the piece's local space (stamp frame `along`: +X follows the route,
 * +Z is the rider's right, +Y is up):
 * - set-awning*: origin on the wall at the top bar. +Z points toward the street.
 *   Valance hangs toward −Y. Three atlases, one mesh family.
 * - set-sheet / set-shirt / set-towel / set-dress / set-sock: peg at the origin, cloth hangs
 *   down (−Y), width along +Z so the chase camera sees the face.
 * - set-balloon: knot at the origin, cluster toward +Y.
 * - set-boat: keel on y=0, length along Z, bow toward +Z.
 * - props/steam/*.webp: one camera-facing puff each. Mixed per updraft.
 */
export const SET_ASSET = {
  awning: 'set-awning',
  awnings: ['set-awning', 'set-awning-teal', 'set-awning-ochre'] as const,
  laundry: ['set-sheet', 'set-shirt', 'set-towel', 'set-dress', 'set-sock', 'set-sock-b'] as const,
  balloon: 'set-balloon',
  boat: 'set-boat',
  /** Paths under the site base. An empty load leaves the plume undrawn. */
  steam: [
    'props/steam/smoke1.webp',
    'props/steam/smoke3.webp',
    'props/steam/smoke_04.webp',
    'props/steam/smoke_07.webp',
  ] as const,
} as const;

export interface SoftProp {
  id: number;
  group: Group;
  hit: number;
  phase: number;
  baseY: number;
  bob: number;
  bobRate: number;
}

/** Squash, a little rebound, then a resting bob. `hit` is the time of the last landing, or -1. */
export function poseSoft(p: SoftProp, time: number): void {
  const age = p.hit < 0 ? 10 : time - p.hit;
  const s = p.hit < 0 ? 0 : Math.exp(-age * 5.5) * Math.cos(age * 14);
  p.group.scale.set(1 + 0.1 * s, 1 - 0.3 * s, 1 + 0.08 * s);
  if (p.bob) p.group.position.y = p.baseY + Math.sin(time * p.bobRate + p.phase) * p.bob;
}
