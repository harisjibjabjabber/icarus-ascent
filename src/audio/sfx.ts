import type { SimEvent, RiderState } from '../sim/types';
import { TUNING } from '../tuning';

/**
 * Tiny WebAudio synth: no assets. One-shots for push / jump / land / flip / break /
 * fail, and continuous beds for wind (scaled with speed), grinding, wall friction
 * and heel skim. Starts on the first user gesture (autoplay rules); mute persists.
 * Observes the sim only.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private beds: Record<'wind' | 'grind' | 'wall' | 'skim', { gain: GainNode; filter: BiquadFilterNode }> | null = null;
  private grindTone: { osc: OscillatorNode; gain: GainNode } | null = null;
  muted: boolean;

  constructor() {
    let m = false;
    try { m = localStorage.getItem('icarus.muted') === '1'; } catch { /* storage unavailable */ }
    this.muted = m;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const bed = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master); src.start();
      return { gain, filter };
    };
    this.beds = { wind: bed('lowpass', 500, 0.5), grind: bed('bandpass', 3200, 3), wall: bed('bandpass', 900, 1.2), skim: bed('bandpass', 450, 1) };
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 160;
    const og = ctx.createGain(); og.gain.value = 0;
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 900;
    osc.connect(of).connect(og).connect(this.master); osc.start();
    this.grindTone = { osc, gain: og };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem('icarus.muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  // ------------------------------------------------------------------ primitives

  private noiseHit(t0: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
  }

  private tone(t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------ events

  onEvent(e: SimEvent): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    switch (e.type) {
      case 'push': if (e.fresh) this.noiseHit(t, 0.2, 'bandpass', 500, 1800, 0.25 * (0.5 + e.strength * 0.5), 0.8); break;
      case 'jump': this.tone(t, 0.09, 'triangle', 260, 480, 0.12); this.noiseHit(t, 0.08, 'highpass', 1500, 3000, 0.06); break;
      case 'land': {
        const k = Math.min(1, e.impact / 14);
        this.tone(t, 0.16, 'sine', 140, 45, 0.25 + 0.35 * k);
        this.noiseHit(t, 0.12 + 0.1 * k, 'lowpass', e.material === 'cloud' ? 900 : 2200, 200, 0.12 + 0.2 * k);
        break;
      }
      case 'flip-complete': this.tone(t, 0.18, 'sine', 880, 880, 0.06); this.tone(t + 0.06, 0.22, 'sine', 1320, 1320, 0.05); break;
      case 'grind-start': this.noiseHit(t, 0.1, 'highpass', 2500, 5000, 0.25); this.tone(t, 0.08, 'square', 900, 600, 0.05); break;
      case 'wall-start': this.noiseHit(t, 0.15, 'bandpass', 1200, 700, 0.2, 1.5); break;
      case 'break':
        if (e.kind === 'pot') {
          // clay: bright crack + scattered chips + a short body thump
          this.noiseHit(t, 0.14, 'highpass', 1800, 900, 0.5);
          this.tone(t, 0.1, 'sine', 220, 90, 0.25);
          for (let i = 0; i < 4; i++) this.tone(t + 0.03 + i * 0.035 + Math.random() * 0.02, 0.035, 'triangle', 1800 + Math.random() * 1600, 1500, 0.06);
        } else {
          // masonry: heavy thump + crumble
          this.tone(t, 0.32, 'sine', 110, 38, 0.55);
          this.noiseHit(t, 0.45, 'lowpass', 2400, 180, 0.45);
          this.noiseHit(t + 0.05, 0.3, 'bandpass', 900, 400, 0.2, 2);
        }
        break;
      case 'fail': this.tone(t, 0.3, 'triangle', 320, 150, 0.12); break;
      default: break;
    }
  }

  /** Continuous beds from the current state (per frame). */
  update(s: RiderState): void {
    if (!this.ctx || !this.beds || !this.grindTone) return;
    const t = this.ctx.currentTime, tc = 0.05;
    const run = s.mode !== 'failed' && s.mode !== 'finished';
    const speed = s.mode === 'airborne' ? Math.hypot(s.vx, s.vy) : s.speed;
    const k = Math.min(1, speed / TUNING.movement.hardCap);
    this.beds.wind.gain.gain.setTargetAtTime(run ? 0.02 + 0.22 * k * k : 0, t, 0.15);
    this.beds.wind.filter.frequency.setTargetAtTime(300 + 1400 * k, t, 0.2);
    const grind = run && s.mode === 'grinding';
    this.beds.grind.gain.gain.setTargetAtTime(grind ? 0.16 : 0, t, tc);
    this.grindTone.gain.gain.setTargetAtTime(grind ? 0.03 : 0, t, tc);
    this.grindTone.osc.frequency.setTargetAtTime(120 + speed * 4, t, 0.1);
    this.beds.wall.gain.gain.setTargetAtTime(run && s.mode === 'wallRiding' ? 0.22 : 0, t, tc);
    this.beds.skim.gain.gain.setTargetAtTime(run && s.mode === 'heelSkim' ? 0.05 + 0.12 * Math.min(1, speed / 15) : 0, t, tc);
  }
}
