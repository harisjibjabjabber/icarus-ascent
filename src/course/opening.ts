import { Course, type Lesson, type Marker, type Rail, type Surface, type Vec2, type Wall } from './course';
import { extend, kicker, smooth, easeOut, linear, crestPop } from './shapes';
import { TUNING } from '../tuning';

/**
 * The authored opening (brief §10 / §12 "Third"). Ten lessons, one idea each, in
 * order, alternating a concentrated section with a short recovery stretch. Every
 * lesson starts with a checkpoint (a fail retries that lesson) and a calm one-line
 * prompt. Compulsory features sit at the end of long, straight, crest-free run-ins
 * so the chase camera shows them well before commitment, and the course supplies
 * the momentum each one needs (a descent precedes the rail gap, the big ramp and
 * the wall).
 *
 *  1 Push          flat start                         -> prompt: swipe down
 *  2 Descent       long smooth drop + valley -> crest pop (no gap) onto a down-slope
 *  3 Jump          small gap, broad slightly-lower receiver
 *  (recovery)
 *  4 Pot           one low pot: jump it or heel-break it
 *  (recovery)
 *  5 Heel skim     two pots close together: skim through both (or hop both)
 *  (recovery descent: regain the speed the skim cost)
 *  6 Optional rail beside the route
 *  (recovery + gentle descent)
 *  7 Required rail rail bridging a gap
 *  (recovery, then descent)
 *  8 Big jump      ramp + gap for a flip or grab, pillar on the landing run
 *  (recovery, then long descent: wall needs ~12 m/s+)
 *  9 Wall ride     kicker -> wall bridging a long gap -> broad receiver
 *  (recovery)
 * 10 Combo         optional garden wall -> pot -> canal crossed by wall run -> pillar
 *  finish run-in   optional harbour wall
 *  finish          long calm run-out
 */
export function buildOpeningCourse(): Course {
  const surfaces: Surface[] = [];
  const rails: Rail[] = [];
  const walls: Wall[] = [];
  const markers: Marker[] = [];
  const lessons: Lesson[] = [];
  const pots: number[] = [];
  const pillars: number[] = [];
  const requiredGaps: [number, 'rail' | 'wall'][] = [];
  let pts: Vec2[] = [{ x: -10, y: 0 }];
  let material: Surface['material'] = 'stone';
  const cur = () => pts[pts.length - 1];
  const flat = (len: number) => extend(pts, cur().x + len, cur().y, linear, 4);
  const slope = (len: number, dy: number, ease = smooth) => extend(pts, cur().x + len, cur().y + dy, ease, 1.5);
  /** End the current chain at its last point and start a new one after a gap. */
  const gap = (len: number, dy: number, next: Surface['material']) => {
    surfaces.push({ id: surfaces.length, kind: 'ground', points: pts, material, thickness: material === 'stone' ? 5 : 4 });
    const lip = cur();
    pts = [{ x: lip.x + len, y: lip.y + dy }];
    material = next;
    return lip;
  };
  const lesson = (l: Omit<Lesson, 'id'>) => { lessons.push({ id: lessons.length, ...l }); };

  // ---------------------------------------------------------------- 1 push
  flat(72);
  lesson({ title: 'Push', cpX: 2, cpSpeed: 0, prompt: 'Swipe down to push', keys: '↓', promptX0: -20, promptX1: 56, featureX: 40, required: false });

  // ---------------------------------------------------------------- 2 descent
  const d2 = cur().x;
  slope(64, -13);
  flat(14);
  // payoff: a crest pop on continuous ground. Carry the descent's speed into it and fly
  // (airtime for a style flip or grab); land on the down-slope and keep the speed.
  const crest2 = cur().x + 10;
  crestPop(pts, 2.2, 10, 2.0, 18);
  lesson({ title: 'Descent', cpX: d2 - 8, cpSpeed: 9, prompt: 'Downhill builds speed — carry it over the bump and fly', promptX0: d2 - 6, promptX1: crest2 + 4, featureX: crest2, required: false });
  flat(48);

  // ---------------------------------------------------------------- 3 jump (forgiving)
  const a3 = cur().x - 46;
  const lip3 = gap(5.5, -0.4, 'cloud');
  slope(14, -1.0, easeOut);
  lesson({ title: 'Jump', cpX: a3, cpSpeed: 12, prompt: 'Swipe up to jump the gap', keys: '↑ / Space', promptX0: a3, promptX1: lip3.x, featureX: lip3.x, required: true });
  flat(28); // recovery

  // ---------------------------------------------------------------- 4 pot (two solutions)
  const a4 = cur().x;
  flat(64);
  const pot4 = a4 + 46;
  pots.push(pot4);
  lesson({ title: 'Pot', cpX: a4 + 2, cpSpeed: 14, prompt: 'Pot ahead — jump it, or jump and hold down to smash it', promptX0: a4, promptX1: pot4 - 2, featureX: pot4 - 5, required: true });
  flat(22); // recovery

  // ---------------------------------------------------------------- 5 heel skim
  const a5 = cur().x;
  flat(80);
  const pot5 = a5 + 48;
  pots.push(pot5, pot5 + 4);
  lesson({ title: 'Heel skim', cpX: a5 + 2, cpSpeed: 14, prompt: 'Jump, then keep holding down as you land — heel skim through both', keys: '↑ then hold ↓', promptX0: a5, promptX1: pot5 + 5, featureX: pot5 - 6, required: true });
  // recovery: a descent gives back the speed the skim took
  slope(40, -6);
  flat(14);

  // ---------------------------------------------------------------- 6 optional rail
  const a6 = cur().x;
  flat(48);
  const r6 = a6 + 18;
  rails.push({ id: rails.length, points: [{ x: r6, y: cur().y + 0.95 }, { x: r6 + 24, y: cur().y + 0.6 }], lateral: 1.2, required: false });
  lesson({ title: 'Optional rail', cpX: a6 + 2, cpSpeed: 14, prompt: 'Rail on the right — jump, then swipe down to grind it (optional)', keys: '↑ then ↓', promptX0: a6, promptX1: r6 + 6, featureX: r6 - 3, required: false });
  slope(26, -3.5); // recovery + momentum for the rail gap
  flat(10);

  // ---------------------------------------------------------------- 7 required rail
  const a7 = cur().x;
  flat(46);
  const y7 = cur().y;
  const lip7 = gap(20, -0.8, 'stone');
  rails.push({ id: rails.length, points: [{ x: lip7.x, y: y7 + 1.0 }, { x: lip7.x + 10, y: y7 + 0.7 }, { x: lip7.x + 25, y: y7 - 0.1 }], lateral: 0, required: true });
  requiredGaps.push([lip7.x, 'rail']);
  lesson({ title: 'Rail', cpX: a7 + 2, cpSpeed: 15, prompt: 'Rail over the gap — jump, then swipe down to catch it', keys: '↑ then ↓', promptX0: a7, promptX1: lip7.x, featureX: lip7.x - 2.2, required: true });
  flat(26); // recovery

  // ---------------------------------------------------------------- 8 big jump + pillar
  const a8 = cur().x;
  slope(44, -8);
  flat(12);
  const rampH = 2.4;
  extend(pts, cur().x + 10, cur().y + rampH, kicker, 0.8);
  const lip8 = gap(8, -1.8, 'cloud');
  slope(16, -2.2, easeOut);
  flat(40);
  const pil8 = lip8.x + 8 + 22;
  pillars.push(pil8);
  lesson({ title: 'Big jump', cpX: a8 + 2, cpSpeed: 13, prompt: 'Big jump: swipe up again to flip, or sideways to grab — hit the pillar mid-trick', keys: '↑↑ flip · ←/→ grab', promptX0: a8, promptX1: pil8, featureX: lip8.x - 0.8, required: true });
  flat(8); // recovery

  // ---------------------------------------------------------------- 9 wall ride
  const a9 = cur().x;
  slope(50, -12); // momentum: the wall wants ~12 m/s or more
  flat(10);
  const kick9 = 1.2;
  extend(pts, cur().x + 10, cur().y + kick9, kicker, 0.8);
  const gap9 = 36;
  const lip9 = gap(gap9, -kick9 - 0.2, 'stone');
  walls.push({ id: walls.length, x0: lip9.x - 4, x1: lip9.x + gap9 + 3, yBottom: lip9.y - 4.5, yTop: lip9.y + 4.5, side: 'right', lateral: 2.4, required: true });
  requiredGaps.push([lip9.x, 'wall']);
  lesson({ title: 'Wall ride', cpX: a9 + 2, cpSpeed: 12, prompt: 'Wall on the right — jump, then hold right to ride it across', keys: '↑ then hold →', promptX0: a9, promptX1: lip9.x + 6, featureX: lip9.x - 0.8, required: true });
  flat(36); // broad receiver + recovery

  // ---------------------------------------------------------------- 10 combo
  // pot -> canal cut you can only cross by wall-running the quay wall beside it -> pillar. An optional garden
  // wall on the run-in lets the player warm up (jump + hold right) before the wall they must ride.
  const a10 = cur().x;
  flat(64);
  walls.push({ id: walls.length, x0: a10 + 6, x1: a10 + 30, yBottom: cur().y - 1.5, yTop: cur().y + 3.6, side: 'right', lateral: 2.4, required: false });
  const pot10 = a10 + 42;
  pots.push(pot10);
  const gap10 = 24;
  const lip10 = gap(gap10, -1.6, 'cloud');
  walls.push({ id: walls.length, x0: lip10.x - 4, x1: lip10.x + gap10 + 3, yBottom: lip10.y - 4.5, yTop: lip10.y + 4.5, side: 'right', lateral: 2.4, required: true });
  requiredGaps.push([lip10.x, 'wall']);
  slope(10, -0.8, easeOut);
  flat(46);
  const pil10 = lip10.x + gap10 + 26;
  pillars.push(pil10);
  lesson({ title: 'Put it together', cpX: a10 + 2, cpSpeed: 14, prompt: 'Put it together: pot, wall run over the canal, pillar', keys: '↑ then hold →', promptX0: a10, promptX1: pil10, featureX: pot10 - 5, required: true });

  // ---------------------------------------------------------------- finish
  const aF = cur().x;
  slope(30, -2.5);
  // optional harbour wall on the last descent: one more ride for fun before the finish line
  walls.push({ id: walls.length, x0: aF + 2, x1: aF + 28, yBottom: cur().y - 1.5, yTop: cur().y + 4.6, side: 'right', lateral: 2.4, required: false });
  const finishX = cur().x + 10;
  flat(90);
  surfaces.push({ id: surfaces.length, kind: 'ground', points: pts, material, thickness: material === 'stone' ? 5 : 4 });
  markers.push({ x: finishX, label: 'FINISH' });

  const course = new Course(0, surfaces, rails, walls, markers, 2, finishX);
  course.kind = 'opening';
  course.lessons = lessons;
  for (const [x, req] of requiredGaps) course.markGap(x, req);
  const O = TUNING.obstacles;
  for (const x of pots) course.addObstacle('pot', x, O.potHalfWidth, O.potHeight);
  for (const x of pillars) course.addObstacle('pillar', x, O.pillarHalfWidth, O.pillarHeight);
  return course;
}
