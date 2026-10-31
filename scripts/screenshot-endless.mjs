// Deterministic screenshots of endless moments via the dev autopilot.
// Usage: node scripts/screenshot-endless.mjs [url] [outDir] [seed]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://127.0.0.1:8080/';
const out = process.argv[3] ?? 'screenshots';
const seed = process.argv[4] ?? '7';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// swiftshader drains queued frames before a screenshot; the art pass shaders make that slower
page.setDefaultTimeout(240000);
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
// start screen (opening boot) with the Endless button
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/endless-0-start-screen.png` });
await page.evaluate(() => localStorage.setItem('icarus.endless.best', '3140'));
await page.goto(`${base}?endless&seed=${seed}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); ic.autopilot({ minSpeed: 15, strength: 1, styleFlips: true, pots: 'heel', pillarTrick: 'grab' }); });
const until = (fn, extra = 0, every = 20) => page.evaluate(([src, extra, every]) => {
  const ic = window.icarus; const pred = new Function('g', `return (${src})(g)`);
  ic.advance(120 * 400, pred, every); if (extra) ic.advance(extra, undefined, 2);
  const g = ic.game, s = g.sim.state, c = g.course.chunkAt(s.x);
  return { x: +s.x.toFixed(1), mode: s.mode, air: s.air, speed: +s.speed.toFixed(1), phrase: c?.spec, chunks: g.course.chunks.length, rebases: g.view.rebases, hud: document.querySelector('.distance')?.textContent };
}, [fn.toString(), extra, every]);
const shot = async (name, info) => { await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name, JSON.stringify(info)); };
await shot('endless-1-crest-flip', await until((g) => g.sim.state.leftBy === 'crest' && g.sim.state.mode === 'airborne' && g.sim.state.air === 'flip' && g.sim.state.flip > 0.3, 0, 4));
await shot('endless-2-pop-chain', await until((g) => g.course.chunkAt(g.sim.state.x)?.spec === 'pop-chain' && g.sim.state.leftBy === 'crest' && g.sim.state.mode === 'airborne' && g.sim.state.airTime > 0.25));
await shot('endless-3-wall-ride', await until((g) => g.sim.state.mode === 'wallRiding', 50));
await shot('endless-4-pillar-break', await until((g) => g.sim.state.broken.some((id) => g.course.obstacle(id)?.kind === 'pillar' && g.course.obstacle(id).x > g.sim.state.x - 3), 8, 6));
// a readable endless fail: a late-jumping autopilot misses a gap; the card shows distance, best and the retry phrase
await page.goto(`${base}?endless&seed=${seed}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('endless-5-fail', JSON.stringify(await page.evaluate(() => { const ic = window.icarus; ic.pause(true); ic.autopilot({ minSpeed: 14, jumpEarly: -3 }); ic.advance(120 * 200, (g) => g.sim.state.mode === 'failed', 30); return { x: ic.game.sim.state.x, sub: document.querySelector('.fail-sub').textContent }; })));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/endless-5-fail.png` });
console.log(logs.join('\n'));
await browser.close();
