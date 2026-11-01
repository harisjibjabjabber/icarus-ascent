import { Course, type Chunk, type Feature, type Gap, type Obstacle, type Rail, type Surface, type Vec2, type Wall } from './course';
import { extend, kicker, smooth, easeOut, linear, crestPop, rollingHills, type Ease } from './shapes';
import { TUNING } from '../tuning';
import { mulberry32 } from '../rng';
import { SET_PIECES, type SetPieceSpec } from './setpieces';
import { waveAt, type WaveInfo } from './waves';
import { ZoneSequence } from '../zones/sequence';
import type { Zone } from '../zones/zone';

/**
 * Endless assembly (brief §10, §12 "Fourth").
 *
 * The course is a seeded, deterministic sequence of authored *phrases*: each one is a
 * purposeful movement sequence (descent -> crest pop -> landing, pot -> pillar,
 * compression -> wall ride -> receiving climb, ...), not a scattering of objects.
 * Every phrase declares the entry speed it is built for, its likely exit speed, the
 * airtime it offers, what receives the rider, and a difficulty tier. The assembler
 * picks phrases with a seeded RNG under a difficulty curve, validates each neighbour
 * pair and inserts connectors (speed boost, speed bleed, recovery, climb) where a pair
 * would not work on its own.
 *
 * Contract between phrases: every phrase starts and ends on flat ground (slope 0), so
 * consecutive phrases join seamlessly (no gap, no crest at the seam). Compulsory
 * features sit at the end of long flat run-ins (readable before commitment) and are
 * followed by broad receivers and a recovery stretch.
 *
 * Streaming: phrases are generated a fixed distance ahead of the rider and recycled
 * once safely behind with no active contact. Phrase i is built from its own RNG
 * (seed, i), so content never depends on when it was generated.
 */

export type Receiving = 'flat' | 'downslope' | 'climb' | 'broad';
export type Tier = 0 | 1 | 2 | 3;

export interface PhraseSpec {
  id: string;
  title: string;
  /** 0 = start/connector, 1..3 = difficulty tier. */
  tier: Tier;
  /** Style air: hills/kickers to flip or grab off with no gap and nothing compulsory. */
  style: boolean;
  /** Contains a compulsory action (gap, required rail/wall, pot, pillar). */
  required: boolean;
  /** Speeds (m/s) at the phrase start it is built for. */
  entry: [number, number];
  /** Likely speed at the phrase end (measured with the dev autopilot across seeds). */
  exit: [number, number];
  /** Typical airtime offered (s) at a normal riding speed. */
  airtime: number;
  /** What receives the rider after the phrase's main action. */
  receiving: Receiving;
  /** Checkpoint speed for a retry from this phrase. */
  cpSpeed: number;
  build(b: PhraseBuilder, d: number, r: () => number): void;
}

/** Collects one phrase's geometry relative to its start point. */
export class PhraseBuilder {
  pts: Vec2[];
  material: Surface['material'];
  readonly chains: { points: Vec2[]; material: Surface['material'] }[] = [];
  readonly rails: Omit<Rail, 'id'>[] = [];
  readonly walls: Omit<Wall, 'id'>[] = [];
  readonly obstacles: { kind: Obstacle['kind']; x: number }[] = [];
  readonly requires: [number, Gap['requires']][] = [];
  readonly features: Feature[] = [];
  /** Where the run-in for the next compulsory feature begins. */
  approachX: number;

  constructor(readonly x0: number, readonly y0: number, material: Surface['material']) {
    this.pts = [{ x: x0, y: y0 }];
    this.material = material;
    this.approachX = x0;
  }
  cur(): Vec2 { return this.pts[this.pts.length - 1]; }
  flat(len: number): this { extend(this.pts, this.cur().x + len, this.cur().y, linear, 4); return this; }
  slope(len: number, dy: number, ease: Ease = smooth): this { extend(this.pts, this.cur().x + len, this.cur().y + dy, ease, 1.5); return this; }
  kicker(len: number, rise: number): this { extend(this.pts, this.cur().x + len, this.cur().y + rise, kicker, 0.8); return this; }
  /** Crest pop on continuous ground (style air, no gap). */
  crest(rise: number, len: number, drop: number, backLen: number): this {
    const top = this.cur().x + len;
    crestPop(this.pts, rise, len, drop, backLen);
    this.features.push({ x: top, kind: 'crest', required: false });
    return this;
  }
  /** Rolling hills: a pop chain for fast riders (style air), calm for slow ones. */
  rollers(count: number, amp: number, period: number): this {
    const a = this.cur().x;
    rollingHills(this.pts, count, amp, period);
    for (let k = 0; k < count; k++) this.features.push({ x: a + period * (k + 0.5), kind: 'rollers', required: false });
    return this;
  }
  /** End the current chain and start the next after a gap. Returns the takeoff lip. */
  gap(len: number, dy: number, requires: Gap['requires'] = 'jump', next: Surface['material'] = this.material === 'stone' ? 'cloud' : 'stone'): Vec2 {
    const lip = this.cur();
    this.chains.push({ points: this.pts, material: this.material });
    this.pts = [{ x: lip.x + len, y: lip.y + dy }];
    this.material = next;
    this.requires.push([lip.x, requires]);
    this.features.push({ x: lip.x, kind: requires === 'jump' ? 'gap' : requires, required: true, approachX: this.approachX });
    if (requires !== 'jump') this.features.push({ x: lip.x + len, kind: requires, required: false });
    this.approachX = lip.x + len;
    return lip;
  }
  rail(x: number, len: number, y0: number, y1: number, lateral: number, required: boolean, mid?: number): void {
    const points = mid === undefined ? [{ x, y: y0 }, { x: x + len, y: y1 }] : [{ x, y: y0 }, { x: x + len * 0.4, y: mid }, { x: x + len, y: y1 }];
    this.rails.push({ points, lateral, required });
    if (!required) this.features.push({ x, kind: 'rail-optional', required: false });
  }
  /** Optional handrail (right of the route) following the ground just built from x0 to x1: something to grind on descents. */
  handrail(x0: number, x1: number, h = 0.95): this {
    const yAt = (x: number) => {
      for (let i = 1; i < this.pts.length; i++) if (this.pts[i].x >= x) { const a = this.pts[i - 1], b = this.pts[i]; return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-6, b.x - a.x); }
      return this.cur().y;
    };
    const n = Math.max(2, Math.ceil((x1 - x0) / 3) + 1);
    this.rails.push({ points: Array.from({ length: n }, (_, i) => { const x = x0 + ((x1 - x0) * i) / (n - 1); return { x, y: yAt(x) + h }; }), lateral: 1.2, required: false });
    this.features.push({ x: x0, kind: 'rail-optional', required: false });
    return this;
  }
  /** Descent with an optional handrail along most of it. */
  railSlope(len: number, dy: number): this { const a = this.cur().x; this.slope(len, dy); return this.handrail(a + 3, a + len - 4); }
  wall(w: Omit<Wall, 'id'>): void { this.walls.push(w); }
  /** `cluster`: a second pot right behind the first, cleared or skimmed together with it. */
  pot(x: number, cluster = false): void {
    this.obstacles.push({ kind: 'pot', x });
    this.features.push(cluster ? { x, kind: 'pot', required: true } : { x, kind: 'pot', required: true, approachX: this.approachX });
    this.approachX = x + 2;
  }
  pillar(x: number): void {
    this.obstacles.push({ kind: 'pillar', x });
    this.features.push({ x, kind: 'pillar', required: true, approachX: this.approachX });
    this.approachX = x + 2;
  }
  /** Mark that the next compulsory feature's run-in starts here. */
  runIn(): this { this.approachX = this.cur().x; return this; }
  finish(): void { this.chains.push({ points: this.pts, material: this.material }); }
}

const HC = TUNING.movement.hardCap;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Phrase library. Entry/exit speeds are checked by tests/endless*.test.ts. */
export const PHRASES: PhraseSpec[] = [
  // ------------------------------------------------------------------ connectors
  {
    id: 'start', title: 'Run-in', tier: 0, style: true, required: false, entry: [0, 4], exit: [13, 22], airtime: 0.5, receiving: 'downslope', cpSpeed: 0,
    build: (b) => { b.flat(64).slope(36, -7).flat(8).crest(1.4, 8, 1.4, 14).flat(14); },
  },
  {
    id: 'boost', title: 'Boost descent', tier: 0, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.2, receiving: 'flat', cpSpeed: 10,
    build: (b) => { b.flat(4).railSlope(40, -9).flat(4).rollers(2, 0.9, 20).flat(8); },
  },
  {
    id: 'bleed', title: 'Easy climb', tier: 0, style: false, required: false, entry: [8, HC], exit: [8, 22], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).slope(36, 4).flat(4).rollers(2, 0.6, 22).flat(8); },
  },
  {
    id: 'recovery', title: 'Recovery', tier: 0, style: false, required: false, entry: [6, HC], exit: [8, HC], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(10).rollers(2, 0.7, 22).flat(10); },
  },
  {
    // zone gate: a calm, readable run between zones (rendered as an arch + fog wall; see src/zones/scenery.ts)
    id: 'gate', title: 'Zone gate', tier: 0, style: true, required: false, entry: [6, HC], exit: [8, HC], airtime: 0.3, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(24).rollers(2, 0.7, 22).flat(24); },
  },
  {
    id: 'climb', title: 'Climb', tier: 0, style: false, required: false, entry: [8, HC], exit: [8, 22], airtime: 0, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).rollers(1, 0.8, 20).slope(40, 6).rollers(2, 0.8, 20).slope(30, 5).rollers(1, 0.8, 20).flat(6); },
  },
  // ------------------------------------------------------------------ style air (no gaps)
  {
    id: 'crest-pop', title: 'Descent → crest pop', tier: 1, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.8, receiving: 'downslope', cpSpeed: 11,
    build: (b, d) => { b.flat(4).railSlope(40, -(9 + 3 * d)).flat(6).crest(2.0 + 0.6 * d, 10, 2.2, 18).flat(14); },
  },
  {
    id: 'rollers', title: 'Rolling hills', tier: 1, style: true, required: false, entry: [6, HC], exit: [11, HC], airtime: 0.4, receiving: 'downslope', cpSpeed: 14,
    build: (b) => { b.flat(4).railSlope(24, -4).flat(4).rollers(3, 1.3, 20).flat(12); },
  },
  {
    id: 'valley-launch', title: 'Valley launch', tier: 1, style: true, required: false, entry: [6, HC], exit: [16, HC], airtime: 0.9, receiving: 'downslope', cpSpeed: 11,
    build: (b, d) => { b.flat(4).railSlope(36, -(10 + 2 * d)).flat(4).crest(3.2, 18, 4.5, 24).flat(12); },
  },
  {
    id: 'pop-chain', title: 'Rolling hills pop chain', tier: 2, style: true, required: false, entry: [6, HC], exit: [14, HC], airtime: 0.6, receiving: 'downslope', cpSpeed: 12,
    build: (b, d) => { b.flat(4).railSlope(34, -(8 + 2 * d)).flat(4).rollers(4, 1.6, 18).flat(12); },
  },
  {
    id: 'big-kicker', title: 'Big kicker', tier: 2, style: true, required: false, entry: [6, HC], exit: [15, HC], airtime: 1.2, receiving: 'downslope', cpSpeed: 11,
    build: (b, d) => { b.flat(4).railSlope(44, -(13 + 3 * d)).flat(8).crest(3.0, 12, 3.6, 24).flat(16); },
  },
  {
    id: 'double-pop', title: 'Double crest', tier: 2, style: true, required: false, entry: [6, HC], exit: [12, HC], airtime: 0.7, receiving: 'downslope', cpSpeed: 11,
    build: (b) => { b.flat(4).railSlope(36, -9).flat(4).crest(1.8, 9, 1.6, 14).flat(12).crest(2.0, 10, 2.2, 16).flat(12); },
  },
  // ------------------------------------------------------------------ compulsory actions
  {
    id: 'hop', title: 'Hop the gap', tier: 1, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0.5, receiving: 'broad', cpSpeed: 12,
    build: (b, d) => { b.flat(4).runIn().slope(46, 2, linear); b.gap(5 + 1.2 * d, -0.4); b.slope(12, -0.8, easeOut).flat(16); },
  },
  {
    id: 'pot', title: 'Pot', tier: 1, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.4, receiving: 'flat', cpSpeed: 13,
    build: (b) => { b.flat(4).runIn().slope(46, 2, linear); b.pot(b.cur().x); b.flat(16); },
  },
  {
    id: 'skim-pair', title: 'Heel-skim pair', tier: 2, style: false, required: true, entry: [8, HC], exit: [12, HC], airtime: 0.4, receiving: 'downslope', cpSpeed: 14,
    build: (b) => { b.flat(4).runIn().slope(46, 2, linear); const x = b.cur().x; b.flat(8); b.pot(x); b.pot(x + 4, true); b.railSlope(30, -5).flat(10); },
  },
  {
    id: 'pot-pillar', title: 'Pot → pillar', tier: 2, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.5, receiving: 'flat', cpSpeed: 14,
    build: (b, d) => { b.flat(4).runIn().slope(46, 2, linear); const x = b.cur().x; b.flat(lerp(36, 31, d)); b.pot(x); b.pillar(b.cur().x); b.flat(14); },
  },
  {
    id: 'stepdowns', title: 'Step-down gaps', tier: 2, style: false, required: true, entry: [8, HC], exit: [9, HC], airtime: 0.6, receiving: 'broad', cpSpeed: 13,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear);
      b.gap(5 + d, -1.2); b.slope(10, -0.6, easeOut).flat(lerp(36, 30, d));
      b.gap(6 + d, -1.4); b.slope(10, -0.6, easeOut).flat(24);
    },
  },
  {
    id: 'ramp-flip', title: 'Ramp → flip → broad landing', tier: 2, style: false, required: true, entry: [8, HC], exit: [13, HC], airtime: 1.0, receiving: 'broad', cpSpeed: 13,
    build: (b, d) => { b.flat(4).runIn().railSlope(36, -8).flat(8).kicker(10, 2.4); b.gap(7 + 2 * d, -1.8); b.slope(16, -2.2, easeOut).flat(24); },
  },
  {
    id: 'rail-launch', title: 'Jump → optional rail → launch', tier: 2, style: true, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.6, receiving: 'downslope', cpSpeed: 13,
    build: (b) => {
      b.flat(4).runIn().slope(46, 2, linear); b.gap(5, -0.3); b.slope(10, -0.6, easeOut).flat(6);
      const x = b.cur().x, y = b.cur().y;
      b.flat(30); b.rail(x, 22, y + 0.95, y + 0.6, 1.2, false);
      b.crest(1.6, 9, 1.6, 14).flat(22);
    },
  },
  {
    id: 'rail-gap', title: 'Rail over a gap', tier: 2, style: false, required: true, entry: [8, HC], exit: [10, HC], airtime: 0, receiving: 'broad', cpSpeed: 14,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, -3, linear);
      const y = b.cur().y, len = 18 + 4 * d;
      const lip = b.gap(len, -0.8, 'rail');
      b.rail(lip.x, len + 5, y + 1.0, y - 0.1, 0, true, y + 0.7);
      b.flat(28);
    },
  },
  {
    id: 'wall-gap', title: 'Compression → wall ride → receiving climb', tier: 3, style: false, required: true, entry: [10, HC], exit: [10, HC], airtime: 0, receiving: 'climb', cpSpeed: 12,
    build: (b, d) => {
      b.flat(4).runIn().railSlope(44, -12).flat(8).kicker(10, 1.2);
      const len = 30 + 6 * d;
      const lip = b.gap(len, -1.4, 'wall');
      b.wall({ x0: lip.x - 4, x1: lip.x + len + 3, yBottom: lip.y - 4.5, yTop: lip.y + 4.5, side: 'right', lateral: 2.4, required: true });
      b.flat(8).slope(26, 2.5).flat(10);
    },
  },
  {
    id: 'ramp-pillar', title: 'Big jump → pillar', tier: 3, style: false, required: true, entry: [8, HC], exit: [12, HC], airtime: 1.0, receiving: 'broad', cpSpeed: 13,
    build: (b) => {
      b.flat(4).runIn().railSlope(36, -8).flat(8).kicker(10, 2.4);
      const lip = b.gap(8, -1.8); b.slope(16, -2.2, easeOut).flat(46);
      b.pillar(lip.x + 8 + 30); b.flat(10);
    },
  },
  {
    id: 'crest-pillar', title: 'Crest flip → pillar', tier: 3, style: true, required: true, entry: [6, HC], exit: [12, HC], airtime: 0.9, receiving: 'flat', cpSpeed: 12,
    build: (b) => {
      b.flat(4).railSlope(40, -10).flat(6).crest(2.2, 10, 2.2, 18).runIn().flat(46);
      b.pillar(b.cur().x); b.flat(20);
    },
  },
  {
    id: 'gap-pillar', title: 'Pot → gap → pillar', tier: 3, style: false, required: true, entry: [8, HC], exit: [8, HC], airtime: 0.5, receiving: 'flat', cpSpeed: 14,
    build: (b, d) => {
      b.flat(4).runIn().slope(46, 2, linear); b.pot(b.cur().x); b.flat(lerp(46, 40, d));
      const lip = b.gap(5.5, -0.5); b.slope(10, -0.8, easeOut).flat(46);
      b.pillar(lip.x + 5.5 + 30); b.flat(14);
    },
  },
];

/** Net height change of a phrase (m), measured from a build at mid difficulty. */
const netCache = new Map<string, number>();
export function netDrop(p: PhraseSpec): number {
  let v = netCache.get(p.id);
  if (v === undefined) { const b = buildPhrase(p, 0, 0, 0.5, () => 0.5); const c = b.chains[b.chains.length - 1].points; v = c[c.length - 1].y; netCache.set(p.id, v); }
  return v;
}

export const SPEC = Object.fromEntries([...PHRASES, ...SET_PIECES].map((p) => [p.id, p])) as Record<string, PhraseSpec>;
const CONNECTORS = new Set(['start', 'boost', 'bleed', 'recovery', 'climb', 'gate']);
export const LIBRARY = PHRASES.filter((p) => !CONNECTORS.has(p.id));
export { SET_PIECES };

/** Difficulty 0..1 by distance (m from the start): in waves (build, peak, breather), see waves.ts. */
export function difficultyAt(dist: number): number { return waveAt(dist).d; }
/** Highest tier allowed at difficulty d. */
export function maxTier(d: number): Tier { return d >= 0.35 ? 3 : d >= 0.1 ? 2 : 1; }
/** Longest run of consecutive compulsory phrases allowed at difficulty d (longer combinations later). */
export function maxRequiredRun(d: number): number { return d >= 0.6 ? 3 : d >= 0.15 ? 2 : 1; }

/**
 * Neighbour validation: can `b` follow `a` directly, or which connector is needed?
 * Speed: a's likely exit range must reach b's entry range (else boost / bleed).
 * Flow: a compulsory phrase after a run of compulsory phrases needs a recovery.
 * Height: keeps the route within a band so it doesn't drift forever downward.
 */
export function connectorFor(a: PhraseSpec, b: PhraseSpec, ctx: { requiredRun: number; d: number; y: number; y0: number }): string | null {
  if (b.required && ctx.requiredRun >= maxRequiredRun(ctx.d)) return 'recovery';
  if (ctx.y < ctx.y0 - 160 && a.id !== 'climb' && a.id !== 'boost' && netDrop(b) < 0) return 'climb';
  if (a.exit[0] < b.entry[0]) return 'boost';
  if (a.exit[1] > b.entry[1] + 0.01) return 'bleed';
  return null;
}

interface Plan { spec: PhraseSpec; d: number; connector: boolean; zone: string; wave: WaveInfo; setPiece?: boolean; gate?: { from: string; to: string } }

/** Seeded phrase sequencer. Phrase i depends only on (seed, i, history). */
export class Assembler {
  private index = 0;
  private history: PhraseSpec[] = [];
  private requiredRun = 0;
  private queue: Plan[] = [];
  /** Zone span the route is in, and the last wave that got its set piece. */
  private span = 0;
  private spWave = -1;
  private lastSetPiece = '';
  constructor(readonly seed: number, private script?: { ids: string[]; d: number }, readonly zones: ZoneSequence = new ZoneSequence(['town'])) {}

  private rng(i: number): () => number { return mulberry32((this.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0); }

  private weightOf(zone: Zone, id: string): number { return zone.weights?.[id] ?? 1; }

  /** Queue `spec` after whatever connectors the pair (prev -> spec) needs. */
  private enqueueWithConnectors(spec: PhraseSpec, base: Omit<Plan, 'spec' | 'connector'>, y: number, y0: number, forceRecovery = false, connectorZone = base.zone): void {
    const chain: PhraseSpec[] = [];
    let a = this.queue.length ? this.queue[this.queue.length - 1].spec : this.history[this.history.length - 1], run = this.queue.length ? 0 : this.requiredRun;
    if (forceRecovery && a.required) { chain.push(SPEC.recovery); a = SPEC.recovery; run = 0; }
    for (let k = 0; k < 3; k++) {
      const c = connectorFor(a, spec, { requiredRun: run, d: base.d, y, y0 });
      if (!c || chain.some((q) => q.id === c)) break;
      chain.push(SPEC[c]); a = SPEC[c]; run = 0;
    }
    for (const c of chain) this.queue.push({ ...base, zone: connectorZone, spec: c, connector: true, setPiece: undefined, gate: undefined });
    this.queue.push({ ...base, spec, connector: !!base.gate });
  }

  /** Next phrase to build, given where the route currently ends (x = distance from the start). */
  next(x: number, y: number, y0: number): Plan {
    const wave = waveAt(x);
    if (this.queue.length) return this.commit(this.queue.shift()!);
    const i = this.index;
    const zone = this.zones.zoneAt(x);
    if (this.script) { // tests: a fixed phrase list, then calm recovery forever
      const id = this.script.ids[i] ?? 'recovery';
      return this.commit({ spec: SPEC[id], d: this.script.d, connector: CONNECTORS.has(id), zone: zone.id, wave, setPiece: id.startsWith('sp-') });
    }
    if (i === 0) return this.commit({ spec: SPEC.start, d: 0, connector: true, zone: zone.id, wave });
    const d = wave.d;
    const r = this.rng(i);
    // zone change: a gate chunk first (zones change at the end of a wave, in the breather)
    const span = this.zones.spanAt(x);
    if (span !== this.span) {
      const from = this.zones.zones[this.span % this.zones.zones.length].id;
      this.span = span;
      if (from !== zone.id) { this.enqueueWithConnectors(SPEC.gate, { d, zone: zone.id, wave, gate: { from, to: zone.id } }, y, y0, true, from); return this.commit(this.queue.shift()!); }
    }
    // wave peak: one hand-authored set piece per wave (after a recovery; anything compulsory after it gets a recovery too)
    // (also from just before the peak, so a long phrase can't carry the route straight over the whole peak)
    if (wave.index >= 0 && this.spWave !== wave.index && (wave.phase === 'peak' || x >= wave.peakAt - 60 || wave.phase === 'breather')) {
      const sps = zone.setPieces.map((id) => SPEC[id] as SetPieceSpec).filter((p) => p && p.minWave <= wave.index && p.tier <= maxTier(waveAt(wave.peakAt).d) && p.id !== this.lastSetPiece);
      if (sps.length) {
        this.spWave = wave.index;
        const w = sps.map((p) => this.weightOf(zone, p.id) * (p.minWave === wave.index ? 1.5 : 1));
        let pick = r() * w.reduce((a, b) => a + b, 0), sp = sps[sps.length - 1];
        for (let k = 0; k < sps.length; k++) { pick -= w[k]; if (pick <= 0) { sp = sps[k]; break; } }
        this.lastSetPiece = sp.id;
        const pd = Math.max(d, waveAt(wave.peakAt).d); // a set piece is built at the wave's peak difficulty
        this.enqueueWithConnectors(sp, { d: pd, zone: zone.id, wave: { ...wave, phase: 'peak' }, setPiece: true }, y, y0, true);
        return this.commit(this.queue.shift()!);
      }
    }
    const prev = this.history[this.history.length - 1];
    const recent = this.history.slice(-3).map((p) => p.id);
    const tier = maxTier(d);
    const breather = wave.phase === 'breather' || wave.phase === 'warmup';
    const pool = zone.phrases.map((id) => SPEC[id]).filter((p) => p && !CONNECTORS.has(p.id));
    let cands = pool.filter((p) => p.tier <= tier && !recent.includes(p.id) && (!breather || (!p.required && p.tier <= 2)));
    if (!cands.length) cands = pool.filter((p) => p.tier <= tier && !recent.includes(p.id));
    const w = cands.map((p) => {
      let k = p.style ? 1.3 : 1; // the user wants lots of hills/kickers to trick off (but also things to do: dense course)
      if (p.tier === tier) k *= 1.6;
      if (wave.phase === 'peak' && p.required) k *= 1.5; // peaks: more compulsory chains
      if (p.required && this.requiredRun >= maxRequiredRun(d)) k *= 0.5;
      if (y < y0 - 100 && netDrop(p) < -6) k *= 0.6; // deep below the start: fewer big descents
      return k * this.weightOf(zone, p.id);
    });
    let pick = r() * w.reduce((a, b) => a + b, 0), spec = cands[cands.length - 1];
    for (let k = 0; k < cands.length; k++) { pick -= w[k]; if (pick <= 0) { spec = cands[k]; break; } }
    void prev;
    this.enqueueWithConnectors(spec, { d, zone: zone.id, wave }, y, y0);
    return this.commit(this.queue.shift()!);
  }

  private commit(p: Plan): Plan {
    this.index++;
    this.history.push(p.spec);
    if (this.history.length > 8) this.history.shift();
    this.requiredRun = p.spec.required ? this.requiredRun + (p.setPiece ? 99 : 1) : 0;
    return p;
  }

  get phraseIndex(): number { return this.index; }
  rngFor(i: number): () => number { return this.rng(i + 7919); }
}

/** Build one phrase's content starting at (x, y). */
export function buildPhrase(spec: PhraseSpec, x: number, y: number, d: number, r: () => number, material: Surface['material'] = 'stone'): PhraseBuilder {
  const b = new PhraseBuilder(x, y, material);
  spec.build(b, d, r);
  b.finish();
  return b;
}

export const STREAM = {
  /** Keep this much course generated ahead of the rider (m). */
  ahead: 700,
  /** Recycle phrases that end this far behind the rider (m). */
  behind: 160,
};

/**
 * Streamed endless course. Content is appended phrase by phrase as the rider
 * approaches and recycled behind them; ids are never reused.
 */
export class EndlessCourse extends Course {
  private asm: Assembler;
  private ids = { s: 0, r: 0, w: 0, o: 0, c: 0 };
  private endX = -10;
  private endY = 0;
  private lastSurface: Surface | null = null;
  private material: Surface['material'] = 'stone';
  /** Total chunks ever built / recycled (diagnostics, memory tests). */
  built = 0;
  recycled = 0;

  /** `x0` shifts the whole route (precision tests); `script` fixes the phrase list (tests). */
  constructor(seed: number, opts: { x0?: number; script?: string[]; d?: number; zones?: string[] } = {}) {
    super(seed, [], [], [], [], (opts.x0 ?? 0) + 2, Infinity);
    this.kind = 'endless';
    this.zones = new ZoneSequence(opts.zones ?? ['town']);
    this.asm = new Assembler(seed, opts.script ? { ids: opts.script, d: opts.d ?? 0.5 } : undefined, this.zones);
    this.endX = (opts.x0 ?? 0) - 10;
    this.originX = this.endX;
    this.generateTo(this.endX + STREAM.ahead);
  }
  /** Where the route begins (distance is measured from startX). */
  readonly originX: number;
  /** Zone order for this run (default: the town only). */
  readonly zones: ZoneSequence;

  private generateTo(x: number): void {
    while (this.endX < x) this.appendPhrase();
  }

  private appendPhrase(): void {
    const i = this.asm.phraseIndex;
    const plan = this.asm.next(this.endX - this.originX, this.endY, 0);
    const b = buildPhrase(plan.spec, this.endX, this.endY, plan.d, this.asm.rngFor(i), this.material);
    const O = TUNING.obstacles;
    const surfaces: Surface[] = b.chains.map((ch) => ({ id: this.ids.s++, kind: 'ground', points: ch.points, material: ch.material, thickness: ch.material === 'stone' ? 5 : 4 }));
    // seamless join onto the previous phrase
    if (this.lastSurface) { this.lastSurface.next = surfaces[0].id; surfaces[0].prev = this.lastSurface.id; }
    const rails: Rail[] = b.rails.map((q) => ({ id: this.ids.r++, ...q }));
    const walls: Wall[] = b.walls.map((q) => ({ id: this.ids.w++, ...q }));
    const ground = (x: number) => {
      for (const s of surfaces) if (x >= Course.x0(s) && x <= Course.x1(s)) return Course.sample(s, x).y;
      throw new Error(`no ground at ${x} in ${plan.spec.id}`);
    };
    const obstacles: Obstacle[] = b.obstacles.map((q) => ({
      id: this.ids.o++, kind: q.kind, x: q.x, baseY: ground(q.x),
      halfWidth: q.kind === 'pot' ? O.potHalfWidth : O.pillarHalfWidth, height: q.kind === 'pot' ? O.potHeight : O.pillarHeight,
    }));
    const gaps: Gap[] = [];
    for (let k = 0; k + 1 < surfaces.length; k++) {
      const a = surfaces[k].points[surfaces[k].points.length - 1], c = surfaces[k + 1].points[0];
      const req = b.requires.find(([x]) => Math.abs(x - a.x) < 0.01)?.[1] ?? 'jump';
      gaps.push({ x0: a.x, x1: c.x, yTakeoff: a.y, yReceive: c.y, requires: req });
    }
    const last = surfaces[surfaces.length - 1];
    const end = last.points[last.points.length - 1];
    const chunk: Chunk = {
      id: this.ids.c++, x0: this.endX, x1: end.x, y0: this.endY, y1: end.y, title: plan.spec.title, spec: plan.spec.id, tier: plan.spec.tier,
      difficulty: plan.d, connector: plan.connector, zone: plan.zone, gate: plan.gate, setPiece: plan.setPiece, wave: { index: plan.wave.index, phase: plan.wave.phase }, cpX: this.endX + 2, cpSpeed: plan.spec.cpSpeed, features: b.features,
      surfaces: surfaces.map((q) => q.id), rails: rails.map((q) => q.id), walls: walls.map((q) => q.id), obstacles: obstacles.map((q) => q.id), markers: [],
    };
    this.addChunk(chunk, surfaces, rails, walls, obstacles, gaps);
    this.lastSurface = last;
    this.material = last.material;
    this.endX = end.x; this.endY = end.y;
    this.built++;
  }

  override stream(x: number, active?: { surfaceId: number; railId: number; wallId: number }): void {
    this.generateTo(x + STREAM.ahead);
    // recycle phrases safely behind the rider with no active contact
    while (this.chunks.length > 1) {
      const c = this.chunks[0];
      if (c.x1 > x - STREAM.behind) break;
      if (active && (c.surfaces.includes(active.surfaceId) || c.rails.includes(active.railId) || c.walls.includes(active.wallId))) break;
      this.removeChunk(c);
      this.recycled++;
    }
  }

  /** Where the generated route currently ends. */
  get generatedTo(): number { return this.endX; }
}

export function buildEndlessCourse(seed: number, zones?: string[]): EndlessCourse { return new EndlessCourse(seed, { zones }); }
