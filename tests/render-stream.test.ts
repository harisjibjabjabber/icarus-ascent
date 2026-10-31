import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EndlessCourse } from '../src/course/endless';
import { CourseView } from '../src/render/courseView';
import { Environment } from '../src/render/environment';
import { ORIGIN, REBASE, rebaseTarget, rebaseDelta, toScene } from '../src/render/space';

describe('render streaming (headless three.js objects)', () => {
  it('course meshes stream with the course: bounded chunks, scene nodes and pooled obstacle meshes over 30 km', () => {
    ORIGIN.x = 0; ORIGIN.y = 0;
    const course = new EndlessCourse(21);
    const view = new CourseView(course);
    let maxNodes = 0, maxChunks = 0;
    for (let x = 0; x <= 30000; x += 10) {
      course.stream(x);
      view.sync();
      expect(view.chunkCount).toBe(course.chunks.length);
      maxChunks = Math.max(maxChunks, view.chunkCount);
      if (x % 500 === 0) { let n = 0; view.group.traverse(() => n++); maxNodes = Math.max(maxNodes, n); }
    }
    expect(view.stats.built).toBeGreaterThan(100);
    expect(view.stats.disposed).toBeGreaterThan(90);
    expect(maxChunks).toBeLessThan(16);
    expect(maxNodes).toBeLessThan(1500);
    expect(view.stats.pooledCreated).toBeLessThan(30); // obstacle meshes are reused, not re-created
    view.dispose();
  });

  it('floating origin: scene coordinates stay small on a 50 km run, and rebasing keeps placed objects in place', () => {
    ORIGIN.x = 0; ORIGIN.y = 0;
    let maxScene = 0, rebases = 0;
    const marker = new THREE.Object3D();
    const markerRoute = { x: 0, y: 0 };
    for (let x = 0; x <= 50000; x += 7) {
      const y = -0.05 * x; // a long descent: the height axis rebases too
      const t = rebaseTarget(x, y);
      if (t) {
        marker.position.add(rebaseDelta(ORIGIN, t));
        ORIGIN.x = t.x; ORIGIN.y = t.y; rebases++;
        // an object placed before the rebase is still where toScene now says it is
        expect(marker.position.distanceTo(toScene(markerRoute.x, markerRoute.y))).toBeLessThan(1e-6);
        markerRoute.x = x - 30; markerRoute.y = -0.05 * (x - 30);
        marker.position.copy(toScene(markerRoute.x, markerRoute.y));
      }
      maxScene = Math.max(maxScene, toScene(x, y).length());
    }
    expect(rebases).toBeGreaterThan(40);
    expect(maxScene).toBeLessThan(REBASE.every * 1.6 + REBASE.height);
    ORIGIN.x = 0; ORIGIN.y = 0;
  });

  it('chunk groups re-place on rebase so geometry stays aligned with the sim', () => {
    ORIGIN.x = 0; ORIGIN.y = 0;
    const course = new EndlessCourse(4);
    course.stream(2500);
    const view = new CourseView(course);
    const c = course.chunks[course.chunks.length - 2];
    const before = toScene(c.x0, c.y0);
    ORIGIN.x = 2000; ORIGIN.y = Math.round(c.y0 / 100) * 100;
    view.rebase();
    const g = view.group.children.find((q) => q.position.distanceTo(toScene(c.x0, c.y0)) < 1e-6);
    expect(g).toBeTruthy();
    expect(toScene(c.x0, c.y0).length()).toBeLessThan(before.length());
    ORIGIN.x = 0; ORIGIN.y = 0;
    view.dispose();
  });

  it('scenery streams in bounded segments', () => {
    const env = new Environment(new THREE.Scene());
    env.buildScenery(3, Infinity, () => 0, 0, true);
    let max = 0;
    for (let x = 0; x < 20000; x += 25) { env.streamScenery(x); max = Math.max(max, env.segmentCount); }
    expect(max).toBeLessThanOrEqual(10);
  });
});
