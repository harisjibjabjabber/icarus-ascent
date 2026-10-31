# White-background removal by border flood fill (no NC models), TripoSR-style framing on 50% grey.
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
near_white = (im.min(-1) > 0.93)
lab, _ = ndimage.label(near_white)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(border))
alpha = ndimage.gaussian_filter((~bg).astype(np.float32), 0.7)
ys, xs = np.where(alpha > 0.5); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
rgba = np.dstack([im, alpha])[y0:y1 + 1, x0:x1 + 1]
h, w = rgba.shape[:2]; s = int(max(h, w) / 0.85)
canvas = np.zeros((s, s, 4), np.float32); oy, ox = (s - h) // 2, (s - w) // 2
canvas[oy:oy + h, ox:ox + w] = rgba
rgb = canvas[..., :3] * canvas[..., 3:] + 0.5 * (1 - canvas[..., 3:])
Image.fromarray((rgb * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS).save(out)
Image.fromarray((canvas * 255).astype(np.uint8)).save(out.replace('.png', '-rgba.png'))
print('ok', out, s)
