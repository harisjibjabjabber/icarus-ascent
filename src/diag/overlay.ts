import type { RiderState, SimEvent } from '../sim/types';
import type { GestureRecognizer } from '../input/gesture';
import type { Action } from '../input/actions';
import { describeAction } from '../input/actions';

/** Development overlay: detected gesture, committed action, rejection reason, movement state. */
export class DevOverlay {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  visible = false;
  private lastAction = '-';
  private lastResolved = '-';
  private lastReject = '-';
  private log: string[] = [];
  private peakSpeed = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dev-overlay';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dev-trail';
    this.ctx = this.canvas.getContext('2d')!;
    parent.append(this.canvas, this.el);
    this.setVisible(localStorage.getItem('icarus.dev') === '1' || new URLSearchParams(location.search).has('dev'));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
    this.canvas.style.display = v ? 'block' : 'none';
    localStorage.setItem('icarus.dev', v ? '1' : '0');
  }

  toggle(): void { this.setVisible(!this.visible); }

  onAction(a: Action): void { this.lastAction = describeAction(a); this.push(`in  ${this.lastAction}`); }

  onEvent(e: SimEvent): void {
    if (e.type === 'resolve') { this.lastResolved = `${e.result}`; this.push(`ok  ${e.result}`); }
    if (e.type === 'reject') { this.lastReject = `${e.action}: ${e.reason}`; this.push(`rej ${e.reason}`); }
    if (e.type === 'land') this.push(`land ${e.speedBefore.toFixed(1)}→${e.speedAfter.toFixed(1)} m/s impact ${e.impact.toFixed(1)}`);
    if (e.type === 'jump' && e.kind !== 'ground') this.push(`${e.kind} jump`);
    if (e.type === 'grind-start' || e.type === 'wall-start' || e.type === 'flip-start' || e.type === 'flip-complete' || e.type === 'skim-start' || e.type === 'grab-start') this.push(e.type);
    if (e.type === 'grind-end' || e.type === 'wall-end' || e.type === 'skim-end') this.push(`${e.type} (${e.reason})`);
    if (e.type === 'break') this.push(`BREAK ${e.kind} by ${e.by} @${e.speed.toFixed(1)}`);
    if (e.type === 'credit') this.push(`credit ${e.credit}`);
    if (e.type === 'fail') this.push(`FAIL ${e.info.kind}`);
  }

  private push(s: string): void { this.log.unshift(s); if (this.log.length > 7) this.log.pop(); }

  resetRun(): void { this.peakSpeed = 0; }

  update(st: RiderState, g: GestureRecognizer, extra: { seed: number; replay: boolean; fps: number; context?: string; version?: string; lesson?: string; quality?: string }): void {
    if (!this.visible) return;
    const speed = st.mode === 'airborne' ? Math.hypot(st.vx, st.vy) : st.speed;
    this.peakSpeed = Math.max(this.peakSpeed, speed);
    const deg = (st.angle * 180) / Math.PI;
    const gd = g.debug;
    this.el.textContent = [
      `${extra.replay ? 'REPLAY ' : ''}seed ${extra.seed}  tick ${st.tick}  ${extra.fps.toFixed(0)} fps${extra.quality ? `  q ${extra.quality}` : ''}`,
      `build ${extra.version ?? '?'}  course ${extra.lesson ?? '-'}`,
      `state   ${st.mode.toUpperCase()}${st.mode === 'grounded' ? ` slope ${deg.toFixed(1)}°` : ''}`,
      `speed   ${speed.toFixed(2)} m/s  (peak ${this.peakSpeed.toFixed(1)})`,
      `x ${st.x.toFixed(1)}  y ${st.y.toFixed(2)}  vx ${st.vx.toFixed(1)} vy ${st.vy.toFixed(1)}`,
      `coyote ${(st.coyote * 1000).toFixed(0)}ms  buffer ${(st.jumpBuffer * 1000).toFixed(0)}ms  air ${st.airTime.toFixed(2)}s`,
      `trick   air=${st.air}${st.air === 'flip' ? ` ${(st.flip * 100).toFixed(0)}%` : ''} flips=${st.flipsThisJump} prep=${st.prepHeld ? 'held' : st.prepTimer > 0 ? 'armed' : '-'} contact ${st.contactTime.toFixed(2)}s credit=${st.trickCredit}${st.trickCredit !== 'none' ? ` ${st.creditGround.toFixed(0)}m` : ''}`,
      `context ${extra.context ?? '-'}`,
      `gesture ${gd.stage} dir=${gd.dir} travel=${gd.travel.toFixed(3)}vu`,
      `detected ${gd.lastDetected}`,
      `action  ${this.lastAction}`,
      `result  ${this.lastResolved}`,
      `reject  ${this.lastReject}`,
      `gest-rej ${gd.lastReject}`,
      '— log —',
      ...this.log,
    ].join('\n');
    // finger trail
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio, 2);
    if (c.width !== innerWidth * dpr) { c.width = innerWidth * dpr; c.height = innerHeight * dpr; }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const now = performance.now();
    const tr = g.trail.filter((p) => now - p.t < 700);
    if (tr.length > 1) {
      ctx.strokeStyle = 'rgba(47,125,109,0.8)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tr[0].x, tr[0].y);
      for (const p of tr) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
}
