import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TIMES, DEFAULT_TOD, todName, todFromSearch, TOD_UNIFORMS, type TimeOfDay } from '../src/render/timeOfDay';
import { biomeName } from '../src/render/biomeHills';
import { Environment, ENV_STYLE } from '../src/render/environment';
import { POST_STYLE } from '../src/render/post';
import { ART } from '../src/render/materials';

const FIELDS: (keyof TimeOfDay)[] = ['skyTop', 'skyMid', 'skyHorizon', 'skyBelow', 'sunGlow', 'sunSky', 'fog', 'fogNear', 'fogFar', 'hemiSky', 'hemiGround', 'hemiIntensity',
  'sun', 'sunIntensity', 'sunFrom', 'bandTint', 'seaTint', 'warm', 'sat', 'exposure', 'windows', 'stars', 'rim'];
const hex = (c: string) => '#' + new THREE.Color(c).getHexString();

describe('time-of-day presets', () => {
  it('every preset defines every field with a sane value', () => {
    for (const [name, t] of Object.entries(TIMES)) {
      expect(Object.keys(t).sort(), name).toEqual([...FIELDS].sort());
      for (const k of FIELDS) {
        const v = t[k];
        if (typeof v === 'string') expect(v, `${name}.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
        else if (Array.isArray(v)) { expect(v.length).toBe(3); v.forEach((x) => expect(Number.isFinite(x)).toBe(true)); }
        else expect(Number.isFinite(v), `${name}.${k}`).toBe(true);
      }
      expect(t.fogNear).toBeLessThan(t.fogFar);
      for (const k of ['windows', 'stars'] as const) { expect(t[k]).toBeGreaterThanOrEqual(0); expect(t[k]).toBeLessThanOrEqual(1); }
    }
  });

  it('?tod= lookup: known names select a preset, anything else falls back to the default', () => {
    expect(DEFAULT_TOD).toBe('day');
    expect(todName('')).toBe('day');
    expect(todName('?seed=1')).toBe('day');
    expect(todName('?tod=night&seed=1')).toBe('night');
    for (const n of ['morning', 'golden', 'dusk', 'night'] as const) expect(todFromSearch(`?tod=${n}`)).toBe(TIMES[n]);
    for (const bad of ['?tod=', '?tod=noon', '?tod=NIGHT', '?tod=constructor', '?tod=toString', '?tod=__proto__']) expect(todName(bad)).toBe('day');
  });

  it('the default preset is the shipped look (ENV_STYLE / POST_STYLE / exposure 0.95)', () => {
    const d = TIMES.day, E = ENV_STYLE;
    for (const k of ['skyTop', 'skyMid', 'skyHorizon', 'skyBelow', 'sunGlow', 'fog', 'hemiSky', 'hemiGround', 'sun'] as const) expect(hex(d[k]), k).toBe(hex(E[k]));
    expect([d.fogNear, d.fogFar, d.hemiIntensity, d.sunIntensity]).toEqual([E.fogNear, E.fogFar, E.hemiIntensity, E.sunIntensity]);
    expect(d.sunSky).toEqual(E.sunSky.toArray());
    expect(d.sunFrom).toEqual(E.sunFrom.toArray());
    expect(d.warm).toEqual(POST_STYLE.warm);
    expect(d.sat).toBe(POST_STYLE.saturation);
    expect(d.exposure).toBe(0.95);
    expect([d.bandTint, d.seaTint, d.windows, d.stars, d.rim]).toEqual(['#ffffff', '#ffffff', 0, 0, 1]);
  });

  it('applyTime is values-only (no new objects) and returning to day restores the shipped state', () => {
    const scene = new THREE.Scene();
    const env = new Environment(scene);
    const count = () => { let n = 0; scene.traverse(() => n++); return n; };
    const state = () => JSON.stringify({ fog: (scene.fog as THREE.Fog).color.getHex(), fn: (scene.fog as THREE.Fog).near, sun: env.sun.color.getHex(), si: env.sun.intensity, rim: ART.rimColor.getHex(),
      band: TOD_UNIFORMS.bandTint.value.getHex(), sea: TOD_UNIFORMS.seaTint.value.getHex(), stars: TOD_UNIFORMS.stars.value, night: TOD_UNIFORMS.night.value });
    const before = state(), n0 = count();
    env.applyTime(TIMES.night);
    expect(count()).toBe(n0);
    expect(TOD_UNIFORMS.night.value).toBe(1);
    expect(state()).not.toBe(before);
    env.applyTime(TIMES.night); // idempotent (the rim is scaled from its base, not compounded)
    env.applyTime(TIMES.day);
    expect(state()).toBe(before);
  });

  it('?biome= lookup falls back to the town', () => {
    expect(biomeName('')).toBe('town');
    expect(biomeName('?biome=hills')).toBe('hills');
    expect(biomeName('?biome=desert')).toBe('town');
  });
});
