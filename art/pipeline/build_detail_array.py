"""Hi-fi pass: pack the town's painted surface detail into one texture array (public/town/detail-array.webp).
Each 512x512 layer, stacked vertically: R = painted luminance detail, G/B = tangent-space normal x/y (z rebuilt in the
shader). The game multiplies the baked palette colour by the *high-pass* of R (texel / local mean), so the palette and
per-house tints stay exactly as art-directed while the tiles, plaster trowel strokes, wood grain and stones read.
Sources (all CC0 / ours): Quaternius Medieval Village MegaKit textures (the kit pieces' own UV layout), plus our painted
tiles in spikes/town-proof/assets/painted (normals derived from their luminance)."""
import os
import numpy as np
from PIL import Image, ImageFilter
MVM = '/workspace/assets-dl/mvm/glTF/'
if not os.path.exists(MVM): MVM = 'spikes/town-proof/assets/mvm/'
PAINT = 'spikes/town-proof/assets/painted/'
S = 512
LAYERS = [  # (albedo, normal or None)   index = layer id used by bake_town.py LAYER / town.ts TEX
    (MVM + 'T_Plaster_BaseColor.png', MVM + 'T_Plaster_Normal.png'),        # 0 plaster
    (MVM + 'T_RoundTiles_BaseColor.png', MVM + 'T_RoundTiles_Normal.png'),  # 1 roof tiles
    (MVM + 'T_WoodTrim_BaseColor.png', MVM + 'T_WoodTrim_Normal.png'),      # 2 wood trim sheet
    (MVM + 'T_RockTrim_BaseColor.png', MVM + 'T_RockTrim_Normal.png'),      # 3 rock trim sheet
    (MVM + 'T_UnevenBrick_BaseColor.png', MVM + 'T_UnevenBrick_Normal.png'),# 4 rubble stone (foundations, quay)
    (MVM + 'T_Brick_BaseColor.png', MVM + 'T_Brick_Normal.png'),            # 5 brick
    (PAINT + 'wood.jpg', None),                                             # 6 painted planks (doors, triplanar)
    (PAINT + 'cobbles.jpg', None),                                          # 7 painted cobbles (pavements, triplanar)
]
def lum(path):
    im = Image.open(path).convert('RGB').resize((S, S), Image.LANCZOS)
    a = np.asarray(im).astype(float) / 255
    l = a @ np.array([0.3, 0.59, 0.11])
    # painterly: soften photo-ish texel noise but keep shapes (median), then gently expand contrast around the mean
    l = np.asarray(Image.fromarray((l * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))).astype(float) / 255
    return l
def normal_from_height(h, k=3.0):
    hb = np.asarray(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))).astype(float) / 255
    dx = (np.roll(hb, -1, 1) - np.roll(hb, 1, 1)) * k
    dy = (np.roll(hb, -1, 0) - np.roll(hb, 1, 0)) * k
    n = np.dstack([-dx, dy, np.ones_like(hb)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n[..., 0], n[..., 1]
out = np.zeros((S * len(LAYERS), S, 3), np.uint8)
for i, (alb, nrm) in enumerate(LAYERS):
    l = lum(alb)
    if nrm:
        n = np.asarray(Image.open(nrm).convert('RGB').resize((S, S), Image.LANCZOS)).astype(float) / 255
        nx, ny = n[..., 0] * 2 - 1, n[..., 1] * 2 - 1
    else:
        nx, ny = normal_from_height(l)
    out[i * S:(i + 1) * S, :, 0] = (l * 255).round()
    out[i * S:(i + 1) * S, :, 1] = ((nx * 0.5 + 0.5) * 255).round().clip(0, 255)
    out[i * S:(i + 1) * S, :, 2] = ((ny * 0.5 + 0.5) * 255).round().clip(0, 255)
    print(i, os.path.basename(alb), 'mean lum', round(l.mean(), 3))
Image.fromarray(out).save('public/town/detail-array.webp', quality=92, method=6)
print('layers', len(LAYERS), os.path.getsize('public/town/detail-array.webp') // 1024, 'KiB')
