import { describe, it, expect } from 'vitest';
import type { AutopilotOptions } from '../src/diag/autopilot';
import { Course, type Rail, type Surface, type Tuft } from '../src/course/course';
import { SKY_FIXTURE_INTRO } from '../src/course/skyFixture';
import type { SkySegment } from '../src/course/skyTypes';
import { Simulation } from '../src/sim/simulation';
import { ScoreKeeper, SCORE } from '../src/score/score';
import { TUNING, type Tuning } from '../src/tuning';
import type { SimEvent } from '../src/sim/types';
import { driveLab, flatCourse } from './helpers';
import { rideEndless, describeFail } from './endlessHelpers';

const G = SKY_FIXTURE_INTRO.gx;
const dt = TUNING.sim.dt;

function tuningAt(speed: number): Tuning {
  return {
    ...TUNING,
    tricks: { ...TUNING.tricks, sky: { ...TUNING.tricks.sky, speed } },
  } as unknown as Tuning;
}

function stone(id: number, points: Surface['points']): Surface {
  return { id, kind: 'ground', points, material: 'stone', thickness: 4 };
}

/** The T1 fixture as a rideable street. `gap` adds the T2 hole and its street rail. */
function buildSky(opts: { gap?: boolean } = {}): { course: Course; seg: SkySegment } {
  const gap = !!opts.gap;
  const seg: SkySegment = gap
    ? { ...SKY_FIXTURE_INTRO, variant: 'sky-gap', gapBelow: { x0: G + 40, x1: G + 62 } }
    : SKY_FIXTURE_INTRO;
  const rails: Rail[] = seg.lines.map((line) => ({
    id: line.railId,
    // Gameplay is the centre line. Anchor laterals in the fixture are presentation for C to re-centre.
    points: line.anchors.map((a) => ({ x: a.x, y: a.y })),
    lateral: 0,
    required: false,
    sky: true as const,
  }));
  if (gap) {
    rails.push({
      id: 90,
      points: [{ x: G + 38, y: 1 }, { x: G + 64, y: 1 }],
      lateral: 0,
      required: true,
    });
  }
  const surfaces = gap
    ? [stone(0, [{ x: -20, y: 0 }, { x: G + 40, y: 0 }]), stone(1, [{ x: G + 62, y: -0.8 }, { x: G + 240, y: -0.8 }])]
    : [stone(0, [{ x: -20, y: 0 }, { x: G + 240, y: 0 }])];
  const course = new Course(1, surfaces, rails, [], [], G - 50, G + 230);
  const tuft: Tuft = {
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
  };
  course.tufts.push(tuft);
  course.sky.push(seg);
  const S = TUNING.tricks.sky;
  for (const c of seg.clusters) {
    course.addBounce({
      kind: 'balloon', x: c.tether.x, y: c.tether.y, half: S.clusterHalf, lateral: 0, sky: true, rad: S.clusterRad,
    });
  }
  if (gap) course.markGap(G + 40, 'rail');
  return { course, seg };
}

function ride(opts: AutopilotOptions & { maxSeconds?: number; speed?: number; gap?: boolean; startX?: number }) {
  const { course, seg } = buildSky({ gap: opts.gap });
  const T = tuningAt(opts.speed ?? TUNING.tricks.sky.speed);
  const sim = new Simulation(course, T, { x: opts.startX ?? G - 30, speed: opts.speed ?? 14 });
  const ev = driveLab(sim, { ...opts, maxSeconds: opts.maxSeconds ?? 45 });
  return { sim, course, seg, ev };
}

function ofType<T extends SimEvent['type']>(ev: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return ev.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

describe('tuft lift', () => {
  it('exits at (gx+9, 7) within ±0.01 for every entry speed, with the release velocity', () => {
    const { course } = buildSky();
    for (const speed of [8, 12, 20, 27.5]) {
      const sim = new Simulation(course, TUNING, { x: G - 2, speed });
      let end: Extract<SimEvent, { type: 'tuft-end' }> | undefined;
      const ys: number[] = [];
      let entryY = 0;
      for (let i = 0; i < Math.round(6 / dt) && !end; i++) {
        const before = sim.state.mode;
        sim.step();
        if (before !== 'gusting' && sim.state.mode === 'gusting') entryY = sim.state.gustFrom.y;
        if (sim.state.mode === 'gusting') ys.push(sim.state.y);
        for (const e of sim.drainEvents()) if (e.type === 'tuft-end') end = e;
      }
      expect(end, `speed ${speed}`).toBeTruthy();
      expect(Math.abs(end!.x - (G + 9)), `speed ${speed} x`).toBeLessThanOrEqual(0.01);
      expect(Math.abs(end!.y - 7), `speed ${speed} y`).toBeLessThanOrEqual(0.01);
      expect(sim.state.mode).toBe('airborne');
      expect(sim.state.layer).toBe('sky');
      expect(sim.state.vx).toBeCloseTo(TUNING.tricks.sky.gustExitVx, 5);
      expect(sim.state.vy).toBeCloseTo(TUNING.tricks.sky.gustExitVy, 5);
      if (speed === 12) {
        // Anticipation: the path dips a little before the whoosh. Hang: the last quarter rises less than the middle.
        expect(Math.min(...ys)).toBeLessThan(entryY - 0.05);
        const n = ys.length;
        const span = (a: number, b: number) => Math.max(...ys.slice(a, b)) - Math.min(...ys.slice(a, b));
        expect(span(Math.floor(n * 0.75), n)).toBeLessThan(span(Math.floor(n * 0.35), Math.floor(n * 0.6)));
      }
    }
  });

  it('rejects Up during the gust and still catches a rider who jumped into the grate', () => {
    const { course } = buildSky();
    const sim = new Simulation(course, TUNING, { x: G - 4, speed: 12 });
    let rejected = false;
    let end: Extract<SimEvent, { type: 'tuft-end' }> | undefined;
    let jumped = false;
    for (let i = 0; i < Math.round(6 / dt) && !end; i++) {
      if (!jumped && sim.state.mode === 'grounded' && sim.state.x > G - 1.4) {
        sim.enqueue({ type: 'up', strokeId: 1, source: 'test' });
        jumped = true;
      }
      if (sim.state.mode === 'gusting' && !rejected) {
        sim.enqueue({ type: 'up', strokeId: 2, source: 'test' });
      }
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type === 'reject' && e.reason.includes('riding the gust')) rejected = true;
        if (e.type === 'tuft-end') end = e;
      }
    }
    expect(jumped).toBe(true);
    expect(rejected).toBe(true);
    expect(end).toBeTruthy();
    expect(Math.abs(end!.x - (G + 9))).toBeLessThanOrEqual(0.01);
    expect(Math.abs(end!.y - 7)).toBeLessThanOrEqual(0.01);
  });
});

describe('sky hops', () => {
  it('every jump window lasts at least 0.30 s at 13.5, 14 and 14.5 m/s', () => {
    for (const h of SKY_FIXTURE_INTRO.hops) {
      if (h.action !== 'jump') continue;
      for (const v of [13.5, 14, 14.5]) expect((h.x1 - h.x0) / v).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('the ideal rider catches every hop and every balloon at governed speeds 13.5, 14 and 14.5', () => {
    for (const speed of [13.5, 14, 14.5]) {
      const { sim, seg, ev } = ride({ minSpeed: speed, speed, maxSeconds: 50 });
      const why = sim.state.fail?.message ?? `stalled at ${sim.state.x.toFixed(1)}`;
      expect(sim.state.mode, `speed ${speed}: ${why}`).not.toBe('failed');
      const grinds = ofType(ev, 'grind-start').map((e) => e.railId);
      for (const line of seg.lines) expect(grinds, `speed ${speed} line ${line.railId}`).toContain(line.railId);
      expect(ofType(ev, 'bounce').length, `speed ${speed} balloons`).toBe(seg.clusters.length);
      const exits = ofType(ev, 'sky-exit');
      expect(exits.at(-1)?.reason, `speed ${speed}`).toBe('complete');
    }
  });

  it('a passive rider is lifted and lands on the street without dying', () => {
    const { sim, ev, seg } = ride({ minSpeed: 14, sky: false, maxSeconds: 40 });
    expect(sim.state.mode, sim.state.fail?.message).not.toBe('failed');
    expect(sim.state.x).toBeGreaterThan(seg.x1);
    expect(ofType(ev, 'tuft-end').length).toBe(1);
    expect(ofType(ev, 'grind-start').length).toBe(0);
    const exits = ofType(ev, 'sky-exit');
    expect(exits).toHaveLength(1);
    expect(exits[0].reason).toBe('fell');
  });

  it('a cluster uses rad: a pass outside it does not bounce, a descending hit does', () => {
    const course = flatCourse(80);
    const pad = course.addBounce({ kind: 'balloon', x: 20, y: 5, half: 1.2, lateral: 0, sky: true, rad: 0.7 });
    const miss = new Simulation(course, TUNING, { x: 0, speed: 8 });
    miss.state.mode = 'airborne';
    miss.state.x = pad.x;
    miss.state.y = pad.y + 0.85;
    miss.state.vx = 0;
    miss.state.vy = -1;
    miss.state.layer = 'sky';
    miss.step();
    expect(miss.state.bounced).toEqual([]);

    const hit = new Simulation(course, TUNING, { x: 0, speed: 8 });
    hit.state.mode = 'airborne';
    hit.state.x = pad.x;
    hit.state.y = pad.y + 0.75;
    hit.state.vx = 0;
    hit.state.vy = -20;
    hit.state.layer = 'sky';
    hit.step();
    expect(hit.state.bounced).toContain(pad.id);
    expect(hit.state.vy).toBeCloseTo(TUNING.tricks.balloonVy, 5);
  });
});

describe('sky gap', () => {
  it('the ideal rider clears the hole; a mistimed hop dies in it; a passive rider takes the street rail', () => {
    const ideal = ride({ minSpeed: 14, gap: true, maxSeconds: 40 });
    expect(ideal.sim.state.mode, ideal.sim.state.fail?.message).not.toBe('failed');
    expect(ofType(ideal.ev, 'sky-exit').at(-1)?.reason).toBe('complete');

    const passive = ride({ minSpeed: 14, sky: false, gap: true, maxSeconds: 40 });
    expect(passive.sim.state.mode, passive.sim.state.fail?.message).not.toBe('failed');
    expect(passive.sim.state.x).toBeGreaterThan(G + 62);

    const late = ride({ minSpeed: 14, skyMistime: 'drop-over-gap', gap: true, maxSeconds: 30 });
    expect(late.sim.state.mode).toBe('failed');
    expect(['fell-in-gap', 'missed-rail']).toContain(late.sim.state.fail?.kind);
  });
});

describe('sky score', () => {
  it('a sky balloon is one combo link worth 50, and clearing the segment banks Sky run! 500 once', () => {
    const course = flatCourse();
    const skyPad = course.addBounce({ kind: 'balloon', x: 8, y: 4, half: 1.2, lateral: 0, sky: true, rad: 0.7 });
    const street = course.addBounce({ kind: 'balloon', x: 12, y: 2, half: 0.7, lateral: 0 });
    const k = new ScoreKeeper();
    const st = new Simulation(course).state;
    k.update(dt, { ...st, x: 1 }, [], course);
    k.update(dt, { ...st, x: 2 }, [{ type: 'bounce', bounceId: skyPad.id, kind: 'balloon', x: 8, y: 4 }], course);
    expect(k.chain).toBe(1);
    expect(k.comboPoints).toBe(SCORE.skyBalloon);
    k.update(dt, { ...st, x: 3 }, [{ type: 'bounce', bounceId: street.id, kind: 'balloon', x: 12, y: 2 }], course);
    expect(k.chain).toBe(2);
    const second = Math.round(SCORE.bounce * SCORE.staleScale);
    expect(k.comboPoints).toBe(SCORE.skyBalloon + second);
    const before = k.banked;
    k.update(dt, { ...st, x: 4 }, [{ type: 'sky-exit', segmentId: 3, reason: 'complete', x: 4, y: 0 }], course);
    // The same update also banks the metre from x=3 to x=4.
    expect(k.banked - before).toBe(SCORE.skyRun + SCORE.perMetre);
    expect(k.drainPopups().some((p) => p.text === 'Sky run!' && p.pts === SCORE.skyRun)).toBe(true);
    const again = k.banked;
    k.update(dt, { ...st, x: 5 }, [{ type: 'sky-exit', segmentId: 3, reason: 'complete', x: 5, y: 0 }], course);
    expect(k.banked).toBeCloseTo(again + SCORE.perMetre, 5);
    k.update(dt, { ...st, x: 6 }, [{ type: 'sky-exit', segmentId: 4, reason: 'fell', x: 6, y: 0 }], course);
    expect(k.drainPopups().some((p) => p.text === 'Sky run!')).toBe(false);
  });
});

describe('endless fairness', () => {
  const seeds = [1, 7, 13, 21, 42];

  it('the ideal autopilot (sky on) clears seeds 1, 7, 13, 21 and 42 to 4200 m', () => {
    const fails: string[] = [];
    for (const seed of seeds) {
      const profile = { minSpeed: 14 };
      const r = rideEndless(seed, profile, 4200, { maxSeconds: 4200 / 7 });
      if (r.sim.state.mode === 'failed' || r.sim.state.x - r.course.startX < 4200) fails.push(describeFail(seed, profile, r));
    }
    expect(fails).toEqual([]);
  }, 180000);

  it('a passive sky rider also clears those seeds', () => {
    const fails: string[] = [];
    for (const seed of seeds) {
      const profile = { minSpeed: 14, sky: false as const };
      const r = rideEndless(seed, profile, 4200, { maxSeconds: 4200 / 7 });
      if (r.sim.state.mode === 'failed' || r.sim.state.x - r.course.startX < 4200) fails.push(describeFail(seed, profile, r));
    }
    expect(fails).toEqual([]);
  }, 180000);
});
