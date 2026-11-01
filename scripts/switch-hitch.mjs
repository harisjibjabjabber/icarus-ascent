// Tier/resolution switch hitch probe (blank-screen investigation).
// Phone viewport 390x844 @ DPR 3 in headless Chromium (swiftshader: compare relative costs only). Drives the game
// deterministically, forces each kind of switch and measures: the switch call itself (CPU), the first frame after it
// (uploads, shader compiles, reallocation) and the steady frame cost at the new tier; GL allocations are tracked by
// hooking the WebGL2 allocation calls (textures + renderbuffers, live bytes) plus an estimate of the canvas buffers.
// Usage: URL=http://127.0.0.1:5371/ node scripts/switch-hitch.mjs [query]
import { chromium } from 'playwright-core';
const BASE = process.env.URL ?? 'http://127.0.0.1:5371/';
const q = process.argv[2] ?? '?seed=12345&look=witch';
const DPR = Number(process.env.DPR ?? 3);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.setDefaultTimeout(600000);
await page.addInitScript(() => {
  // ---- GL allocation tracker ----
  const P = WebGL2RenderingContext.prototype;
  const BPP = { 0x8058: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x1908: 4, 0x1907: 3, 0x8051: 4, 0x81a6: 4, 0x88f0: 4, 0x8cac: 4, 0x81a5: 2, 0x8cad: 8, 0x822b: 2, 0x8229: 1, 0x822d: 2, 0x822f: 4, 0x8230: 8, 0x1902: 4, 0x84f9: 4, 0x8d48: 1 };
  const bpp = (f) => BPP[f] ?? 4;
  const T = { tex: new Map(), rb: new Map(), uploaded: 0, uploads: 0 };
  window.__gl = T;
  let unit = 0; const bound = new Map(); let rb = null;
  const key = (t) => (t >= 0x8515 && t <= 0x851a ? 0x8513 : t);
  const cur = (t) => bound.get(unit + ':' + key(t));
  const setLevel = (t, id, bytes) => { const tx = cur(t); if (!tx) return; let m = T.tex.get(tx); if (!m) T.tex.set(tx, (m = new Map())); m.set(id, bytes); };
  const wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { try { fn.apply(this, a); } catch { /* best effort */ } return o.apply(this, a); }; };
  wrap('activeTexture', (u) => { unit = u - 0x84c0; });
  wrap('bindTexture', (t, tx) => { bound.set(unit + ':' + t, tx); });
  wrap('deleteTexture', (tx) => { T.tex.delete(tx); });
  wrap('bindRenderbuffer', (_t, r) => { rb = r; });
  wrap('deleteRenderbuffer', (r) => { T.rb.delete(r); });
  wrap('renderbufferStorage', (_t, f, w, h) => { if (rb) T.rb.set(rb, w * h * bpp(f)); });
  wrap('renderbufferStorageMultisample', (_t, s, f, w, h) => { if (rb) T.rb.set(rb, w * h * bpp(f) * Math.max(1, s)); });
  wrap('texStorage2D', (t, levels, f, w, h) => { let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(f); setLevel(t, 'S' + t, b); });
  wrap('texStorage3D', (t, levels, f, w, h, d) => { let b = 0; for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * d * bpp(f); setLevel(t, 'S', b); });
  const srcWH = (s) => [s?.naturalWidth ?? s?.videoWidth ?? s?.width ?? 0, s?.naturalHeight ?? s?.videoHeight ?? s?.height ?? 0];
  wrap('texImage2D', (t, level, f, ...r) => {
    let w, h; if (r.length >= 6) { w = r[0]; h = r[1]; } else [w, h] = srcWH(r[2]);
    const b = w * h * bpp(f); setLevel(t, `${t}:${level}`, b); T.uploaded += b; T.uploads++;
  });
  wrap('texImage3D', (t, level, f, w, h, d) => { const b = w * h * d * bpp(f); setLevel(t, `${level}`, b); T.uploaded += b; T.uploads++; });
  wrap('texSubImage2D', (t, level, x, y, ...r) => { let w, h; if (r.length >= 5) { w = r[0]; h = r[1]; } else [w, h] = srcWH(r[2]); T.uploaded += w * h * 4; T.uploads++; });
  wrap('texSubImage3D', (t, level, x, y, z, w, h, d) => { T.uploaded += w * h * d * 4; T.uploads++; });
  wrap('generateMipmap', () => {});
  // switch work, isolated from the (noisy, fill-bound) frame: while T.timing, each upload / allocation / shader call is
  // timed between two glFinish()es, so prior draws are excluded and the call's own GPU-process work is included
  T.timing = false; T.workMs = 0;
  const finish = P.finish;
  for (const name of ['texImage2D', 'texImage3D', 'texStorage2D', 'texStorage3D', 'texSubImage2D', 'texSubImage3D', 'generateMipmap', 'renderbufferStorage', 'renderbufferStorageMultisample', 'compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter']) {
    const o = P[name];
    P[name] = function (...a) {
      if (!T.timing) return o.apply(this, a);
      finish.call(this); const t = performance.now();
      const r = o.apply(this, a); finish.call(this); T.workMs += performance.now() - t; return r;
    };
  }
  T.live = () => { let tex = 0, rbs = 0; for (const m of T.tex.values()) for (const b of m.values()) tex += b; for (const b of T.rb.values()) rbs += b; return { tex, rb: rbs }; };
});
await page.goto(BASE + q, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.icarus?.game?.view?.rider?.figureStats, null, { timeout: 120000 });
await page.waitForTimeout(6000); // load veil + background shader prewarm
await page.evaluate(() => {
  const ic = window.icarus; ic.pause(true); let s = 7; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ic.game.retry(); ic.autopilot({ minSpeed: 13, strength: 1, optionalRail: true, styleGrabs: true });
  ic.advance(600, undefined, 60); // into the town
});

const MB = (b) => +(b / 1048576).toFixed(1);
const measure = (label, action) => page.evaluate(({ label, action }) => {
  const ic = window.icarus, v = ic.game.view, r = v.renderer, gl = r.getContext(), Q = v.quality;
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const frame = () => { const t = performance.now(); ic.advance(1, undefined, 1); sync(); return performance.now() - t; };
  const T = window.__gl;
  const steady = () => { const f = []; for (let i = 0; i < 3; i++) f.push(frame()); f.sort((a, b) => a - b); return f[1]; };
  const before = frame();
  // per-frame upload work without a switch (instance matrices etc.), subtracted below
  T.workMs = 0; T.timing = true; frame(); frame(); T.timing = false; const idleWork = T.workMs;
  const up0 = T.uploaded, n0 = T.uploads, p0 = r.info.programs?.length ?? 0;
  T.workMs = 0; T.timing = true;
  const t0 = performance.now();
  if (action === 'up') Q.step(1);
  else if (action === 'down') Q.step(-1);
  else if (action.startsWith('scale:')) { Q.scale = Number(action.slice(6)); v.applyResolution(); }
  sync();
  const call = performance.now() - t0;
  const f1 = frame(), f2 = frame();
  T.timing = false; const work = T.workMs - idleWork;
  const after = Math.min(f2, frame());
  const c = r.domElement, live = T.live();
  const ctx = r.getContextAttributes();
  // canvas buffers: back (MSAA when antialias) + depth/stencil, resolve + front; +1 copy with preserveDrawingBuffer
  const px = c.width * c.height, s = ctx.antialias ? 4 : 1;
  const canvas = px * 4 * s + (ctx.depth ? px * 4 * s : 0) + px * 4 * (ctx.antialias ? 2 : 1) + (ctx.preserveDrawingBuffer ? px * 4 : 0);
  return { label, tier: Q.level.name, pr: +r.getPixelRatio().toFixed(2), canvasPx: `${c.width}x${c.height}`, shadow: v.env.sun.shadow.mapSize.x,
    beforeMs: +before.toFixed(0), callMs: +call.toFixed(0), frame1Ms: +f1.toFixed(0), frame2Ms: +f2.toFixed(0), steadyMs: +after.toFixed(0),
    hitchMs: +(call + f1 - after).toFixed(0), workMs: +work.toFixed(0), uploadedMB: +((T.uploaded - up0) / 1048576).toFixed(1), uploads: T.uploads - n0, newPrograms: (r.info.programs?.length ?? 0) - p0,
    texMB: +(live.tex / 1048576).toFixed(1), rbMB: +(live.rb / 1048576).toFixed(1), canvasMB: +(canvas / 1048576).toFixed(1), totalMB: +((live.tex + live.rb + canvas) / 1048576).toFixed(1),
    aa: ctx.antialias, pdb: ctx.preserveDrawingBuffer };
}, { label, action });

const rows = [];
const TRIALS = Number(process.env.TRIALS ?? 2);
const run = async (label, action) => { const r = await measure(label, action); rows.push(r); console.log(JSON.stringify(r)); };
const hi = await page.evaluate(() => window.icarus.game.view.quality.level.pixelRatio);
const lo = +(hi - 0.25).toFixed(2);
const seq = [['promote high->ultra', 'up'], ['step ultra->high', 'down'], [`dyn-res ${hi}->${lo}`, `scale:${lo}`], [`dyn-res ${lo}->${hi}`, `scale:${hi}`], ['step high->medium', 'down'], ['raise medium->high', 'up']];
await run('baseline high', 'none');
for (let t = 0; t < TRIALS; t++) for (const [l, a] of seq) await run(l, a);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
console.log(`\nDPR ${DPR}, ${TRIALS} trial(s), medians. call = the switch itself (sync); GL work = uploads/allocations/shader`
  + ' compiles in the switch + next 2 frames, each fenced by glFinish (fill excluded); frame hitch = call + 1st frame - steady frame (noisy)');
console.log('| switch | tier | canvas px | shadow | call ms | GL work ms | frame hitch ms | steady frame ms | re-uploaded MB | new programs | GL tex MB | GL rb MB | canvas MB | total MB |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const label of ['baseline high', ...seq.map((x) => x[0])]) {
  const rs = rows.filter((r) => r.label === label), r = rs[rs.length - 1], m = (k) => med(rs.map((x) => x[k]));
  console.log(`| ${label} | ${r.tier} | ${r.canvasPx} | ${r.shadow} | ${m('callMs')} | ${m('workMs')} | ${m('hitchMs')} | ${m('steadyMs')} | ${m('uploadedMB')} | ${rs[0].newPrograms} | ${r.texMB} | ${r.rbMB} | ${r.canvasMB} | ${r.totalMB} |`);
}
console.log(`context: antialias ${rows[0].aa}, preserveDrawingBuffer ${rows[0].pdb}`);
void MB;
await browser.close();
