import { TUNING, type Tuning } from '../tuning';
import type { Action } from './actions';
import { nextStrokeId, type GestureEvent } from './gesture';

/** Converts recogniser events into shared gameplay actions. */
export function gestureToActions(e: GestureEvent): Action[] {
  switch (e.kind) {
    case 'fire':
      if (e.dir === 'down') return [{ type: 'down', strokeId: e.strokeId, strength: e.strength, fresh: true, source: 'touch' }];
      if (e.dir === 'up') return [{ type: 'up', strokeId: e.strokeId, source: 'touch' }];
      return [{ type: 'side', side: e.dir, held: true, strokeId: e.strokeId, source: 'touch' }];
    case 'extend':
      return [{ type: 'down', strokeId: e.strokeId, strength: e.strength, fresh: false, source: 'touch' }];
    case 'end':
      if (!e.fired) return [];
      if (e.dir === 'left' || e.dir === 'right') return [{ type: 'side', side: e.dir, held: false, strokeId: e.strokeId, source: 'touch' }];
      return [{ type: 'release', dir: e.dir, strokeId: e.strokeId, source: 'touch' }];
    case 'tap':
      return [{ type: 'tap', source: 'touch' }];
    case 'reject':
      return [];
  }
}

/**
 * Keyboard -> actions. Fresh presses only: auto-repeat never produces pushes,
 * so OS key-repeat settings can't change the game's balance.
 */
export class KeyboardMapper {
  private held = new Map<string, number>(); // code -> strokeId
  constructor(private T: Tuning = TUNING) {}

  keyDown(code: string, repeat: boolean): Action[] {
    const kind = keyKind(code);
    if (!kind) return [];
    if (repeat || this.held.has(code)) return [];
    const strokeId = nextStrokeId();
    this.held.set(code, strokeId);
    switch (kind) {
      case 'down': return [{ type: 'down', strokeId, strength: this.T.movement.keyboardPushStrength, fresh: true, source: 'key' }];
      case 'up': return [{ type: 'up', strokeId, source: 'key' }];
      case 'left': case 'right': return [{ type: 'side', side: kind, held: true, strokeId, source: 'key' }];
    }
  }

  keyUp(code: string): Action[] {
    const kind = keyKind(code);
    const strokeId = this.held.get(code);
    if (!kind || strokeId === undefined) return [];
    this.held.delete(code);
    if (kind === 'left' || kind === 'right') return [{ type: 'side', side: kind, held: false, strokeId, source: 'key' }];
    return [{ type: 'release', dir: kind, strokeId, source: 'key' }];
  }

  /** Window blur: release everything so a held key can't stick. */
  releaseAll(): Action[] {
    const out: Action[] = [];
    for (const code of [...this.held.keys()]) out.push(...this.keyUp(code));
    return out;
  }
}

function keyKind(code: string): 'up' | 'down' | 'left' | 'right' | null {
  switch (code) {
    case 'ArrowUp': case 'KeyW': case 'Space': return 'up';
    case 'ArrowDown': case 'KeyS': return 'down';
    case 'ArrowLeft': case 'KeyA': return 'left';
    case 'ArrowRight': case 'KeyD': return 'right';
    default: return null;
  }
}
