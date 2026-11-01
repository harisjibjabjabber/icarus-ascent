/**
 * Zone (biome) abstraction. A zone is mostly data: which phrases and set pieces the endless
 * generator may use in it and how often, plus a visual/audio theme the renderer resolves.
 * Course-side code (generator, tests) only reads the gameplay half; render code resolves
 * `theme.scenery` through src/zones/scenery.ts. See docs/ZONES.md for how to add one.
 */
export type TimeOfDay = 'day' | 'morning' | 'golden' | 'dusk' | 'night';

export interface ZoneTheme {
  /** Scenery builder id (src/zones/scenery.ts): what streams beside the route in this zone. */
  scenery: string;
  /** Palette hints for the scenery builder and transition (hex). */
  palette: { ground: string; accent: string; sky: string };
  /** Painted backdrop band(s) (paths under public/), if the zone has its own. */
  backdrop?: string[];
  /** Fog colour / near / far applied while in the zone (cross-faded at gates). */
  fog: { color: string; near: number; far: number };
  /** Time of day the zone defaults to (hook for the day-night cycle). */
  timeOfDay: TimeOfDay;
  /** Ambient props scattered by the scenery builder (asset ids it understands). */
  props?: string[];
}

export interface ZoneAudio { music?: string; ambience?: string; sfx?: Record<string, string> }

export interface Zone {
  id: string;
  name: string;
  /** One-line vibe (start banners, review). */
  tagline: string;
  /** Phrase ids from the shared library (src/course/endless.ts PHRASES) allowed here. */
  phrases: string[];
  /** Set piece ids (src/course/setpieces.ts) dropped in at wave peaks here. */
  setPieces: string[];
  /** Spawn weight multipliers per phrase / set piece id (default 1). */
  weights?: Record<string, number>;
  /** How many waves the zone lasts in endless before the next gate (zones change in a breather). */
  waves: number;
  theme: ZoneTheme;
  audio?: ZoneAudio;
  /** Not used unless asked for by URL (rough/stub zones). */
  experimental?: boolean;
}
