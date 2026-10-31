import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BROOM, Broom, BristleTrail } from '../src/render/broom';

describe('broom prototype (presentation only)', () => {
  it('the deck section tops out where the feet plant (deckTop - DECK_Y = 0.035) and the broom runs along +X', () => {
    const b = new Broom();
    const box = new THREE.Box3().setFromObject(b.group);
    expect(box.max.x).toBeGreaterThan(1.2); // nose ahead
    expect(box.min.x).toBeLessThan(-1.2); // straw tail behind
    expect(box.max.z - box.min.z).toBeLessThan(0.45); // slim across the travel axis (board was 0.44)
    // under the feet (x = +-0.23): the top surface (foot wraps) sits within a few mm of 0.035
    const ray = new THREE.Raycaster(new THREE.Vector3(0.23, 1, 0), new THREE.Vector3(0, -1, 0));
    b.group.updateMatrixWorld(true);
    const hit = ray.intersectObject(b.group, true)[0];
    expect(hit.point.y).toBeGreaterThan(0.03);
    expect(hit.point.y).toBeLessThan(0.05);
  });
  it('grab targets sit on the handle just outside the feet', () => {
    expect(BROOM.grabL.x).toBeGreaterThan(0.3); expect(BROOM.grabR.x).toBeLessThan(-0.3);
    expect(Math.abs(BROOM.grabL.z)).toBeLessThan(0.06); expect(Math.abs(BROOM.grabR.z)).toBeLessThan(0.06);
  });
  it('the trail emits per mode and stays finite, and goes quiet when emission stops', () => {
    const t = new BristleTrail(64);
    const alpha = () => (t.points.geometry.getAttribute('aAlpha').array as Float32Array);
    let x = 0;
    for (let i = 0; i < 120; i++) { x += 15 / 60; t.update(1 / 60, [20, 50, 60], x - 1.3, 0, 0, x, 0, 0, 15); }
    const a = alpha();
    expect([...a].some((v) => v > 0)).toBe(true);
    expect([...(t.points.geometry.getAttribute('position').array as Float32Array)].every(Number.isFinite)).toBe(true);
    // particles stay behind her (route space): none ahead of the rider
    const pos = t.points.geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < 64; i++) if (a[i] > 0) expect(pos[i * 3]).toBeLessThan(0.5);
    for (let i = 0; i < 120; i++) t.update(1 / 60, [0, 0, 0], 0, 0, 0, x, 0, 0, 0);
    expect([...alpha()].every((v) => v === 0)).toBe(true);
  });
});
