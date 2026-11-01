// QA screenshots for orb HUD + world orbs. Usage: node scripts/orb-qa-screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = process.argv[3] ?? '/opt/cursor/artifacts';

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function phoneShot(page, name) {
  await page.screenshot({ path: `${out}/${name}-390x844.png` });
}

async function desktopShot(page, name) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}-1280x720.png` });
  await page.setViewportSize({ width: 390, height: 844 });
}

const prepEndless = async (page, seed, script) => {
  await page.goto(`${base}/?endless&seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate((script) => {
    const ic = window.icarus;
    ic.pause(true);
    ic.game.retry();
    document.querySelector('.hint')?.classList.add('gone');
    document.querySelector('.start')?.classList.remove('show');
    if (script) ic.autopilot(script);
  }, script);
};

const advance = (page, ticks) => page.evaluate((ticks) => { window.icarus.advance(ticks); }, ticks);

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// HUD at run start (counter visible at 0)
await prepEndless(page, 12345, null);
await phoneShot(page, 'qa-hud-start');
await desktopShot(page, 'qa-hud-start');

// Common gold orbs — ride into big-kicker (~35 s sim)
await prepEndless(page, 4, { minSpeed: 16, styleFlips: true, optionalRail: true });
await advance(page, 120 * 38);
await page.waitForTimeout(120);
await phoneShot(page, 'qa-common-orbs');

// Rare orb on high line
await prepEndless(page, 1, { minSpeed: 14, riskyLine: true });
await advance(page, 120 * 32);
await page.waitForTimeout(120);
await phoneShot(page, 'qa-rare-orb-highline');

// Counter after pickups (same seed, longer ride)
await prepEndless(page, 4, { minSpeed: 16, styleFlips: true, optionalRail: true });
await advance(page, 120 * 48);
const picked = await page.evaluate(() => window.icarus.game.score.orbCount);
console.log('orbs after ride:', picked);
await page.waitForTimeout(120);
await phoneShot(page, 'qa-counter-after-pickup');
await desktopShot(page, 'qa-counter-after-pickup');

// Run summary — bail out three times
await prepEndless(page, 42, { minSpeed: 5 });
await advance(page, 120 * 90);
await page.waitForTimeout(400);
await phoneShot(page, 'qa-run-summary');

console.log('Wrote QA orb screenshots to', out);
await browser.close();
