// Render-cost probe: draw calls / triangles / geometries and mean frame time over N
// rendered frames at the opening start and mid-course (headless swiftshader: relative only).
// Usage: node scripts/perf-probe.mjs [url] [query]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:8080/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const probe = (label) => page.evaluate((label) => {
  const ic = window.icarus, r = ic.game.view.renderer;
  ic.pause(true);
  ic.advance(1, undefined, 1);
  const info = { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length };
  const t0 = performance.now(); const N = 20;
  for (let i = 0; i < N; i++) { ic.advance(1, undefined, 1); const gl = r.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
  return { label, ...info, msPerFrame: +((performance.now() - t0) / N).toFixed(1), quality: ic.game.view.quality?.level?.name ?? 'n/a', pr: r.getPixelRatio() };
}, label);
console.log(JSON.stringify(await probe('start')));
await page.evaluate(() => { const ic = window.icarus; ic.autopilot({ minSpeed: 15, strength: 1, pillarTrick: 'grab', pots: 'heel' }); ic.advance(120 * 60, (g) => g.sim.state.x > 400, 30); });
console.log(JSON.stringify(await probe('x>400')));
await browser.close();
