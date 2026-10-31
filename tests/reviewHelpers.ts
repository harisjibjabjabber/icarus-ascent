import { GestureRecognizer, type GestureEvent } from '../src/input/gesture';
import { gestureToActions } from '../src/input/mapper';
import { Simulation } from '../src/sim/simulation';
import { TUNING } from '../src/tuning';

export type P = [number, number];
/** Deterministic RNG for fuzz traces. */
export function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function gauss(r: () => number) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
export const ray = (start: P, angDeg: number, len: number): P => [start[0] + Math.cos((angDeg * Math.PI) / 180) * len, start[1] - Math.sin((angDeg * Math.PI) / 180) * len];
export const fires = (ev: GestureEvent[]) => ev.filter((e) => e.kind === 'fire').map((e: any) => e.dir as string);

/** Drive a finger path (vu) through a recogniser at `speed` vu/s and `hz`, with optional jitter (vu sd). */
export function drive(path: P[], o: { speed?: number; hz?: number; jitter?: number; seed?: number; holdMs?: number; g?: GestureRecognizer } = {}) {
  const unit = 390, g = o.g ?? new GestureRecognizer(TUNING, 390, 844);
  const speed = o.speed ?? 1.5, dt = 1000 / (o.hz ?? 120), r = rng(o.seed ?? 1), j = o.jitter ?? 0;
  const ev: GestureEvent[] = []; let t = 0;
  const px = (p: P): P => [(p[0] + gauss(r) * j) * unit, (p[1] + gauss(r) * j) * unit];
  let c = px(path[0]); g.pointerDown(1, c[0], c[1], t); ev.push(...g.drain());
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.round(((Math.hypot(bx - ax, by - ay) / speed) * 1000) / dt));
    for (let k = 1; k <= n; k++) { t += dt; c = px([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]); g.pointerMove(1, c[0], c[1], t); ev.push(...g.drain()); }
  }
  if (o.holdMs) { const last = path[path.length - 1]; for (let k = 0; k < o.holdMs / dt; k++) { t += dt; c = px(last); g.pointerMove(1, c[0], c[1], t); ev.push(...g.drain()); } }
  t += dt; g.pointerUp(1, c[0], c[1], t); ev.push(...g.drain());
  return ev;
}

/** A finger driving the real recogniser -> mapper -> sim in lockstep (120 Hz). Positions in vu. */
export class Finger {
  g = new GestureRecognizer(TUNING, 390, 844); t = 0; x = 0; y = 0;
  constructor(public sim: Simulation) {}
  private flush() { for (const e of this.g.drain()) for (const a of gestureToActions(e)) this.sim.enqueue(a); }
  press(x: number, y: number) { this.x = x; this.y = y; this.g.pointerDown(1, x * 390, y * 390, this.t); this.flush(); }
  move(dx: number, dy: number, ms: number) { const n = Math.max(1, Math.round(ms / 8.333)); for (let i = 0; i < n; i++) { this.x += dx / n; this.y += dy / n; this.t += 8.333; this.g.pointerMove(1, this.x * 390, this.y * 390, this.t); this.flush(); this.sim.step(); } }
  hold(ms: number) { this.move(0, 0, ms); }
  lift() { this.g.pointerUp(1, this.x * 390, this.y * 390, this.t); this.flush(); }
  idle(ms: number) { for (let i = 0; i < Math.round(ms / 8.333); i++) { this.t += 8.333; this.sim.step(); } }
}

let sid = 7e6;
export const nid = () => ++sid;
/** Ride (pushing to `target`) until x, staying grounded. */
export function rideTo(sim: Simulation, x: number, target = 17) {
  let n = 0;
  while (sim.state.x < x && sim.state.mode === 'grounded' && n++ < 1e5) {
    if (sim.state.speed < target && n % 40 === 0) sim.enqueue({ type: 'down', strokeId: nid(), strength: 1, fresh: true, source: 'test' });
    sim.step();
  }
}
/** Step until failed, or grounded beyond stopX. */
export function settle(sim: Simulation, stopX: number, seconds = 5) {
  for (let i = 0; i < seconds / TUNING.sim.dt && sim.state.mode !== 'failed'; i++) { sim.step(); if (sim.state.x > stopX && sim.state.mode === 'grounded') break; }
}
