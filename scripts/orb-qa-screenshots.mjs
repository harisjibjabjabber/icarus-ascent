// Mid-run star QA at a 390×844 viewport.
// Usage: node scripts/orb-qa-screenshots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const out = process.argv[3] ?? '/opt/cursor/artifacts';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: [
    '--use-angle=swiftshader',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => log('pageerror', e.message));

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}-390x844.png`, timeout: 180000, animations: 'disabled' });
  log('shot', name);
};

const ready = async (url) => {
  log('goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => {
    const v = window.icarus?.game?.view;
    const veil = document.querySelector('.veil');
    return !!v?.courseView && v.courseView.chunkCount >= 2 && (!veil || veil.classList.contains('gone'));
  }, { timeout: 45000 });
  await page.evaluate(() => {
    document.querySelector('.veil')?.remove();
    document.querySelector('.hint')?.classList.add('gone');
    document.querySelector('.start')?.classList.remove('show');
  });
  log('scene ready');
};

const boot = async (seed, zones) => {
  await ready(`${base}/?endless&seed=${seed}&zones=${zones}`);
  await page.evaluate(() => {
    const ic = window.icarus;
    ic.pause(true);
    ic.game.retry();
  });
};

/** Coarse ride to a route distance. One render at the end. */
const gotoX = async (xRel, opts) => {
  const info = await page.evaluate(({ xRel, opts }) => {
    const ic = window.icarus;
    ic.autopilot(opts);
    ic.advance(120 * 280, (g) => g.sim.state.x - g.course.originX >= xRel, 40);
    const g = ic.game;
    const x = g.sim.state.x;
    const ahead = g.course.orbs
      .filter((o) => !g.score.tookOrb(o.id) && o.x > x + 2 && o.x < x + 36)
      .slice(0, 8)
      .map((o) => ({ tier: o.tier, pickup: o.pickup, dx: +(o.x - x).toFixed(1), lat: +o.lateral.toFixed(2), len: o.trailLen }));
    return {
      x: Math.round(x - g.course.originX),
      mode: g.sim.state.mode,
      orbs: g.score.orbCount,
      hud: document.querySelector('.eh-orb-n')?.textContent ?? '',
      zone: g.course.chunkAt(x)?.zone,
      ahead,
    };
  }, { xRel, opts });
  log('at', info);
  return info;
};

const ap = { minSpeed: 14, optionalRail: true, riskyLine: true, pots: 'jump' };

// (a) gold centre-line trail, seed 42 town, first star of the route line near 467 m.
await boot(42, 'town');
await gotoX(456, ap);
await shot('orb-gold-trail-ahead');

// (c) the next pickup on that same line, frozen on the collect frame.
const burst = await page.evaluate(() => {
  const ic = window.icarus;
  const near = (g) => {
    const x = g.sim.state.x;
    const y = g.sim.state.y;
    return g.course.orbs
      .filter((o) => !g.score.tookOrb(o.id) && o.pickup === 'route' && Math.abs(o.lateral) < 0.9 && o.x > x + 0.15 && o.x < x + 12 && Math.abs(o.y - y) < 1.4)
      .sort((a, b) => a.x - b.x)[0];
  };
  ic.advance(120 * 40, (g) => {
    const o = near(g);
    return !!o && o.x - g.sim.state.x < 1.6;
  }, 20);
  const before = ic.game.score.orbCount;
  let hit = false;
  let parts = 0;
  for (let i = 0; i < 28; i++) {
    ic.advance(1, undefined, 50);
    const g = ic.game;
    let n = 0;
    g.view.scene.traverse((o) => { if (o.isInstancedMesh && o.renderOrder === 650) n = o.count; });
    if (g.score.orbCount > before) { hit = true; parts = n; break; }
  }
  // Let the star-pop travel for ~80 ms so the sparkles have left the flash.
  if (hit) ic.advance(10, undefined, 5);
  const g = ic.game;
  let n = 0;
  g.view.scene.traverse((o) => { if (o.isInstancedMesh && o.renderOrder === 650) n = o.count; });
  parts = n;
  return {
    hit,
    parts,
    x: Math.round(g.sim.state.x - g.course.originX),
    orbs: g.score.orbCount,
    hud: document.querySelector('.eh-orb-n')?.textContent ?? '',
    mode: g.sim.state.mode,
  };
});
log('burst', burst);
await shot('orb-pickup-burst');

// (e) HUD still showing that count, burst faded.
await page.evaluate(() => window.icarus.advance(36, undefined, 12));
const hud = await page.evaluate(() => ({
  hud: document.querySelector('.eh-orb-n')?.textContent ?? '',
  x: Math.round(window.icarus.game.sim.state.x - window.icarus.game.course.originX),
}));
log('hud', hud);
await shot('orb-hud-count');

// (b) purple air star on the centre line, seed 1 town, star near 711 m.
await boot(1, 'town');
await gotoX(697, ap);
await shot('orb-purple-ahead');

// (d) harbour centre-line trail, seed 7 at 283 m.
await boot(7, 'harbour');
await gotoX(283, ap);
await shot('orb-harbour-trail');

log('done', out);
await browser.close();
