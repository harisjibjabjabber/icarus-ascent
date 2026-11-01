// Mid-run orb QA at 390×844. Usage: node scripts/orb-qa-screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = process.argv[3] ?? '/opt/cursor/artifacts';

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const phoneShot = async (page, name) => {
  await page.screenshot({ path: `${out}/${name}-390x844.png` });
};

const prepEndless = async (page, seed, apOpts) => {
  await page.goto(`${base}/?endless&seed=${seed}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(600);
  await page.evaluate((opts) => {
    const ic = window.icarus;
    ic.pause(true);
    ic.game.retry();
    document.querySelector('.hint')?.classList.add('gone');
    document.querySelector('.start')?.classList.remove('show');
    if (opts) ic.autopilot(opts);
  }, apOpts);
};

const advance = (page, ticks) => page.evaluate((t) => { window.icarus.advance(t); }, ticks);

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

// HUD orb counter at run start (counter visible at 0)
await prepEndless(page, 12345, null);
await phoneShot(page, 'orb-hud-counter');

// Gold trail ahead — crest-pop with optional rail, early mid-run
await prepEndless(page, 4, { minSpeed: 15, optionalRail: true, styleFlips: false });
await advance(page, 120 * 22);
await page.waitForTimeout(200);
await phoneShot(page, 'orb-gold-trail-ahead');

// Purple on high line (hard spot visible)
await prepEndless(page, 1, { minSpeed: 14, riskyLine: true });
await advance(page, 120 * 18);
await page.waitForTimeout(200);
await phoneShot(page, 'orb-purple-highline');

// Pickup burst + counter bump — ride until orbs collected, pause mid-burst window
await prepEndless(page, 4, { minSpeed: 16, optionalRail: true, styleFlips: true });
await advance(page, 120 * 42);
await page.evaluate(() => window.icarus.pause(true));
await page.waitForTimeout(180);
await phoneShot(page, 'orb-pickup-burst-counter');

// Run summary — burn through lives with a slow autopilot
await prepEndless(page, 42, { minSpeed: 3 });
await page.evaluate(() => {
  const ic = window.icarus;
  ic.autopilot({ minSpeed: 3 });
  for (let n = 0; n < 400 && !ic.game.run.over; n++) {
    ic.advance(120, (g) => g.run.over || g.sim.state.mode === 'failed', 3);
    if (ic.game.run.over) break;
    if (ic.game.sim.state.mode === 'failed') ic.retry();
  }
});
await page.waitForTimeout(500);
await phoneShot(page, 'orb-run-summary');

const orbs = await page.evaluate(() => window.icarus?.game?.score?.orbCount ?? 0);
console.log('QA screenshots →', out, 'last orb count', orbs);
await browser.close();
