/**
 * Explicit movement states. One state at a time; no contradictory booleans.
 * 'grinding' and 'wallRiding' are reserved for milestone 2 — the transition
 * table in simulation.ts already routes through resolve*() hooks where they slot in.
 */
export type MoveMode = 'grounded' | 'airborne' | 'failed' | 'finished' | 'grinding' | 'wallRiding';

export type FailKind = 'fell-in-gap' | 'hit-ledge-face' | 'stalled';

export interface FailInfo {
  kind: FailKind;
  message: string;
  x: number;
  y: number;
  /** How far short of the receiving edge the rider was (m), when applicable. */
  shortBy?: number;
  gapX1?: number;
}

export interface RiderState {
  mode: MoveMode;
  tick: number;
  /** World position (x along route, y height). */
  x: number;
  y: number;
  /** World velocity, valid in every mode. */
  vx: number;
  vy: number;
  /** Speed along the surface while grounded (m/s). */
  speed: number;
  /** Ground contact (valid while grounded). */
  surfaceId: number;
  seg: number;
  /** Surface angle (rad) while grounded; last takeoff angle while airborne. */
  angle: number;
  airTime: number;
  groundTime: number;
  /** Remaining coyote window (s): > 0 only after rolling off a ledge. */
  coyote: number;
  /** Remaining jump buffer (s). */
  jumpBuffer: number;
  /** Current push stroke being extended (touch strokes grow). */
  pushStrokeId: number;
  pushApplied: number;
  /** Last takeoff point, for failure explanation. */
  takeoffX: number;
  takeoffY: number;
  takeoffSpeed: number;
  leftBy: 'jump' | 'edge' | 'none';
  fail: FailInfo | null;
}

export type SimEvent =
  | { type: 'push'; impulse: number; strength: number; fresh: boolean; x: number; y: number }
  | { type: 'jump'; kind: 'ground' | 'coyote' | 'buffered'; x: number; y: number; vx: number; vy: number }
  | { type: 'leave-edge'; x: number; y: number }
  | { type: 'land'; x: number; y: number; impact: number; speedBefore: number; speedAfter: number; material: string }
  | { type: 'fail'; info: FailInfo }
  | { type: 'finish'; x: number }
  | { type: 'resolve'; action: string; result: string }
  | { type: 'reject'; action: string; reason: string };
