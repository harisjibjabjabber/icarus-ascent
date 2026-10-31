declare const __BUILD_VERSION__: string;

/** Version baked in at build time (dev server: 'dev'). */
export const BUILD_VERSION: string = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

/**
 * Stale-build guard. Polls version.json (cache-busted) on load, when the tab becomes
 * visible again and every ~60 s; reloads only when `canReload()` says the player is
 * not mid-run (start / fail / finish screen). A newer build found mid-run is
 * remembered and applied at the next safe moment.
 */
export class VersionWatcher {
  private pending = false;
  private busy = false;
  latest: string | null = null;

  constructor(private canReload: () => boolean, private intervalMs = 60_000) {}

  start(): void {
    if (BUILD_VERSION.startsWith('dev')) return; // dev server: no version.json
    void this.check();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.check(); });
    setInterval(() => { if (this.pending || this.canReload()) void this.check(); }, this.intervalMs);
  }

  /** Call at safe moments (run ended, back on the start screen). */
  safePoint(): void { if (this.pending && this.canReload()) location.reload(); }

  async check(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const url = new URL('version.json', document.baseURI);
      url.searchParams.set('t', String(Date.now()));
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.json()) as { version?: string };
      if (!v.version) return;
      this.latest = v.version;
      if (v.version !== BUILD_VERSION) {
        this.pending = true;
        this.safePoint();
      }
    } catch { /* offline or blocked: try again later */ } finally { this.busy = false; }
  }
}
