// Review clip capture: rides a course with the dev autopilot (paused, deterministic) and writes chase and/or
// side-view JPEG frames, then encodes MP4s with ffmpeg. Side camera sits beside Ao at chest height or above,
// looking level/slightly down (never low, never looking up).
// Usage: URL=http://127.0.0.1:5222/ node scripts/town-clip.mjs <outDir> [maxTicks=8400] [ticksPerFrame=6] [mode=opening] [views=chase,side]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [outDir, maxTicks = '8400', tpf = '6', mode = 'opening', viewsArg = 'chase,side'] = process.argv.slice(2);
const views = viewsArg.split(',');
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
const q = process.env.Q ?? '?seed=12345&look=witch';
for (const v of views) fs.mkdirSync(`${outDir}/frames-${v}`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR ?? 1), isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(BASE + q, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 90000 });
await page.evaluate((mode) => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone');
  let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  if (mode !== 'opening') ic.setMode(mode); ic.game.retry();
  ic.autopilot(mode === 'endless' ? { minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true, styleFlips: true } : { minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true }); }, mode);
await page.waitForTimeout(3000);
const per = Number(tpf), total = Number(maxTicks), side = Number(process.env.SIDE ?? -4.2);
let n = 0, done = false; const meta = [];
for (let t = 0; t < total && !done; t += per) {
  const r = await page.evaluate(([per, views, side]) => {
    const ic = window.icarus, v = ic.game.view; ic.advance(per, undefined, 1000);
    const draw = (c) => (v.present ? v.present(c) : v.renderer.render(v.scene, c));
    const canvas = v.renderer.domElement, out = {};
    if (views.includes('chase')) { draw(v.rig.camera); out.chase = canvas.toDataURL('image/jpeg', 0.88); }
    if (views.includes('side')) {
      const c = v.rig.camera.clone(); const V = c.position.constructor; const r = v.rider.root;
      const hips = new V(); v.rider.figure.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(hips);
      const right = r.localToWorld(new V(0, 0, 1)).sub(r.position).normalize();
      c.fov = 62; c.position.copy(hips).addScaledVector(right, side).add(new V(0, 1.1, 0)); c.lookAt(hips.clone().add(new V(0, 0.1, 0))); c.updateProjectionMatrix(); c.updateMatrixWorld();
      draw(c); out.side = canvas.toDataURL('image/jpeg', 0.88);
    }
    const st = ic.game.sim.state, info = ic.renderInfo();
    return { ...out, x: Math.round(st.x), mode: st.mode, calls: info.calls, tris: info.triangles };
  }, [per, views, side]);
  for (const v of views) fs.writeFileSync(`${outDir}/frames-${v}/${String(n).padStart(5, '0')}.jpg`, Buffer.from(r[v].split(',')[1], 'base64'));
  meta.push({ t, x: r.x, mode: r.mode, calls: r.calls, tris: r.tris }); n++;
  if (n % 50 === 0) console.log(n, r.x, r.mode, r.calls, r.tris);
  if (r.mode === 'finished' || r.mode === 'failed') done = true;
}
await browser.close();
fs.writeFileSync(`${outDir}/clip-meta.json`, JSON.stringify(meta));
const fps = Math.round(120 / per);
for (const v of views) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${outDir}/frames-${v}/%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', `${outDir}/${mode}-${v}.mp4`]);
console.log('frames', n, 'fps', fps);
