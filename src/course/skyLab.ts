/**
 * `?lab=sky` — a straight street with the T1 fixture, so art and mechanics can ride it
 * before the endless generator is in the picture. Lines are the fixture anchors, on the lane.
 */
import { Course, type Rail, type Surface } from './course';
import { SKY_FIXTURE_INTRO } from './skyFixture';
import { TUNING } from '../tuning';

export function buildSkyLab(): Course {
  const seg = SKY_FIXTURE_INTRO;
  const G = seg.gx;
  const rails: Rail[] = seg.lines.map((line) => ({
    id: line.railId,
    points: line.anchors.map((a) => ({ x: a.x, y: a.y })),
    lateral: 0,
    required: false,
    sky: true as const,
  }));
  const stone = (id: number, points: Surface['points']): Surface => ({ id, kind: 'ground', points, material: 'stone', thickness: 4 });
  const course = new Course(1, [stone(0, [{ x: -20, y: 0 }, { x: G + 240, y: 0 }])], rails, [], [], G - 40, G + 220);
  course.kind = 'lab';
  course.tufts.push({
    id: seg.tuftId,
    x0: seg.gx,
    x1: seg.gx + 3,
    yBase: seg.yBase,
    catchH: TUNING.tricks.sky.gustCatchH,
    exitX: seg.gx + TUNING.tricks.sky.gustExitDx,
    exitY: seg.yBase + TUNING.tricks.sky.gustExitDy,
    lateral: 0,
    source: 'grate',
    segmentId: seg.id,
  });
  course.sky.push(seg);
  const S = TUNING.tricks.sky;
  for (const c of seg.clusters) {
    course.addBounce({
      kind: 'balloon', x: c.tether.x, y: c.tether.y, half: S.clusterHalf, lateral: 0, sky: true, rad: S.clusterRad,
    });
  }
  return course;
}
