// Deterministic screenshots of key opening lessons via the dev autopilot.
// Usage: node scripts/screenshot-opening.mjs [url] [outDir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:8080/';
const out = process.argv[3] ?? 'screenshots';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/opening-start.png` });
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); ic.autopilot({ minSpeed: 15, strength: 1, pillarTrick: 'grab', pots: 'heel', styleFlips: true }); });
const until = (fn, extra = 0) => page.evaluate(([src, extra]) => {
  const ic = window.icarus; const pred = new Function('g', `return (${src})(g)`);
  ic.advance(120 * 200, pred, 6); if (extra) ic.advance(extra);
  const s = ic.game.sim.state; return { x: +s.x.toFixed(1), mode: s.mode, air: s.air, speed: +s.speed.toFixed(1), fail: s.fail?.message, prompt: document.querySelector('.prompt.show .prompt-text')?.textContent ?? null };
}, [fn.toString(), extra]);
const shot = async (name, info) => { await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name, JSON.stringify(info)); };
const L = (i) => `g.course.lessons[${i}]`;
await shot('opening-1-push', await until((g) => g.sim.state.x > 14));
await shot('opening-2-crest-pop', await until((g) => g.sim.state.leftBy === 'crest' && g.sim.state.mode === 'airborne' && g.sim.state.air === 'flip', 10));
await shot('opening-3-jump', await until((g) => g.sim.state.x > g.course.lessons[2].featureX - 22));
await shot('opening-5-heel', await until((g) => g.sim.state.mode === 'heelSkim' && g.sim.state.x > g.course.lessons[4].featureX), 30);
await shot('opening-7-rail', await until((g) => g.sim.state.mode === 'grinding' && g.course.rails[g.sim.state.railId].required, 60));
await shot('opening-8-pillar', await until((g) => g.sim.state.broken.some((id) => g.course.obstacles[id].kind === 'pillar'), 8));
await shot('opening-9-wall-approach', await until((g) => g.sim.state.x > g.course.lessons[8].featureX - 30));
await shot('opening-9-wall', await until((g) => g.sim.state.mode === 'wallRiding', 80));
await shot('opening-finish', await until((g) => g.sim.state.mode === 'finished', 60));
void L;
console.log(logs.join('\n'));
await browser.close();
