import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Autopilot } from '../src/diag/autopilot';
import { CameraRig, chaseAheadMax, skyCameraZone, stepSkyCamera, type SkyCamMemory } from '../src/render/cameraRig';
import { ORIGIN, toScene } from '../src/render/space';
import { Simulation } from '../src/sim/simulation';
import { TUNING } from '../src/tuning';
import { SKY_FIXTURE_INTRO } from '../src/course/skyFixture';

/**
 * The fixture course lives in sky-sim.test.ts. This file rebuilds the same street so the camera
 * test does not import the view (that module touches document at load).
 */
import { Course, type Rail, type Surface, type Tuft } from '../src/course/course';

function stone(id: number, points: Surface['points']): Surface {
  return { id, kind: 'ground', points, material: 'stone', thickness: 4 };
}

function fixtureCourse(): Course {
  const seg = SKY_FIXTURE_INTRO;
  const rails: Rail[] = seg.lines.map((line) => ({
    id: line.railId,
    points: line.anchors.map((a) => ({ x: a.x, y: a.y })),
    lateral: 0,
    required: false,
    sky: true as const,
  }));
  const course = new Course(1, [stone(0, [{ x: -20, y: 0 }, { x: seg.x1 + 40, y: 0 }])], rails, [], [], seg.x0, seg.x1 + 40);
  const tuft: Tuft = {
    id: seg.tuftId, x0: seg.gx, x1: seg.gx + 3, yBase: seg.yBase,
    catchH: TUNING.tricks.sky.gustCatchH,
    exitX: seg.gx + TUNING.tricks.sky.gustExitDx,
    exitY: seg.yBase + TUNING.tricks.sky.gustExitDy,
    lateral: 0, source: 'grate', segmentId: seg.id,
  };
  course.tufts.push(tuft);
  course.sky.push(seg);
  const S = TUNING.tricks.sky;
  for (const c of seg.clusters) {
    course.addBounce({ kind: 'balloon', x: c.tether.x, y: c.tether.y, half: S.clusterHalf, lateral: 0, sky: true, rad: S.clusterRad });
  }
  return course;
}

describe('sky chase camera', () => {
  it('keeps Ao\'s feet at 45–85% of a 390×844 screen and the street 10 m ahead inside the frustum', () => {
    ORIGIN.x = 0; ORIGIN.y = 0;
    const course = fixtureCourse();
    const seg = SKY_FIXTURE_INTRO;
    const sim = new Simulation(course, TUNING, { x: seg.x0, speed: 14 });
    const ap = new Autopilot({ minSpeed: 14 });
    const rig = new CameraRig();
    rig.resize(390, 844);
    const mem: SkyCamMemory = { postGust: 0 };
    const frustum = new THREE.Frustum();
    const proj = new THREE.Matrix4();
    let worstHi = 1;
    let worstLo = 0;
    let samples = 0;
    let gustHi = 1;
    let preGust = -1;
    let lineGap = -1;
    let lineFeet = -1;
    let linePitch = 0;
    let topFeet = -1;
    let topStreet = -1;
    let highPitch = 0;
    let lowPitch = 0;
    let nextIn = false;
    let streetMiss = '';
    const dt = TUNING.sim.dt;
    const maxTicks = Math.round(40 / dt);
    let snapped = false;
    for (let i = 0; i < maxTicks && sim.state.mode !== 'failed' && sim.state.x < seg.x1 + 5; i++) {
      for (const a of ap.next(sim)) sim.enqueue(a);
      sim.step();
      sim.drainEvents();
      const s = sim.state;
      const ahead = chaseAheadMax(course, s.x, TUNING.camera.lookOverRange);
      const plan = stepSkyCamera(s.mode, s.layer, dt, mem, skyCameraZone(course, s.x, s.mode, s.layer), s.y);
      const camSpeed = s.mode === 'gusting' || (s.layer === 'sky' && s.mode === 'airborne') ? Math.max(0, s.vx) : s.speed;
      rig.update(dt, s.x, s.y, camSpeed, !snapped, ahead, 0, plan);
      snapped = true;
      if (s.x < seg.x0 || s.x > seg.x1) continue;
      rig.camera.updateMatrixWorld();
      const feet = toScene(s.x, s.y, 0, new THREE.Vector3()).project(rig.camera);
      const fromTop = (1 - feet.y) / 2;
      worstHi = Math.min(worstHi, fromTop);
      worstLo = Math.max(worstLo, fromTop);
      samples++;
      if (s.mode === 'grounded' && s.x < seg.gx && preGust < 0) preGust = fromTop;
      if (s.mode === 'gusting') gustHi = Math.min(gustHi, fromTop);
      if (s.mode === 'grinding' && s.railId === 1 && s.x > seg.gx + 16 && s.x < seg.gx + 24 && lineGap < 0) {
        lineFeet = fromTop;
        const under = toScene(s.x + 4, 0, 0, new THREE.Vector3()).project(rig.camera);
        lineGap = (1 - under.y) / 2 - fromTop;
        linePitch = -rig.camera.rotation.x * 180 / Math.PI;
      }
      if (s.mode === 'grinding' && s.railId === 1 && s.x > seg.gx + 30) {
        const hop = toScene(seg.gx + 38, 7, 0, new THREE.Vector3()).project(rig.camera);
        if (hop.z > 0 && hop.z < 1 && Math.abs(hop.x) < 1 && Math.abs(hop.y) < 1) nextIn = true;
      }
      if (s.mode === 'grinding' && s.railId === 4 && s.y > 8 && topFeet < 0) {
        topFeet = fromTop;
        const under = toScene(s.x + 6, 0, 0, new THREE.Vector3()).project(rig.camera);
        topStreet = (1 - under.y) / 2;
        highPitch = -rig.camera.rotation.x * 180 / Math.PI;
      }
      if (s.mode === 'grinding' && s.railId === 4 && s.y < 6.2) {
        const p = -rig.camera.rotation.x * 180 / Math.PI;
        if (lowPitch === 0 || p < lowPitch) lowPitch = p;
      }
      const ground = course.groundBelow(s.x + 10, 1e6);
      const streetY = ground ? ground.sample.y : seg.yBase;
      const street = toScene(s.x + 10, streetY, 0, new THREE.Vector3());
      frustum.setFromProjectionMatrix(proj.multiplyMatrices(rig.camera.projectionMatrix, rig.camera.matrixWorldInverse));
      if (!frustum.containsPoint(street)) {
        streetMiss = `street at x+10 missed the frustum at rider x=${s.x.toFixed(1)} y=${s.y.toFixed(2)} mode=${s.mode}`;
        break;
      }
    }
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(samples).toBeGreaterThan(100);
    expect(streetMiss).toBe('');
    expect(worstHi, `feet rose to ${(worstHi * 100).toFixed(1)}% from the top`).toBeGreaterThanOrEqual(0.45);
    expect(worstLo, `feet sank to ${(worstLo * 100).toFixed(1)}% from the top`).toBeLessThanOrEqual(0.85);
    // The gust trails below her, so she climbs the frame instead of the camera matching the rise.
    expect(preGust).toBeGreaterThan(0.7);
    expect(gustHi).toBeLessThanOrEqual(preGust - 0.15);
    // Settled on a line, the cobbles sit well below her feet and the next line is still in frame.
    expect(lineFeet).toBeLessThan(0.75);
    expect(lineGap).toBeGreaterThanOrEqual(0.12);
    expect(linePitch).toBeGreaterThan(21);
    expect(nextIn).toBe(true);
    expect(topStreet - topFeet).toBeGreaterThanOrEqual(0.12);
    // The look-down eases off on the glide down from the top line.
    expect(highPitch).toBeGreaterThan(24);
    expect(lowPitch).toBeLessThan(highPitch - 2);
  });

  it('looks ahead at sky lines, not only the street', () => {
    const course = fixtureCourse();
    const seg = SKY_FIXTURE_INTRO;
    const at = chaseAheadMax(course, seg.gx - 5, TUNING.camera.lookOverRange);
    expect(at).toBeGreaterThanOrEqual(6.4);
    const groundOnly = course.maxHeightAhead(seg.gx - 5, TUNING.camera.lookOverRange);
    expect(groundOnly).toBeLessThan(1);
  });
});
