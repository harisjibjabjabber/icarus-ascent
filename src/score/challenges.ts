import type { RiderState, SimEvent } from '../sim/types';
import { mulberry32 } from '../rng';

/**
 * One short goal at a time, for the run in progress. Pure and deterministic (seed in, events in).
 * Missing one never fails the run: it just swaps for another after a quiet stretch with no progress.
 * No new gestures — every goal is something the existing vocabulary already does.
 */

export type ChallengeId = 'flip' | 'grind' | 'grab' | 'pots' | 'mix' | 'near' | 'pillar' | 'wall';

export interface ChallengeDef {
  id: ChallengeId;
  /** Calm HUD line. */
  text: string;
  goal: number;
  /** Banked at once when the goal is met (not lost on a later bail). */
  pts: number;
  /** Earliest run distance (m) this may be offered. */
  minDist: number;
}

export const CHALLENGE_POOL: ChallengeDef[] = [
  { id: 'flip', text: 'Land a backflip', goal: 1, pts: 700, minDist: 0 },
  { id: 'grind', text: 'Catch a rail', goal: 1, pts: 700, minDist: 0 },
  { id: 'pots', text: 'Smash 2 pots', goal: 2, pts: 800, minDist: 0 },
  { id: 'grab', text: 'Hold a grab', goal: 1, pts: 600, minDist: 0 },
  { id: 'near', text: 'Make a close call', goal: 1, pts: 700, minDist: 200 },
  { id: 'mix', text: 'Mix 3 tricks', goal: 3, pts: 1100, minDist: 400 },
  { id: 'pillar', text: 'Smash a pillar', goal: 1, pts: 900, minDist: 700 },
  { id: 'wall', text: 'Ride a wall', goal: 1, pts: 900, minDist: 900 },
];

const BY_ID = Object.fromEntries(CHALLENGE_POOL.map((c) => [c.id, c])) as Record<ChallengeId, ChallengeDef>;
const IDS = new Set<string>(CHALLENGE_POOL.map((c) => c.id));

/** Metres with no progress before the goal quietly swaps. Long enough to meet a crest or a rail. */
export const CHALLENGE_STALL = 520;

export interface ChallengeSnapshot {
  v: 1;
  order: ChallengeId[];
  cursor: number;
  progress: number;
  done: number;
  startedAt: number;
  nearSeen: number;
}

export interface ChallengeView { id: ChallengeId; text: string; progress: number; goal: number }

function isId(v: unknown): v is ChallengeId { return typeof v === 'string' && IDS.has(v); }

/** Stable shuffle so a seed always offers the same sequence. */
export function challengeOrder(seed: number): ChallengeId[] {
  const ids = CHALLENGE_POOL.map((c) => c.id);
  const r = mulberry32((seed ^ 0x51edc0de) >>> 0);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  }
  return ids;
}

export class Challenges {
  private order: ChallengeId[];
  private cursor = 0;
  private active: ChallengeDef;
  private progress = 0;
  private startedAt = 0;
  private nearSeen = 0;
  /** Goals met this run. */
  done = 0;

  constructor(seed: number) {
    this.order = challengeOrder(seed);
    this.active = this.order.map((id) => BY_ID[id])[0];
    this.pick(0);
  }

  get current(): ChallengeView {
    return { id: this.active.id, text: this.active.text, progress: Math.min(this.progress, this.active.goal), goal: this.active.goal };
  }

  /**
   * One tick. `distance` is how far this run has reached. Returns the goal just completed, once.
   * A fail on this tick completes nothing (the life is already gone).
   */
  update(st: RiderState, events: SimEvent[], ctx: { nearMisses: number; comboTrickKinds: number; distance: number }): { text: string; pts: number } | null {
    if (events.some((e) => e.type === 'fail') || st.mode === 'failed') {
      this.nearSeen = ctx.nearMisses;
      return null;
    }
    const id = this.active.id;
    if (id === 'flip') { if (events.some((e) => e.type === 'land' && e.flipped)) this.progress++; }
    else if (id === 'grind') { if (events.some((e) => e.type === 'grind-start')) this.progress++; }
    else if (id === 'grab') { if (events.some((e) => e.type === 'grab-end' && e.held >= 0.2)) this.progress++; }
    else if (id === 'pots') this.progress += events.filter((e) => e.type === 'break' && e.kind === 'pot').length;
    else if (id === 'pillar') { if (events.some((e) => e.type === 'break' && e.kind === 'pillar')) this.progress++; }
    else if (id === 'wall') { if (events.some((e) => e.type === 'wall-start')) this.progress++; }
    else if (id === 'near') { if (ctx.nearMisses > this.nearSeen) this.progress += ctx.nearMisses - this.nearSeen; }
    else this.progress = ctx.comboTrickKinds; // mix: kinds inside the current combo, so it resets if the combo banks
    this.nearSeen = ctx.nearMisses;
    if (this.progress >= this.active.goal) {
      const done = { text: this.active.text, pts: this.active.pts };
      this.done++;
      this.cursor = (this.cursor + 1) % this.order.length;
      this.pick(ctx.distance);
      return done;
    }
    if (this.progress <= 0 && ctx.distance - this.startedAt >= CHALLENGE_STALL) {
      this.cursor = (this.cursor + 1) % this.order.length;
      this.pick(ctx.distance);
    }
    return null;
  }

  /** Next goal whose distance gate is open, starting at the cursor. */
  private pick(distance: number): void {
    for (let n = 0; n < this.order.length; n++) {
      const i = (this.cursor + n) % this.order.length;
      const def = BY_ID[this.order[i]];
      if (def.minDist <= distance) {
        this.cursor = i;
        this.active = def;
        this.progress = 0;
        this.startedAt = distance;
        return;
      }
    }
    this.active = BY_ID[this.order[this.cursor]];
    this.progress = 0;
    this.startedAt = distance;
  }

  serialize(): ChallengeSnapshot {
    return { v: 1, order: [...this.order], cursor: this.cursor, progress: this.progress, done: this.done, startedAt: this.startedAt, nearSeen: this.nearSeen };
  }

  /** Restore after a reload. False leaves this instance unchanged. */
  restore(s: unknown): boolean {
    const q = s as Partial<ChallengeSnapshot> | null;
    if (!q || q.v !== 1 || !Array.isArray(q.order) || typeof q.cursor !== 'number') return false;
    const order = q.order.filter(isId);
    if (order.length !== CHALLENGE_POOL.length || new Set(order).size !== order.length) return false;
    this.order = order;
    this.cursor = ((q.cursor % order.length) + order.length) % order.length;
    this.active = BY_ID[this.order[this.cursor]];
    this.progress = typeof q.progress === 'number' && q.progress >= 0 ? q.progress : 0;
    this.done = typeof q.done === 'number' && q.done >= 0 ? q.done : 0;
    this.startedAt = typeof q.startedAt === 'number' ? q.startedAt : 0;
    this.nearSeen = typeof q.nearSeen === 'number' ? q.nearSeen : 0;
    return true;
  }
}
