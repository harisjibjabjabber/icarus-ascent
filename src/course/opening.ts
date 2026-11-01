import { Course, type Lesson, type Marker, type Rail, type Surface, type Vec2, type Wall } from './course';
import { extend, kicker, smooth, easeOut, linear, crestPop } from './shapes';
import { TUNING } from '../tuning';

/**
 * The authored opening (brief §10 / §12 "Third"). Ten lessons, one idea each, in order.
 * Every lesson starts with a checkpoint (a fail retries that lesson) and a calm one-line
 * prompt; compulsory features sit at the end of straight, crest-free run-ins so the chase
 * camera shows them well before commitment, and the course supplies the momentum each one
 * needs (a descent precedes the rail gap, the big ramp and the wall).
 *
 * Dense layout (Haris: "too sparse, takes ages to see the harbour"): the first ~10 s
 * (push, descent, first jump) stay a gentle tutorial; from the Pot lesson on, lessons chain
 * with almost no recovery: each lesson's prompt and checkpoint begin right after the previous
 * feature, optional handrails fill the descents, and the next element is never more than
 * ~3 s away. The harbour (both wall runs) starts at the big jump's landing (~26 s, was ~53 s).
 *
 *  1 Push          flat start                         -> prompt: swipe down
 *  2 Descent       drop + valley -> crest pop (no gap) onto a down-slope
 *  3 Jump          small gap, broad slightly-lower receiver
 *  4 Pot           one low pot: jump it or heel-break it
 *  5 Heel skim     two pots close together: skim through both (or hop both); short descent
 *  6 Optional rail beside the route, straight into
 *  7 Required rail rail bridging a gap -> pot on the run-out
 *  8 Big jump      descent with handrail -> ramp + gap for a flip or grab, pillar on the landing run
 *                  (harbour from here)
 *  9 Wall ride     descent with handrail -> kicker -> wall bridging a long gap -> broad receiver
 * 10 Harbour run   garden wall -> pot -> canal crossed by wall run -> pillar -> handrail -> pots
 *  finish run-in   optional harbour wall
 *  finish          long calm run-out on the quay
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
  /** Optional handrail (right of the route) following the current chain's ground from x0 to x1, h above it. */
  const handrail = (x0: number, x1: number, h = 0.95) => {
    const yAt = (x: number) => {
      for (let i = 1; i < pts.length; i++) if (pts[i].x >= x) { const a = pts[i - 1], b = pts[i]; return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x); }
      return cur().y;
    };
    const n = Math.max(2, Math.ceil((x1 - x0) / 3) + 1);
    rails.push({ id: rails.length, points: Array.from({ length: n }, (_, i) => { const x = x0 + ((x1 - x0) * i) / (n - 1); return { x, y: yAt(x) + h }; }), lateral: 1.2, required: false });
  };

  // ---------------------------------------------------------------- 1 push (tutorial: gentle, ~12 s to the first gap)
  flat(50);
  lesson({ title: 'Push', cpX: 2, cpSpeed: 0, prompt: 'Swipe down to push', keys: '↓', promptX0: -20, promptX1: 40, featureX: 30, required: false });

  // ---------------------------------------------------------------- 2 descent
  const d2 = cur().x;
  slope(54, -12);
  flat(12);
  // payoff: a crest pop on continuous ground. Carry the descent's speed into it and fly
  // (airtime for a style flip or grab); land on the down-slope and keep the speed.
  const crest2 = cur().x + 10;
  crestPop(pts, 2.2, 10, 2.0, 18);
  lesson({ title: 'Descent', cpX: d2 - 8, cpSpeed: 9, prompt: 'Downhill builds speed — carry it over the bump and fly', promptX0: d2 - 6, promptX1: crest2 + 4, featureX: crest2, required: false });
  flat(40);

  // ---------------------------------------------------------------- 3 jump (forgiving)
  const a3 = cur().x - 38;
  const lip3 = gap(5.5, -0.4, 'cloud');
  slope(14, -1.0, easeOut);
  lesson({ title: 'Jump', cpX: a3, cpSpeed: 12, prompt: 'Swipe up to jump the gap', keys: '↑ / Space', promptX0: a3, promptX1: lip3.x + 2, featureX: lip3.x, required: true });

  // ---------------------------------------------------------------- 4 pot (two solutions); the ramp-up starts here
  // From here on each lesson's prompt and checkpoint start right after the previous feature,
  // so features can follow each other closely while every prompt still gets its 2 s.
  const a4 = cur().x;
  flat(38);
  const pot4 = a4 + 27;
  pots.push(pot4);
  lesson({ title: 'Pot', cpX: lip3.x + 10, cpSpeed: 13, prompt: 'Pot ahead — jump it, or jump and hold down to smash it', promptX0: lip3.x + 4, promptX1: pot4 - 2, featureX: pot4 - 5, required: true });

  // ---------------------------------------------------------------- 5 heel skim
  const a5 = cur().x;
  flat(50);
  const pot5 = a5 + 38;
  pots.push(pot5, pot5 + 4);
  lesson({ title: 'Heel skim', cpX: pot4 + 5, cpSpeed: 14, prompt: 'Jump, then keep holding down as you land — heel skim through both', keys: '↑ then hold ↓', promptX0: pot4 + 3, promptX1: pot5 + 5, featureX: pot5 - 6, required: true });
  // a short descent gives back the speed the skim took
  slope(24, -4.5);

  // ---------------------------------------------------------------- 6 optional rail -> straight into the rail gap
  const a6 = cur().x;
  flat(28);
  const r6 = a6 + 4;
  rails.push({ id: rails.length, points: [{ x: r6, y: cur().y + 0.95 }, { x: r6 + 22, y: cur().y + 0.6 }], lateral: 1.2, required: false });
  lesson({ title: 'Optional rail', cpX: pot5 + 8, cpSpeed: 14, prompt: 'Rail on the right — jump, then swipe down to grind it (optional)', keys: '↑ then ↓', promptX0: pot5 + 7, promptX1: r6 + 8, featureX: r6 - 3, required: false });
  slope(20, -2.5); // momentum for the rail gap (long enough not to launch at the hard cap)

  // ---------------------------------------------------------------- 7 required rail
  const a7 = cur().x;
  flat(18);
  const y7 = cur().y;
  const lip7 = gap(20, -0.8, 'stone');
  rails.push({ id: rails.length, points: [{ x: lip7.x, y: y7 + 1.0 }, { x: lip7.x + 10, y: y7 + 0.7 }, { x: lip7.x + 25, y: y7 - 0.1 }], lateral: 0, required: true });
  requiredGaps.push([lip7.x, 'rail']);
  lesson({ title: 'Rail', cpX: r6 + 24, cpSpeed: 15, prompt: 'Rail over the gap — jump, then swipe down to catch it', keys: '↑ then ↓', promptX0: r6 + 8, promptX1: lip7.x, featureX: lip7.x - 2.2, required: true });
  flat(26);
  const pot7 = cur().x - 6; // a pot on the rail's run-out: smash or hop it into the big-jump descent
  pots.push(pot7);
  void a7;

  // ---------------------------------------------------------------- 8 big jump + pillar (the harbour comes into view)
  const a8 = cur().x;
  slope(28, -6.5);
  handrail(a8 + 3, a8 + 25);
  flat(6);
  const rampH = 2.4;
  extend(pts, cur().x + 10, cur().y + rampH, kicker, 0.8);
  const lip8 = gap(8, -1.8, 'cloud');
  slope(16, -2.2, easeOut);
  flat(24);
  const pil8 = lip8.x + 8 + 22;
  pillars.push(pil8);
  lesson({ title: 'Big jump', cpX: a8 + 2, cpSpeed: 13, prompt: 'Big jump: swipe up again to flip, or sideways to grab — hit the pillar mid-trick', keys: '↑↑ flip · ←/→ grab', promptX0: pot7 + 3, promptX1: pil8, featureX: lip8.x - 0.8, required: true });
  const harbourX = Math.floor((lip8.x + 8) / 40) * 40; // harbour town from the big jump's landing on

  // ---------------------------------------------------------------- 9 wall ride (first wall: forgiving, long overhang)
  const a9 = cur().x;
  slope(40, -11); // momentum: the wall wants ~12 m/s or more
  handrail(a9 + 4, a9 + 32);
  flat(8);
  const kick9 = 1.2;
  extend(pts, cur().x + 10, cur().y + kick9, kicker, 0.8);
  const gap9 = 36;
  const lip9 = gap(gap9, -kick9 - 0.2, 'stone');
  walls.push({ id: walls.length, x0: lip9.x - 4, x1: lip9.x + gap9 + 3, yBottom: lip9.y - 4.5, yTop: lip9.y + 4.5, side: 'right', lateral: 2.4, required: true });
  requiredGaps.push([lip9.x, 'wall']);
  lesson({ title: 'Wall ride', cpX: a9 + 2, cpSpeed: 12, prompt: 'Wall on the right — jump, then hold right to ride it across', keys: '↑ then hold →', promptX0: pil8 + 3, promptX1: lip9.x + 6, featureX: lip9.x - 0.8, required: true });
  flat(14); // broad receiver

  // ---------------------------------------------------------------- 10 combo: harbour run
  // garden wall -> pot -> canal crossed by wall run -> pillar -> handrail -> pots, one flowing chain to the finish
  const a10 = cur().x;
  flat(50);
  walls.push({ id: walls.length, x0: a10 + 2, x1: a10 + 20, yBottom: cur().y - 1.5, yTop: cur().y + 3.6, side: 'right', lateral: 2.4, required: false });
  const pot10 = a10 + 30;
  pots.push(pot10);
  const gap10 = 24;
  const lip10 = gap(gap10, -1.6, 'cloud');
  walls.push({ id: walls.length, x0: lip10.x - 4, x1: lip10.x + gap10 + 3, yBottom: lip10.y - 4.5, yTop: lip10.y + 4.5, side: 'right', lateral: 2.4, required: true });
  requiredGaps.push([lip10.x, 'wall']);
  slope(10, -0.8, easeOut);
  flat(22);
  const pil10 = lip10.x + gap10 + 18;
  pillars.push(pil10);
  lesson({ title: 'Put it together', cpX: lip9.x + gap9 + 2, cpSpeed: 14, prompt: 'Harbour run: pot, wall run over the canal, pillar, rail, pots', keys: '↑ then hold →', promptX0: lip9.x + gap9 + 2, promptX1: pil10, featureX: pot10 - 5, required: true });
  const aR = cur().x;
  slope(22, -3.5);
  handrail(aR + 2, aR + 22);
  flat(28);
  pots.push(cur().x - 12, cur().x - 8);

  // ---------------------------------------------------------------- finish (harbour quay)
  const aF = cur().x;
  slope(26, -2.5);
  // optional harbour wall on the last descent: one more ride before the finish line
  walls.push({ id: walls.length, x0: aF + 2, x1: aF + 24, yBottom: cur().y - 1.5, yTop: cur().y + 4.6, side: 'right', lateral: 2.4, required: false });
  const finishX = cur().x + 6;
  flat(90);
  surfaces.push({ id: surfaces.length, kind: 'ground', points: pts, material, thickness: material === 'stone' ? 5 : 4 });
  markers.push({ x: finishX, label: 'FINISH' });

  const course = new Course(0, surfaces, rails, walls, markers, 2, finishX);
  course.kind = 'opening';
  course.lessons = lessons;
  course.harbourX = harbourX;
  for (const [x, req] of requiredGaps) course.markGap(x, req);
  const O = TUNING.obstacles;
  for (const x of pots) course.addObstacle('pot', x, O.potHalfWidth, O.potHeight);
  for (const x of pillars) course.addObstacle('pillar', x, O.pillarHalfWidth, O.pillarHeight);
  return course;
}
