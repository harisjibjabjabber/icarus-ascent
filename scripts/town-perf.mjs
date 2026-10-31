// Town perf probe: renders the chase camera at several points of a course and reports draw calls / triangles.
// Usage: node scripts/town-perf.mjs [query]   (needs URL dev/static server; default dev 5199)
import { chromium } from 'playwright-core';
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
const q = process.argv[2] ?? '?seed=12345&look=witch';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(BASE + q, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); ic.game.retry(); ic.autopilot({ minSpeed: 9, strength: 0.9, jumpEarly: 999 }); });
await page.waitForTimeout(1500);
const rows = [];
for (let i = 0; i < Number(process.env.STEPS ?? 12); i++) {
  const r = await page.evaluate(() => { const ic = window.icarus, v = ic.game.view; ic.advance(150); v.present(v.rig.camera);
    const info = ic.renderInfo(); const env = v.env; let near = 0, far = 0; for (const c of env.town.values()) { if (c.near?.visible) near++; else if (c.far?.visible) far++; }
    let ao = 0; v.rider.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; ao += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return { x: Math.round(ic.game.state?.x ?? ic.game.rider?.x ?? 0), calls: info.calls, tris: info.triangles, townTris: env.townTris(), chunks: env.town.size, near, far, ao: Math.round(ao) }; });
  rows.push(r); console.log(JSON.stringify(r));
}
const mx = (k) => Math.max(...rows.map((r) => r[k]));
console.log('MAX calls', mx('calls'), 'tris', mx('tris'));
await browser.close();
