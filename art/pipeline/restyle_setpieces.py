"""Restyle sourced set-piece atlases into the town palette and pack meshes for bake_props.py.

Grab3D atlases are flat colour islands. This keeps base colour only (normal, roughness and
metallic maps are dropped), repaints each island, adds low-frequency mottling and, on cloth,
a little of the Fabric019 canvas weave, then a light blur. Atlases are written as WebP
(1024, or 512 for the small garments).

    python3 art/pipeline/restyle_setpieces.py

Decimated meshes come from art/pipeline/decimate_setpieces.py. Laundry comes from
art/pipeline/laundry_sim.py. Both run under Blender (`pip install bpy` if it is not installed).
"""
import io
import json
import os
import struct

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOD = os.path.join(ROOT, 'art', 'props', 'grab3d', 'lod')
OUT = os.path.join(ROOT, 'art', 'pipeline', 'out')
PUB = os.path.join(ROOT, 'public', 'props')
FABRIC = os.path.join(ROOT, 'art', 'props', 'fabric', 'Fabric019_Color.jpg')
LUM_W = np.array([0.3, 0.59, 0.11])

CREAM = np.array([0xf7, 0xec, 0xd4]) / 255
TERRACOTTA = np.array([0xc9, 0x6a, 0x42]) / 255
TEAL = np.array([0x3f, 0x8f, 0x8a]) / 255
OCHRE = np.array([0xd9, 0xa4, 0x41]) / 255
SAFFRON = np.array([0xf6, 0xe3, 0xa0]) / 255
IRON = np.array([0x3b, 0x34, 0x40]) / 255
WOOD_LO = np.array([0x8a, 0x5a, 0x3a]) / 255
WOOD_HI = np.array([0xd9, 0xb4, 0x8a]) / 255
BRICK_LO = np.array([0xa2, 0x54, 0x3e]) / 255
BRICK_HI = np.array([0xe0, 0xa4, 0x8c]) / 255
ROSE = np.array([0xd9, 0x89, 0x8c]) / 255
ROPE = np.array([0x7a, 0x53, 0x40]) / 255


def glb(path):
    b = open(path, 'rb').read()
    off = 12
    js = buf = None
    while off < len(b):
        ln, typ = struct.unpack_from('<I4s', b, off)
        off += 8
        chunk = b[off:off + ln]
        off += ln
        if typ == b'JSON':
            js = json.loads(chunk)
        elif typ == b'BIN\x00':
            buf = chunk
    return js, buf


def accessor(j, buf, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=o).astype(np.float64)
    return arr.reshape(-1, n) if n > 1 else arr


def mat4(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    t = n.get('translation', [0, 0, 0])
    r = n.get('rotation', [0, 0, 0, 1])
    s = n.get('scale', [1, 1, 1])
    x, y, z, w = r
    m = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
        [0, 0, 0, 1],
    ], float)
    m[0, :3] *= s[0]
    m[1, :3] *= s[1]
    m[2, :3] *= s[2]
    m[:3, 3] = t
    return m


def worlds(j):
    nodes = j['nodes']
    child = set()
    for n in nodes:
        child.update(n.get('children', []))
    out = [None] * len(nodes)

    def walk(i, parent):
        w = parent @ mat4(nodes[i])
        out[i] = w
        for c in nodes[i].get('children', []):
            walk(c, w)

    eye = np.eye(4)
    for i in range(len(nodes)):
        if i not in child:
            walk(i, eye)
    return out


def image_of(j, buf, mat_index):
    mats = j.get('materials', [])
    if mat_index is None or mat_index >= len(mats):
        return None, np.array([1, 1, 1])
    pbr = mats[mat_index].get('pbrMetallicRoughness', {})
    factor = np.array(pbr.get('baseColorFactor', [1, 1, 1])[:3], float)
    tex = pbr.get('baseColorTexture')
    if not tex:
        return None, factor
    src = j['textures'][tex['index']].get('source')
    im = j['images'][src]
    if 'bufferView' not in im:
        return None, factor
    bv = j['bufferViews'][im['bufferView']]
    o = bv.get('byteOffset', 0)
    raw = buf[o:o + bv['byteLength']]
    img = np.asarray(Image.open(io.BytesIO(raw)).convert('RGB')).astype(np.float64) / 255
    return img * factor, factor


def meshes(path):
    """World-space primitives: pos, nor, uv, idx, basecolor image (or None)."""
    j, buf = glb(path)
    W = worlds(j)
    out = []
    for ni, node in enumerate(j['nodes']):
        if 'mesh' not in node:
            continue
        mesh = j['meshes'][node['mesh']]
        M = W[ni]
        N = np.linalg.inv(M[:3, :3]).T
        name = node.get('name') or mesh.get('name') or f'mesh{ni}'
        for pr in mesh['primitives']:
            pos = accessor(j, buf, pr['attributes']['POSITION'])
            hom = np.concatenate([pos, np.ones((len(pos), 1))], 1)
            pos = (hom @ M.T)[:, :3]
            if 'NORMAL' in pr['attributes']:
                nor = accessor(j, buf, pr['attributes']['NORMAL'])
                nor = nor @ N.T
            else:
                nor = np.tile([0, 1, 0], (len(pos), 1))
            nor /= np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-8)
            if 'TEXCOORD_0' in pr['attributes']:
                uv = accessor(j, buf, pr['attributes']['TEXCOORD_0'])[:, :2]
            else:
                uv = np.zeros((len(pos), 2))
            idx = accessor(j, buf, pr['indices']).astype(np.int64).reshape(-1)
            img, _ = image_of(j, buf, pr.get('material'))
            out.append({'name': name, 'pos': pos, 'nor': nor, 'uv': uv, 'idx': idx, 'img': img})
    return out


def sample(img, uv):
    if img is None:
        return np.tile([0.7, 0.6, 0.5], (len(uv), 1))
    h, w = img.shape[:2]
    x = np.mod(uv[:, 0], 1)
    y = np.mod(uv[:, 1], 1)
    px = np.clip((x * (w - 1)).astype(int), 0, w - 1)
    py = np.clip(((1 - y) * (h - 1)).astype(int), 0, h - 1)
    return img[py, px]


def lum_of(rgb):
    return rgb @ LUM_W


def sat_of(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    return (mx - mn) / np.maximum(mx, 1e-4)


def hue_of(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    d = np.maximum(mx - mn, 1e-6)
    h = np.zeros_like(mx)
    mr = mx == r
    mg = (mx == g) & ~mr
    mb = (mx == b) & ~mr & ~mg
    h[mr] = np.mod((g - b)[mr] / d[mr], 6)
    h[mg] = (b - r)[mg] / d[mg] + 2
    h[mb] = (r - g)[mb] / d[mb] + 4
    return h / 6


def paint_mask(img, mask, target):
    """Replace a class with the target colour, keeping the model's own shading."""
    if img is None or int(mask.sum()) < 8:
        return
    lum = lum_of(img)
    mean = float(lum[mask].mean())
    scale = np.clip(lum[mask] / max(mean, 1e-4), 0.75, 1.15)
    img[mask] = target * scale[..., None]


def wood_paint(img, mask):
    if int(mask.sum()) < 8:
        return
    lum = lum_of(img)
    t = np.clip((lum[mask] - 0.25) / 0.55, 0, 1)
    img[mask] = WOOD_LO + (WOOD_HI - WOOD_LO) * t[..., None]


def mottling(h, w, seed):
    rng = np.random.default_rng(seed)
    a = np.asarray(Image.fromarray((rng.random((24, 24)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float64) / 255
    b = np.asarray(Image.fromarray((rng.random((96, 96)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float64) / 255
    noise = (a * 0.62 + b * 0.38) - 0.5
    return 1 + np.clip(noise, -0.5, 0.5) * 0.14  # ±7% value


_weave = None


def weave_map(h, w):
    global _weave
    if _weave is None:
        im = Image.open(FABRIC).convert('L')
        _weave = np.asarray(im).astype(np.float64) / 255
    src = _weave
    tile = np.asarray(Image.fromarray((src * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float64) / 255
    tile /= max(tile.mean(), 1e-4)
    return 1 + (tile - 1) * 0.07


def finish(img, cloth_mask, seed, blur):
    h, w = img.shape[:2]
    mot = mottling(h, w, seed)
    img *= mot[..., None]
    if cloth_mask is not None and int(cloth_mask.sum()) > 8:
        wv = weave_map(h, w)
        img[cloth_mask] *= wv[cloth_mask][..., None]
    out = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), 'RGB')
    out = out.filter(ImageFilter.GaussianBlur(radius=blur))
    return np.asarray(out).astype(np.float64) / 255


def save_webp(img, path, size):
    im = Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), 'RGB')
    if max(im.size) != size:
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=82, method=4)
    return im.size


def awning_classes(img):
    """Coral stripe (r−g>0.18, sat>0.25), dark iron (and the navy arms), else cream."""
    lum = lum_of(img)
    sat = sat_of(img)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx = img.max(-1)
    coral = (r - g > 0.18) & (sat > 0.25)
    # The folding arms are a dark navy that sits just above a strict 0.35 cut, so they
    # join the iron class instead of being repainted as cream.
    iron = (mx < 0.35) | ((b > r + 0.02) & (b > g) & (mx < 0.55) & (sat > 0.08))
    iron &= ~coral
    cream = ~(coral | iron)
    return coral, iron, cream


def repaint_awning(img, stripe):
    coral, iron, cream = awning_classes(img)
    paint_mask(img, coral, stripe)
    paint_mask(img, iron, IRON)
    paint_mask(img, cream, CREAM)
    cloth = coral | cream
    return finish(img, cloth, seed=3, blur=0.6), cloth


def balloon_classes(img):
    """Collapse the rainbow bouquet to terracotta, cream, saffron and teal. Strings stay iron."""
    lum = lum_of(img)
    sat = sat_of(img)
    hue = hue_of(img)
    mx = img.max(-1)
    iron = (mx < 0.32) | ((sat < 0.12) & (lum < 0.28))
    cream = (sat < 0.16) & (lum >= 0.45) & ~iron
    saffron = (hue > 0.07) & (hue < 0.18) & (sat >= 0.16) & ~iron
    # pinks, reds and oranges are one terracotta; greens, blues and purples are one teal
    teal = (hue >= 0.18) & (hue < 0.85) & (sat >= 0.12) & ~iron & ~saffron
    terracotta = ~iron & ~cream & ~saffron & ~teal
    return terracotta, cream, saffron, teal, iron


def repaint_balloon(img):
    terracotta, cream, saffron, teal, iron = balloon_classes(img)
    paint_mask(img, terracotta, TERRACOTTA)
    paint_mask(img, cream, CREAM)
    paint_mask(img, saffron, SAFFRON)
    paint_mask(img, teal, TEAL)
    paint_mask(img, iron, IRON)
    cloth = terracotta | cream | saffron | teal
    return finish(img, cloth, seed=5, blur=0.6)


def solid_shells(pos, idx, col):
    """One palette colour per connected shell.

    Collapse-decimate stretches UVs across the atlas field, so a sampled map
    reads as torn paper. The shell's own majority colour stays a flat gore.
    """
    n = len(pos)
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            parent[rb] = ra

    for a, b, c in idx.reshape(-1, 3):
        union(a, b)
        union(b, c)
    roots = np.array([find(i) for i in range(n)])
    palette = np.stack([TERRACOTTA, CREAM, SAFFRON, TEAL, IRON])
    dist = np.linalg.norm(col[:, None, :] - palette[None, :, :], axis=2)
    snap = dist.argmin(1)
    out = col.copy()
    for r in np.unique(roots):
        sel = np.where(roots == r)[0]
        counts = np.bincount(snap[sel], minlength=len(palette))
        pick = int(counts.argmax())
        # A shell that only grazes the terracotta field should keep its gore colour.
        other = int(counts[1:].max()) if len(counts) > 1 else 0
        if pick == 0 and other >= max(2, 0.25 * len(sel)):
            pick = 1 + int(np.argmax(counts[1:]))
        out[sel] = palette[pick]
    return out


def repaint_boat(img):
    lum = lum_of(img)
    sat = sat_of(img)
    hue = hue_of(img)
    mx = img.max(-1)
    iron = mx < 0.28
    teal = (hue > 0.25) & (hue < 0.6) & (sat > 0.15) & ~iron
    cream = (sat < 0.14) & (lum > 0.62) & ~iron
    wood = ~(iron | teal | cream)
    wood_paint(img, wood)
    paint_mask(img, teal, TEAL * 0.85 + CREAM * 0.15)
    paint_mask(img, cream, CREAM)
    paint_mask(img, iron, IRON)
    return finish(img, None, seed=8, blur=0.6)


def repaint_chimney(img):
    lum = lum_of(img)
    sat = sat_of(img)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    mx = img.max(-1)
    iron = mx < 0.28
    stone = (lum > 0.72) & (sat < 0.22) & ~iron
    brick = ~iron & ~stone & (r > g) & (g > b * 0.9)
    other = ~(iron | stone | brick)
    # Brick shading stays in the vertex colour; the town's brick layer supplies the mortar.
    t = np.clip((lum - 0.35) / 0.4, 0, 1)
    img[brick] = BRICK_LO + (BRICK_HI - BRICK_LO) * t[brick][..., None]
    paint_mask(img, stone, CREAM)
    paint_mask(img, iron, IRON)
    wood_paint(img, other)
    return finish(img, None, seed=4, blur=0.6), brick


def repaint_wood_iron(img):
    lum = lum_of(img)
    sat = sat_of(img)
    mx = img.max(-1)
    iron = (mx < 0.34) & (sat < 0.18)
    cream = (sat < 0.12) & (lum > 0.7)
    wood = ~(iron | cream)
    wood_paint(img, wood)
    paint_mask(img, iron, IRON)
    paint_mask(img, cream, CREAM)
    return finish(img, None, seed=6, blur=0.6), wood, iron


def repaint_stall(img):
    lum = lum_of(img)
    sat = sat_of(img)
    hue = hue_of(img)
    mx = img.max(-1)
    iron = mx < 0.28
    cream = (sat < 0.14) & (lum > 0.72) & ~iron
    green = (hue > 0.18) & (hue < 0.5) & (sat > 0.12) & ~iron
    red = ((hue < 0.04) | (hue > 0.94)) & (sat > 0.18) & ~iron
    ochre = (hue >= 0.06) & (hue < 0.16) & (sat > 0.2) & (lum > 0.45) & ~iron
    wood = ~(iron | cream | green | red | ochre)
    wood_paint(img, wood)
    paint_mask(img, cream, CREAM)
    paint_mask(img, green, np.array([0x6a, 0x8f, 0x62]) / 255)
    paint_mask(img, red, TERRACOTTA)
    paint_mask(img, ochre, OCHRE)
    paint_mask(img, iron, IRON)
    return finish(img, cream, seed=9, blur=0.6)


def repaint_envelope(img):
    """Hot-air envelope: two or three gore colours, basket in the wood gradient, ropes iron."""
    lum = lum_of(img)
    sat = sat_of(img)
    hue = hue_of(img)
    mx = img.max(-1)
    iron = (mx < 0.22) | ((sat < 0.1) & (lum < 0.2))
    wood = (hue > 0.03) & (hue < 0.12) & (sat > 0.18) & (lum < 0.62) & ~iron
    saffron = (hue >= 0.07) & (hue < 0.16) & (lum >= 0.5) & ~iron & ~wood
    cream = (sat < 0.16) & (lum >= 0.55) & ~iron
    teal = (hue >= 0.25) & (hue < 0.7) & (sat > 0.1) & ~iron
    terra = ~(iron | wood | saffron | cream | teal)
    paint_mask(img, terra, TERRACOTTA)
    paint_mask(img, saffron, SAFFRON)
    paint_mask(img, cream, CREAM)
    paint_mask(img, teal, TEAL)
    wood_paint(img, wood)
    paint_mask(img, iron, IRON)
    cloth = terra | saffron | cream | teal
    return finish(img, cloth, seed=11, blur=0.6)


def concat(parts, cols, tls):
    pos, nor, uv, tl, idx = [], [], [], [], []
    base = 0
    for part, col, layer in zip(parts, cols, tls):
        pos.append(part['pos'])
        nor.append(part['nor'])
        uv.append(part['uv'])
        tl.append(np.full(len(part['pos']), layer, np.float64))
        idx.append(part['idx'] + base)
        base += len(part['pos'])
    return (np.concatenate(pos), np.concatenate(nor), np.concatenate(cols),
            np.concatenate(uv), np.concatenate(tl), np.concatenate(idx))


def write_piece(name, pos, nor, col, uv, tl, idx, manifest, webp_name=None, img=None, size=1024):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.npz')
    np.savez(path, pos=pos.astype(np.float32), nor=nor.astype(np.float32),
             col=np.clip(col, 0, 1).astype(np.float32), uv=uv.astype(np.float32),
             tl=tl.astype(np.float32), idx=idx.astype(np.int64))
    entry = {'npz': os.path.relpath(path, ROOT)}
    if webp_name and img is not None:
        rel = webp_name
        save_webp(img, os.path.join(PUB, rel), size)
        entry['map'] = rel
    manifest[name] = entry
    print(f'{name:18} v={len(pos):5d} tris={len(idx)//3:5d} map={entry.get("map", "-")}')


def piece_from_image(parts, img, layer_for=None):
    cols, tls = [], []
    for part in parts:
        col = sample(img, part['uv'])
        if layer_for is None:
            layer = -1
        else:
            layer = layer_for(col)
        cols.append(col)
        tls.append(np.full(len(col), layer))
    # tls as arrays already; concat expects a scalar layer. Do it here.
    pos, nor, uv, idx = [], [], [], []
    tl = []
    col_all = []
    base = 0
    for part, col, layer in zip(parts, cols, tls):
        pos.append(part['pos']); nor.append(part['nor']); uv.append(part['uv'])
        col_all.append(col); tl.append(layer)
        idx.append(part['idx'] + base); base += len(part['pos'])
    return (np.concatenate(pos), np.concatenate(nor), np.concatenate(col_all),
            np.concatenate(uv), np.concatenate(tl), np.concatenate(idx))


def one_image(parts):
    """Primitives share an atlas. Return the first image that exists."""
    for p in parts:
        if p['img'] is not None:
            return p['img'].copy()
    return None


def do_awning(manifest):
    parts = meshes(os.path.join(LOD, 'awning.glb'))
    base = one_image(parts)
    if base is None:
        raise SystemExit('awning has no base colour')
    variants = [('set-awning', TERRACOTTA), ('set-awning-teal', TEAL), ('set-awning-ochre', OCHRE)]
    for name, stripe in variants:
        img, _ = repaint_awning(base.copy(), stripe)
        pos, nor, col, uv, tl, idx = piece_from_image(parts, img)
        write_piece(name, pos, nor, col, uv, tl, idx, manifest, name + '.webp', img, 1024)


def do_simple(manifest, filename, name, repaint, size, webp=True, mask_layer=None):
    """Repaint every primitive from its own atlas. A map is written only when they share one."""
    parts = meshes(os.path.join(LOD, filename))
    cache = {}
    painted_for_map = None
    cols, tls = [], []
    for p in parts:
        key = id(p['img']) if p['img'] is not None else 0
        if key not in cache:
            if p['img'] is None:
                cache[key] = (None, None)
            else:
                painted = repaint(p['img'].copy())
                mask = None
                if isinstance(painted, tuple):
                    painted, mask, *_ = painted
                cache[key] = (painted, mask)
        painted, mask = cache[key]
        col = sample(painted, p['uv']) if painted is not None else np.tile(CREAM, (len(p['pos']), 1))
        if mask is not None and mask_layer is not None:
            flag = np.zeros(mask.shape[:2] + (3,))
            flag[mask] = 1
            layer = np.where(sample(flag, p['uv'])[:, 0] > 0.5, float(mask_layer), -1.0)
        else:
            layer = np.full(len(p['pos']), -1.0)
        cols.append(col)
        tls.append(layer)
        painted_for_map = painted
    shared = len({id(p['img']) for p in parts if p['img'] is not None}) == 1
    pos, nor, uv, idx, tl, col = [], [], [], [], [], []
    base = 0
    for p, c, layer in zip(parts, cols, tls):
        pos.append(p['pos']); nor.append(p['nor']); uv.append(p['uv']); col.append(c); tl.append(layer)
        idx.append(p['idx'] + base); base += len(p['pos'])
    pos = np.concatenate(pos); nor = np.concatenate(nor); uv = np.concatenate(uv)
    col = np.concatenate(col); tl = np.concatenate(tl); idx = np.concatenate(idx)
    if mask_layer in (2, 5):
        # Town wood / brick layers tile in tuv, so those verts get a planar unwrap, not the atlas.
        scale = 1.7 if mask_layer == 5 else 0.55
        planar = np.stack([np.mod(pos[:, 0] * scale, 1), np.mod(pos[:, 1] * scale, 1)], 1)
        take = tl > 0
        uv = np.where(take[:, None], planar, uv)
    # The bouquet's atlas islands don't survive the decimate. Flat shells do.
    if name == 'set-balloon':
        col = solid_shells(pos, idx, col)
        webp = False
    use_map = webp and shared and painted_for_map is not None
    write_piece(name, pos, nor, col, uv, tl, idx, manifest,
                (name + '.webp') if use_map else None,
                painted_for_map if use_map else None, size)


def garment_texture(kind, size=512):
    """Painted cloth: flat colour, stripes or gingham, hem darkening, mottling, weave."""
    u = np.linspace(0, 1, size)[None, :]
    v = np.linspace(0, 1, size)[:, None]  # 0 at the hem (image bottom after the uv flip below)
    img = np.zeros((size, size, 3))
    if kind == 'sheet':
        stripe = np.mod(np.floor(u * 9), 2) == 0
        img[:] = np.where(stripe[..., None], CREAM, TERRACOTTA)
    elif kind == 'shirt':
        img[:] = CREAM
        img[int(size * 0.92):] = TERRACOTTA  # hem band, image bottom
    elif kind == 'towel':
        stripe = np.mod(np.floor(u * 7), 2) == 0
        img[:] = np.where(stripe[..., None], OCHRE, CREAM)
    elif kind == 'dress':
        cell = (np.floor(u * 10) + np.floor(v * 12)) % 2 == 0
        img[:] = np.where(cell[..., None], ROSE, CREAM)
    else:
        img[:] = TEAL
    # darker toward the hem (image bottom, high row index)
    hem = np.clip((np.arange(size) - size * 0.55) / (size * 0.45), 0, 1)[:, None]
    img *= (1 - 0.16 * hem)[..., None]
    img = finish(img, np.ones((size, size), bool), seed={'sheet': 1, 'shirt': 2, 'towel': 3, 'dress': 4, 'sock': 5}[kind], blur=0.8)
    # a wood swatch in the corner for the peg
    img[:40, :40] = WOOD_HI * 0.85
    return img


def do_laundry(manifest):
    path = os.path.join(LOD, 'laundry.glb')
    if not os.path.exists(path):
        print('laundry.glb missing — wash slot stays empty')
        return
    parts = meshes(path)
    # one node per garment; the peg shares the mesh
    by = {}
    for p in parts:
        by.setdefault(p['name'], []).append(p)
    kind_of = {
        'set-sock-b': 'sock', 'set-sheet': 'sheet', 'set-shirt': 'shirt',
        'set-towel': 'towel', 'set-dress': 'dress', 'set-sock': 'sock',
    }
    for name, group in by.items():
        kind = slot = None
        for key, k in sorted(kind_of.items(), key=lambda kv: -len(kv[0])):
            if key in name:
                kind = k
                slot = key
                break
        if kind is None:
            print('  skip laundry node', name)
            continue
        pos, nor, uv, tl, idx = [], [], [], [], []
        base = 0
        tex = garment_texture(kind)
        for g in group:
            p = g['pos']
            z = p[:, 2]
            y = p[:, 1]
            uu = (z - z.min()) / max(z.max() - z.min(), 1e-4)
            vv = (y - y.min()) / max(y.max() - y.min(), 1e-4)  # 0 hem, 1 peg
            guv = np.stack([uu, vv], 1)
            peg = (y > y.max() - 0.03) & (np.abs(p[:, 0]) < 0.05) & (np.abs(z - np.median(z)) < 0.08)
            guv[peg, 0] = 0.02
            guv[peg, 1] = 0.98
            pos.append(p); nor.append(g['nor']); uv.append(guv)
            tl.append(np.full(len(p), -1.0))
            idx.append(g['idx'] + base); base += len(p)
        pos = np.concatenate(pos); nor = np.concatenate(nor); uv = np.concatenate(uv)
        tl = np.concatenate(tl); idx = np.concatenate(idx)
        col = sample(tex, uv)
        # two socks share a texture name; the second is a posed copy with its own mesh
        map_name = slot + '.webp'
        write_piece(slot if name == slot or 'sock-b' not in name else 'set-sock-b',
                    pos, nor, col, uv, tl, idx, manifest, map_name, tex, 512)


def do_steam():
    """White-RGB puffs. Kenney's pack stores the shape in luminance with a solid alpha."""
    os.makedirs(os.path.join(PUB, 'steam'), exist_ok=True)
    src = os.path.join(ROOT, 'art', 'props', 'smoke')
    jobs = [
        ('smoke1.png', 'smoke1.webp', False),
        ('smoke3.png', 'smoke3.webp', False),
        ('smoke_04.png', 'smoke_04.webp', True),
        ('smoke_07.png', 'smoke_07.webp', True),
    ]
    for filename, out, from_lum in jobs:
        im = Image.open(os.path.join(src, filename)).convert('RGBA')
        arr = np.asarray(im).astype(np.float64)
        rgb = arr[..., :3]
        if from_lum:
            alpha = lum_of(rgb / 255) * 255
        else:
            alpha = arr[..., 3]
        canvas = np.zeros_like(arr)
        grey = np.clip(alpha, 0, 255)
        canvas[..., 0] = canvas[..., 1] = canvas[..., 2] = grey
        canvas[..., 3] = grey
        img = Image.fromarray(canvas.astype(np.uint8), 'RGBA').resize((256, 256), Image.Resampling.LANCZOS)
        img.save(os.path.join(PUB, 'steam', out), 'WEBP', quality=82, method=4)
        print('steam', out)


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PUB, exist_ok=True)
    manifest = {}
    do_awning(manifest)
    do_simple(manifest, 'balloon.glb', 'set-balloon', repaint_balloon, 1024)
    do_simple(manifest, 'rowboat.glb', 'set-boat', repaint_boat, 512, webp=False)
    do_simple(manifest, 'chimney.glb', 'chimney', repaint_chimney, 512, webp=False, mask_layer=5)
    do_simple(manifest, 'treadwheel-crane.glb', 'crane', repaint_wood_iron, 512, webp=False, mask_layer=2)
    do_simple(manifest, 'market-stall.glb', 'set-stall', repaint_stall, 1024)
    do_simple(manifest, 'hot-air-balloon.glb', 'set-hotair', repaint_envelope, 1024)
    do_laundry(manifest)
    do_steam()
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('manifest', len(manifest))


if __name__ == '__main__':
    main()
