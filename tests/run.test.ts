import { describe, it, expect } from 'vitest';
import { ScoreKeeper, SCORE } from '../src/score/score';
import { MAX_LIVES, newRunState, loseLife, retryCostsLife, updateBest, endRun, buildResume, parseResume, applyRunResume, RESUME_MAX_AGE } from '../src/score/run';
import { EndlessCourse } from '../src/course/endless';
import { Simulation } from '../src/sim/simulation';
import { TUNING } from '../src/tuning';
import type { RiderState, SimEvent } from '../src/sim/types';

const course = new EndlessCourse(1);
const dt = TUNING.sim.dt;
const st = (o: Partial<RiderState>): RiderState => ({ ...new Simulation(course).state, ...o });
const fail = (x: number): SimEvent => ({ type: 'fail', info: { kind: 'fell-in-gap', message: '', x, y: 0 } });

/** A run with some banked score, a combo in progress and a furthest point. */
function midRun(): ScoreKeeper {
  const k = new ScoreKeeper();
  k.update(dt, st({ x: 0 }), [], course);
  k.update(dt, st({ x: 200, mode: 'airborne' }), [{ type: 'flip-complete', x: 200, y: 0 }], course);
  for (let i = 0; i < SCORE.idle / dt + 2; i++) k.update(dt, st({ x: 200 + i * 0.01, mode: 'grounded' }), [], course);
  k.update(dt, st({ x: 300, mode: 'airborne' }), [{ type: 'flip-complete', x: 300, y: 0 }, { type: 'flip-complete', x: 300, y: 0 }], course);
  return k;
}

describe('endless run flow', () => {
  it('a fail costs a life; the last one ends the run with what was banked', () => {
    const run = newRunState(), k = midRun();
    expect(run.lives).toBe(MAX_LIVES);
    for (let i = 1; i < MAX_LIVES; i++) {
      k.update(dt, st({ x: 300, mode: 'failed' }), [fail(300)], course); // the sim's fail bails the combo
      expect(loseLife(run, k, 'fail')).toBe(false);
      expect(run.lives).toBe(MAX_LIVES - i);
    }
    const banked = k.banked;
    expect(loseLife(run, k, 'fail')).toBe(true);
    expect(run.over).toBe(true);
    expect(run.lives).toBe(0);
    expect(k.banked).toBe(banked);
    expect(loseLife(run, k, 'fail')).toBe(true); // a dead run stays dead
    expect(run.lives).toBe(0);
  });

  it('a manual retry mid-run in endless is a bail and costs a life (last life: run over); free elsewhere', () => {
    const live = { mode: 'endless', runOver: false, replay: false, simMode: 'grounded', moved: true };
    expect(retryCostsLife(live)).toBe(true);
    expect(retryCostsLife({ ...live, simMode: 'airborne' })).toBe(true);
    expect(retryCostsLife({ ...live, mode: 'opening' })).toBe(false);
    expect(retryCostsLife({ ...live, mode: 'lab' })).toBe(false);
    expect(retryCostsLife({ ...live, simMode: 'failed' })).toBe(false); // the fail screen: that fail already cost a life
    expect(retryCostsLife({ ...live, runOver: true })).toBe(false);
    expect(retryCostsLife({ ...live, replay: true })).toBe(false);
    expect(retryCostsLife({ ...live, moved: false })).toBe(false); // still on the checkpoint: nothing to undo
    const run = newRunState(), k = midRun();
    const banked = k.banked;
    expect(k.chain).toBe(2);
    expect(loseLife(run, k, 'manual-retry')).toBe(false);
    expect([run.lives, k.chain, k.comboPoints, k.banked]).toEqual([MAX_LIVES - 1, 0, 0, banked]); // combo lost
    run.lives = 1;
    expect(loseLife(run, k, 'manual-retry')).toBe(true);
    expect(run.over).toBe(true);
  });

  it('the summary counts banked tricks only, and the personal best only moves up', () => {
    const run = newRunState(), k = midRun();
    k.update(dt, st({ x: 300, mode: 'failed' }), [fail(300)], course);
    const s = endRun(run, k, 300, 99, 5);
    expect(s.tricks).toBe(1); // the bailed double flip is not counted
    expect(s.score).toBe(k.banked);
    expect(s.newBest).toBe(true);
    expect(s.personalBest).toBe(Math.round(k.banked));
    expect(updateBest(10, 50)).toEqual({ best: 50, isNew: false });
    expect(updateBest(80.4, 50)).toEqual({ best: 80, isNew: true });
    expect(endRun(newRunState(), k, 300, 1e9, 5).newBest).toBe(false);
  });

  it('an update reload carries the whole endless run (score, combo, lives, furthest point), not just the checkpoint', () => {
    const run = newRunState(), k = midRun();
    loseLife(run, k, 'fail');
    const cp = { x: 250, speed: 13, title: 'Pot' };
    const raw = JSON.stringify(buildResume({ mode: 'endless', seed: 42, cpIndex: 0, endlessCp: cp, now: 1000, run, score: k }));
    // the reload: a fresh game resets the run, then applies the payload
    const p = parseResume(raw, 2000, 'endless', 42)!;
    expect(p.endlessCp).toEqual(cp);
    const run2 = newRunState(), k2 = new ScoreKeeper();
    expect(applyRunResume(p.run, run2, k2)).toBe(true);
    expect(run2).toEqual(run);
    expect([k2.total, k2.banked, k2.chain, k2.tricks, k2.furthestX]).toEqual([k.total, k.banked, k.chain, k.tricks, k.furthestX]);
    expect(k2.best).toEqual(k.best);
    // riding again from the checkpoint pays no distance until past the furthest point
    k2.update(dt, st({ x: 250 }), [], course);
    k2.update(dt, st({ x: k.furthestX }), [], course);
    expect(k2.banked).toBe(k.banked);
    // other modes, seeds or stale payloads are ignored
    expect(parseResume(raw, 2000, 'endless', 43)).toBeNull();
    expect(parseResume(raw, 2000, 'lab', 42)).toBeNull();
    expect(parseResume(raw, 1000 + RESUME_MAX_AGE + 1, 'endless', 42)).toBeNull();
    expect(parseResume('{nope', 2000, 'endless', 42)).toBeNull();
    // an old payload (checkpoint only) still resumes the checkpoint, with a fresh run
    const old = parseResume(JSON.stringify({ mode: 'endless', seed: 42, cpIndex: 0, endlessCp: cp, at: 1000 }), 2000, 'endless', 42)!;
    expect(old.endlessCp).toEqual(cp);
    expect(applyRunResume(old.run, newRunState(), new ScoreKeeper())).toBe(false);
  });

  it('a reload after the last life resumes to the summary, never to a live run', () => {
    const run = newRunState(), k = midRun();
    k.update(dt, st({ x: 300, mode: 'failed' }), [fail(300)], course);
    run.lives = 1;
    loseLife(run, k, 'fail');
    const s = endRun(run, k, 300, 0, 42);
    const p = parseResume(JSON.stringify(buildResume({ mode: 'endless', seed: 42, cpIndex: 0, endlessCp: null, now: 0, run, score: k })), 1, 'endless', 42)!;
    const run2 = newRunState(), k2 = new ScoreKeeper();
    expect(applyRunResume(p.run, run2, k2)).toBe(true);
    expect(run2.over).toBe(true);
    expect(run2.lives).toBe(0);
    expect(run2.summary).toEqual(s);
    expect(retryCostsLife({ mode: 'endless', runOver: run2.over, replay: false, simMode: 'grounded', moved: true })).toBe(false);
    // lives 0 without the flag (a hand-edited payload) is still a finished run
    const p0 = JSON.parse(JSON.stringify(p.run));
    p0.over = false;
    const run3 = newRunState();
    applyRunResume(p0, run3, new ScoreKeeper());
    expect(run3.over).toBe(true);
  });
});
