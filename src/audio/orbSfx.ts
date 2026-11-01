import { ORB_ASSETS, ORB_RARE_PITCH_OFFSET, ORB_STREAK_RATE, type OrbSfxKind } from '../orb/orbAssets';

const EXT = ['ogg', 'mp3'] as const;
const STREAK_GAP = 0.6;
const RARE_DOWN = 2 ** (ORB_RARE_PITCH_OFFSET / 12);

/** Gem reverb pickup (CC0): gold = short + streak pitch; rare = full + louder, 3 semitones below streak step. */
export class OrbSfx {
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private streak = 0;
  private lastT = -999;
  private voiceCount = 0;
  private lastGoldAt = -999;

  constructor(private ctx: () => AudioContext | null, private master: () => GainNode | undefined, private muted: () => boolean) {}

  pickupGold(simTime: number): void {
    if (simTime - this.lastT > STREAK_GAP) this.streak = 0;
    this.streak = Math.min(8, this.streak + 1);
    this.lastT = simTime;
    const step = this.streak - 1;
    const rate = ORB_STREAK_RATE[Math.min(step, ORB_STREAK_RATE.length - 1)];
    this.playSample('gold', rate, 0.44);
  }

  pickupRare(simTime: number): void {
    const step = Math.max(0, this.streak - 1);
    const base = ORB_STREAK_RATE[Math.min(step, ORB_STREAK_RATE.length - 1)];
    const rate = base * RARE_DOWN;
    this.streak = 0;
    this.lastT = simTime;
    this.playSample('rare', rate, 0.68);
  }

  trailComplete(longTrail: boolean): void {
    this.streak = 0;
    this.playSample(longTrail ? 'trailPerfect' : 'trail', 1, longTrail ? 0.55 : 0.48);
  }

  resetStreak(): void { this.streak = 0; }

  private playSample(kind: OrbSfxKind, rate: number, gain: number): void {
    const ctx = this.ctx();
    const master = this.master();
    if (!ctx || !master || this.muted()) return;
    const now = ctx.currentTime;
    if (kind === 'gold' && now - this.lastGoldAt < 0.045) return;
    if (kind === 'gold') this.lastGoldAt = now;
    if (this.voiceCount >= 4) return;
    void this.sample(kind).then((buf) => {
      if (!buf || this.muted()) return;
      if (this.voiceCount >= 4) return;
      const c = this.ctx();
      const m = this.master();
      if (!c || !m) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(g).connect(m);
      this.voiceCount++;
      src.onended = () => { this.voiceCount = Math.max(0, this.voiceCount - 1); };
      src.start();
    });
  }

  private sample(kind: OrbSfxKind): Promise<AudioBuffer | null> {
    const base = ORB_ASSETS.sfx[kind];
    if (!base) return Promise.resolve(null);
    let p = this.loading.get(kind);
    if (!p) {
      p = this.loadFirst(base).then((buf) => {
        if (buf) this.buffers.set(kind, buf);
        return buf;
      });
      this.loading.set(kind, p);
    }
    return p;
  }

  private async loadFirst(base: string): Promise<AudioBuffer | null> {
    for (const ext of EXT) {
      try {
        const r = await fetch(`${base}.${ext}`);
        if (!r.ok) continue;
        const ab = await r.arrayBuffer();
        const ctx = this.ctx();
        if (!ctx) return null;
        return await ctx.decodeAudioData(ab);
      } catch { /* try next */ }
    }
    return null;
  }
}
