import './hud.css';
import type { Popup, ScoreKeeper } from './score';
import type { RunSummary } from './run';
import type { ChallengeView } from './challenges';
import type { WavePhase } from '../course/waves';

export type { RunSummary };

/** One cached formatter (toLocaleString per frame allocates a formatter each call). */
const NF = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const fmt = (n: number) => NF.format(Math.round(n));
const fmtKm = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/**
 * Endless HUD (DOM): score, lives, combo bubble, pop-ups, zone banners, run summary.
 *
 * Calm by design (the brief: no excessive interface or reward effects mid-run): no per-trick or air
 * pop-ups, only a banked combo (with its total), a near miss, a bail and a set-piece bonus; banners
 * only for zone changes. The combo bubble and pop-ups sit in the top band of the screen, right of
 * the score and clear of the rider (who rides at ~60-80% of the screen height). Per-frame updates
 * write to the DOM only when a value changes.
 */
export class EndlessHud {
  readonly root: HTMLElement;
  private el: Record<'score' | 'sub' | 'lives' | 'goal' | 'combo' | 'mult' | 'chain' | 'meter' | 'flow' | 'pops' | 'banner' | 'bk' | 'bt' | 'bs' | 'sum', HTMLElement>;
  private lastMult = 0;
  private lastScore = '';
  private lastSub = '';
  private lastChain = '';
  private lastMeter = '';
  private lastFlow = '';
  private lastGoal = '';
  private comboOn = false;
  private bannerTimer = 0;
  /** Wave hook: the wave / phase the rider is in (kept for future use and dev tools; not shown). */
  waveState: { index: number; phase: WavePhase; setPiece: string } | null = null;
  private popQueue: Popup[] = [];
  private popCooldown = 0;
  onAgain: () => void = () => {};
  onSameSeed: () => void = () => {};

  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.className = 'eh';
    r.innerHTML = `
      <div class="eh-score">0</div><div class="eh-sub"></div><div class="eh-lives"></div><div class="eh-goal"></div>
      <div class="eh-combo"><div class="eh-mult">×1</div><div class="eh-chain"></div><div class="eh-meter eh-flow"><i></i></div><div class="eh-meter"><i></i></div></div>
      <div class="eh-pops"></div>
      <div class="eh-banner"><div class="eh-banner-k"></div><div class="eh-banner-t"></div><div class="eh-banner-s"></div></div>
      <div class="eh-sum"></div>`;
    parent.appendChild(r);
    this.root = r;
    const q = (s: string) => r.querySelector(s) as HTMLElement;
    this.el = { score: q('.eh-score'), sub: q('.eh-sub'), lives: q('.eh-lives'), goal: q('.eh-goal'), combo: q('.eh-combo'), mult: q('.eh-mult'), chain: q('.eh-chain'), meter: q('.eh-combo .eh-meter:not(.eh-flow)'), flow: q('.eh-flow'), pops: q('.eh-pops'), banner: q('.eh-banner'), bk: q('.eh-banner-k'), bt: q('.eh-banner-t'), bs: q('.eh-banner-s'), sum: q('.eh-sum') };
  }

  show(on: boolean): void { this.root.classList.toggle('on', on); if (!on) this.hideSummary(); }

  setLives(n: number, max: number): void {
    if (this.el.lives.children.length !== max) this.el.lives.innerHTML = Array.from({ length: max }, () => '<div class="eh-life"></div>').join('');
    [...this.el.lives.children].forEach((c, i) => c.classList.toggle('lost', i >= n));
  }

  /** Per frame (or per tick in deterministic capture). */
  update(dt: number, k: ScoreKeeper, distance: number, personalBest: number, idleFrac: number, goal: ChallengeView | null = null): void {
    const s = fmt(k.total);
    if (s !== this.lastScore) { this.el.score.textContent = s; this.lastScore = s; }
    const sub = `${fmtKm(distance)}${personalBest > 0 ? ` · best ${fmt(personalBest)}` : ''}`;
    if (sub !== this.lastSub) { this.el.sub.textContent = sub; this.lastSub = sub; }
    const g = goal ? (goal.goal > 1 ? `${goal.text}  ${Math.min(goal.progress, goal.goal)}/${goal.goal}` : goal.text) : '';
    if (g !== this.lastGoal) { this.el.goal.textContent = g; this.el.goal.classList.toggle('show', !!g); this.lastGoal = g; }
    const on = k.chain >= 2;
    if (on !== this.comboOn) { this.el.combo.classList.toggle('show', on); this.comboOn = on; }
    if (on) {
      const m = k.mult;
      if (m !== this.lastMult) {
        const up = m > this.lastMult;
        this.el.mult.textContent = `×${m}`;
        this.el.mult.className = `eh-mult${m >= 5 ? ' m5' : m >= 3 ? ' m3' : ''}`;
        if (up) { void this.el.mult.offsetWidth; this.el.mult.classList.add('pop'); }
        this.lastMult = m;
      }
      const kinds = k.comboTrickKinds;
      const chain = `${k.chain} · ${kinds} kind${kinds === 1 ? '' : 's'}`;
      if (chain !== this.lastChain) { this.el.chain.textContent = chain; this.lastChain = chain; }
      const meter = Math.max(0, 1 - idleFrac).toFixed(2);
      if (meter !== this.lastMeter) { this.el.meter.style.setProperty('--k', meter); this.el.meter.classList.toggle('soon', idleFrac > 0.72); this.lastMeter = meter; }
      const flow = k.flow.toFixed(2);
      if (flow !== this.lastFlow) { this.el.flow.style.setProperty('--k', flow); this.lastFlow = flow; }
    } else this.lastMult = 0;
    for (const p of k.drainPopups()) this.popQueue.push(p);
    if (this.popQueue.length > 3) this.popQueue.splice(0, this.popQueue.length - 3);
    this.popCooldown -= dt;
    if (this.popQueue.length && this.popCooldown <= 0) { this.spawnPop(this.popQueue.shift()!); this.popCooldown = 0.3; }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.el.banner.classList.remove('show'); }
  }

  private spawnPop(p: Popup): void {
    const d = document.createElement('div');
    d.className = `eh-pop ${p.kind}`;
    d.innerHTML = `${p.text}${p.pts ? `<b>${p.pts > 0 ? '+' : ''}${fmt(p.pts)}</b>` : ''}`;
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1400);
    while (this.el.pops.children.length > 3) this.el.pops.firstElementChild?.remove();
  }

  /** Wave hook: called as the rider enters a wave phase (or a set piece). Records it; shows nothing (calm HUD). */
  wave(index: number, phase: WavePhase, setPiece = ''): void { this.waveState = { index, phase, setPiece }; }

  banner(kicker: string, title: string, sub = '', kind: '' | 'peak' = '', seconds = 2.6): void {
    this.el.bk.textContent = kicker; this.el.bt.textContent = title; this.el.bs.textContent = sub;
    this.el.banner.className = `eh-banner show${kind ? ` ${kind}` : ''}`;
    this.bannerTimer = seconds;
  }

  summary(r: RunSummary): void {
    this.el.sum.innerHTML = `
      <div class="eh-sum-k">Run over</div>
      <div class="eh-sum-score">${fmt(r.score)}</div>
      ${r.newBest ? '<div class="eh-sum-best">New personal best!</div>' : `<div class="eh-sum-k" style="margin-top:6px">Personal best ${fmt(r.personalBest)}</div>`}
      ${r.note ? `<div class="eh-sum-note">${r.note}</div>` : ''}
      <div class="eh-sum-rows">
        <span>Best combo</span><span>${r.best.points ? `×${r.best.mult} · ${r.best.chain} tricks · ${fmt(r.best.points)}` : '—'}</span>
        <span>Distance</span><span>${(r.distanceBest ?? 0) > 0 ? `${fmtKm(r.distance)} · best ${fmtKm(r.distanceBest)}` : fmtKm(r.distance)}</span>
        <span>Tricks</span><span>${r.tricks}${(r.kinds ?? 0) ? ` · ${r.kinds} kind${r.kinds === 1 ? '' : 's'}` : ''}</span>
        <span>Near misses</span><span>${r.nearMisses}</span>
        <span>Lanterns</span><span>${r.charms ?? 0}</span>
        <span>Challenges</span><span>${r.challenges ?? 0}</span>
      </div>
      <div class="eh-sum-buttons"><button data-act="again" class="ui-btn ui-btn--primary">Ride again</button><button data-act="same" class="ui-btn ui-btn--secondary">Same route</button></div>`;
    for (const b of this.el.sum.querySelectorAll('button')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); if ((b as HTMLElement).dataset.act === 'again') this.onAgain(); else this.onSameSeed(); });
    }
    this.el.sum.classList.add('show');
    this.el.combo.classList.remove('show'); this.comboOn = false;
    this.el.goal.classList.remove('show'); this.lastGoal = '';
  }
  hideSummary(): void { this.el.sum.classList.remove('show'); }
  get summaryShown(): boolean { return this.el.sum.classList.contains('show'); }
}
