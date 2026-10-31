import { Course, type Rail, type Surface, type Wall, type Marker, type Vec2 } from './course';
import { extend, kicker, smooth, easeOut, linear } from './shapes';
import { mulberry32, randRange } from '../rng';

/**
 * Movement laboratory (milestones 1-2). An authored route whose dimensions vary
 * slightly with the seed so "retry same seed" vs "new run" is meaningful.
 *
 *  A  start flat (push) -> descent -> compression -> climb -> ramp (flip ramp)
 *  GAP1 (jump)
 *  B  landing slope -> flat with OPTIONAL rail on the right -> gentle descent -> lip
 *  GAP2 (COMPULSORY rail on the route centre line)
 *  C  receive -> recovery flat -> wall kicker
 *  GAP3 (COMPULSORY wall ride on the right)
 *  D  receive -> climb to crest
 *  GAP4 (jump)
 *  E  receive -> finish
 */
export function buildLabCourse(seed: number): Course {
  const rng = mulberry32(seed);
  const surfaces: Surface[] = [];
  const rails: Rail[] = [];
  const walls: Wall[] = [];
  const markers: Marker[] = [];
  let id = 0;
  const addSurface = (points: Vec2[], material: Surface['material'] = 'cloud', thickness = 4) => {
    surfaces.push({ id: id++, kind: 'ground', points, material, thickness });
  };
  const last = (p: Vec2[]) => p[p.length - 1];

  // --- A ---
  const a: Vec2[] = [{ x: -10, y: 0 }];
  extend(a, 36, 0, linear, 4);
  markers.push({ x: 8, label: 'PUSH' });
  const drop = randRange(rng, 9, 11.5);
  extend(a, 88, -drop, smooth);
  markers.push({ x: 40, label: 'DESCENT' });
  extend(a, 100, -drop, linear, 3);
  const climb = randRange(rng, 4, 5.5);
  extend(a, 128, -drop + climb, smooth);
  markers.push({ x: 102, label: 'CLIMB' });
  extend(a, 140, -drop + climb, linear, 3);
  const rampH = randRange(rng, 2.0, 2.6);
  extend(a, 150, -drop + climb + rampH, kicker, 0.8);
  markers.push({ x: 140, label: 'RAMP · FLIP' });
  addSurface(a, 'stone', 5);
  const lip1 = last(a);

  // --- GAP1 (jump) ---
  const gap1 = randRange(rng, 7, 9);
  markers.push({ x: lip1.x + gap1 / 2, label: 'GAP' });

  // --- B ---
  const bx = lip1.x + gap1;
  const by = lip1.y - randRange(rng, 1.4, 2.2);
  const b: Vec2[] = [{ x: bx, y: by }];
  extend(b, bx + 16, by - 2.2, easeOut, 1);
  const floorB = by - 2.2;
  extend(b, bx + 26, floorB, linear, 4);
  const r1x = bx + 30, r1len = 26;
  rails.push({ id: 0, points: [{ x: r1x, y: floorB + 1.0 }, { x: r1x + r1len, y: floorB + 0.6 }], lateral: 1.2, required: false });
  markers.push({ x: r1x - 3, label: 'RAIL · OPTIONAL' });
  extend(b, r1x + r1len + 10, floorB, linear, 4);
  const floor2 = floorB - randRange(rng, 3, 4.5);
  extend(b, r1x + r1len + 40, floor2, smooth);
  const lip2x = r1x + r1len + 62;
  extend(b, lip2x, floor2, linear, 4);
  addSurface(b, 'cloud', 4);

  // --- GAP2 (compulsory rail) ---
  const gap2 = randRange(rng, 22, 25);
  rails.push({
    id: 1,
    points: [{ x: lip2x, y: floor2 + 1.0 }, { x: lip2x + gap2 / 2, y: floor2 + 0.7 }, { x: lip2x + gap2 + 5, y: floor2 - 0.1 }],
    lateral: 0,
    required: true,
  });
  markers.push({ x: lip2x - 6, label: 'RAIL · REQUIRED' });

  // --- C ---
  const cx = lip2x + gap2;
  const cy = floor2 - 0.8;
  const c: Vec2[] = [{ x: cx, y: cy }];
  extend(c, cx + 30, cy, linear, 4); // recovery
  const kick = randRange(rng, 1.0, 1.4);
  extend(c, cx + 40, cy + kick, kicker, 0.8);
  addSurface(c, 'stone', 5);
  const lip3 = last(c);

  // --- GAP3 (compulsory wall) ---
  const gap3 = randRange(rng, 34, 38);
  walls.push({ id: 0, x0: lip3.x - 4, x1: lip3.x + gap3 + 3, yBottom: lip3.y - 4.5, yTop: lip3.y + 4.5, side: 'right', lateral: 2.4, required: true });
  markers.push({ x: lip3.x - 10, label: 'WALL · REQUIRED' });

  // --- D ---
  const dx = lip3.x + gap3;
  const dy = lip3.y - kick - 0.2;
  const d: Vec2[] = [{ x: dx, y: dy }];
  extend(d, dx + 18, dy, linear, 3);
  const crestRise = randRange(rng, 3, 4);
  extend(d, dx + 44, dy + crestRise, smooth);
  extend(d, dx + 48, dy + crestRise + 0.25, easeOut, 1);
  markers.push({ x: dx + 22, label: 'CREST' });
  addSurface(d, 'cloud', 4);
  const lip4 = last(d);

  // --- GAP4 (jump) ---
  const gap4 = randRange(rng, 4.5, 6);
  const ex = lip4.x + gap4;
  const ey = lip4.y - randRange(rng, 1.2, 2);
  const e: Vec2[] = [{ x: ex, y: ey }];
  extend(e, ex + 12, ey - 1.5, easeOut, 1);
  extend(e, ex + 80, ey - 1.5, linear, 4);
  addSurface(e, 'stone', 5);
  const finishX = ex + 50;
  markers.push({ x: finishX, label: 'FINISH' });

  const course = new Course(seed, surfaces, rails, walls, markers, 2, finishX);
  course.markGap(lip2x, 'rail');
  course.markGap(lip3.x, 'wall');
  return course;
}
