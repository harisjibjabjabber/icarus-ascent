// Deterministic break screenshots (pot heel-break, pillar flip-break, pillar grab-break) via the dev autopilot.
// Usage: node scripts/screenshot-breaks.mjs [url] [outDir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://127.0.0.1:8080/?seed=12345';
const out = process.argv[3] ?? 'screenshots';
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const setup = (opts) => page.evaluate((opts) => {
  const ic = window.icarus; ic.pause(true); ic.game.retry();
  document.querySelector('.hint')?.classList.add('gone');
  ic.autopilot(opts);
}, opts);
const until = (fn, extra = 0) => page.evaluate(([src, extra]) => {
  const ic = window.icarus; const pred = new Function('g', `return (${src})(g)`);
  ic.advance(120 * 120, pred, 6); if (extra) ic.advance(extra);
  const s = ic.game.sim.state; return { x: +s.x.toFixed(1), mode: s.mode, broken: s.broken, speed: +s.speed.toFixed(1), fail: s.fail?.message };
}, [fn.toString(), extra]);
const shot = async (name, info) => { await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log(name, JSON.stringify(info)); };

await setup({ minSpeed: 15, strength: 1, pots: 'heel' });
await shot('lab-pot-approach', await until((g) => g.sim.state.x > g.course.obstacles[0].x - 9));
await shot('lab-pot-break', await until((g) => g.sim.state.broken.some((id) => g.course.obstacles[id].kind === 'pot'), 16));
await setup({ minSpeed: 15, strength: 1, pillarTrick: 'flip' });
await shot('lab-pillar-approach', await until((g) => g.sim.state.x > g.course.obstacles.find((o) => o.kind === 'pillar').x - 12));
await shot('lab-pillar-break', await until((g) => g.sim.state.broken.some((id) => g.course.obstacles[id].kind === 'pillar'), 12));
await setup({ minSpeed: 15, strength: 1, pillarTrick: 'grab' });
await shot('lab-pillar-break-grab', await until((g) => g.sim.state.broken.filter((id) => g.course.obstacles[id].kind === 'pillar').length >= 2, 12));
console.log(logs.join('\n'));
await browser.close();
