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
  it('draws fixture clusters, ropes on the authored laterals and a tuft, and keeps bunting out of the zone', () => {
    const ground = { id: 0, kind: 'ground' as const, points: [{ x: -10, y: 0 }, { x: 600, y: 0 }], material: 'stone' as const, thickness: 4 };
    const course = new Course(1, [ground], [buntingRail(11, 140, 160), buntingRail(12, 400, 420)], [], [], 0, 700);
    course.sky.push(SKY_FIXTURE_INTRO);
    const view = new CourseView(course);
    const root = view.group;

    const clusters = named(root, 'sky-cluster');
    expect(clusters.map((c) => c.userData.count)).toEqual([5, 4, 6]);
    for (const c of clusters) {
      const balloons = c.children.filter((ch) => ch.name === 'sky-balloon');
      const strings = c.children.find((ch) => ch.name === 'sky-strings');
      expect(balloons.length).toBe(c.userData.count);
      expect(strings?.children.length).toBeGreaterThanOrEqual(c.userData.count as number);
      const lengths = c.userData.lengths as number[];
      expect(lengths.length).toBe(c.userData.count);
      for (const len of lengths) expect(len).toBeGreaterThanOrEqual(1.35);
      for (const len of lengths) expect(len).toBeLessThanOrEqual(2.25);
    }

    const ropes = named(root, 'sky-rope');
    expect(ropes.length).toBe(SKY_FIXTURE_INTRO.lines.length);
    SKY_FIXTURE_INTRO.lines.forEach((line, i) => {
      expect(ropes[i].userData.laterals).toEqual(line.anchors.map((a) => a.lateral));
    });
    expect(named(root, 'sky-anchor').length).toBeGreaterThanOrEqual(SKY_FIXTURE_INTRO.lines.reduce((n, l) => n + l.anchors.length, 0));
    expect(named(root, 'sky-tuft').length).toBe(1);
    expect(named(root, 'sky-laundry').length).toBeGreaterThan(0);
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
