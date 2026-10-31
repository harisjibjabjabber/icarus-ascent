// Headless screenshots of the lab. Usage: node scripts/screenshot.mjs [url] [outDir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:4173/?seed=12345';
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
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/lab.png` });
const shots = process.env.SEQ === '1';
if (shots) {
  // scripted keyboard run for extra framing checks
  const press = async (k) => { await page.keyboard.down(k); await page.waitForTimeout(60); await page.keyboard.up(k); };
  for (let i = 0; i < 3; i++) { await press('ArrowDown'); await page.waitForTimeout(350); }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/lab-descent.png` });
  for (let i = 0; i < 60; i++) {
    const x = await page.evaluate(() => window.icarus.game.sim.state.x);
    const gx = await page.evaluate(() => window.icarus.game.course.gaps[0].x0);
    if (x > gx - 22) break;
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: `${out}/lab-gap-approach.png` });
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/lab-dev.png` });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/lab-later.png` });
}
console.log(logs.join('\n'));
await browser.close();
