import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TUNING } from '../src/tuning';

/** Pure-math visibility budget for the chase camera on a 390x844 portrait screen. */
function framing(speed: number, W = 390, H = 844) {
  const C = TUNING.camera;
  const fov = C.fov + C.fovAtCap * Math.min(1, speed / TUNING.movement.hardCap);
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.3, 2000);
  cam.rotation.set((-C.pitchDeg * Math.PI) / 180, 0, 0, 'YXZ');
  cam.position.set(0, C.height + C.heightPerSpeed * speed, C.behind + C.behindPerSpeed * speed);
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const px = (ahead: number, y = 0) => ((1 - new THREE.Vector3(0, y, -ahead).project(cam).y) / 2) * H;
  let gapVisible = 0;
  for (let d = 2; d < 300; d += 0.5) if (px(d) - px(d + 7) >= 10) gapVisible = d;
  return { riderPx: px(0) - px(0, 1.7), feetPx: px(0), gapVisible };
}

describe('chase camera visibility budget', () => {
  it('a 7 m gap gets >= ~2 s of readable approach at the hard cap', () => {
    const f = framing(TUNING.movement.hardCap);
    expect(f.gapVisible / TUNING.movement.hardCap).toBeGreaterThanOrEqual(1.95);
  });
  it('and >= 2.4 s at the soft cap', () => {
    const v = TUNING.movement.softCap;
    expect(framing(v).gapVisible / v).toBeGreaterThanOrEqual(2.4);
  });
  it('rider stays a reasonable size and low in frame at rest and at the cap', () => {
    for (const v of [0, TUNING.movement.hardCap]) {
      const f = framing(v);
      expect(f.riderPx).toBeGreaterThan(65);
      expect(f.riderPx).toBeLessThan(130);
      expect(f.feetPx).toBeGreaterThan(844 * 0.68);
      expect(f.feetPx).toBeLessThan(844 * 0.88);
    }
  });
});
