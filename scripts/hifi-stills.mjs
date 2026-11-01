// Hi-fi review stills: chase camera only (the game's own rig: chest height or above), same seed/autopilot/ticks
// for before/after. Saves the canvas at the resolution the game actually renders, plus a copy scaled to the
// device's physical size (what the phone shows: a DPR-1.5 render upscaled to DPR 3).
// Usage: URL=... DPR=1|3 node scripts/hifi-stills.mjs <outDir> [ticks] [query]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [outDir, ticksArg = '240,560,880,1200,1520,1840,2160', q = '?seed=12345&look=witch'] = process.argv.slice(2);
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
const DPR = Number(process.env.DPR ?? 1);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(BASE + q, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 180000 });
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone'); document.querySelector('.fps-hud')?.remove(); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true }); });
await page.waitForTimeout(3000);
let t = 0; const meta = [];
for (const tick of ticksArg.split(',').map(Number)) {
  const r = await page.evaluate(([n, RE]) => {
    const ic = window.icarus, v = ic.game.view; ic.advance(n, undefined, RE);
    for (let i = 0; i < 3; i++) v.present(v.rig.camera); // settle fades / dynamic textures
    const canvas = v.renderer.domElement; v.present(v.rig.camera);
    const img = canvas.toDataURL('image/png'); const info = ic.renderInfo();
    return { img, info, w: canvas.width, h: canvas.height, dpr: v.renderer.getPixelRatio(), x: Math.round(ic.game.sim.state.x), mode: ic.game.sim.state.mode };
  }, [tick - t, Number(process.env.RE ?? 16)]);
  t = tick;
  const f = `${outDir}/chase-${tick}.png`;
  fs.writeFileSync(f, Buffer.from(r.img.split(',')[1], 'base64'));
  const W = Math.round(390 * DPR), H = Math.round(844 * DPR);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-vf', `scale=${W}:${H}:flags=bilinear`, '-q:v', '3', `${outDir}/chase-${tick}.jpg`]);
  fs.unlinkSync(f);
  meta.push({ tick, x: r.x, mode: r.mode, canvas: [r.w, r.h], renderDpr: r.dpr, ...r.info }); console.log(tick, r.x, r.mode, `${r.w}x${r.h}`, r.info.calls, r.info.triangles, r.info.quality);
}
fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
