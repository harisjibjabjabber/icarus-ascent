/** Heroine looks (lightweight: no three-vrm import, safe to use from the HUD). */
export type Look = 'longhair' | 'witch';
export const LOOKS: Record<Look, { file: string; label: string }> = {
  longhair: { file: 'heroine/ao-longhair.vrm', label: 'Long hair' },
  witch: { file: 'heroine/ao-witch.vrm', label: 'Witch' },
};
const KEY = 'icarus.look';
const isLook = (v: string | null): v is Look => v === 'longhair' || v === 'witch';
/** ?look=witch|longhair wins (and is remembered), else the saved choice, else long hair. */
export function initialLook(search = typeof location !== 'undefined' ? location.search : ''): Look {
  const q = new URLSearchParams(search).get('look');
  if (isLook(q)) { saveLook(q); return q; }
  try { const s = localStorage.getItem(KEY); if (isLook(s)) return s; } catch { /* private mode */ }
  return 'longhair';
}
export function saveLook(l: Look): void { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } }
export const nextLook = (l: Look): Look => (l === 'longhair' ? 'witch' : 'longhair');
export function lookUrl(l: Look): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
  return base + LOOKS[l].file;
}
