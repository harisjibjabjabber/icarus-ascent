// Hi-fi per-tier perf probe (see review/hifi/README.md): same as town-perf.mjs with DPR=env; pass ?q=<tier>.
// Town perf probe: rides the opening course with the dev autopilot and samples the chase-camera frame cost
// (draw calls / triangles incl. Ao, via renderer.info) every N ticks until the finish.
// Usage: URL=http://127.0.0.1:5222/ node scripts/town-perf.mjs [query] [everyTicks]
import { chromium } from 'playwright-core';
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
const q = process.argv[2] ?? '?seed=12345&look=witch';
const every = Number(process.argv[3] ?? 250);
const DPR = Number(process.env.DPR ?? 1);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(BASE + q, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true }); });
await page.waitForTimeout(2500);
const rows = [];
for (let i = 0; i < 80; i++) {
  const r = await page.evaluate((n) => { const ic = window.icarus, v = ic.game.view; ic.advance(n, undefined, 25);
    const info = ic.renderInfo(); const st = ic.game.sim.state;
    return { x: Math.round(st.x), mode: st.mode, calls: info.calls, tris: info.triangles, town: v.env.townTris ? v.env.townTris() : null }; }, every);
  rows.push(r); console.log(JSON.stringify(r));
  if (r.mode === 'finished' || r.mode === 'failed') break;
}
const mx = (k) => Math.max(...rows.map((r) => r[k])), av = (k) => Math.round(rows.reduce((a, r) => a + r[k], 0) / rows.length);
console.log(JSON.stringify({ q, samples: rows.length, maxCalls: mx('calls'), avgCalls: av('calls'), maxTris: mx('tris'), avgTris: av('tris') }));
await browser.close();
