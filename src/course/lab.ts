import { Course, type Rail, type Surface, type Wall, type Marker, type Vec2 } from './course';
import { extend, kicker, smooth, easeOut, linear } from './shapes';
import { mulberry32, randRange } from '../rng';

/**
 * Milestone 1 movement laboratory. An authored route whose dimensions vary
 * slightly with the seed so "retry same seed" vs "new run" is meaningful.
 *
 * Order: start flat (push) -> descent -> compression -> climb -> ramp -> GAP ->
 * landing slope -> flat with optional rail (right) -> wall section (right) ->
 * climb to crest -> small GAP -> finish.
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

  // --- Chain A: start flat, descent, compression, climb, ramp ---
  const a: Vec2[] = [{ x: -10, y: 0 }];
  extend(a, 36, 0, linear, 4);
  markers.push({ x: 8, label: 'PUSH' });
  const drop = randRange(rng, 9, 11.5);
  extend(a, 88, -drop, smooth);
  markers.push({ x: 40, label: 'DESCENT' });
  extend(a, 100, -drop, linear, 3); // compression / valley
  const climb = randRange(rng, 4, 5.5);
  extend(a, 128, -drop + climb, smooth);
  markers.push({ x: 102, label: 'CLIMB' });
  extend(a, 140, -drop + climb, linear, 3);
  const rampH = randRange(rng, 2.0, 2.6);
  extend(a, 150, -drop + climb + rampH, kicker, 0.8);
  markers.push({ x: 140, label: 'RAMP' });
  addSurface(a, 'stone', 5);
  const lipY = -drop + climb + rampH;

  // --- GAP 1 ---
  const gap1 = randRange(rng, 7, 9);
  markers.push({ x: 150 + gap1 / 2, label: 'GAP' });

  // --- Chain B: landing slope, flat w/ optional rail, wall section, climb to crest ---
  const bx = 150 + gap1;
  const by = lipY - randRange(rng, 1.4, 2.2);
  const b: Vec2[] = [{ x: bx, y: by }];
  extend(b, bx + 16, by - 2.2, easeOut, 1);
  extend(b, bx + 24, by - 2.2, linear, 4);
  const railStart = bx + 26, railLen = 26, railY = by - 2.2 + 1.7;
  extend(b, railStart + railLen + 6, by - 2.2, linear, 4);
  rails.push({
    id: 0,
    points: [{ x: railStart, y: railY }, { x: railStart + railLen, y: railY - 0.6 }],
    lateral: 2.3,
    required: false,
  });
  markers.push({ x: railStart - 2, label: 'RAIL (M2)' });
  // gentle drop into the wall section
  const wx0 = railStart + railLen + 14;
  extend(b, wx0 - 2, by - 4, smooth);
  const floorY = by - 4;
  extend(b, wx0 + 32, floorY, linear, 4);
  walls.push({ id: 0, x0: wx0, x1: wx0 + 28, yBottom: floorY + 0.2, yTop: floorY + 5, side: 'right', lateral: 2.4, required: false });
  markers.push({ x: wx0, label: 'WALL (M2)' });
  // climb to a crest lip
  const crestRise = randRange(rng, 3, 4);
  const cx = wx0 + 60;
  extend(b, cx, floorY + crestRise, smooth);
  extend(b, cx + 4, floorY + crestRise + 0.25, easeOut, 1);
  markers.push({ x: wx0 + 36, label: 'CREST' });
  addSurface(b, 'cloud', 4);
  const crestY = floorY + crestRise + 0.25;

  // --- GAP 2 ---
  const gap2 = randRange(rng, 4.5, 6);
  // --- Chain C: receive + finish flat ---
  const c0 = cx + 4 + gap2;
  const cy = crestY - randRange(rng, 1.2, 2);
  const c: Vec2[] = [{ x: c0, y: cy }];
  extend(c, c0 + 12, cy - 1.5, easeOut, 1);
  extend(c, c0 + 70, cy - 1.5, linear, 4);
  addSurface(c, 'stone', 5);
  const finishX = c0 + 40;
  markers.push({ x: finishX, label: 'FINISH' });

  return new Course(seed, surfaces, rails, walls, markers, 2, finishX);
}
