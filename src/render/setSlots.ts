import type { Group } from 'three';

/**
 * Set-piece visuals that are not drawn until a sourced asset is in the slot.
 * Gameplay (the rail, the bounce, the updraft) does not consult this file.
 *
 * A slot is empty when `PropSet.piece(name)` is missing, or when the steam
 * sheet 404s. Do not fill an empty slot with procedural geometry, flat colour,
 * or a box. Drop the authored file in and rebake under the name below.
 *
 * Expected axes, in the piece's local space (stamp frame `along`: +X follows
 * the route, +Z is the rider's right, +Y is up):
 * - set-awning: origin on the wall at the top bar. +Z points toward the street.
 * - set-sheet / set-shirt / set-towel / set-sock: peg at the origin, cloth hangs
 *   down (−Y), width along +X.
 * - set-balloon: cluster around the origin, knot toward −Y.
 * - set-boat: keel on y=0, length along Z, bow toward +Z.
 * - props/steam.png: one painted wisp, or a horizontal strip of equal frames.
 *   Set STEAM_FRAMES to the frame count when the sheet arrives.
 */
export const SET_ASSET = {
  awning: 'set-awning',
  laundry: ['set-sheet', 'set-shirt', 'set-towel', 'set-sock'] as const,
  balloon: 'set-balloon',
  boat: 'set-boat',
  /** Path under the site base. Missing file means no plume. */
  steam: 'props/steam.png',
} as const;

/** Frames across props/steam.png. 1 until the sheet is a strip. */
export const STEAM_FRAMES = 1;

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
