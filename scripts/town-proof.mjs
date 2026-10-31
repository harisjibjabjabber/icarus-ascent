// Town asset proof capture (sourcing phase): renders the live game from the real chase camera at 390x844
// with spikes/town-proof/proof.ts installed in different variants. Needs the vite dev server (URL).
// Usage: node scripts/town-proof.mjs <outDir> [ticks]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outDir = 'review/town/proof', ticksArg = '260'] = process.argv.slice(2);
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
fs.mkdirSync(outDir, { recursive: true });
const variants = (process.env.VARIANTS ?? 'current,orig-premade,retex-premade,retex-ours').split(',');
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const vName of variants) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR ?? 2), isMobile: true, hasTouch: true });
  const logs = []; page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`)); page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}?seed=12345&look=witch`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
  await page.evaluate((ticks) => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone'); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    ic.game.retry(); ic.autopilot({ minSpeed: 9, strength: 0.9, jumpEarly: 999 }); ic.advance(ticks); }, Number(ticksArg));
  const [variant, broom] = vName.split('-');
  let info = {};
  if (variant !== 'current') {
    info = await page.evaluate(async ({ variant, broom }) => { const m = await import('/spikes/town-proof/proof.ts'); return m.install(window.icarus, { variant, broom }); }, { variant, broom });
    await page.waitForTimeout(1500); // textures
  }
  await page.evaluate(() => window.icarus.advance(4));
  const shots = await page.evaluate(() => {
    const ic = window.icarus, v = ic.game.view; const canvas = v.renderer.domElement; const out = {};
    v.renderer.render(v.scene, v.rig.camera); out.chase = canvas.toDataURL('image/jpeg', 0.92); out.info = ic.renderInfo();
    const c = v.rig.camera.clone(); const V = c.position.constructor; const r = v.rider.root;
    const hips = new V(); v.rider.figure.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(hips);
    const fwd = r.localToWorld(new V(1, 0, 0)).sub(r.position).normalize(), right = r.localToWorld(new V(0, 0, 1)).sub(r.position).normalize();
    c.fov = 30; c.position.copy(hips).addScaledVector(right, 4.2).addScaledVector(fwd, 1.2).add(new V(0, 0.2, 0)); c.lookAt(hips.clone().addScaledVector(fwd, -0.3).add(new V(0, -0.55, 0))); c.updateProjectionMatrix(); c.updateMatrixWorld();
    v.renderer.render(v.scene, c); out.broomcu = canvas.toDataURL('image/jpeg', 0.92);
    c.fov = 50; c.position.copy(hips).addScaledVector(right, -1.5).addScaledVector(fwd, 3).add(new V(0, 1.2, 0)); c.lookAt(hips.clone().addScaledVector(fwd, 12).addScaledVector(right, 6.5).add(new V(0, 4.2, 0))); c.updateProjectionMatrix(); c.updateMatrixWorld();
    v.renderer.render(v.scene, c); out.wide = canvas.toDataURL('image/jpeg', 0.92);
    v.renderer.render(v.scene, v.rig.camera);
    return out;
  });
  for (const k of ['chase', 'broomcu', 'wide']) fs.writeFileSync(`${outDir}/${vName}-${k}.jpg`, Buffer.from(shots[k].split(',')[1], 'base64'));
  fs.writeFileSync(`${outDir}/${vName}-meta.json`, JSON.stringify({ info, render: shots.info, logs: logs.filter((l) => /error|warn/i.test(l)).slice(0, 20) }, null, 1));
  console.log(vName, JSON.stringify(shots.info), logs.filter((l) => /error/i.test(l)).slice(0, 5).join(' | '));
  await page.close();
}
await browser.close();
