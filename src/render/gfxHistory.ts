import { ORDER, type QualityName } from './quality';

/**
 * Per-device memory of WebGL context losses (presentation only). A loss that the page saw while it was visible
 * means the GPU ran out of something at that tier, so this device starts at most one tier below it from then on
 * and never auto-promotes again. Stored in localStorage; every access is wrapped (private mode, blocked storage).
 */
export interface GfxLoss {
  /** Lowest tier that has lost the context on this device. */
  tier: QualityName;
  /** Losses so far (all sessions). */
  count: number;
  /** Time of the last loss (ms since epoch). */
  t: number;
}

export const GFX_LOSS_KEY = 'icarus.gfx.lost';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export function loadLoss(store: Store | null = defaultStore()): GfxLoss | null {
  try {
    const raw = store?.getItem(GFX_LOSS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<GfxLoss>;
    if (!v || !ORDER.includes(v.tier as QualityName)) return null;
    return { tier: v.tier as QualityName, count: Math.max(1, Math.floor(Number(v.count) || 1)), t: Number(v.t) || 0 };
  } catch { return null; }
}

export function saveLoss(rec: GfxLoss, store: Store | null = defaultStore()): void {
  try { store?.setItem(GFX_LOSS_KEY, JSON.stringify(rec)); } catch { /* storage full or blocked: this session still steps down */ }
}

/** Fold a new loss at `tier` into the history: keep the lowest tier that failed, count it. */
export function recordLoss(prev: GfxLoss | null, tier: QualityName, now: number): GfxLoss {
  const lower = prev && ORDER.indexOf(prev.tier) < ORDER.indexOf(tier) ? prev.tier : tier;
  return { tier: lower, count: (prev?.count ?? 0) + 1, t: now };
}

/** Highest tier a device with this history may start at (one below the tier that lost the context), or null. */
export function startCap(rec: GfxLoss | null): QualityName | null {
  if (!rec) return null;
  return ORDER[Math.max(0, ORDER.indexOf(rec.tier) - 1)];
}
