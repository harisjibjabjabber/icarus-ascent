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
 *    tier up (high -> ultra on flagships). Never again once the tier has had to step down (no ping-pong), and never on
 *    a device with a WebGL context-loss history (see gfxHistory.ts): such a device also starts one tier below the tier
 *    that lost the context.
 *
 * Switch hygiene (the "blank for a few seconds" fix): resolution changes are applied at most every `AUTO.scaleGap`
 * seconds and, like promotions, are held while `busy` (the rider is in the air); a tier step-down is never held.
 * Phones run ultra at a phone-safe budget (`PHONE_ULTRA`: same shadow map as high, pixel ratio <= 2.5), so a
 * promotion reallocates no shadow map and adds ~25% more pixels instead of ~80%.
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
  /** Anisotropy the tier is designed for; textures use `deviceAnisotropy` (set once at load, never per switch). */
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

/**
 * Ultra on a phone: everything ultra adds (AO, longer LOD reach, more petals) at a phone-safe GPU budget. The shadow
 * map stays at high's 2048 (4096 is 64 MB of colour + 64 MB of depth, reallocated on every switch) with a box a
 * little bigger than high's at the same softness in metres, and the pixel ratio stops at 2.5 (DPR 3 on a 390x844
 * phone is 2.96 MP per buffer, 2.5 is 2.06 MP). Desktops keep `QUALITY.ultra` unchanged.
 */
export const PHONE_ULTRA: Quality = { ...QUALITY.ultra, pixelRatio: 2.5, shadowMap: 2048, shadowRange: 48, shadowSoft: 3 };

/** The tier as this device runs it (phones: ultra at PHONE_ULTRA). A `?q=` pin is the tier exactly as defined. */
export function tierFor(name: QualityName, mobile: boolean, pinned = false): Quality {
  return name === 'ultra' && mobile && !pinned ? PHONE_ULTRA : QUALITY[name];
}

/**
 * Texture anisotropy, set once at load and never changed by a tier switch (a change re-uploads every texture: ~200 MB
 * with the hi-fi texture set). Phones get high's value, desktops ultra's, both clamped to the GPU's maximum.
 */
export function deviceAnisotropy(gpuMax: number, mobile: boolean): number {
  return Math.max(1, Math.min(gpuMax, (mobile ? QUALITY.high : QUALITY.ultra).anisotropy));
}

export const AUTO = {
  minFps: 45, softFps: 55, capFps: 58, window: 2.0, strikes: 2, warmup: 3.0, step: 0.25, upWindows: 4, promoteWindows: 10,
  /** Minimum seconds (of sampled play) between two render-resolution changes; requests in between merge. */
  scaleGap: 4,
};

/** Context-loss history as QualityManager needs it (see gfxHistory.ts). */
export interface LossHistory { tier: QualityName; count: number }

export class QualityManager {
  level: Quality;
  readonly pinned: boolean;
  readonly mobile: boolean;
  /** Applied render pixel ratio before the device cap (dynamic resolution). */
  scale: number;
  /** Requested pixel ratio; copied to `scale` when the debounce and `busy` allow. */
  private target: number;
  /** Presentation hint from the view: the rider is airborne. Resolution changes and promotions wait. */
  busy = false;
  private acc = 0;
  private frames = 0;
  private strikes = 0;
  private good = 0;
  private promote = 0;
  private promotePending = false;
  /** Set once the tier has stepped down (or the device has lost a context): no more automatic promotion. */
  private noPromote = false;
  private warm = AUTO.warmup;
  /** Seconds of sampled (unpaused) time; drives the resolution debounce. */
  private clock = 0;
  private lastScaleAt = -Infinity;
  private suspended = false;
  private lostTier: QualityName | null = null;
  lastFps = 0;
  /** Diagnostics: tier changes and counted context losses this session; losses recorded on this device before. */
  tierChanges = 0;
  losses = 0;
  readonly pastLosses: number;
  /** Called when the tier changes (apply to renderer/env/effects). */
  onChange: ((q: Quality) => void) | null = null;
  /** Called when only the render resolution changes. */
  onScale: ((pixelRatio: number) => void) | null = null;

  constructor(search = '', mobile = false, history: LossHistory | null = null) {
    const q = new URLSearchParams(search).get('q') as QualityName | null;
    this.pinned = !!q && q in QUALITY;
    this.mobile = mobile;
    let name: QualityName = this.pinned ? q! : mobile ? 'high' : 'ultra';
    if (history && !this.pinned) {
      // start at most one tier below the one that lost the context; never promote on this device again
      const cap = ORDER[Math.max(0, ORDER.indexOf(history.tier) - 1)];
      if (ORDER.indexOf(name) > ORDER.indexOf(cap)) name = cap;
      this.noPromote = true;
    }
    this.pastLosses = history?.count ?? 0;
    this.level = tierFor(name, mobile, this.pinned);
    this.scale = this.target = this.level.pixelRatio;
  }

  /** May this manager still raise the tier on its own? */
  get canPromote(): boolean { return !this.pinned && !this.noPromote && this.level.name !== 'ultra'; }

  /** Feed a real frame time (seconds). Ignored while paused, while the context is lost, or for huge hitches. */
  sample(dt: number, paused: boolean): void {
    if (paused || this.suspended || dt <= 0 || dt > 0.25) return;
    this.clock += dt;
    if (this.promotePending && !this.busy) { this.promotePending = false; this.step(1); return; }
    this.flushScale();
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
    if (this.lastFps >= AUTO.capFps && this.target >= L.pixelRatio && this.scale >= L.pixelRatio && this.canPromote) {
      if (++this.promote >= AUTO.promoteWindows) {
        this.promote = 0;
        if (this.busy) this.promotePending = true; else { this.step(1); return; }
      }
    } else this.promote = 0;
    if (this.lastFps < AUTO.softFps) {
      this.good = -AUTO.upWindows; // after a drop, wait twice as long before trying more pixels again
      this.setScale(Math.max(L.minPixelRatio, this.target - AUTO.step));
    } else if (this.lastFps >= AUTO.capFps && this.target < L.pixelRatio) {
      if (++this.good >= AUTO.upWindows) { this.good = 0; this.setScale(Math.min(L.pixelRatio, this.target + AUTO.step)); }
    }
  }

  private setScale(s: number): void {
    this.target = s;
    this.flushScale();
  }

  /** Apply a pending resolution change if the debounce allows and the rider is not mid-jump. */
  private flushScale(): void {
    if (Math.abs(this.target - this.scale) < 1e-6 || this.busy || this.clock - this.lastScaleAt < AUTO.scaleGap) return;
    this.scale = this.target;
    this.lastScaleAt = this.clock;
    this.onScale?.(this.scale);
  }

  step(dir: -1 | 1): void {
    const i = ORDER.indexOf(this.level.name) + dir;
    if (i < 0 || i >= ORDER.length) return;
    this.level = tierFor(ORDER[i], this.mobile, this.pinned);
    if (dir < 0) this.noPromote = true;
    this.promote = 0; this.promotePending = false;
    // stepping down: start the lower tier at its full resolution (it is cheaper per pixel already)
    this.scale = this.target = this.level.pixelRatio;
    this.lastScaleAt = this.clock; // the tier change resized: the debounce counts from here
    this.warm = AUTO.warmup;
    this.good = 0; this.strikes = 0;
    this.tierChanges++;
    this.onChange?.(this.level);
  }

  /** The WebGL context is gone: stop judging fps (frames are free while nothing renders). */
  contextLost(): void {
    this.suspended = true;
    this.lostTier = this.level.name;
  }

  /**
   * The context is back. `counts`: the loss happened while the page was visible (a real GPU failure, not the OS
   * reclaiming a background tab). Then the tier steps down one level (unless pinned) and promotion is off for good.
   * Returns the tier that lost the context when it counts (for the per-device history), else null.
   */
  contextRestored(counts = true): QualityName | null {
    this.suspended = false;
    this.acc = 0; this.frames = 0; this.warm = AUTO.warmup;
    const tier = this.lostTier ?? this.level.name;
    this.lostTier = null;
    if (!counts) return null;
    this.losses++;
    this.noPromote = true;
    if (!this.pinned && this.level.name !== 'low') this.step(-1);
    return tier;
  }
}

