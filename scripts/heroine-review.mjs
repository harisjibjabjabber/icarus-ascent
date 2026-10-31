// Heroine review capture: drives the REAL game deterministically (paused loop + dev autopilot) and
// grabs the canvas every 1/30 s from the gameplay chase camera, plus a re-render of the same frame
// from a closer side camera (presentation-only; the game camera is untouched).
// Usage: node scripts/heroine-review.mjs <scenario> <look> [outDir]
//   scenarios: probe | idle | run | crash | lessons
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [scenario = 'probe', look = 'longhair', outDir = 'review/ao/frames'] = process.argv.slice(2);
const BASE = process.env.URL ?? 'http://127.0.0.1:5199/';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.DPR ?? 2), isMobile: true, hasTouch: true });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const mode = scenario === 'idle' || scenario === 'push' || scenario === 'coast' || scenario === 'skimexit' || scenario === 'crash' || scenario === 'lessons' ? '' : 'lab&';
await page.goto(`${BASE}?${mode}seed=12345&look=${look}${process.env.Q ? '&q=' + process.env.Q : ''}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 60000 });
await page.evaluate(() => { const ic = window.icarus; ic.pause(true); document.querySelector('.hint')?.classList.add('gone'); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); });

// in-page helpers
await page.evaluate(() => {
  const ic = window.icarus;
  window.__cap = (cams) => {
    const v = ic.game.view; const out = {};
    const canvas = v.renderer.domElement;
    for (const cam of cams) {
      if (cam !== 'chase') {
        const c = v.rig.camera.clone(); const root = v.rider.root; const V = root.position.constructor;
        const p = root.position.clone(), right = root.localToWorld(new V(0, 0, 1)).sub(root.position).normalize(), fwd = root.localToWorld(new V(1, 0, 0)).sub(root.position).normalize();
        const f = v.rider.figure; const hipsW = new V(); f.vrm.humanoid.getNormalizedBoneNode('hips').getWorldPosition(hipsW);
        // side cam rides in the roll frame (so a wall ride is seen square-on), looking at the hips
        const rq = v.rider.roll.getWorldQuaternion(v.rider.roll.quaternion.clone()); const sideZ = new V(0, 0, 1).applyQuaternion(rq), sideY = new V(0, 1, 0).applyQuaternion(rq);
        const far = ic.game.sim.state.mode === 'airborne' && Math.abs(ic.game.sim.state.flip) > 0.01 ? 1.25 : 1;
        const crashed = ic.game.sim.state.mode === 'failed';
        if (cam === 'side' && crashed) { c.fov = 34; c.up.set(0, 1, 0); c.position.copy(hipsW).addScaledVector(fwd, -3.4).addScaledVector(right, 1.2).add(new V(0, 1.2, 0)); c.lookAt(hipsW); }
        else if (cam === 'side' && ic.game.sim.state.mode === 'wallRiding') { c.fov = 34; c.up.set(0, 1, 0); c.fov = 36; c.position.copy(hipsW).addScaledVector(fwd, -5.5).addScaledVector(right, -1.2).add(new V(0, 1.4, 0)); c.lookAt(hipsW); }
        else if (cam === 'side' && ic.game.sim.state.mode === 'grinding') { c.fov = 34; c.up.set(0, 1, 0); c.position.copy(hipsW).addScaledVector(fwd, 3.4).addScaledVector(right, 2.6).add(new V(0, 0.7, 0)); c.lookAt(hipsW); }
        else if (cam === 'side') { c.fov = 34; c.up.copy(sideY); c.position.copy(hipsW).addScaledVector(sideZ, 4.6 * far).addScaledVector(fwd, 1.3).addScaledVector(sideY, 0.45); c.lookAt(hipsW.clone().addScaledVector(sideY, 0.05)); }
        // 3/4 front: ahead of her along travel and out on her facing side, a touch above the hips
        if (cam === 'q34') { c.fov = 34; c.up.set(0, 1, 0); c.position.copy(hipsW).addScaledVector(fwd, 3.2).addScaledVector(right, 3.2).add(new V(0, 0.55, 0)); c.lookAt(hipsW.clone().add(new V(0, 0.1, 0))); }
        if (cam === 'profile') { c.fov = 32; c.position.copy(p).addScaledVector(fwd, 4.6).addScaledVector(right, 0.9).add(new V(0, 1.1, 0)); c.lookAt(p.clone().add(new V(0, 0.8, 0))); }
        if (cam === 'back') { c.fov = 32; c.position.copy(p).addScaledVector(fwd, -4.2).addScaledVector(right, -1.2).add(new V(0, 1.9, 0)); c.lookAt(p.clone().add(new V(0, 0.8, 0))); }
        if (cam === 'face') {
          const head = f.vrm.humanoid.getNormalizedBoneNode('head'); const hw = new V(); head.getWorldPosition(hw);
          const hq = head.getWorldQuaternion(head.quaternion.clone()); const fd = new V(0, 0, f.v0 ? -1 : 1).applyQuaternion(hq); fd.y = Math.max(-0.2, Math.min(0.2, fd.y)); fd.normalize();
          c.fov = 22; c.position.copy(hw).addScaledVector(fd, 1.25).addScaledVector(right, 0.25).add(new V(0, 0.08, 0)); c.lookAt(hw.clone().add(new V(0, 0.02, 0)));
        }
        c.updateProjectionMatrix(); c.updateMatrixWorld();
        v.renderer.render(v.scene, c);
      } else if (cams.length > 1) {
        v.renderer.render(v.scene, v.rig.camera);
      }
      out[cam] = canvas.toDataURL('image/jpeg', 0.92);
    }
    if (cams.length > 1) v.renderer.render(v.scene, v.rig.camera);
    const s = ic.game.sim.state, st = v.rider.figureStats;
    // posture metrics in the rider-root frame (+X travel, +Y up, +Z her facing): torso pitch toward her front (F) and along travel (T),
    // hips yaw/roll relative to the root, knee offsets (+ = toward her front)
    const f0 = v.rider.figure; let pm = {};
    if (f0) {
      const Hn = (b) => f0.vrm.humanoid.getNormalizedBoneNode(b); const V3c = v.rider.root.position.constructor;
      const inv = v.rider.root.matrixWorld.clone().invert();
      const P = (b) => Hn(b).getWorldPosition(new V3c()).applyMatrix4(inv);
      const hp = P('hips'), nk = P('neck'), t = nk.clone().sub(hp);
      const rq = v.rider.root.getWorldQuaternion(Hn('hips').quaternion.clone()).invert().multiply(Hn('hips').getWorldQuaternion(Hn('hips').quaternion.clone()));
      const e = new (v.rider.root.rotation.constructor)().setFromQuaternion(rq, 'YXZ');
      const knee = (s) => { const u = P(s + 'UpperLeg'), l = P(s + 'LowerLeg'), ft = P(s + 'Foot'); const mid = u.clone().add(ft).multiplyScalar(0.5); return +(l.z - mid.z).toFixed(3); };
      const D = 180 / Math.PI;
      pm = { pF: +(Math.atan2(t.z, t.y) * D).toFixed(1), pT: +(Math.atan2(t.x, t.y) * D).toFixed(1), hy: +(e.y * D).toFixed(1), hx: +(e.x * D).toFixed(1), hz: +(e.z * D).toFixed(1), kL: knee('left'), kR: knee('right'), slope: +(s.angle ?? 0).toFixed(3) };
    }
    out.meta = { ...pm, tick: s.tick, x: +s.x.toFixed(2), mode: s.mode, air: s.air, flip: +s.flip.toFixed(2), speed: +s.speed.toFixed(1), state: st?.state, cpu: +(st?.cpuMs ?? 0).toFixed(3), ik: st?.ik.map((x) => +(x * 100).toFixed(2)), calls: v.renderer.info.render.calls, st: +(v.rider.figure?.stateTime ?? 0).toFixed(2), rt: +(v.rider.figure?.actions?.get('respawn')?.time ?? 0).toFixed(2), sm: s.mode };
    return out;
  };
});
fs.mkdirSync(outDir, { recursive: true });
const save = (name, data) => fs.writeFileSync(`${outDir}/${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
const meta = [];
let frame = 0;
const FROM = Number(process.env.FROM ?? 0); // skip (simulate without capture) to this frame
async function record(n, cams = (process.env.CAMS ?? 'chase,side').split(',').filter(Boolean)) {
  if (FROM && frame === 0) { await page.evaluate((k) => { for (let i = 0; i < k; i++) window.icarus.advance(4, undefined, 4); }, FROM); frame = FROM; }
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((cams) => { window.icarus.advance(4, undefined, 4); return window.__cap(cams); }, cams);
    for (const c of cams) save(`${c}-${String(frame).padStart(5, '0')}`, r[c]);
    meta.push({ f: frame, ...r.meta }); frame++;
    if (frame % 30 === 0) fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta)); // survive interruptions
  }
}
const until = (fn, max = 120 * 120) => page.evaluate(([src, max]) => { const pred = new Function('g', `return (${src})(g)`); window.icarus.advance(max, pred, 4); return window.icarus.game.sim.state.mode; }, [fn.toString(), max]);

if (scenario === 'probe') {
  await page.evaluate(() => window.icarus.advance(240, undefined, 4));
  const r = await page.evaluate(() => window.__cap(['chase', 'side', 'face']));
  for (const c of ['chase', 'side', 'face']) save(`probe-${look}-${c}`, r[c]);
  console.log(JSON.stringify(r.meta));
} else if (scenario === 'gallery') {
  // key poses held one at a time (review tooling freeze), side + face cameras
  const items = JSON.parse(process.env.ITEMS ?? 'null') ?? [
    ['idle', 0.0, 'calm'], ['idle', 1.3, 'calm'], ['cruise', 0.4, 'cruise'], ['tuck', 0.3, 'tuck'], ['push', 0.24, 'push'], ['push', 0.48, 'push'],
    ['pop', 0.0, 'air'], ['pop', 0.08, 'whee'], ['airUp', 0.3, 'air'], ['airDown', 0.3, 'air'], ['float', 0.22, 'whee'], ['grabL', 0.3, 'wink'], ['grabR', 0.3, 'smug'],
    ['flip', 0.4, 'focus'], ['prep', 0.2, 'focus'], ['grind', 0.2, 'grind'], ['wall', 0.3, 'wall'], ['skim', 0.1, 'skim'],
    ['landClean', 0.08, 'happy'], ['landClean', 0.22, 'happy'], ['landBig', 0.1, 'big'], ['landBig', 0.6, 'big'], ['landFlip', 0.42, 'victory'], ['landFlip', 0.85, 'victory'],
    ['landSketchy', 0.24, 'eek'], ['crash', 0.12, 'crash'], ['crashSit', 0.3, 'sheepish'], ['respawn', 0.42, 'calm'], ['respawn', 0.7, 'calm'],
    ['finish', 0.36, 'cheer'], ['finish', 1.0, 'victory'], ['fidgetHip', 1.0, 'calm'], ['fidgetHair', 0.85, 'calm'], ['fidgetStretch', 1.4, 'relief'], ['fidgetLook', 1.2, 'calm'],
  ];
  const cams = (process.env.CAMS ?? 'side,face').split(',');
  for (const [clip, t, mood] of items) {
    const r = await page.evaluate(([clip, t, mood, cams]) => {
      const f = window.icarus.game.view.rider.figure; f.debugFreeze = { clip, t }; f.debugMood(mood);
      window.icarus.advance(90, undefined, 3); return window.__cap(cams);
    }, [clip, t, mood, cams]);
    for (const c of cams) save(`${c}-${clip}-${t}`, r[c]);
  }
} else if (scenario === 'perf') {
  // character cost: avg/max figure CPU ms over 4 s of the lab run, and draw calls/triangles with the figure shown vs hidden
  const r = await page.evaluate(() => {
    const ic = window.icarus, v = ic.game.view; ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, styleGrabs: true });
    const cpu = []; for (let i = 0; i < 240; i++) { ic.advance(4, undefined, 4); cpu.push(v.rider.figureStats.cpuMs); }
    const fig = v.rider.figureObject; const measure = () => { v.renderer.info.autoReset = false; v.renderer.info.reset(); v.renderer.render(v.scene, v.rig.camera); const i = v.renderer.info.render; const o = { calls: i.calls, tris: i.triangles }; v.renderer.info.autoReset = true; return o; };
    const on = measure(); fig.visible = false; const off = measure(); fig.visible = true;
    cpu.sort((a, b) => a - b);
    return { avg: cpu.reduce((a, b) => a + b, 0) / cpu.length, p95: cpu[Math.floor(cpu.length * 0.95)], max: cpu[cpu.length - 1], callsWith: on.calls, callsWithout: off.calls, figCalls: on.calls - off.calls, figTris: on.tris - off.tris };
  });
  console.log('PERF', look, process.env.Q ?? 'auto', JSON.stringify(r));
} else if (scenario === 'idle') {
  // the opening start card: standing still -> idle + personality idles
  await record(Number(process.env.N ?? 330));
} else if (scenario === 'run') {
  // lab course with the dev autopilot: pushes, gaps, grabs, flips, rails, walls, landings, pots, pillars
  await page.evaluate(() => { const ic = window.icarus; ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleFlips: true, styleGrabs: true, flipAtFirstGap: true }); });
  await record(Number(process.env.N ?? 1500));
} else if (scenario === 'push') {
  // opening start: a full push stroke every second (no jumps) so the whole push cycle reads
  await page.evaluate(() => { const ic = window.icarus; ic.game.retry(); ic.autopilot({ minSpeed: 99, strength: 0.8, pushEvery: 120, jumpEarly: 999 }); });
  await record(Number(process.env.N ?? 150));
} else if (scenario === 'coast' || scenario === 'skimexit') {
  // coast: three pushes then no input for ~N frames. skimexit: pushes, jump, hold a down stroke in the air, land into a heel skim,
  // hold ~1.5 s, release, then coast. Actions go straight into the game's input queue (same path as touch/keys).
  await page.evaluate(() => { const g = window.icarus.game; g.retry(); window.__act = (a) => g.pending.push({ source: 'test', ...a }); });
  const plan = scenario === 'coast'
    ? { 5: [{ type: 'down', strokeId: 1, strength: 0.8, fresh: true }], 40: [{ type: 'down', strokeId: 2, strength: 0.8, fresh: true }], 75: [{ type: 'down', strokeId: 3, strength: 0.8, fresh: true }] }
    : { 5: [{ type: 'down', strokeId: 1, strength: 0.8, fresh: true }], 40: [{ type: 'down', strokeId: 2, strength: 0.8, fresh: true }], 75: [{ type: 'down', strokeId: 3, strength: 0.8, fresh: true }],
        110: [{ type: 'up', strokeId: 4 }], 118: [{ type: 'down', strokeId: 5, strength: 0.7, fresh: true }], 200: [{ type: 'release', dir: 'down', strokeId: 5 }] };
  const n = Number(process.env.N ?? 900);
  for (let i = 0; i < n; i++) {
    const acts = plan[frame];
    if (acts) await page.evaluate((acts) => { for (const a of acts) window.__act(a); }, acts);
    await record(1);
  }
} else if (scenario === 'crash') {
  // opening course: push to speed then ride into the first gap without jumping -> crash, retry -> respawn
  await page.evaluate(() => { const ic = window.icarus; ic.game.retry(); ic.autopilot({ minSpeed: 11, strength: 1, jumpEarly: 999 }); });
  // ride until the crash, hold ~2.5 s on the crash + sheepish recover, then retry -> checkpoint respawn
  let failed = 0, retried = false; const n = Number(process.env.N ?? 600);
  for (let i = 0; i < n; i++) {
    await record(1);
    if (meta[meta.length - 1].mode === 'failed') failed++;
    if (failed === 75 && !retried) { retried = true; await page.evaluate(() => { window.icarus.game.retry(); }); }
    if (failed >= 75 && i > n - 1) break;
    if (failed >= 75 && meta.length - meta.findIndex((m) => m.mode === 'failed') > 75 + 90) break;
  }
}
fs.writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta));
console.log(logs.filter((l) => !/vite|DevTools/.test(l)).slice(0, 20).join('\n'));
await browser.close();
