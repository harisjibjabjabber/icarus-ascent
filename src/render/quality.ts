/**
 * Render quality levels, an automatic fallback and a dynamic-resolution scaler. Pure presentation: nothing here
 * touches the simulation.
 *
 * Tiers target real hardware classes (2026): `ultra` = desktops and current flagships (iPhone 15-17 Pro, Galaxy
 * S24/S25), `high` = recent phones (the phone default), `medium` = older/mid phones, `low` = the rescue tier.
 * `?q=low|medium|high|ultra` pins a tier at its full resolution (no auto changes; for testing on a device);
 * otherwise phones start at high, desktops at ultra.
 *
 * Every 2 s window (after a warm-up):
 *  - fps below `AUTO.softFps` lowers the render resolution one notch (down to the tier's floor), keeping 60 fps;
 *  - fps below `AUTO.minFps` for `AUTO.strikes` windows steps the tier down (a real deficit, not a dip);
 *  - fps at the refresh cap for `AUTO.upWindows` windows raises the resolution back a notch (never above the tier);
 *  - a phone that holds the cap at the tier's full resolution for `AUTO.promoteWindows` windows (~20 s) earns the next
 *    tier up (high -> ultra on flagships). Never again once the tier has had to step down (no ping-pong).
 */
export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface Quality {
  name: QualityName;
  /** Maximum render pixel ratio (capped by the device's own DPR). */
  pixelRatio: number;
  /** Floor for the dynamic-resolution scaler. */
  minPixelRatio: number;
  /** Shadow map size; 0 disables shadows. */
  shadowMap: number;
  /** PCF filter radius in shadow texels (softness). */
  shadowSoft: number;
  /** Half-size (m) of the sun's shadow box around the action; bigger reaches further ahead. */
  shadowRange: number;
  /** Town houses/roofs cast shadows onto the street (sun-and-shade street, an extra depth pass of the near town). */
  townShadows: boolean;
  cloudOctaves: number;
  puffs: number;
  petals: number;
  /** Texture anisotropy for ground/walls (clamped to the GPU's max). */
  anisotropy: number;
  /** Town surfaces: 0 = flat palette + brush, 1 = painted texture detail, 2 = + normal maps. */
  textures: 0 | 1 | 2;
  /** Soft bloom on highlights. */
  bloom: boolean;
  /** Screen-space ambient occlusion in the post pass. */
  ao: boolean;
  /** Multiplier on the town's full-detail distance (fewer, later LOD crossfades). */
  lodScale: number;
  /** Full-geometry tiled roofs on the near town (instead of the decimated ones). */
  fullRoofs: boolean;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 1, minPixelRatio: 0.75, shadowMap: 0, shadowSoft: 1, shadowRange: 28, townShadows: false, cloudOctaves: 2, puffs: 16, petals: 0, anisotropy: 2, textures: 0, bloom: false, ao: false, lodScale: 1, fullRoofs: false },
  medium: { name: 'medium', pixelRatio: 1.5, minPixelRatio: 1, shadowMap: 1024, shadowSoft: 2.5, shadowRange: 28, townShadows: false, cloudOctaves: 3, puffs: 32, petals: 24, anisotropy: 4, textures: 1, bloom: false, ao: false, lodScale: 1, fullRoofs: false },
  high: { name: 'high', pixelRatio: 2.25, minPixelRatio: 1.5, shadowMap: 2048, shadowSoft: 3.5, shadowRange: 42, townShadows: true, cloudOctaves: 4, puffs: 48, petals: 48, anisotropy: 8, textures: 2, bloom: true, ao: false, lodScale: 1.5, fullRoofs: true },
  ultra: { name: 'ultra', pixelRatio: 3, minPixelRatio: 2, shadowMap: 4096, shadowSoft: 5, shadowRange: 64, townShadows: true, cloudOctaves: 4, puffs: 48, petals: 64, anisotropy: 16, textures: 2, bloom: true, ao: true, lodScale: 3, fullRoofs: true },
};

export const ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra'];

export const AUTO = { minFps: 45, softFps: 55, capFps: 58, window: 2.0, strikes: 2, warmup: 3.0, step: 0.25, upWindows: 4, promoteWindows: 10 };

export class QualityManager {
  level: Quality;
  readonly pinned: boolean;
  /** Current render pixel ratio before the device cap (dynamic resolution). */
  scale: number;
  private acc = 0;
  private frames = 0;
  private strikes = 0;
  private good = 0;
  private promote = 0;
  /** Set once the tier has stepped down: no more automatic promotion. */
  private noPromote = false;
  private warm = AUTO.warmup;
  lastFps = 0;
  /** Called when the tier changes (apply to renderer/env/effects). */
  onChange: ((q: Quality) => void) | null = null;
  /** Called when only the render resolution changes. */
  onScale: ((pixelRatio: number) => void) | null = null;

  constructor(search = '', mobile = false) {
    const q = new URLSearchParams(search).get('q') as QualityName | null;
    this.pinned = !!q && q in QUALITY;
    this.level = QUALITY[this.pinned ? q! : mobile ? 'high' : 'ultra'];
    this.scale = this.level.pixelRatio;
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
    const L = this.level;
    if (this.lastFps < AUTO.minFps) {
      this.good = 0;
      if (++this.strikes >= AUTO.strikes) { this.strikes = 0; this.step(-1); return; }
    } else this.strikes = 0;
    if (this.lastFps >= AUTO.capFps && this.scale >= L.pixelRatio && !this.noPromote && L.name !== 'ultra') {
      if (++this.promote >= AUTO.promoteWindows) { this.promote = 0; this.step(1); return; }
    } else this.promote = 0;
    if (this.lastFps < AUTO.softFps) {
      this.good = -AUTO.upWindows; // after a drop, wait twice as long before trying more pixels again
      this.setScale(Math.max(L.minPixelRatio, this.scale - AUTO.step));
    } else if (this.lastFps >= AUTO.capFps && this.scale < L.pixelRatio) {
      if (++this.good >= AUTO.upWindows) { this.good = 0; this.setScale(Math.min(L.pixelRatio, this.scale + AUTO.step)); }
    }
  }

  private setScale(s: number): void {
    if (Math.abs(s - this.scale) < 1e-6) return;
    this.scale = s;
    this.onScale?.(s);
  }

  step(dir: -1 | 1): void {
    const i = ORDER.indexOf(this.level.name) + dir;
    if (i < 0 || i >= ORDER.length) return;
    this.level = QUALITY[ORDER[i]];
    if (dir < 0) this.noPromote = true;
    this.promote = 0;
    // stepping down: start the lower tier at its full resolution (it is cheaper per pixel already)
    this.scale = this.level.pixelRatio;
    this.warm = AUTO.warmup;
    this.good = 0; this.strikes = 0;
    this.onChange?.(this.level);
  }
}
