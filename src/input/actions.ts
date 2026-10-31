/**
 * Shared gameplay intents. Touch gestures and keyboard both produce exactly these.
 * They are *intents*, not resolved moves: the simulation resolves meaning from
 * context (e.g. "up" = jump on the ground, coyote/buffered jump near the ground,
 * backflip in the air in milestone 2).
 */
export type InputSource = 'touch' | 'key' | 'replay' | 'test';

export type Action =
  /** Downward stroke. `fresh` = a new stroke began; later events for the same
   *  strokeId report a longer stroke (higher strength, 0..1). */
  | { type: 'down'; strokeId: number; strength: number; fresh: boolean; source: InputSource }
  /** Upward stroke (fires once per stroke). */
  | { type: 'up'; strokeId: number; source: InputSource }
  /** Sideways stroke-and-hold; held=false is the release. */
  | { type: 'side'; side: 'left' | 'right'; held: boolean; strokeId: number; source: InputSource }
  /** A down stroke (or Down key) was released. Needed for held actions (heel skim, M2). */
  | { type: 'release'; dir: 'down' | 'up'; strokeId: number; source: InputSource }
  /** A tap with no stroke. Used for retry; no movement meaning. */
  | { type: 'tap'; source: InputSource };

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'down': return `down#${a.strokeId} ${a.fresh ? 'fresh' : 'extend'} s=${a.strength.toFixed(2)}`;
    case 'up': return `up#${a.strokeId}`;
    case 'side': return `${a.side} ${a.held ? 'hold' : 'release'}#${a.strokeId}`;
    case 'release': return `release ${a.dir}#${a.strokeId}`;
    case 'tap': return 'tap';
  }
}
