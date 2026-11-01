/**
 * CC0 orb assets: trim/normalise mono SFX + Kenney particle atlas (white-alpha).
 * Run: node art/orb/process-assets.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const outSfx = path.join(root, '../../public/orbs/sfx');
const outTex = path.join(root, '../../public/orbs/tex');

fs.mkdirSync(outSfx, { recursive: true });
fs.mkdirSync(outTex, { recursive: true });

const ff = (cmd) => execSync(cmd, { stdio: 'inherit' });

const gemReverb = path.join(src, 'gem-gather-stereo-reverb.wav');

/** Gold: same CC0 gem reverb, short tail so rapid trails don't smear. */
for (const ext of ['ogg', 'mp3']) {
  const codec = ext === 'mp3' ? '-codec:a libmp3lame -q:a 4' : '';
  ff(`ffmpeg -y -hide_banner -loglevel error -i "${gemReverb}" -af "pan=mono|c0=0.5*c0+0.5*c1,alimiter=limit=0.95,atrim=0:0.35,asetpts=N/SR/TB" ${codec} "${path.join(outSfx, `gold.${ext}`)}"`);
}

for (const [name, inp, cap] of [
  ['rare', gemReverb, 0.55],
  ['trail', path.join(src, 'kenney_if/Audio/confirmation_003.ogg'), 0.4],
  ['trailPerfect', path.join(src, '24.wav'), 0.9],
]) {
  const af = `pan=mono|c0=0.5*c0+0.5*c1,alimiter=limit=0.95,atrim=0:${cap},asetpts=N/SR/TB`;
  ff(`ffmpeg -y -hide_banner -loglevel error -i "${inp}" -af "${af}" "${path.join(outSfx, `${name}.ogg`)}"`);
  ff(`ffmpeg -y -hide_banner -loglevel error -i "${inp}" -af "${af}" -codec:a libmp3lame -q:a 4 "${path.join(outSfx, `${name}.mp3`)}"`);
}

const sprites = [
  ['glow', 'circle_02.png'],
  ['star', 'star_09.png'],
  ['sparkle', 'star_02.png'],
  ['ring', 'circle_05.png'],
  ['burst', 'circle_03.png'],
  ['swirl', 'twirl_02.png'],
  ['flare', 'light_03.png'],
  ['streak', 'trace_01.png'],
];

const cell = 128;
const atlasW = cell * sprites.length;
const atlasH = cell;
const composites = [];

for (let i = 0; i < sprites.length; i++) {
  const [, file] = sprites[i];
  const p = path.join(src, 'kenney_particles/PNG', file);
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let px = 0; px < info.width * info.height; px++) {
    const r = data[px * 4], g = data[px * 4 + 1], b = data[px * 4 + 2], a = data[px * 4 + 3];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const alpha = Math.round(a * Math.max(lum, 0.08));
    out[px * 4] = 255;
    out[px * 4 + 1] = 255;
    out[px * 4 + 2] = 255;
    out[px * 4 + 3] = alpha;
  }
  const white = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  composites.push({ input: white, left: i * cell, top: 0 });
}

await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites)
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(path.join(outTex, 'particles.webp'));

console.log('Wrote', outSfx, 'and', path.join(outTex, 'particles.webp'));
