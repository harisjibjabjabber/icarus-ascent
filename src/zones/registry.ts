import type { Zone } from './zone';
import { TOWN } from './town';
import { HARBOUR } from './harbour';
import { HILLS } from './hills';

export const ZONES: Record<string, Zone> = { town: TOWN, harbour: HARBOUR, hills: HILLS };

/**
 * Default endless zone order: old town, then the harbour, then it loops.
 * Experimental zones (hills) join only by URL. Traces recorded before zones were
 * stored replay town-only; see EndlessCourse / buildCourseFor.
 */
export const DEFAULT_ZONES = ['town', 'harbour'];

/** `?zones=town,hills` sets the order (it loops); `?zone=hills` starts in the town and goes to that zone. */
export function zonesFromSearch(search: string): string[] {
  const q = new URLSearchParams(search);
  const list = q.get('zones');
  if (list) { const ids = list.split(',').map((s) => s.trim()).filter((s) => ZONES[s]); if (ids.length) return ids; }
  const one = q.get('zone');
  if (one && ZONES[one] && one !== 'town') return ['town', one];
  return DEFAULT_ZONES;
}
