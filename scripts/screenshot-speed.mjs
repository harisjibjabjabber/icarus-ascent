// Screenshot at high speed (forces speed via the debug handle; screenshot only).
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:8080/?seed=12345';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(() => { const g = window.icarus.game; g.sim.state.speed = 24; });
for (let i = 0; i < 12; i++) { await page.evaluate(() => { const s = window.icarus.game.sim.state; if (s.mode === 'grounded') s.speed = Math.max(s.speed, 26); }); await page.waitForTimeout(150); }
await page.screenshot({ path: 'screenshots/lab-speed.png' });
await browser.close();
