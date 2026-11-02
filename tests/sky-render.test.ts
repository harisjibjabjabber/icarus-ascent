import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Course, type Rail } from '../src/course/course';
import { SKY_FIXTURE_INTRO } from '../src/course/skyFixture';
import { CourseView } from '../src/render/courseView';
import { Kit } from '../src/render/town/kit';
import { buildTownChunk } from '../src/render/town/town';

const loadKit = async () => {
  const nodeFs = 'node:fs';
  const fs = await import(/* @vite-ignore */ nodeFs) as { readFileSync(p: string, enc?: string): Uint8Array & string };
  const b = fs.readFileSync('public/town/kit.bin');
  const j = JSON.parse(fs.readFileSync('public/town/kit.json', 'utf8'));
  return Kit.fromBuffers(j, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
};

function named(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
}

function buntingRail(id: number, x0: number, x1: number): Rail {
  return { id, points: [{ x: x0, y: 5 }, { x: x1, y: 5 }], lateral: 1.15, required: false, dress: 'bunting' };
}

describe('sky layer art', () => {
  it('draws fixture clusters, ropes on the authored laterals and a tuft, and keeps bunting out of the zone', async () => {
    const ground = { id: 0, kind: 'ground' as const, points: [{ x: -10, y: 0 }, { x: 600, y: 0 }], material: 'stone' as const, thickness: 4 };
    const course = new Course(1, [ground], [buntingRail(11, 140, 160), buntingRail(12, 400, 420)], [], [], 0, 700);
    course.sky.push(SKY_FIXTURE_INTRO);
    const view = new CourseView(course);
    await view.balloonsReady;
    const root = view.group;

    const balloons = named(root, 'sky-balloon');
    expect(balloons.length).toBe(SKY_FIXTURE_INTRO.clusters.length);
    for (const b of balloons) {
      expect(b.userData.diameter).toBeGreaterThanOrEqual(5);
      expect(b.userData.diameter).toBeLessThanOrEqual(6);
      expect(b.userData.lateral).toBe(0);
      const env = b.getObjectByName('sky-balloon-envelope') as THREE.Object3D;
      expect(env).toBeTruthy();
      const gores = env.children.filter((c) => (c as THREE.Mesh).isMesh);
      expect(gores.length).toBeGreaterThanOrEqual(5);
      const mats = new Set(gores.map((c) => (c as THREE.Mesh).material));
      expect(mats.size).toBe(gores.length);
    }
    const first = balloons[0];
    const env = first.getObjectByName('sky-balloon-envelope')!;
    view.squashPad(SKY_FIXTURE_INTRO.clusters[0].bounceId);
    view.animate(0.04);
    expect(env.scale.y).toBeLessThan(0.9);
    expect(env.scale.x).toBeGreaterThan(1);
    view.animate(0.55);
    expect(env.scale.y).toBeLessThan(0.7);
    expect(first.userData.popped).toBe(true);
    expect(first.userData.spent).toBe(true);

    const ropes = named(root, 'sky-rope');
    expect(ropes.length).toBe(SKY_FIXTURE_INTRO.lines.length);
    SKY_FIXTURE_INTRO.lines.forEach((line, i) => {
      expect(ropes[i].userData.laterals).toEqual(line.anchors.map((a) => a.lateral));
    });
    const lines = named(root, 'sky-line');
    expect(lines.length).toBe(SKY_FIXTURE_INTRO.lines.length);
    for (const line of lines) {
      const xs = line.children.filter((c) => c.name === 'sky-anchor').map((c) => c.userData.x as number).sort((a, b) => a - b);
      expect(xs.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(11);
        expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(21);
      }
    }
    const ribbons = named(root, 'sky-tuft-ribbon') as THREE.Mesh[];
    expect(ribbons.length).toBeGreaterThanOrEqual(5);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ribbon of ribbons) {
      const p = ribbon.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        minY = Math.min(minY, p.getY(i));
        maxY = Math.max(maxY, p.getY(i));
      }
    }
    expect(maxY - minY).toBeGreaterThan(8);
    expect(named(root, 'sky-tuft').length).toBe(1);
    const laundry = named(root, 'sky-laundry') as THREE.Mesh[];
    expect(laundry.length).toBeGreaterThan(0);
    for (const cloth of laundry) {
      cloth.geometry.computeBoundingBox();
      const bb = cloth.geometry.boundingBox!;
      expect(bb.max.y - bb.min.y).toBeGreaterThan(0.45);
    }
    expect(named(root, 'cross-laundry').length).toBe(0);
    expect(named(root, 'hang-span').length).toBe(0);

    const flags = named(root, 'street-bunting');
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(f.userData.x0 as number).toBeGreaterThanOrEqual(295);
    }
    view.dispose();
  });

  let kit: Kit;
  beforeAll(async () => { kit = await loadKit(); });

  it('dresses sky-zone frontages with three floors and flower boxes, and builds no cross-street laundry', () => {
    const slope = (x: number) => ({ y: -x * 0.02, gap: false });
    const zone = { x0: 0, x1: 500 };
    const chunk = buildTownChunk(kit, 2, 1, slope, { skyZones: [zone] });
    const fronts = chunk.plans.filter((p) => p.row === 0);
    expect(fronts.length).toBeGreaterThan(0);
    for (const p of fronts) {
      expect(p.floors).toBeGreaterThanOrEqual(3);
      expect(p.flowerBoxes * 2).toBeGreaterThanOrEqual(p.thirdWindows);
    }
    expect(chunk.crossStreetLaundry).toBe(0);
    expect(chunk.buntingStrings).toBe(0);
    const plain = buildTownChunk(kit, 2, 1, slope, { skyZones: [] });
    expect(plain.crossStreetLaundry).toBe(0);
    expect(plain.buntingStrings).toBe(0);
  });
});
