import * as THREE from 'three';

/**
 * Time-of-day presets (vision work, `?tod=morning|golden|dusk|night`). Lighting, sky, fog and grade only: no extra
 * lights, no extra draw calls, no new shader variants. A preset change writes uniforms and light/fog values only:
 *  - sky dome colours + stars, painted band / sea tint and cloud tint (TOD_UNIFORMS, shared by those materials);
 *  - hemisphere + sun light colour/intensity/direction, fog colour/range, the toon rim strength (ART.rimColor);
 *  - the post grade (warmth, saturation) in PostPass's shared uniforms, and the renderer's tone-mapping exposure;
 *  - window glow (TOD_UNIFORMS.night) in the town material's emissive term, which the existing bloom picks up.
 * `day` is the shipped look: its values equal ENV_STYLE / POST_STYLE (tests/timeOfDay.test.ts holds them together).
 */
export interface TimeOfDay {
  skyTop: string; skyMid: string; skyHorizon: string; skyBelow: string; sunGlow: string;
  /** Direction of the sun glow in the sky dome (the moon at night). */
  sunSky: [number, number, number];
  fog: string; fogNear: number; fogFar: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  sun: string; sunIntensity: number; sunFrom: [number, number, number];
  /** Multiplies the painted panorama / far-town bands (and the clouds) and the sea. */
  bandTint: string; seaTint: string;
  /** Post grade: warmth multiplier and saturation; renderer tone-mapping exposure. */
  warm: [number, number, number]; sat: number; exposure: number;
  /** 0..1 window glow (town emissive). */
  windows: number;
  /** Stars in the dome (0..1). */
  stars: number;
  /** Rim-light strength multiplier (the warm toon rim keeps walls bright; dimmed at dusk/night). */
  rim: number;
}

export type TodName = 'day' | 'morning' | 'golden' | 'dusk' | 'night';
export const DEFAULT_TOD: TodName = 'day';

export const TIMES: Record<TodName, TimeOfDay> = {
  day: {
    skyTop: '#4f93d0', skyMid: '#86b8e0', skyHorizon: '#dbe9ef', skyBelow: '#9ccbd2', sunGlow: '#fff4d8', sunSky: [-0.42, 0.3, -1],
    fog: '#d9e7ee', fogNear: 70, fogFar: 520, hemiSky: '#fff3e2', hemiGround: '#b4a6c6', hemiIntensity: 1.2,
    sun: '#ffe2b8', sunIntensity: 2.5, sunFrom: [-0.62, 0.7, -0.18], bandTint: '#ffffff', seaTint: '#ffffff',
    warm: [1.025, 1.0, 0.965], sat: 1.07, exposure: 0.95, windows: 0, stars: 0, rim: 1,
  },
  morning: {
    skyTop: '#6aa6d8', skyMid: '#a9cbe6', skyHorizon: '#f3e4d6', skyBelow: '#b9d6da', sunGlow: '#fff0d0', sunSky: [0.55, 0.16, -1],
    fog: '#e8ecef', fogNear: 40, fogFar: 380, hemiSky: '#eef4ff', hemiGround: '#c4b8cf', hemiIntensity: 1.25,
    sun: '#fff0d8', sunIntensity: 2.0, sunFrom: [0.7, 0.42, -0.4], bandTint: '#f4f2f4', seaTint: '#e8f2f6',
    warm: [1.0, 1.0, 1.02], sat: 0.98, exposure: 1.0, windows: 0, stars: 0, rim: 1,
  },
  golden: {
    skyTop: '#5d86c4', skyMid: '#e7b98c', skyHorizon: '#ffcf8a', skyBelow: '#e0a77a', sunGlow: '#ffd27a', sunSky: [-0.5, 0.1, -1],
    fog: '#f2cfa2', fogNear: 60, fogFar: 460, hemiSky: '#ffd9a8', hemiGround: '#9b7f9e', hemiIntensity: 1.0,
    sun: '#ffb45e', sunIntensity: 3.0, sunFrom: [-0.85, 0.28, -0.35], bandTint: '#ffd3a0', seaTint: '#ffcf9a',
    warm: [1.07, 0.99, 0.88], sat: 1.12, exposure: 0.95, windows: 0.15, stars: 0, rim: 1,
  },
  dusk: {
    skyTop: '#2e3a73', skyMid: '#7d5c94', skyHorizon: '#f08a6a', skyBelow: '#6a4f73', sunGlow: '#ff9a60', sunSky: [-0.6, 0.03, -1],
    fog: '#8a6f8e', fogNear: 50, fogFar: 420, hemiSky: '#a99ad0', hemiGround: '#4a3d58', hemiIntensity: 0.62,
    sun: '#ff8a5a', sunIntensity: 1.1, sunFrom: [-0.9, 0.16, -0.3], bandTint: '#9c86b0', seaTint: '#8a7aa8',
    warm: [1.04, 0.96, 0.98], sat: 1.05, exposure: 1.0, windows: 0.85, stars: 0.25, rim: 0.55,
  },
  night: {
    skyTop: '#0b1430', skyMid: '#1b2b55', skyHorizon: '#3a4d7a', skyBelow: '#1a2440', sunGlow: '#dfe8ff', sunSky: [0.35, 0.45, -1],
    fog: '#1a2440', fogNear: 30, fogFar: 300, hemiSky: '#5a70b8', hemiGround: '#14132a', hemiIntensity: 0.42,
    sun: '#a9c0ff', sunIntensity: 0.55, sunFrom: [0.45, 0.75, -0.35], bandTint: '#4a5a8a', seaTint: '#3a4f80',
    warm: [0.96, 0.99, 1.06], sat: 0.95, exposure: 1.0, windows: 1, stars: 1, rim: 0.25,
  },
};

/** Preset name from a query string (`?tod=`); anything unknown or missing is the default (the shipped daytime look). */
export function todName(search: string): TodName {
  const k = new URLSearchParams(search).get('tod');
  return k !== null && Object.prototype.hasOwnProperty.call(TIMES, k) ? (k as TodName) : DEFAULT_TOD;
}
export const todFromSearch = (search: string): TimeOfDay => TIMES[todName(search)];

/** Shared uniforms (one object each, referenced by every material that reads them: setting them never recompiles). */
export const TOD_UNIFORMS = {
  /** Painted bands + clouds tint. */
  bandTint: { value: new THREE.Color('#ffffff') },
  seaTint: { value: new THREE.Color('#ffffff') },
  stars: { value: 0 },
  /** Town window glow 0..1. */
  night: { value: 0 },
};
