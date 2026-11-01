import { WAVE } from '../course/waves';
import { ZONES } from './registry';
import type { Zone } from './zone';

/**
 * How endless sequences zones: each zone lasts `zone.waves` waves and the order loops. Every
 * change happens at the end of a wave (the breather), where the assembler places a gate chunk
 * (src/course/endless.ts 'gate'): a calm flat run the renderer dresses as an arch + fog wall
 * and across which it cross-fades the theme.
 */
export class ZoneSequence {
  readonly zones: Zone[];
  constructor(ids: string[]) {
    this.zones = ids.map((id) => { const z = ZONES[id]; if (!z) throw new Error(`unknown zone ${id}`); return z; });
    if (!this.zones.length) throw new Error('empty zone sequence');
  }
  /** Distance (from the start) where the k-th zone span begins (k = 0 is the first zone, from 0). */
  spanStart(k: number): number {
    if (k <= 0) return 0;
    let waves = 0;
    for (let i = 0; i < k; i++) waves += this.zones[i % this.zones.length].waves;
    return WAVE.first + waves * WAVE.length;
  }
  /** Index of the zone span containing `dist`. */
  spanAt(dist: number): number { let k = 0; while (this.spanStart(k + 1) <= dist) k++; return k; }
  zoneAt(dist: number): Zone { return this.zones[this.spanAt(dist) % this.zones.length]; }
  /** Zone boundaries (distance, from, to) up to `dist`. Single-zone sequences have none. */
  boundaries(dist: number): { at: number; from: string; to: string }[] {
    const out: { at: number; from: string; to: string }[] = [];
    if (this.zones.length < 2) return out;
    for (let k = 1; this.spanStart(k) <= dist; k++) out.push({ at: this.spanStart(k), from: this.zones[(k - 1) % this.zones.length].id, to: this.zones[k % this.zones.length].id });
    return out;
  }
}
