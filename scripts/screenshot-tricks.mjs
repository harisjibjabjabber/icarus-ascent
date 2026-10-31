// Deterministic trick screenshots: pauses the real-time loop and drives the sim with the dev autopilot.
// Usage: node scripts/screenshot-tricks.mjs [url] [outDir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:8080/?seed=12345';
const out = process.argv[3] ?? 'screenshots';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const setup = (flip) => page.evaluate((flip) => {
  const ic = window.icarus; ic.pause(true); ic.game.retry();
  document.querySelector('.hint')?.classList.add('gone');
  ic.autopilot({ minSpeed: 15, strength: 1, optionalRail: true, flipAtFirstGap: flip });
}, flip);
const until = (fn, extra = 0) => page.evaluate(([src, extra]) => {
  const ic = window.icarus; const pred = new Function('g', `return (${src})(g)`);
  ic.advance(120 * 120, pred); if (extra) ic.advance(extra);
  const s = ic.game.sim.state; return { x: s.x, mode: s.mode, air: s.air, flip: s.flip, speed: s.speed };
}, [fn.toString(), extra]);
const shot = async (name, info) => { await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name, JSON.stringify(info)); };

await setup(true);
await shot('lab-flip', await until((g) => g.sim.state.air === 'flip' && g.sim.state.flip > 0.4));
await setup(false);
await shot('lab-grind-optional', await until((g) => g.sim.state.mode === 'grinding' && !g.course.rails[g.sim.state.railId].required, 40));
await shot('lab-grind', await until((g) => g.sim.state.mode === 'grinding' && g.course.rails[g.sim.state.railId].required, 70));
await shot('lab-wall', await until((g) => g.sim.state.mode === 'wallRiding', 90));
console.log(logs.join('\n'));
await browser.close();
