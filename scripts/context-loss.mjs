// WebGL context-loss drill: plays the endless/opening run in real time (autopilot), forces a context loss with
// WEBGL_lose_context, checks the sim keeps going and the screen shows the CSS sky + hint (not white/black), restores
// the context and measures how long until a frame is drawn again, then checks the tier stepped down, the per-device
// flag was stored, and a reload starts at the capped tier. Screenshots go to OUT (default: /tmp/context-loss).
// Usage: URL=http://127.0.0.1:5372/ DPR=1 node scripts/context-loss.mjs [query]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = process.env.URL ?? 'http://127.0.0.1:5372/';
const q = process.argv[2] ?? '?seed=12345&look=witch&fps=1';
const DPR = Number(process.env.DPR ?? 1);
const OUT = process.env.OUT ?? '/tmp/context-loss';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (/context/i.test(m.text())) console.log('console:', m.text()); });
const boot = async () => {
  await page.goto(BASE + q, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
};
await boot();
await page.evaluate(() => { localStorage.removeItem('icarus.gfx.lost'); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 120000 });
await page.waitForTimeout(4000);
await page.evaluate(() => { const ic = window.icarus; ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true }); });
await page.waitForTimeout(4000);
const state = () => page.evaluate(() => { const g = window.icarus.game, v = g.view; return { tick: g.sim.state.tick, x: +g.sim.state.x.toFixed(1), mode: g.sim.state.mode, lost: v.contextLost, tier: v.quality.level.name, losses: v.quality.losses, blackoutMs: Math.round(v.lastBlackoutMs), hint: !!document.querySelector('.gfx-hint.show'), glLost: v.renderer.getContext().isContextLost(), stored: localStorage.getItem('icarus.gfx.lost') }; });
const s0 = await state();
console.log('before loss', JSON.stringify(s0));
await page.screenshot({ path: `${OUT}/1-before.png` });
// a normal frame's cost here (for scale): time between two rendered frames
const frameMs = await page.evaluate(() => new Promise((r) => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - t0)))); }));
await page.evaluate(() => { window.__lose = window.icarus.game.view.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
await page.waitForTimeout(2500);
const s1 = await state();
console.log('during loss', JSON.stringify(s1), `sim advanced ${s1.tick - s0.tick} ticks`);
await page.screenshot({ path: `${OUT}/2-lost.png` });
const restore = await page.evaluate(() => new Promise((res) => {
  const v = window.icarus.game.view, t0 = performance.now();
  window.__lose.restoreContext();
  const poll = () => { if (v.lastBlackoutMs > 0 && !v.contextLost) res({ firstFrameAfterRestoreMs: Math.round(performance.now() - t0), tier: v.quality.level.name }); else setTimeout(poll, 10); };
  poll();
}));
console.log('restore', JSON.stringify(restore), `normal frame ~${frameMs} ms (two rAFs)`);
await page.waitForTimeout(4000);
const s2 = await state();
console.log('after restore', JSON.stringify(s2), `sim advanced ${s2.tick - s1.tick} ticks`);
await page.screenshot({ path: `${OUT}/3-restored.png` });
// the post pass, its render targets and the shadow map all work again: the frame has ink, AO/bloom tiers aside
const pix = await page.evaluate(() => { const v = window.icarus.game.view; v.present(); const c = v.renderer.domElement; const g = document.createElement('canvas'); g.width = 64; g.height = 128; const x = g.getContext('2d'); x.drawImage(c, 0, 0, 64, 128); const d = x.getImageData(0, 0, 64, 128).data; let m = 0, m2 = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; m += l; m2 += l * l; } const n = d.length / 4; m /= n; return { mean: +m.toFixed(1), std: +Math.sqrt(m2 / n - m * m).toFixed(1) }; });
console.log('restored frame luminance', JSON.stringify(pix));
// a second session on this device starts capped (one tier below the one that lost the context), no promotion
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.quality, null, { timeout: 120000 });
const s3 = await page.evaluate(() => { const Q = window.icarus.game.view.quality; return { tier: Q.level.name, canPromote: Q.canPromote, pastLosses: Q.pastLosses, stored: localStorage.getItem('icarus.gfx.lost') }; });
console.log('next session', JSON.stringify(s3));
await page.evaluate(() => localStorage.removeItem('icarus.gfx.lost'));
await browser.close();
