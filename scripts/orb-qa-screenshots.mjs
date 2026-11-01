// Mid-run orb QA at 390×844. Usage: node scripts/orb-qa-screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = process.argv[3] ?? '/opt/cursor/artifacts';

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const phoneShot = async (page, name) => {
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${name}-390x844.png` });
};

/** Town kit, props, course chunks, and the load veil must be ready before captures. */
const waitSceneReady = (page) =>
  page.waitForFunction(
    () => {
      const ic = window.icarus;
      const v = ic?.game?.view;
      if (!v?.courseView?.course) return false;
      const veil = document.querySelector('.veil');
      if (veil && !veil.classList.contains('gone')) return false;
      const propsOk = window.__props === true || ic.props === true;
      if (!propsOk) return false;
      if (v.courseView.chunkCount < 2) return false;
      return true;
    },
    { timeout: 120000 },
  );

const prepEndless = async (page, seed, apOpts) => {
  await page.goto(`${base}/?endless&seed=${seed}`, { waitUntil: 'networkidle', timeout: 90000 });
  await waitSceneReady(page);
  await page.evaluate((opts) => {
    const ic = window.icarus;
    ic.pause(true);
    ic.game.retry();
    document.querySelector('.hint')?.classList.add('gone');
    document.querySelector('.start')?.classList.remove('show');
    document.querySelector('.veil')?.remove();
    if (opts) ic.autopilot(opts);
  }, apOpts);
  await page.evaluate(() => {
    window.icarus.advance(120 * 6, undefined, 8);
  });
  await waitSceneReady(page);
};

const advance = (page, ticks, every = 8) => page.evaluate(([t, e]) => window.icarus.advance(t, undefined, e), [ticks, every]);

const advanceUntil = (page, fnSrc, maxTicks = 120 * 200, every = 12) =>
  page.evaluate(
    ([src, max, e]) => {
      const pred = new Function('g', `return (${src})(g)`);
      window.icarus.advance(max, pred, e);
      const g = window.icarus.game;
      return { x: g.sim.state.x, orbs: g.score.orbCount, chunks: g.course.chunks.length };
    },
    [fnSrc, maxTicks, every],
  );

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
page.setDefaultTimeout(240000);

await prepEndless(page, 42, { minSpeed: 14, optionalRail: false });
await advance(page, 120 * 28, 10);
await phoneShot(page, 'orb-hud-counter');

await prepEndless(page, 42, { minSpeed: 14, optionalRail: false, styleFlips: false });
await advanceUntil(
  page,
  `(g) => {
    const x = g.sim.state.x;
    const ahead = g.course.orbs.filter((o) => o.tier === 'common' && !g.score.tookOrb(o.id) && o.x > x + 8 && o.x < x + 38 && o.trailLen >= 5);
    return ahead.length >= 4;
  }`,
  120 * 120,
  12,
);
await advance(page, 4, 1);
await phoneShot(page, 'orb-gold-trail-ahead');

await prepEndless(page, 1, { minSpeed: 14, riskyLine: true });
await advanceUntil(
  page,
  `(g) => {
    const x = g.sim.state.x;
    return g.course.orbs.some((o) => o.tier === 'rare' && !g.score.tookOrb(o.id) && o.x > x && o.x < x + 28);
  }`,
  120 * 100,
  12,
);
await advance(page, 4, 1);
await phoneShot(page, 'orb-purple-highline');

await prepEndless(page, 42, { minSpeed: 15, optionalRail: true, styleFlips: false });
await advanceUntil(page, `(g) => g.score.orbCount >= 1`, 120 * 160, 8);
await advance(page, 6, 1);
await page.evaluate(() => window.icarus.pause(true));
await page.waitForTimeout(200);
await phoneShot(page, 'orb-pickup-burst-counter');

await prepEndless(page, 777, { minSpeed: 13, optionalRail: false });
await advanceUntil(
  page,
  `(g) => {
    const x = g.sim.state.x;
    const line = g.course.orbs.filter((o) => !g.score.tookOrb(o.id) && o.x > x + 5 && o.x < x + 42);
    return line.length >= 6;
  }`,
  120 * 140,
  12,
);
await advance(page, 4, 1);
await phoneShot(page, 'orb-density-40m');

const meta = await page.evaluate(() => ({
  orbs: window.icarus?.game?.score?.orbCount ?? 0,
  x: window.icarus?.game?.sim?.state?.x ?? 0,
  chunks: window.icarus?.game?.course?.chunks?.length ?? 0,
}));
console.log('QA screenshots →', out, meta);
await browser.close();
