// Stills along a run at fixed ticks (same seed/autopilot as town-proof), chase + side views, for old/new comparisons.
// Usage: URL=http://127.0.0.1:5199/ node scripts/town-stills.mjs <outDir> <ticks,comma,separated> [query]
// Side camera: level with Ao's chest or above, never low looking up.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outDir, ticksArg = '200,600,1000,1400,1800,2200', q = '?seed=12345&look=witch'] = process.argv.slice(2);
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR ?? 1), isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(BASE + q, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
await page.evaluate((ap) => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone'); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); ic.game.retry(); ic.autopilot(ap); }, JSON.parse(process.env.AP ?? '{"minSpeed":13,"strength":1,"optionalRail":true,"styleGrabs":true}'));
await page.waitForTimeout(2000);
let t = 0; const meta = [];
for (const tick of ticksArg.split(',').map(Number)) {
  const r = await page.evaluate(([n, SIDE, RE]) => {
    const ic = window.icarus, v = ic.game.view; ic.advance(n, undefined, RE);
    const draw = (c) => (v.present ? v.present(c) : v.renderer.render(v.scene, c));
    const canvas = v.renderer.domElement; draw(v.rig.camera); const chase = canvas.toDataURL('image/jpeg', 0.9); const info = ic.renderInfo();
    const c = v.rig.camera.clone(); const V = c.position.constructor; const r = v.rider.root;
    const hips = new V(); v.rider.figure.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(hips);
    const fwd = r.localToWorld(new V(1, 0, 0)).sub(r.position).normalize(), right = r.localToWorld(new V(0, 0, 1)).sub(r.position).normalize();
    c.fov = 62; c.position.copy(hips).addScaledVector(right, Number(SIDE)).add(new V(0, 1.1, 0)); c.lookAt(hips.clone().add(new V(0, 0.1, 0))); c.updateProjectionMatrix(); c.updateMatrixWorld();
    draw(c); const side = canvas.toDataURL('image/jpeg', 0.9); draw(v.rig.camera);
    return { chase, side, info, x: Math.round(ic.game.sim.state.x), mode: ic.game.sim.state.mode };
  }, [tick - t, process.env.SIDE ?? '-4.2', Number(process.env.RE ?? 2)]);
  t = tick;
  fs.writeFileSync(`${outDir}/chase-${tick}.jpg`, Buffer.from(r.chase.split(',')[1], 'base64'));
  fs.writeFileSync(`${outDir}/side-${tick}.jpg`, Buffer.from(r.side.split(',')[1], 'base64'));
  meta.push({ tick, ...r.info }); console.log(tick, r.x, r.mode, r.info.calls, r.info.triangles);
}
fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
