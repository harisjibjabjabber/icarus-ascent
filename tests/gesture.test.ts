import { describe, it, expect } from 'vitest';
import { GestureRecognizer, type GestureEvent } from '../src/input/gesture';
import { gestureToActions, KeyboardMapper } from '../src/input/mapper';
import { TUNING } from '../src/tuning';

/** Drive a stroke through points given in vu (fraction of short side), sampled finely. */
function stroke(g: GestureRecognizer, unit: number, path: [number, number][], opts: { stepVu?: number; dtMs?: number; lift?: boolean; t0?: number } = {}): GestureEvent[] {
  const step = opts.stepVu ?? 0.004, dtMs = opts.dtMs ?? 8, lift = opts.lift ?? true;
  let t = opts.t0 ?? 0;
  const out: GestureEvent[] = [];
  const [sx, sy] = path[0];
  g.pointerDown(1, sx * unit, sy * unit, t);
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) {
      t += dtMs;
      g.pointerMove(1, (ax + ((bx - ax) * k) / n) * unit, (ay + ((by - ay) * k) / n) * unit, t);
      out.push(...g.drain());
    }
  }
  if (lift) { const [lx, ly] = path[path.length - 1]; g.pointerUp(1, lx * unit, ly * unit, t + dtMs); out.push(...g.drain()); }
  return out;
}
const fires = (ev: GestureEvent[]) => ev.filter((e) => e.kind === 'fire').map((e) => (e as any).dir);

const VIEWPORTS: [number, number][] = [[390, 844], [360, 640], [430, 932], [1440, 900], [768, 1024]];

describe('gesture recogniser', () => {
  for (const [w, h] of VIEWPORTS) {
    const unit = Math.min(w, h);
    describe(`${w}x${h}`, () => {
      it('push -> upward reversal (no lift) = push then jump', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 0.8], [0.5, 1.0], [0.5, 0.85]]);
        expect(fires(ev)).toEqual(['down', 'up']);
      });

      it('several pushes then a reversal upward still jumps', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        let ev = stroke(g, unit, [[0.5, 0.8], [0.5, 0.95]]);
        ev = ev.concat(stroke(g, unit, [[0.5, 0.8], [0.5, 0.95]], { t0: 300 }));
        ev = ev.concat(stroke(g, unit, [[0.5, 0.8], [0.5, 0.92], [0.52, 0.82]], { t0: 600 }));
        expect(fires(ev)).toEqual(['down', 'down', 'down', 'up']);
      });

      it('one long single upward swipe = exactly one action', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 1.2], [0.5, 0.2]], { stepVu: 0.003 });
        expect(fires(ev)).toEqual(['up']);
      });

      it('long upward swipe with lateral wobble and a small dip stays one action', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 1.2], [0.54, 1.0], [0.47, 0.8], [0.5, 0.815], [0.53, 0.6], [0.49, 0.3]]);
        expect(fires(ev)).toEqual(['up']);
      });

      it('one long downward stroke = one push whose strength grows, never repeated pushes', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 0.5], [0.5, 1.1]], { dtMs: 4 });
        expect(fires(ev)).toEqual(['down']);
        const ext = ev.filter((e) => e.kind === 'extend') as any[];
        expect(ext.length).toBeGreaterThan(0);
        expect(ext[ext.length - 1].strength).toBe(1);
      });

      it('small wobble inside the dead zone is rejected', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const d = TUNING.gesture.deadZone * 0.7;
        const ev = stroke(g, unit, [[0.5, 0.5], [0.5 + d, 0.5], [0.5 - d * 0.5, 0.5 + d * 0.6], [0.5, 0.5 - d * 0.6], [0.5, 0.5]], { dtMs: 40 });
        expect(fires(ev)).toEqual([]);
        expect(ev.some((e) => e.kind === 'reject')).toBe(true);
      });

      it('a short twitch past the dead zone but below fire distance is rejected with a reason', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 0.5], [0.5, 0.5 - 0.03]]);
        expect(fires(ev)).toEqual([]);
        const r = ev.find((e) => e.kind === 'reject') as any;
        expect(r.reason).toMatch(/too short/);
      });

      it('diagonal up-right is not an up (no flip from wall gestures)', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.3, 0.8], [0.45, 0.66]]);
        expect(fires(ev)).not.toContain('up');
      });

      it('clear sideways stroke = side; brief sideways flick then lift releases', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.3, 0.5], [0.45, 0.51]]);
        expect(fires(ev)).toEqual(['right']);
        const acts = ev.flatMap(gestureToActions);
        expect(acts.filter((a) => a.type === 'side').map((a) => (a as any).held)).toEqual([true, false]);
      });

      it('up, reversal down, up again = up, down, up (genuine new strokes)', () => {
        const g = new GestureRecognizer(TUNING, w, h);
        const ev = stroke(g, unit, [[0.5, 0.9], [0.5, 0.75], [0.5, 0.85], [0.5, 0.7]]);
        expect(fires(ev)).toEqual(['up', 'down', 'up']);
      });
    });
  }

  it('is frame-rate independent: coarse samples give the same result', () => {
    for (const stepVu of [0.002, 0.02, 0.05]) {
      const g = new GestureRecognizer(TUNING, 390, 844);
      const ev = stroke(g, 390, [[0.5, 0.8], [0.5, 1.0], [0.5, 0.85]], { stepVu });
      expect(fires(ev)).toEqual(['down', 'up']);
    }
  });

  it('a quick tap is a tap', () => {
    const g = new GestureRecognizer(TUNING, 390, 844);
    g.pointerDown(1, 100, 100, 0); g.pointerUp(1, 101, 100, 80);
    expect(g.drain().map((e) => e.kind)).toEqual(['tap']);
  });
});

describe('keyboard mapper', () => {
  it('held Down never auto-pushes; fresh presses only', () => {
    const k = new KeyboardMapper();
    const a = [...k.keyDown('ArrowDown', false), ...k.keyDown('ArrowDown', true), ...k.keyDown('ArrowDown', true), ...k.keyDown('ArrowDown', false)];
    expect(a.filter((x) => x.type === 'down').length).toBe(1);
    k.keyUp('ArrowDown');
    expect(k.keyDown('ArrowDown', false).length).toBe(1);
  });
  it('Up fires once per press; Left/Right hold and release', () => {
    const k = new KeyboardMapper();
    expect(k.keyDown('ArrowUp', false)[0].type).toBe('up');
    expect(k.keyDown('ArrowUp', true)).toEqual([]);
    expect((k.keyDown('ArrowRight', false)[0] as any).held).toBe(true);
    expect((k.keyUp('ArrowRight')[0] as any).held).toBe(false);
  });
});
