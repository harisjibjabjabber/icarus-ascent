import * as THREE from 'three';
import { GeoBuilder, blob } from '../geo';
import { toSceneRaw, ROUTE_RIGHT, ROUTE_YAW } from '../space';
import { Kit, MergeBuffer, TEX, type Tints } from './kit';
import { inSkyFrontage, skyFrontRowFloors } from '../../course/sky';

/**
 * Witch-town layout (Kiki-style Mediterranean seaside town). Places premade kit pieces along the route in 40 m
 * chunks, both sides of the street, stepping down the hill with the course; merges each chunk into ONE mesh per
 * LOD (near: full kit pieces, far: body boxes + facades + light roofs). Pure presentation: never touches the course.
 * Positions are chunk-local (float32-friendly); the caller places the chunk at toScene(x0, y0).
 */
export const TOWN = {
  chunk: 40,
  streetEdge: 1.6, // course half-width (cobbled track) -> pavement from here
  front: 4.7, // |lateral| of the front-row facades
  panel: 2, storey: 3.12, depth: 4,
  plaster: ['#fff8ee', '#fbe7cc', '#f6d9c4', '#fff1d6', '#f3e4e8', '#e9efe6', '#fde3b8', '#f7ddd0', '#eaf0f6'],
  shutter: ['#3f8f8a', '#3c6fa8', '#6a9a4c', '#c0533e', '#2f7d6d', '#5b84b8', '#d08a3a', '#8a5aa0'],
  pavement: '#b3a28e', pavementAlt: '#a69482', water: '#3f8fa0', waterDeep: '#2c6f86', stone: '#b9a796', trimCream: '#efe4d0', stoneShade: '#8f8088',
  interior: '#3a3442', terracotta: '#c96a42', terracottaTop: '#e0875a',
  flowers: ['#e84a6a', '#f4f0ea', '#f2c04a', '#d94a3a', '#b768c8'], leaf: '#5f8f4a', leafTop: '#86b05c',
  cloth: ['#ffffff', '#f2b8c6', '#a8d4e8', '#f6e3a0', '#c8e6c0', '#e8eef8'],
  sign: ['#2f5d7a', '#7a3a2f', '#3f6b45', '#5a3f7a'], signBoard: '#f1e4c8', iron: '#3b3440', gold: '#d9a441',
};

export interface GroundSample { y: number; gap: boolean }
export type GroundFn = (x: number) => GroundSample;
export interface ChunkOpts {
  /** Opening course: quay from this route x on (chunk start >= this). */
  harbourFrom?: number;
  /**
   * Endless: true where this route x is inside a harbour zone span. Supports the town → harbour →
   * town loop. A chunk is one or the other (its midpoint), so the switch is a chunk edge.
   */
  harbourAt?: (x: number) => boolean;
  finish?: number;
  clockTowers?: number[];
  endless?: boolean;
  /** Sky segments. Front-row houses overlapping a zone (padded 10 m) are dressed for the upper layer. */
  skyZones?: { x0: number; x1: number }[];
}
export interface HousePlan {
  x0: number; x1: number; side: 1 | -1; row: number; floors: number; thirdWindows: number; flowerBoxes: number;
}
export interface TownChunk {
  near: THREE.BufferGeometry | null; far: THREE.BufferGeometry | null; y0: number; trisNear: number; trisFar: number;
  /** Swaying pennants for the street bunting. Null when this chunk has no string. */
  flags: THREE.BufferGeometry | null;
  /** Houses placed in this chunk, for the sky-layer floor check. */
  plans: HousePlan[];
  /** Cross-street laundry strings. Retired; stays 0. */
  crossStreetLaundry: number;
  /** Bunting strings in this chunk. Retired inside sky zones; the town no longer builds any. */
  buntingStrings: number;
}

/** Zones published by the course view before the town builds. Tests pass `opts.skyZones` instead. */
let notedSkyZones: { x0: number; x1: number }[] = [];
export function setSkyDressingZones(zones: { x0: number; x1: number }[]): void {
  notedSkyZones = zones.map((z) => ({ x0: z.x0, x1: z.x1 }));
}
function skySpans(opts: ChunkOpts): { x0: number; x1: number }[] {
  return opts.skyZones !== undefined ? opts.skyZones : notedSkyZones;
}

const lin = (h: string) => new THREE.Color(h);
const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _s = new THREE.Matrix4(), _v = new THREE.Vector3();
/** Facing angle (about +Y) that turns local +Z toward `dir` (scene). */
const facing = (dir: THREE.Vector3) => Math.atan2(dir.x, dir.z);
const TO_LEFT = facing(ROUTE_RIGHT.clone().negate()); // faces toward -lateral (right-side houses face the street)
const TO_RIGHT = facing(ROUTE_RIGHT);
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Placer {
  constructor(readonly x0: number, readonly y0: number) {}
  /** Matrix for a frame at route (x, y, lateral) facing angle `rot` (about Y), extra local transform `local`. */
  at(x: number, y: number, lat: number, rot: number, out = new THREE.Matrix4()): THREE.Matrix4 {
    toSceneRaw(x - this.x0, y - this.y0, lat, _v);
    return out.makeRotationY(rot).setPosition(_v);
  }
}
const local = (base: THREE.Matrix4, x: number, y: number, z: number, ry = 0, s: number | [number, number, number] = 1) => {
  const sc = typeof s === 'number' ? [s, s, s] : s;
  _r.makeRotationY(ry); _s.makeScale(sc[0], sc[1], sc[2]);
  return new THREE.Matrix4().copy(base).multiply(_m.makeTranslation(x, y, z)).multiply(_r).multiply(_s);
};

/** A box (helper geometry, vertex-coloured) in a placed frame. */
function box(mb: MergeBuffer, base: THREE.Matrix4, w: number, h: number, d: number, x: number, y: number, z: number, color: string | THREE.Color, top?: string | THREE.Color, tex: number = TEX.NONE): void {
  const g = new GeoBuilder().add(new THREE.BoxGeometry(w, h, d), [x, y, z], color, { top: top ?? color }).build();
  if (g) mb.geometry(g, base, tex);
}

/** Presentation knobs (perf vs looks). */
export const TOWN_LOD = { fullRoofs: false };

interface HouseSpec { w: 4 | 6; floors: number; plaster: THREE.Color; shutter: THREE.Color; roof: number; chimney: boolean; balcony: boolean; sign: number; door: number; flowers: boolean; skyFront?: boolean }

function house(kit: Kit, near: MergeBuffer, far: MergeBuffer, base: THREE.Matrix4, h: HouseSpec, rng: () => number, nearDetail: boolean): { thirdWindows: number; flowerBoxes: number } {
  const T = TOWN, n = h.w / 2, H = h.floors * T.storey, half = h.w / 2;
  const tints: Tints = { plaster: h.plaster, shutter: h.shutter, roof: h.roof };
  let thirdWindows = 0, flowerBoxes = 0;
  const roof = h.w === 4 ? 'roof44' : 'roof46';
  const roofRot = h.w === 4 ? 0 : Math.PI / 2;
  for (const [mb, full] of [[near, nearDetail], [far, false]] as const) {
    if (!full) { cheapHouse(mb, base, h); continue; }
    // foundation (the hill drops away): stone block under the house
    box(mb, base, h.w + 0.1, 7, T.depth + 0.1, 0, -3.5, 0, T.stoneShade, T.stone, TEX.RUBBLE);
    if (full) box(mb, base, h.w - 0.5, H - 0.3, T.depth - 0.7, 0, (H - 0.3) / 2, -0.1, T.interior); // dark interiors behind the windows
    else box(mb, base, h.w - 0.1, H - 0.05, T.depth - 0.3, 0, H / 2, -0.15, h.plaster.clone().multiply(lin('#f4ece2')), undefined, TEX.PLASTER);
    // street facade: door + shop/plain on the ground floor, windows with painted shutters above
    for (let f = 0; f < h.floors; f++) for (let i = 0; i < n; i++) {
      const px = -half + 1 + i * 2, y = f * T.storey;
      let piece = 'wallWin';
      if (f === 0) piece = i === h.door ? 'wallDoor' : (i + h.sign) % 2 ? 'wallWinFlat' : 'wallBase';
      else piece = (i + f) % 3 === 2 ? 'wallWinThin' : 'wallWin';
      mb.piece(kit, piece, local(base, px, y, 2 - 0.09), tints);
      if (piece === 'wallWin') mb.piece(kit, 'shutWide', local(base, px, y, 2 - 0.09), tints);
      if (piece === 'wallWinThin') mb.piece(kit, 'shutThin', local(base, px, y, 2 - 0.09), tints);
      if (full && piece === 'wallDoor') {
        // painted plank door set into the arched opening (the wall hides its corners); 36 tris vs 470 for the kit leaf
        const db = new GeoBuilder();
        db.add(new THREE.BoxGeometry(1.25, 2.6, 0.06), [px, y + 1.3, 1.86], h.shutter.clone().multiplyScalar(0.8), { top: h.shutter });
        db.add(new THREE.BoxGeometry(0.46, 0.4, 0.04), [px, y + 1.72, 1.9], T.interior);
        db.add(new THREE.BoxGeometry(0.08, 0.08, 0.06), [px + 0.36, y + 1.05, 1.91], T.gold);
        mb.geometry(db.build()!, base, TEX.PLANKS);
      }
      const windowPiece = piece === 'wallWin' || piece === 'wallWinThin';
      const skyBox = !!h.skyFront && f === 2 && windowPiece && i % 2 === 0;
      const normalBox = f > 0 && h.flowers && piece === 'wallWin' && !skyBox;
      if (full && (skyBox || normalBox)) {
        flowerBox(mb, base, px, y + 1.02, 2.28, rng);
        if (f === 2) flowerBoxes++;
      }
      if (full && f === 2 && windowPiece) thirdWindows++;
      if (full && f === 1 && h.balcony && i === 0) mb.piece(kit, 'balcony', local(base, px, y, 2 - 0.09 - 0.9), tints);
    }
    if (full) {
      // end walls (row houses touch, but heights step so the sides show)
      for (const sx of [-1, 1]) box(mb, base, 0.18, H, T.depth - 0.2, sx * (half - 0.09), H / 2, -0.1, h.plaster.clone().multiply(lin('#efe6dc')), h.plaster, TEX.PLASTER); // plain plaster end walls
      if (h.sign >= 0 && h.sign < T.sign.length) hangingSign(mb, base, -half + 0.4, 2.7, 2.15, T.sign[h.sign]);
    }
    mb.piece(kit, roof + (TOWN_LOD.fullRoofs ? '' : 'lite'), local(base, 0, H, 0, roofRot), tints);
    if (full && h.chimney) mb.piece(kit, 'chimney', local(base, half - 1, H + 0.6, -0.8, 0, [0.8, 0.8, 0.8]), tints);
  }
  return { thirdWindows, flowerBoxes };
}

/**
 * Cheap house for the far LOD and the back rows: one plaster body, flat painted windows/shutters/door quads on the
 * street face and a low hip roof (~10 tris) instead of kit pieces (a 4x3 house drops from ~4k to ~200 tris).
 */
function cheapHouse(mb: MergeBuffer, base: THREE.Matrix4, h: HouseSpec): void {
  const T = TOWN, n = h.w / 2, H = h.floors * T.storey, half = h.w / 2, b = new GeoBuilder();
  const fb = new GeoBuilder(), pb = new GeoBuilder(), rb = new GeoBuilder();
  fb.add(new THREE.BoxGeometry(h.w + 0.1, 7, T.depth + 0.1), [0, -3.5, 0], T.stoneShade, { top: T.stone });
  // body front face sits exactly where the near LOD's facade plaster is (z = depth/2), so the LOD crossfade has no depth step
  pb.add(new THREE.BoxGeometry(h.w, H, T.depth), [0, H / 2, 0], h.plaster.clone().multiply(lin('#f7efe6')), { top: h.plaster });
  b.add(new THREE.BoxGeometry(h.w + 0.04, 0.22, T.depth - 0.1), [0, H - 0.11, -0.1], T.trimCream);
  const zf = T.depth / 2 + 0.012;
  for (let f = 0; f < h.floors; f++) for (let i = 0; i < n; i++) {
    const px = -half + 1 + i * 2, y = f * T.storey;
    if (f === 0) {
      if (i === h.door) b.add(new THREE.PlaneGeometry(1.0, 2.1), [px, y + 1.05, zf], h.shutter);
      else b.add(new THREE.PlaneGeometry(1.1, 1.5), [px, y + 1.25, zf], T.interior);
      continue;
    }
    b.add(new THREE.PlaneGeometry(0.72, 1.3), [px, y + 1.55, zf], T.interior);
    b.add(new THREE.PlaneGeometry(0.36, 1.36), [px - 0.56, y + 1.55, zf + 0.005], h.shutter);
    b.add(new THREE.PlaneGeometry(0.36, 1.36), [px + 0.56, y + 1.55, zf + 0.005], h.shutter);
  }
  const roof = new THREE.Color(T.terracotta).multiplyScalar(h.roof);
  rb.add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), [0, H + 0.75, -0.1], roof, { scale: [h.w + 0.7, 1.5, T.depth + 0.5], top: roof });
  mb.geometry(fb.build()!, base, TEX.RUBBLE);
  mb.geometry(pb.build()!, base, TEX.PLASTER);
  mb.geometry(rb.build()!, base, TEX.TILES);
  mb.geometry(b.build()!, base);
}

function flowerBox(mb: MergeBuffer, base: THREE.Matrix4, x: number, y: number, z: number, rng: () => number): void {
  const T = TOWN, b = new GeoBuilder();
  b.add(new THREE.BoxGeometry(1.3, 0.22, 0.3), [x, y, z], T.terracotta, { top: T.terracottaTop });
  for (let k = 0; k < 6; k++) {
    const c = T.flowers[Math.floor(rng() * T.flowers.length)];
    b.add(blob(0, 0.1, rng()), [x - 0.55 + k * 0.22, y + 0.2 + rng() * 0.06, z + (rng() - 0.5) * 0.12], k % 2 ? T.leaf : c, { scale: 0.13, top: k % 2 ? T.leafTop : c });
  }
  mb.geometry(b.build()!, base);
}
function hangingSign(mb: MergeBuffer, base: THREE.Matrix4, x: number, y: number, z: number, color: string): void {
  const T = TOWN, b = new GeoBuilder();
  b.add(new THREE.BoxGeometry(0.05, 0.05, 0.9), [x, y + 0.45, z + 0.45], T.iron);
  b.add(new THREE.BoxGeometry(0.06, 0.62, 0.78), [x, y, z + 0.55], color, { top: color });
  b.add(new THREE.BoxGeometry(0.08, 0.5, 0.66), [x, y, z + 0.55], T.signBoard);
  b.add(new THREE.SphereGeometry(0.16, 8, 6), [x, y, z + 0.55], T.gold, { scale: [0.7, 0.8, 1.4] }); // a loaf / emblem
  mb.geometry(b.build()!, base);
}
/** Smoothed street level near x (houses must not poke through kickers or sink into dips). */
function level(ground: GroundFn, x: number): number {
  let best = Infinity, any = false;
  for (const dx of [-3, 0, 3]) { const g = ground(x + dx); if (!g.gap) { best = Math.min(best, g.y); any = true; } }
  return any ? best : ground(x).y;
}

/**
 * A town chunk is tens of milliseconds of mesh work. Streaming pumps it in slices (see `pump`) so one chunk
 * never occupies a whole frame; the chunk is still deep in the haze when it finishes.
 */
export interface TownChunkBuild {
  /** Do more work, at least one slice. Returns the finished chunk, or null if the budget ran out. */
  pump(budgetMs: number): TownChunk | null;
}

/** Resumable chunk build. `pump(0)` does exactly one slice; `buildTownChunk` drains it in one go. */
export function startTownChunk(kit: Kit, k: number, seed: number, ground: GroundFn, opts: ChunkOpts = {}): TownChunkBuild {
  const gen = townChunkSteps(kit, k, seed, ground, opts);
  let done = false;
  return {
    pump(budgetMs: number) {
      if (done) return null;
      const t0 = performance.now();
      for (;;) {
        const n = gen.next();
        if (n.done) { done = true; return n.value; }
        if (performance.now() - t0 >= budgetMs) return null;
      }
    },
  };
}

export function buildTownChunk(kit: Kit, k: number, seed: number, ground: GroundFn, opts: ChunkOpts = {}): TownChunk {
  const c = startTownChunk(kit, k, seed, ground, opts).pump(1e9);
  if (!c) throw new Error('town chunk build produced nothing');
  return c;
}

function* townChunkSteps(kit: Kit, k: number, seed: number, ground: GroundFn, opts: ChunkOpts = {}): Generator<void, TownChunk> {
  const T = TOWN, L = T.chunk, x0 = k * L, x1 = x0 + L;
  const rng = mulberry((seed ^ Math.imul(k + 7919, 0x9e3779b1)) >>> 0);
  const spans = skySpans(opts);
  const plans: HousePlan[] = [];
  const y0 = level(ground, x0);
  const P = new Placer(x0, y0);
  const near = new MergeBuffer(), far = new MergeBuffer();
  const flags: THREE.BufferGeometry[] = [];
  const pick = <V>(a: V[]) => a[Math.floor(rng() * a.length)];
  const harbour = opts.harbourAt ? opts.harbourAt(x0 + L / 2) : opts.harbourFrom !== undefined && x0 >= opts.harbourFrom;
  // pavement/canal ribbons (both LODs share: put in far, near copies)
  const ribs: [THREE.BufferGeometry, number][] = [];
  const pv = new THREE.Vector3();
  const ribbon = (latA: number, latB: number, yAt: (x: number) => number, ca: string, cb: string, tex: number = TEX.COBBLES) => {
    const pos: number[] = [], col: number[] = [], cA = lin(ca), cB = lin(cb);
    for (let x = x0; x < x1 - 1e-6; x += 2) {
      const xa = x, xb = Math.min(x1, x + 2);
      const q = [[xa, latA], [xb, latA], [xa, latB], [xb, latB]].map(([xx, ll]) => { toSceneRaw(xx - x0, yAt(xx) - y0, ll, pv); return [pv.x, pv.y, pv.z]; });
      // hi-fi: no 2 m checker any more (the painted cobbles carry the detail); a gentle drift along the street instead
      const c = cA.clone().lerp(cB, 0.5 + 0.5 * Math.sin(x * 0.13) * Math.sin(x * 0.047 + 1.3));
      for (const i of [0, 2, 1, 1, 2, 3]) { pos.push(...q[i]); col.push(c.r, c.g, c.b); }
    }
    // wind every triangle so it faces up (visible from above with front-face culling)
    for (let t = 0; t < pos.length; t += 9) {
      const ax = pos[t + 3] - pos[t], az = pos[t + 5] - pos[t + 2], bx = pos[t + 6] - pos[t], bz = pos[t + 8] - pos[t + 2];
      if (az * bx - ax * bz < 0) for (let k = 0; k < 3; k++) { const a = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = a; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    ribs.push([g, tex]);
  };
  const streetY = (x: number) => { const g = ground(x); return g.gap ? level(ground, x) - 7 : g.y - 0.14; };
  const canalY = (x: number) => level(ground, x) - 6.5;
  ribbon(-T.front, -T.streetEdge, streetY, T.pavement, T.pavementAlt);
  // right pavement always (in the harbour it runs out to the quay edge): no tall plain quay face beside the track
  // that reads like a wall you could ride; only the turquoise course walls are rideable
  ribbon(T.streetEdge, harbour ? T.front + 2 : T.front, streetY, T.pavement, T.pavementAlt);
  ribbon(-T.front - 0.2, T.front + 0.2, canalY, T.water, T.water, TEX.NONE);
  ribbon(-26, -T.front, (x) => level(ground, x) - 0.2, T.pavementAlt, T.pavementAlt);
  if (!harbour) ribbon(T.front, 26, (x) => level(ground, x) - 0.2, T.pavementAlt, T.pavementAlt);
  for (const [rg, tex] of ribs) { near.geometry(rg, undefined, tex); far.geometry(rg, undefined, tex); rg.dispose(); }
  yield;

  for (const side of [1, -1] as const) {
    if (side === 1 && harbour) continue;
    for (const row of [0, 1]) {
      let x = x0 + (row ? rng() * 3 : 0);
      while (x < x1 - 2) {
        const w: 4 | 6 = rng() < 0.6 ? 4 : 6;
        if (x + w > x1 + 0.01 && row === 0) { x += w; yield; continue; }
        if (rng() < (row ? 0.12 : 0.08)) {
          // alley: a cypress or an olive tree, plus a lamp in front on row 0
          const cx = x + 1.2, gy = level(ground, cx);
          const lat = side * (T.front + 1.5 + row * 9);
          const tm = P.at(cx, gy + (row ? (side < 0 ? 4 : -4) : 0), lat, 0);
          if (rng() < 0.6) far.piece(kit, 'treeHigh', local(tm, 0, 0, 0, rng() * 6, [1.6, 2.8, 1.6])), near.piece(kit, 'treeHigh', local(tm, 0, 0, 0, rng() * 6, [1.6, 2.8, 1.6]));
          else far.piece(kit, 'treeRound', local(tm, 0, 0, 0, rng() * 6, 2)), near.piece(kit, 'treeRound', local(tm, 0, 0, 0, rng() * 6, 2));
          x += 2.4; yield; continue;
        }
        const cx = x + w / 2;
        const gy = level(ground, cx) + (row ? (side < 0 ? 3.5 + rng() * 2 : -4 - rng() * 2) : 0);
        const lat = side * (T.front + T.depth / 2 + (row ? 9 + rng() * 2 : rng() * 0.5));
        const base = P.at(cx, gy, lat, side > 0 ? TO_LEFT : TO_RIGHT);
        const tower = opts.clockTowers?.some((tx) => row === 1 && side < 0 && tx >= x && tx < x + w);
        if (tower) { clockTower(kit, near, far, base); x += w; yield; continue; }
        const floorRoll = rng();
        const rolled = row ? 2 + Math.floor(floorRoll * 3) : 2 + (floorRoll < 0.45 ? 1 : 0);
        const skyFront = row === 0 && inSkyFrontage(spans, x + w / 2);
        const floors = skyFrontRowFloors(skyFront, rolled);
        const spec: HouseSpec = {
          w, floors, plaster: lin(pick(T.plaster)), shutter: lin(pick(T.shutter)), roof: 0.85 + rng() * 0.25,
          chimney: rng() < 0.45, balcony: rng() < 0.18, sign: row === 0 && rng() < 0.3 ? Math.floor(rng() * T.sign.length) : -1,
          door: Math.floor(rng() * (w / 2)), flowers: rng() < 0.6, skyFront,
        };
        const stats = house(kit, near, far, base, spec, rng, row === 0);
        plans.push({ x0: x, x1: x + w, side, row, floors, thirdWindows: stats.thirdWindows, flowerBoxes: stats.flowerBoxes });
        x += w;
        yield;
      }
    }
  }
  // street furniture (near LOD only): lamps on alternating sides, crates, a stall. No cross-street laundry.
  for (let x = x0 + 4 + rng() * 6; x < x1; x += 13 + rng() * 6) {
    const s = rng() < 0.5 ? 1 : -1;
    if (s === 1 && harbour) continue;
    const g = ground(x); if (g.gap) continue;
    near.piece(kit, 'lantern', P.at(x, g.y - 0.14, s * (T.front - 0.5), 0).multiply(_m.makeScale(1.7, 1.7, 1.7)));
    // crates and barrels read as the breakable obstacles. Keep them off the harbour pavement;
    // the quay's few boats are the decoration, and they sit out on the water.
    const clutter = rng();
    if (!harbour && clutter < 0.35) near.piece(kit, rng() < 0.5 ? 'barrel' : 'crate', P.at(x + 1.6, g.y - 0.14, s * (T.front - 0.7), rng() * 6).multiply(_m.makeScale(0.6, 0.6, 0.6)));
    yield;
  }
  if (!harbour && rng() < 0.3) { const x = x0 + 10 + rng() * 20, g = ground(x); if (!g.gap) near.piece(kit, rng() < 0.5 ? 'stallRed' : 'stallGreen', P.at(x, g.y - 0.14, -(T.front - 0.9), TO_RIGHT).multiply(_m.makeScale(1.6, 1.6, 1.6))); }
  if (harbour) yield* harbourChunk(kit, near, far, P, x0, x1, ground);
  const gn = yield* near.buildSteps();
  const gf = yield* far.buildSteps();
  return { near: gn, far: gf, y0, trisNear: near.triangles, trisFar: far.triangles, flags: flags[0] ?? null, plans, crossStreetLaundry: 0, buntingStrings: 0 };
}

/**
 * Harbour quay, right side only. The stone face runs the whole chunk (the edge you read).
 * Props are a fixed pattern on the chunk index, not a scatter: most chunks are open water,
 * every 200 m a ship, and between those a single dock with one boat moored parallel to the quay.
 * Gameplay pots and pillars stay on the street; nothing wooden sits on the pavement.
 */
function* harbourChunk(kit: Kit, near: MergeBuffer, far: MergeBuffer, P: Placer, x0: number, x1: number, ground: GroundFn): Generator<void, void> {
  const T = TOWN;
  const k = Math.round(x0 / T.chunk);
  for (let x = x0, n = 0; x < x1; x += 4, n++) {
    const g = level(ground, x + 2);
    for (const mb of [near, far]) box(mb, P.at(x + 2, g, T.front + 1, ROUTE_YAW), 4.1, 9, 2, 0, -4.6, 0, T.stoneShade, T.stone, TEX.RUBBLE);
    if (n % 2 === 1) yield;
  }
  const seaY = level(ground, x0 + T.chunk / 2) - 8.6;
  const slot = ((k % 5) + 5) % 5;
  const edge = T.front + 1;
  if (slot === 0) {
    // one sail out in the channel, bow along the route, so it reads as a silhouette rather than a pile
    const sm = P.at(x0 + 22, seaY - 0.35, edge + 24, ROUTE_YAW).multiply(_m.makeScale(1.5, 1.5, 1.5));
    near.piece(kit, 'ship', sm); far.piece(kit, 'ship', sm);
    yield;
  } else if (slot === 2 || slot === 4) {
    const x = x0 + 18;
    const dock = P.at(x, seaY + 0.35, edge + 5.2, TO_LEFT).multiply(_m.makeScale(1.25, 1.25, 1.25));
    near.piece(kit, 'dock', dock); far.piece(kit, 'dock', dock);
    const boat = slot === 4 ? 'boatLarge' : 'boatSmall';
    const bm = P.at(x + 1.4, seaY - 0.05, edge + 10.5, ROUTE_YAW).multiply(_m.makeScale(1.1, 1.1, 1.1));
    near.piece(kit, boat, bm); far.piece(kit, 'boatSmall', bm);
    yield;
  }
}

/** Clock tower: 4x4 plaster tower of six storeys, tower roof, a painted clock face toward the approaching rider. */
function clockTower(kit: Kit, near: MergeBuffer, far: MergeBuffer, base: THREE.Matrix4): void {
  const T = TOWN, floors = 6, H = floors * T.storey, t: Tints = { plaster: lin('#f3e6cf'), shutter: lin('#3c6fa8') };
  for (const mb of [near, far]) {
    box(mb, base, 4.1, 8, 4.1, 0, -4, 0, T.stoneShade, T.stone, TEX.RUBBLE);
    if (mb === far) {
      // far LOD: plaster shaft + pyramid cap; the clock faces below still read at distance
      const fb = new GeoBuilder();
      fb.add(new THREE.BoxGeometry(4, H, 4), [0, H / 2, 0], lin('#e9dcc4'), { top: lin('#f3e6cf') });
      mb.geometry(fb.build()!, base, TEX.PLASTER);
      const cb = new GeoBuilder().add(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4), [0, H + 2.2, 0], new THREE.Color(T.terracotta), { scale: [4.6, 4.4, 4.6] });
      mb.geometry(cb.build()!, base, TEX.TILES);
    } else {
      // near: same plain plaster shaft as the far LOD for the lower floors (cheaper, and no change at the LOD blend);
      // kit window pieces only on the top two floors, under the clock and the tiled cap
      const lowH = (floors - 2) * T.storey, nb = new GeoBuilder();
      nb.add(new THREE.BoxGeometry(4, lowH, 4), [0, lowH / 2, 0], lin('#e9dcc4'), { top: lin('#f3e6cf') });
      mb.geometry(nb.build()!, base, TEX.PLASTER);
      box(mb, base, 3.6, H - lowH, 3.6, 0, lowH + (H - lowH) / 2, 0, T.interior);
    }
    if (mb !== far) {
      for (let s = 0; s < 4; s++) for (let f = floors - 2; f < floors; f++) for (let i = 0; i < 2; i++) {
        const piece = f === floors - 1 ? 'wallWinThin' : f % 2 ? 'wallWinFlat' : 'wall';
        mb.piece(kit, piece, local(base, 0, 0, 0, s * Math.PI / 2).multiply(_m.makeTranslation(-1 + i * 2, f * T.storey, 2 - 0.09)), t);
      }
      mb.piece(kit, 'roofTower', local(base, 0, H, 0), t);
    }
    // clock faces on all four sides (one reads from the chase cam whichever way the tower is turned)
    for (let s = 0; s < 4; s++) {
      const b = new GeoBuilder();
      b.add(new THREE.CylinderGeometry(1.05, 1.05, 0.12, 24), [0, 0, 0], T.gold, { rot: [Math.PI / 2, 0, 0] });
      b.add(new THREE.CylinderGeometry(0.92, 0.92, 0.16, 24), [0, 0, 0.01], '#fbf4e4', { rot: [Math.PI / 2, 0, 0] });
      b.add(new THREE.BoxGeometry(0.08, 0.7, 0.05), [0, 0.3, 0.1], T.iron);
      b.add(new THREE.BoxGeometry(0.5, 0.08, 0.05), [0.22, 0, 0.1], T.iron);
      mb.geometry(b.build()!, local(base, 0, 0, 0, s * Math.PI / 2).multiply(_m.makeTranslation(0, H - 4.6, 2.12)));
    }
  }
}
