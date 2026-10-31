/**
 * Render quality levels and an automatic fallback. Pure presentation: nothing here
 * touches the simulation. `?q=low|medium|high` pins a level (no auto changes);
 * otherwise phones start at medium, desktops at high, and the level steps down when
 * the average frame rate stays under `AUTO.minFps` for consecutive windows.
 */
export type QualityName = 'low' | 'medium' | 'high';

export interface Quality {
  name: QualityName;
  pixelRatio: number;
  /** Shadow map size; 0 disables shadows. */
  shadowMap: number;
  cloudOctaves: number;
  puffs: number;
  petals: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 1, shadowMap: 0, cloudOctaves: 2, puffs: 16, petals: 0 },
  medium: { name: 'medium', pixelRatio: 1.5, shadowMap: 1024, cloudOctaves: 3, puffs: 32, petals: 24 },
  high: { name: 'high', pixelRatio: 2, shadowMap: 2048, cloudOctaves: 4, puffs: 48, petals: 48 },
};

const ORDER: QualityName[] = ['low', 'medium', 'high'];

export const AUTO = { minFps: 48, window: 2.0, strikes: 2, warmup: 3.0 };

export class QualityManager {
  level: Quality;
  readonly pinned: boolean;
  private acc = 0;
  private frames = 0;
  private strikes = 0;
  private warm = AUTO.warmup;
  lastFps = 0;
  /** Called when the level changes (apply to renderer/env/effects). */
  onChange: ((q: Quality) => void) | null = null;

  constructor(search = '', mobile = false) {
    const q = new URLSearchParams(search).get('q') as QualityName | null;
    this.pinned = !!q && q in QUALITY;
    this.level = QUALITY[this.pinned ? q! : mobile ? 'medium' : 'high'];
  }

  /** Feed a real frame time (seconds). Ignored while paused or for huge hitches (tab switches). */
  sample(dt: number, paused: boolean): void {
    if (paused || dt <= 0 || dt > 0.25) return;
    if (this.warm > 0) { this.warm -= dt; return; }
    this.acc += dt; this.frames++;
    if (this.acc < AUTO.window) return;
    this.lastFps = this.frames / this.acc;
    this.acc = 0; this.frames = 0;
    if (this.pinned) return;
    if (this.lastFps < AUTO.minFps) {
      if (++this.strikes >= AUTO.strikes) { this.strikes = 0; this.step(-1); }
    } else this.strikes = 0;
  }

  step(dir: -1 | 1): void {
    const i = ORDER.indexOf(this.level.name) + dir;
    if (i < 0 || i >= ORDER.length) return;
    this.level = QUALITY[ORDER[i]];
    this.warm = AUTO.warmup;
    this.onChange?.(this.level);
  }
}
