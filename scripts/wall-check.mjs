// Wall-run check: rides the opening course with the dev autopilot; for every wall the course has, grabs a chase
// still on the approach and one mid-ride (if the autopilot rides it), and counts wallRiding ticks per wall.
// Usage: URL=http://127.0.0.1:5199/ node scripts/wall-check.mjs <outDir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outDir] = process.argv.slice(2);
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.goto(BASE + '?seed=12345&look=witch', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
const walls = await page.evaluate(() => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone'); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true });
  return ic.game.course.walls.map((w) => ({ id: w.id, x0: w.x0, x1: w.x1, lateral: w.lateral, required: !!w.required })); });
await page.waitForTimeout(3000);
const shot = async (name) => { const d = await page.evaluate(() => { const v = window.icarus.game.view; (v.present ? v.present() : v.renderer.render(v.scene, v.rig.camera)); return v.renderer.domElement.toDataURL('image/jpeg', 0.9); }); fs.writeFileSync(`${outDir}/${name}.jpg`, Buffer.from(d.split(',')[1], 'base64')); };
const out = [];
for (const w of walls) {
  await page.evaluate((x) => window.icarus.advance(30000, (g) => g.sim.state.x > x || g.sim.state.mode === 'failed' || g.sim.state.mode === 'finished', 30), w.x0 - 34);
  await page.evaluate(() => window.icarus.advance(6, undefined, 2)); await shot(`wall${w.id}-approach`);
  const r = await page.evaluate((w) => { const ic = window.icarus; let n = 0, shotAt = -1;
    for (let i = 0; i < 2400; i++) { ic.advance(1, undefined, 1000); const s = ic.game.sim.state; if (s.mode === 'wallRiding' && s.wallId === w.id) { n++; if (n === 45) { shotAt = Math.round(s.x); break; } } if (s.mode === 'failed' || s.mode === 'finished' || s.x > w.x1) break; }
    ic.advance(2, undefined, 2); return { ticks: n, shotAt, x: Math.round(ic.game.sim.state.x), mode: ic.game.sim.state.mode }; }, w);
  if (r.shotAt >= 0) await shot(`wall${w.id}-riding`);
  out.push({ ...w, ...r }); console.log(JSON.stringify({ ...w, ...r }));
}
fs.writeFileSync(`${outDir}/walls.json`, JSON.stringify(out, null, 1));
await browser.close();
