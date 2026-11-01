/**
 * Trail frequency and purple spacing over streamed endless course.
 * Run: npx tsx scripts/orb-trail-metrics.ts [seed...]
 */
import { EndlessCourse } from '../src/course/endless';

const seeds = process.argv.slice(2).map(Number).filter((n) => n > 0);
const SEEDS = seeds.length ? seeds : [1, 42, 777];

const DIST = 3200;

function measure(seed: number) {
  const course = new EndlessCourse(seed);
  course.stream(DIST);
  const x0 = course.originX;
  const span = DIST - x0;
  const orbs = course.orbs;
  const trailIds = new Set<number>();
  for (const o of orbs) if (o.trailId > 0 && o.trailLen > 1) trailIds.add(o.trailId);
  const trailsPer100 = (trailIds.size / span) * 100;
  const rares = orbs.filter((o) => o.tier === 'rare').sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 1; i < rares.length; i++) gaps.push(rares[i].x - rares[i - 1].x);
  const gapStats = gaps.length
    ? { min: Math.min(...gaps), max: Math.max(...gaps), mean: gaps.reduce((a, b) => a + b, 0) / gaps.length, n: gaps.length }
    : { min: 0, max: 0, mean: 0, n: 0 };
  return { seed, span, trailGroups: trailIds.size, trailsPer100, rareCount: rares.length, purpleGapM: gapStats };
}

console.log(JSON.stringify(SEEDS.map(measure), null, 2));
