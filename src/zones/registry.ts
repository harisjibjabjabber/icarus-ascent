import type { Zone } from './zone';
import { TOWN } from './town';
import { HILLS } from './hills';

export const ZONES: Record<string, Zone> = { town: TOWN, hills: HILLS };

/** Default endless zone order. Experimental zones join only by URL. */
export const DEFAULT_ZONES = ['town'];

/** `?zones=town,hills` sets the order (it loops); `?zone=hills` starts in the town and goes to that zone. */
export function zonesFromSearch(search: string): string[] {
  const q = new URLSearchParams(search);
  const list = q.get('zones');
  if (list) { const ids = list.split(',').map((s) => s.trim()).filter((s) => ZONES[s]); if (ids.length) return ids; }
  const one = q.get('zone');
  if (one && ZONES[one] && one !== 'town') return ['town', one];
  return DEFAULT_ZONES;
}
