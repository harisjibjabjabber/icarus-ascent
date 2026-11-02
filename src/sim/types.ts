/**
 * Explicit movement states. Exactly one at a time; no contradictory booleans.
 *  grounded   – rolling on a ground chain
 *  heelSkim   – grounded on the tail (manual), slowing progressively while held
 *  airborne   – ballistic; may carry an `air` trick (flip / grab) and a landing prep
 *  grinding   – locked to a rail
 *  wallRiding – riding a right-hand wall
 *  swinging   – hooked on a rope
 *  flying     – short steered flight after an updraft
 *  failed / finished – run over
 */
export type MoveMode = 'grounded' | 'heelSkim' | 'airborne' | 'grinding' | 'wallRiding' | 'swinging' | 'flying' | 'failed' | 'finished';

/** Airborne trick sub-state (only meaningful while airborne). */
export type AirTrick = 'none' | 'flip' | 'grabLeft' | 'grabRight';

export type FailKind =
  | 'fell-in-gap' | 'hit-ledge-face' | 'unfinished-flip' | 'landed-grabbing'
  | 'missed-rail' | 'missed-wall' | 'fell-off-wall' | 'stalled' | 'hit-pot' | 'hit-pillar';

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
  /** Speed along the current contact (ground, rail, wall) (m/s). */
  speed: number;
  /** Ground contact (valid while grounded / heelSkim). */
  surfaceId: number;
  seg: number;
  /** Contact angle (rad): surface/rail slope; last takeoff angle while airborne. */
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
  /** Stroke that started the current jump: the same stroke can never also flip. */
  jumpStrokeId: number;

  // --- airborne tricks ---
  air: AirTrick;
  /** Flip progress 0..1 (1 = full rotation). */
  flip: number;
  flipsThisJump: number;
  /** A second rotation is waiting for the current one to finish, and only starts if it can land. */
  flipQueued: boolean;
  /** Stroke holding the current grab / wall ride. */
  sideStrokeId: number;
  /** Landing preparation: held (stroke id or -1) and armed-until timer (s). */
  prepStrokeId: number;
  prepTimer: number;
  /** True while the stroke that armed the prep is still held. */
  prepHeld: boolean;
  /** Seconds since the prep stroke fired, and its (growing) stroke strength: a stroke begun just
   *  before touchdown is a late push. */
  prepAge: number;
  prepStrength: number;
  /** Heel skim that may still turn into the late push it started as (released quickly). */
  skimPendingPush: boolean;

  // --- contacts ---
  railId: number;
  wallId: number;
  swingId: number;
  /** Pendulum angle (rad, 0 = hanging straight down, + = ahead of the anchor) and angular rate. */
  swingPhi: number;
  swingOmega: number;
  /** Updraft the rider is in, and the y where that column was entered (NaN if none). */
  updraftId: number;
  gustY: number;
  /** Flying corridor ends at this x. */
  flightX1: number;
  flightTime: number;
  /** Bounce pads already used this flight (one trigger each). */
  bounced: number[];
  /** Pad the rider last bounced on (-1 after a landing). Presentation and scoring. */
  bounceId: number;
  /** Vertical speed at the start of this flight. A washing line needs more than a flat jump. */
  launchVy: number;
  /** Time in the current contact mode (grind / wall / skim) (s). */
  contactTime: number;
  /** Speed when the last wall ride began (for failure explanation). */
  wallEntrySpeed: number;
  /** What the rider last touched before the current flight. */
  lastContact: 'ground' | 'rail' | 'wall' | 'none';
  lastContactId: number;
  /** True if a catch was armed at any point during the current flight. */
  prepTriedThisAir: boolean;
  sideTriedThisAir: boolean;
  /** How the last wall ride ended (failure explanations). */
  wallExit: 'none' | 'end' | 'release' | 'slid-off' | 'too-slow' | 'jump';
  /** This flight reached a rail's catch band with the catch armed, but mid-flip. */
  railBlockedByFlip: boolean;

  // --- obstacles ---
  /** Ids of obstacles broken this run. */
  broken: number[];
  /** Airborne trick that can power a pillar break: earned in the air, spent on a break. */
  trickCredit: 'none' | 'flip' | 'grab';
  /** A grab was started at some point during the current airborne phase. */
  grabbedThisAir: boolean;
  /** Ground distance travelled since landing with a credit (m). */
  creditGround: number;

  /** Last takeoff point, for failure explanation. */
  takeoffX: number;
  takeoffY: number;
  takeoffSpeed: number;
  leftBy: 'jump' | 'edge' | 'crest' | 'rail' | 'wall' | 'swing' | 'bounce' | 'flight' | 'none';
  fail: FailInfo | null;
}

export type SimEvent =
  | { type: 'push'; impulse: number; strength: number; fresh: boolean; x: number; y: number }
  | { type: 'jump'; kind: 'ground' | 'coyote' | 'buffered' | 'rail' | 'wall' | 'skim'; x: number; y: number; vx: number; vy: number }
  | { type: 'leave-edge'; x: number; y: number; crest: boolean }
  | { type: 'land'; x: number; y: number; impact: number; speedBefore: number; speedAfter: number; material: string; flipped: boolean }
  | { type: 'flip-start'; x: number; y: number }
  | { type: 'flip-complete'; x: number; y: number; rotation?: number }
  | { type: 'grab-start'; side: 'left' | 'right' }
  | { type: 'grab-end'; side: 'left' | 'right'; held: number }
  | { type: 'prep'; armed: boolean }
  | { type: 'grind-start'; railId: number; x: number; y: number; speed: number }
  | { type: 'grind-end'; railId: number; x: number; y: number; reason: 'end' | 'jump' }
  | { type: 'wall-start'; wallId: number; x: number; y: number; speed: number }
  | { type: 'wall-end'; wallId: number; x: number; y: number; reason: 'end' | 'release' | 'slid-off' | 'too-slow' | 'jump' }
  | { type: 'swing-start'; swingId: number; x: number; y: number }
  | { type: 'swing-end'; swingId: number; x: number; y: number; reason: 'release' | 'up' | 'street' | 'timeout' }
  | { type: 'flight-start'; updraftId: number; x: number; y: number }
  | { type: 'flight-end'; x: number; y: number }
  | { type: 'bounce'; bounceId: number; kind: 'boat' | 'balloon' | 'awning'; x: number; y: number }
  | { type: 'skim-start'; x: number; y: number }
  | { type: 'skim-end'; x: number; y: number; reason: 'release' | 'push' | 'jump' | 'edge' | 'stopped' }
  | { type: 'break'; obstacleId: number; kind: 'pot' | 'pillar'; by: 'heel' | 'flip' | 'grab'; x: number; y: number; vx: number; vy: number; speed: number }
  | { type: 'credit'; credit: 'flip' | 'grab' }
  | { type: 'fail'; info: FailInfo }
  | { type: 'finish'; x: number }
  | { type: 'resolve'; action: string; result: string }
  | { type: 'reject'; action: string; reason: string };
