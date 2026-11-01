/**
 * CC0 orb SFX and Kenney particle atlas (see art/LICENSES.md, art/orb/process-assets.mjs).
 */
const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || './';
const join = (p: string) => BASE + p.replace(/^\//, '');

export const ORB_SPRITE = {
  glow: 0,
  star: 1,
  sparkle: 2,
  ring: 3,
  burst: 4,
  swirl: 5,
  flare: 6,
  streak: 7,
} as const;

export type OrbSprite = keyof typeof ORB_SPRITE;

/** CC0 gem collect (reverb) — gold uses short bake, rare full length; see art/orb/process-assets.mjs. */
export const ORB_PICKUP_SFX = join('orbs/sfx/gold');

export const ORB_ASSETS = {
  sfx: {
    gold: join('orbs/sfx/gold'),
    rare: join('orbs/sfx/rare'),
    trail: join('orbs/sfx/trail'),
    trailPerfect: join('orbs/sfx/trailPerfect'),
  },
  tex: {
    atlas: join('orbs/tex/particles.webp'),
  },
} as const;

export type OrbSfxKind = 'gold' | 'rare' | 'trail' | 'trailPerfect';

/** Major-scale streak semitones (reset after 0.6 s without a pickup). */
export const ORB_STREAK_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12] as const;

/** playbackRate for streak steps 1..8. */
export const ORB_STREAK_RATE = ORB_STREAK_SEMITONES.map((s) => 2 ** (s / 12)) as readonly number[];

/** Purple orb plays ~this many semitones below the active streak step. */
export const ORB_RARE_PITCH_OFFSET = -3;
