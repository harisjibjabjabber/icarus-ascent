"""Sharper painted backdrop (gfx2). The old panorama/far-town layers were 1280-px paintings upscaled to 4096.
Each 1536x864 tile of the 4096x2304 layer (3x3 sky/sea, 3x2 far town; 256/144 px overlap) was repainted at 1280x720
by the image tool with the tile as reference ("same composition, more detail"). Here every repainted tile is
  1. aligned to its source tile (OpenCV ECC, affine, on blurred greyscale) so nothing drifts,
  2. detail-transferred: result = repaint - blur(repaint) + blur(source), so tone/colour/composition stay exactly the
     source's (seamless across tiles) and only the fine brushwork comes from the repaint,
  3. feather-blended into the full layer. The far-town alpha is the original's (repaint only fills RGB).
Usage: python3 art/pipeline/repaint_backdrop.py <tiles_dir>   (writes public/town/sky-sea.webp, far-town.webp)
"""
import sys, os
import numpy as np, cv2
from PIL import Image
D = sys.argv[1] if len(sys.argv) > 1 else '/workspace/gfx-tiles'
TW, TH = 1536, 864
BLUR = float(os.environ.get('BLUR', 5))

def align(src, gen):
    a = cv2.GaussianBlur(cv2.cvtColor(src, cv2.COLOR_RGB2GRAY), (0, 0), 3).astype(np.float32)
    b = cv2.GaussianBlur(cv2.cvtColor(gen, cv2.COLOR_RGB2GRAY), (0, 0), 3).astype(np.float32)
    s = 0.25
    a2, b2 = cv2.resize(a, None, fx=s, fy=s), cv2.resize(b, None, fx=s, fy=s)
    W = np.eye(2, 3, dtype=np.float32)
    try:
        _, W = cv2.findTransformECC(a2, b2, W, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-5), None, 5)
    except cv2.error as e:
        print('  ECC failed, identity', e); return gen, 0.0
    W[:, 2] /= s
    out = cv2.warpAffine(gen, W, (gen.shape[1], gen.shape[0]), flags=cv2.INTER_CUBIC + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    return out, float(np.abs(W[:, 2]).max())

def transfer(src, gen):
    s = src.astype(np.float32); g = gen.astype(np.float32)
    k = (0, 0)
    return np.clip(g - cv2.GaussianBlur(g, k, BLUR) + cv2.GaussianBlur(s, k, BLUR), 0, 255)

def compose(base, name, rows, cols):
    H, W = base.shape[:2]
    acc = np.zeros((H, W, 3), np.float32); wsum = np.zeros((H, W, 1), np.float32)
    wy = np.minimum(1, np.minimum(np.arange(TH) + 1, TH - np.arange(TH)) / 144.0)
    wx = np.minimum(1, np.minimum(np.arange(TW) + 1, TW - np.arange(TW)) / 256.0)
    win = (wy[:, None] * wx[None, :])[..., None].astype(np.float32)
    for r, y in enumerate(rows):
        for c, x in enumerate(cols):
            f = f'{D}/gen_{name}_{r}{c}.jpg'
            if not os.path.exists(f): print('missing', f); continue
            src = base[y:y + TH, x:x + TW, :3]
            gen = cv2.resize(np.array(Image.open(f).convert('RGB')), (TW, TH), interpolation=cv2.INTER_LANCZOS4)
            gen, sh = align(src, gen)
            t = transfer(src, gen)
            acc[y:y + TH, x:x + TW] += t * win; wsum[y:y + TH, x:x + TW] += win
            print(f'{name} {r}{c} shift {sh:.1f}px')
    out = np.where(wsum > 1e-3, acc / np.maximum(wsum, 1e-3), base[..., :3].astype(np.float32))
    return out.astype(np.uint8)

sky = np.array(Image.open('public/town/sky-sea.webp').convert('RGB'))
o = compose(sky, 'sky', [0, 720, 1440], [0, 1280, 2560])
Image.fromarray(o).save('public/town/sky-sea.webp', quality=90, method=6)
far = np.array(Image.open('public/town/far-town.webp').convert('RGBA'))
# composite the reference on the same haze colour the tiles were cut from
a = far[..., 3:4].astype(np.float32) / 255
ref = (far[..., :3] * a + np.array([220, 232, 238]) * (1 - a)).astype(np.uint8)
o = compose(ref, 'town', [1045, 1440], [0, 1280, 2560])
# un-premultiply against the haze so semi-transparent edges keep their original colour
rgb = np.where(a > 0.02, (o.astype(np.float32) - np.array([220, 232, 238]) * (1 - a)) / np.maximum(a, 0.02), far[..., :3])
Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), far[..., 3]])).save('public/town/far-town.webp', quality=90, method=6)
print('sizes', os.path.getsize('public/town/sky-sea.webp') // 1024, os.path.getsize('public/town/far-town.webp') // 1024, 'KiB')
