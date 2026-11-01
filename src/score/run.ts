import type { ScoreKeeper, ScoreSnapshot } from './score';

/**
 * Endless run flow, pure (no DOM, no storage): lives, the run ending, the personal best, and the
 * payload that carries a run across an update reload. game.ts wires it to the HUD and storage.
 */

/** Lives per run. */
export const MAX_LIVES = 3;

export interface RunSummary { score: number; best: { points: number; chain: number; mult: number }; distance: number; tricks: number; nearMisses: number; personalBest: number; newBest: boolean; seed: number }

export interface RunState {
  lives: number;
  /** The last life is gone: the summary is up and the run takes no more input. */
  over: boolean;
  /** Set when the run ends. */
  summary: RunSummary | null;
}

export function newRunState(): RunState { return { lives: MAX_LIVES, over: false, summary: null }; }

/**
 * An attempt ended badly: a fail (the sim's fail event already bailed the combo) or a manual retry
 * mid-run, which counts as a bail too. Costs a life; the last one ends the run (what is banked
 * stays banked). Returns true if the run is now over.
 */
export function loseLife(run: RunState, score: ScoreKeeper, how: 'fail' | 'manual-retry'): boolean {
  if (run.over) return true;
  if (how === 'manual-retry') score.bail();
  run.lives = Math.max(0, run.lives - 1);
  if (run.lives === 0) { run.over = true; score.bank(); }
  return run.over;
}

/**
 * Does a manual retry (R / icarus.retry()) cost a life? Only in endless with a live run that the
 * player is actually riding: not on the fail screen (that fail already cost one; retrying is the
 * normal flow), not in a replay, and not before the rider has moved off the checkpoint.
 * Course and lab retries are free.
 */
export function retryCostsLife(ctx: { mode: string; runOver: boolean; replay: boolean; simMode: string; moved: boolean }): boolean {
  return ctx.mode === 'endless' && !ctx.runOver && !ctx.replay && ctx.simMode !== 'failed' && ctx.simMode !== 'finished' && ctx.moved;
}

/** Personal best after a run (or an abandoned run) scoring `score`. */
export function updateBest(score: number, best: number): { best: number; isNew: boolean } {
  const s = Math.round(score);
  return s > best ? { best: s, isNew: true } : { best, isNew: false };
}

/** End the run: record its summary (the personal best is updated by the caller from `newBest`). */
export function endRun(run: RunState, score: ScoreKeeper, distance: number, personalBest: number, seed: number): RunSummary {
  run.over = true;
  const pb = updateBest(score.banked, personalBest);
  run.summary = { score: score.banked, best: { ...score.best }, distance, tricks: score.tricks, nearMisses: score.nearMisses, personalBest: pb.best, newBest: pb.isNew, seed };
  return run.summary;
}

// ------------------------------------------------------------------ update reload

export interface Checkpoint { x: number; speed: number; title: string }

/** What an update reload carries (sessionStorage). `run` is endless only. */
export interface ResumePayload {
  mode: string;
  seed: number;
  cpIndex: number;
  endlessCp: Checkpoint | null;
  at: number;
  run?: { lives: number; over: boolean; summary: RunSummary | null; score: ScoreSnapshot };
}

/** Resumes older than this are ignored (a fresh visit, not an update reload). */
export const RESUME_MAX_AGE = 30 * 60_000;

export function buildResume(o: { mode: string; seed: number; cpIndex: number; endlessCp: Checkpoint | null; now: number; run?: RunState; score?: ScoreKeeper }): ResumePayload {
  const p: ResumePayload = { mode: o.mode, seed: o.seed, cpIndex: o.cpIndex, endlessCp: o.endlessCp, at: o.now };
  if (o.mode === 'endless' && o.run && o.score) p.run = { lives: o.run.lives, over: o.run.over, summary: o.run.summary, score: o.score.serialize() };
  return p;
}

/** Parse a stored payload; null unless it is recent and for this mode (and seed, outside the opening). */
export function parseResume(raw: string | null, now: number, mode: string, seed: number): ResumePayload | null {
  let r: ResumePayload | null;
  try { r = raw ? JSON.parse(raw) : null; } catch { return null; }
  if (!r || typeof r !== 'object' || typeof r.at !== 'number' || now - r.at > RESUME_MAX_AGE || r.mode !== mode || (r.mode !== 'opening' && r.seed !== seed)) return null;
  return r;
}

/**
 * Put a resumed endless run back (after the course has been reset for a new run). A broken score
 * snapshot leaves a fresh run. Returns true if a run was restored.
 */
export function applyRunResume(p: ResumePayload['run'], run: RunState, score: ScoreKeeper): boolean {
  if (!p || typeof p.lives !== 'number' || !score.restore(p.score)) return false;
  run.lives = Math.max(0, Math.min(MAX_LIVES, Math.round(p.lives)));
  run.over = !!p.over || run.lives === 0;
  run.summary = run.over ? (p.summary ?? null) : null;
  return true;
}
