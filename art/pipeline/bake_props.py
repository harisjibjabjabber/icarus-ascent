"""Bake the small CC0 props the course places itself (collectible lanterns, high-line rails, choice beacons).

Same treatment as art/pipeline/bake_town.py: sample the source palette, keep its luminance, recolour into the
witch-town palette, then multiply by the painted detail array's high-pass (public/town/detail-array.webp, the
wood-trim and rock-trim layers) so the grain is the town's, not the kit's original colours. Palette-atlas UVs
are not the kit's surface UVs, so the planar unwrap written here is what the town shader samples.

Sources (CC0, see art/LICENSES.md):
  * Kenney Holiday Kit — lantern-hanging.glb (the floating collectible), cabin-fence.glb (the high-line rail)
  * Kenney Fantasy Town Kit — the `lantern` piece already in public/town/kit.bin (choice-point beacon)
"""
import json, os, struct
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'art', 'props', 'kenney')
OUT = os.path.join(ROOT, 'public', 'props')
DETAIL = os.path.join(ROOT, 'public', 'town', 'detail-array.webp')
KIT_JSON = os.path.join(ROOT, 'public', 'town', 'kit.json')
KIT_BIN = os.path.join(ROOT, 'public', 'town', 'kit.bin')

hexc = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255

def grad(lum, a, b, lo=0.18, hi=0.82):
    A, B = hexc(a), hexc(b)
    t = np.clip((lum - lo) / (hi - lo), 0, 1)[:, None]
    return A + (B - A) * t

def load_glb(path):
    b = open(path, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    off = 20 + ln
    bl = struct.unpack('<I', b[off:off + 4])[0]
    buf = b[off + 8:off + 8 + bl]
    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        n = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a['type']]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=o).astype(float)
        return arr.reshape(-1, n) if n > 1 else arr
    pr = j['meshes'][0]['primitives'][0]
    pos = acc(pr['attributes']['POSITION'])
    nor = acc(pr['attributes']['NORMAL']) if 'NORMAL' in pr['attributes'] else np.tile([0, 1, 0], (len(pos), 1))
    uv = acc(pr['attributes']['TEXCOORD_0'])
    idx = acc(pr['indices']).astype(np.int64)
    return pos, nor, uv, idx

def sample_colormap(uv):
    img = np.asarray(Image.open(os.path.join(SRC, 'colormap.png')).convert('RGB')).astype(float) / 255
    h, w = img.shape[:2]
    # Kenney's Unity glTF puts v = 0 at the top of the palette (verified against the known swatches).
    px = ((uv[:, 0] % 1) * (w - 1)).astype(int)
    py = ((uv[:, 1] % 1) * (h - 1)).astype(int)
    return img[py, px]

def grain_map():
    """Painted detail array: R is luminance. Return (rock layer, wood layer) high-pass, 512²."""
    im = np.asarray(Image.open(DETAIL).convert('RGB')).astype(float) / 255
    out = []
    for layer in (3, 2):  # rock trim, wood trim
        lum = im[layer * 512:(layer + 1) * 512, :, 0]
        blur = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(float) / 255
        hp = np.clip(lum / np.maximum(blur, 0.06), 0.5, 1.6)
        out.append(hp)
    return out

ROCK, WOOD = grain_map()

def paint(pos, hp, scale=2.4):
    """Planar sample of a high-pass. pos is in the piece's normalised frame."""
    u = np.mod(pos[:, 0] * scale, 1)
    v = np.mod(pos[:, 1] * scale, 1)
    h, w = hp.shape
    return hp[(v * (h - 1)).astype(int), (u * (w - 1)).astype(int)]

def pack(name, pos, nor, col, uv, tl, idx, glow_idx, blob, index):
    """col is rgb 0..1. tl is the detail-array layer, -1 = none. glow_idx indexes the flame triangles."""
    v = len(pos)
    def put(arr):
        while len(blob) % 4: blob.append(0)
        o = len(blob)
        blob.extend(arr.tobytes())
        return o
    entry = {'v': v, 'i': int(len(idx)), 'g': int(len(glow_idx))}
    entry['pos'] = put(pos.astype(np.float32))
    entry['nrm'] = put(nor.astype(np.float32))
    entry['col'] = put(np.clip(np.round(col * 255), 0, 255).astype(np.uint8))
    entry['uv'] = put(uv.astype(np.float32))
    entry['tl'] = put(tl.astype(np.float32))
    entry['idx'] = put(idx.astype(np.uint32))
    entry['gidx'] = put(glow_idx.astype(np.uint32)) if len(glow_idx) else 0
    index[name] = entry
    print(f'{name:10s} v={v:4d} tris={len(idx)//3:4d} flame={len(glow_idx)//3:3d}')

def lantern():
    pos, nor, uv, idx = load_glb(os.path.join(SRC, 'lantern-hanging.glb'))
    src = sample_colormap(uv)
    lum = src @ np.array([0.3, 0.59, 0.11])
    flame = (src[:, 0] > 0.75) & (src[:, 0] > src[:, 2] * 1.3)
    col = grad(lum, '#3c3348', '#c4b6c0')
    g = paint(pos - pos.mean(0), ROCK, 3.2)
    col *= (0.72 + 0.38 * g)[:, None]
    col[flame] = grad(lum, '#ffb15a', '#fff6d4')[flame]
    # centre it: the charm anchor is the middle of the lantern, hook up
    pos = pos - (pos.min(0) + pos.max(0)) / 2
    nor = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-6)
    # planar unwrap for the rock grain; flame does not sample (tl = -1)
    uv2 = np.stack([np.mod(pos[:, 0] * 3.2, 1), np.mod(pos[:, 1] * 3.2, 1)], 1)
    tl = np.where(flame, -1, 3).astype(float)
    faces = idx.reshape(-1, 3)
    is_flame = flame[faces].any(axis=1)
    return pos, nor, col, uv2, tl, faces[~is_flame].reshape(-1), faces[is_flame].reshape(-1)

def rail():
    pos, nor, uv, idx = load_glb(os.path.join(SRC, 'cabin-fence.glb'))
    src = sample_colormap(uv)
    lum = src @ np.array([0.3, 0.59, 0.11])
    # unit panel: X along the run, Y up, Z thickness centred
    pos[:, 0] = (pos[:, 0] - pos[:, 0].min()) / (pos[:, 0].max() - pos[:, 0].min())
    pos[:, 1] = (pos[:, 1] - pos[:, 1].min()) / (pos[:, 1].max() - pos[:, 1].min())
    pos[:, 2] = (pos[:, 2] - pos[:, 2].mean()) * 2.1
    gold = pos[:, 1] > 0.72
    col = grad(lum, '#2e2836', '#8a7e90')
    g = paint(pos, WOOD, 2.2)
    col *= (0.7 + 0.4 * g)[:, None]
    col[gold] = grad(lum, '#e09840', '#ffe3a8')[gold]
    nor = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-6)
    uv2 = np.stack([np.mod(pos[:, 0] * 2.2, 1), np.mod(pos[:, 1] * 2.2, 1)], 1)
    tl = np.where(gold, -1, 2).astype(float)
    return pos, nor, col, uv2, tl, idx, np.zeros(0, np.int64)

# Pixor library models have no UVs: one flat colour per named material, and named parts we can drop
# (washing-line posts, chimney smoke). Kenney pieces still come through the palette atlas.
PIX = os.path.join(ROOT, 'art', 'props', 'pixor')
# material name -> (dark, light, detail-array layer or -1, glow)
PIX_MAT = {
    'Rope': ('#8d7b66', '#e6d3b8', 2, False),
    'Light wood': ('#c4ae92', '#f3e6d2', 2, False),
    'Wood': ('#a89078', '#e4d2b8', 2, False),
    'Dark wood': ('#4a3c34', '#8d7360', 2, False),
    'White cloth': ('#efe6dc', '#fffaf4', -1, False),
    'Blue cloth': ('#3d6f8a', '#8ec4d4', -1, False),
    'Yellow cloth': ('#e2b15a', '#ffe3a4', -1, False),
    'Red cloth': ('#c4543a', '#f0a07a', -1, False),
    'Red roof': ('#a33b2c', '#e07a52', 1, False),
    'White paint': ('#efe8df', '#fffdf8', -1, False),
    'Yellow paint': ('#e2b15a', '#ffe3a4', -1, False),
    'Blue paint': ('#2f6d86', '#7eb6c8', -1, False),
    'Red paint': ('#c4543a', '#f0a07a', -1, False),
    'Green paint': ('#3f7a52', '#8fbf8a', -1, False),
    'Dark iron': ('#2c2832', '#6a6270', -1, False),
    'Iron': ('#3a3642', '#8a8494', -1, False),
    'Bronze': ('#8a6238', '#e0b070', -1, False),
    'Gold': ('#c48a3a', '#ffe0a0', -1, False),
    'Fire': ('#ffb15a', '#fff6d4', -1, True),
    'Fire core': ('#fff0c0', '#ffffff', -1, True),
    'Lamp light': ('#ffe6a8', '#fff8e4', -1, True),
    'Stone': ('#8a7c86', '#e4d8cc', 3, False),
    'Light stone': ('#b0a4a8', '#f0e6de', 3, False),
    'Clay': ('#a85a42', '#e09878', 3, False),
    'Brick': ('#8e4a3a', '#e09a78', 5, False),
    'Smoke': ('#d5d0d8', '#f7f4f8', -1, False),
    'Steam': ('#e4eef2', '#ffffff', -1, False),
    'Charcoal': ('#2a262e', '#5c5664', -1, False),
    'Straw': ('#c4a46a', '#f0ddb0', 2, False),
    'Leather': ('#6a4634', '#c49a74', -1, False),
    'Window': ('#4a6a80', '#9ec4d4', -1, False),
    'Shingle': ('#6a5348', '#b09080', 1, False),
    'Canvas': ('#e6d8c4', '#fff6ea', -1, False),
    'Whitewash': ('#e8e0d8', '#fffcf8', 0, False),
}

def glb_doc(path):
    b = open(path, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    off = 20 + ln
    bl = struct.unpack('<I', b[off:off + 4])[0]
    buf = b[off + 8:off + 8 + bl]
    return j, buf

def acc_of(j, buf, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    n = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride')
    if stride and stride != n * np.dtype(dt).itemsize:
        raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + n * np.dtype(dt).itemsize, offset=o)
        return np.stack([np.frombuffer(raw[k * stride:k * stride + n * np.dtype(dt).itemsize].tobytes(), dt).astype(float) for k in range(a['count'])])
    arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=o).astype(float)
    return arr.reshape(-1, n) if n > 1 else arr

def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def node_mat(n):
    if 'matrix' in n:
        return np.array(n['matrix']).reshape(4, 4).T
    M = np.eye(4)
    R = qmat(n.get('rotation', [0, 0, 0, 1]))
    M[:3, :3] = R @ np.diag(n.get('scale', [1, 1, 1]))
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M

def iter_parts(path):
    """World-space parts: (node name, material name, pos, nor, idx)."""
    j, buf = glb_doc(path)
    out = []
    def walk(ni, M):
        n = j['nodes'][ni]
        M = M @ node_mat(n)
        if 'mesh' in n:
            for pr in j['meshes'][n['mesh']]['primitives']:
                mi = pr.get('material')
                mname = j['materials'][mi].get('name', '') if mi is not None else ''
                pos = acc_of(j, buf, pr['attributes']['POSITION'])
                nor = acc_of(j, buf, pr['attributes']['NORMAL']) if 'NORMAL' in pr['attributes'] else np.tile([0., 1, 0], (len(pos), 1))
                idx = acc_of(j, buf, pr['indices']).astype(np.int64) if 'indices' in pr else np.arange(len(pos))
                p4 = np.c_[pos, np.ones(len(pos))] @ M.T
                nr = nor @ np.linalg.inv(M[:3, :3]).T
                nl = np.linalg.norm(nr, axis=1, keepdims=True)
                out.append((n.get('name', ''), mname, p4[:, :3], nr / np.maximum(nl, 1e-6), idx, pr))
        for c in n.get('children', []):
            walk(c, M)
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    return j, buf, out

def paint_flat(pos, lo, hi, layer, glow):
    # a little luminance from height so a flat material still has form
    y = pos[:, 1]
    lum = 0.35 + 0.4 * (y - y.min()) / max(1e-6, y.max() - y.min())
    col = grad(lum, lo, hi, 0.2, 0.85)
    if layer >= 0:
        hp = {0: None, 1: None, 2: WOOD, 3: ROCK, 5: ROCK}[layer] if layer in (2, 3, 5) else None
        # plaster/roof/brick share the rock or wood high-pass we already loaded
        if layer == 2: hp = WOOD
        elif layer in (3, 5, 1, 0): hp = ROCK
        if hp is not None:
            col *= (0.78 + 0.28 * paint(pos, hp, 2.6))[:, None]
    uv = np.stack([np.mod(pos[:, 0] * 2.4, 1), np.mod(pos[:, 1] * 2.4, 1)], 1)
    tl = np.full(len(pos), -1 if glow or layer < 0 else float(layer))
    return col, uv, tl

def pixor_parts(path, drop=(), keep=None, hang=False, foot=False, wall=False, scale=1.0):
    """Bake named Pixor parts. drop/keep match node names. hang: origin at the top centre (clothes).
    foot: keel/base on y=0, centred in x/z. wall: origin at the wall end of a bracket (min x)."""
    _j, _b, parts = iter_parts(path)
    P, N, C, U, T, I, G = [], [], [], [], [], [], []
    base = 0
    for name, mat, pos, nor, idx, _pr in parts:
        if name in drop: continue
        if keep is not None and name not in keep: continue
        spec = PIX_MAT.get(mat)
        if spec is None:
            print('  unknown material', mat, 'on', name)
            spec = ('#6a6270', '#c4b6c0', -1, False)
        lo, hi, layer, glow = spec
        pos = pos * scale
        col, uv, tl = paint_flat(pos, lo, hi, layer, glow)
        P.append(pos); N.append(nor); C.append(col); U.append(uv); T.append(tl)
        I.append(idx + base)
        if glow: G.append(idx + base)
        base += len(pos)
    if not P:
        raise SystemExit(f'no parts left in {path} drop={drop} keep={keep}')
    pos = np.concatenate(P); nor = np.concatenate(N); col = np.concatenate(C)
    uv = np.concatenate(U); tl = np.concatenate(T); idx = np.concatenate(I)
    glow = np.concatenate(G) if G else np.zeros(0, np.int64)
    if hang:
        top = pos[:, 1].max()
        mask = pos[:, 1] > top - 0.05
        pos -= pos[mask].mean(0)
    elif wall:
        pos[:, 0] -= pos[:, 0].min()
        pos[:, 1] -= (pos[:, 1].min() + pos[:, 1].max()) / 2
        pos[:, 2] -= pos[:, 2].mean()
    elif foot:
        pos[:, 1] -= pos[:, 1].min()
        pos[:, 0] -= pos[:, 0].mean()
        pos[:, 2] -= pos[:, 2].mean()
    faces = idx.reshape(-1, 3)
    if len(glow):
        gset = set(glow.tolist())
        is_g = np.array([all(int(v) in gset for v in f) for f in faces])
    else:
        is_g = np.zeros(len(faces), bool)
    return pos, nor, col, uv, tl, faces[~is_g].reshape(-1), faces[is_g].reshape(-1)

def kenney_piece(path, colormap, foot=True):
    """Kenney palette-atlas mesh, recoloured into the town palette (wood grain, cloth kept saturated)."""
    j, buf, parts = iter_parts(path)
    img = np.asarray(Image.open(colormap).convert('RGB')).astype(float) / 255
    h, w = img.shape[:2]
    P, N, C, U, T, I = [], [], [], [], [], []
    base = 0
    for name, _mat, pos, nor, idx, pr in parts:
        if 'TEXCOORD_0' not in pr['attributes']:
            src = np.tile([0.6, 0.55, 0.5], (len(pos), 1))
        else:
            uv = acc_of(j, buf, pr['attributes']['TEXCOORD_0'])
            # node transform does not move UVs; sample the atlas (v = 0 at the top, same as the lantern)
            px = ((uv[:, 0] % 1) * (w - 1)).astype(int)
            py = ((uv[:, 1] % 1) * (h - 1)).astype(int)
            src = img[py, px]
        lum = src @ np.array([0.3, 0.59, 0.11])
        red = (src[:, 0] > src[:, 1] * 1.28) & (src[:, 0] > src[:, 2] * 1.2) & (lum > 0.12)
        green = (src[:, 1] > src[:, 0] * 1.2) & (src[:, 1] > src[:, 2] * 1.15)
        blue = (src[:, 2] > src[:, 0] * 1.15) & (src[:, 2] > 0.25)
        gold = (src[:, 0] > 0.65) & (src[:, 1] > 0.45) & (src[:, 2] < src[:, 0] * 0.55)
        col = grad(lum, '#3a332c', '#cbb89a')
        g = paint(pos - pos.mean(0), WOOD, 2.2)
        col *= (0.72 + 0.36 * g)[:, None]
        col[red] = grad(lum, '#c4543a', '#f0a07a')[red]
        col[green] = grad(lum, '#3f7a52', '#9dcc96')[green]
        col[blue] = grad(lum, '#2f6d86', '#9ed0de')[blue]
        col[gold] = grad(lum, '#e09840', '#ffe3a8')[gold]
        uv2 = np.stack([np.mod(pos[:, 0] * 2.2, 1), np.mod(pos[:, 1] * 2.2, 1)], 1)
        tl = np.where(red | green | blue | gold, -1, 2).astype(float)
        P.append(pos); N.append(nor); C.append(col); U.append(uv2); T.append(tl); I.append(idx + base)
        base += len(pos)
    pos = np.concatenate(P); nor = np.concatenate(N); col = np.concatenate(C)
    uv = np.concatenate(U); tl = np.concatenate(T); idx = np.concatenate(I)
    if foot:
        pos[:, 1] -= pos[:, 1].min()
        pos[:, 0] -= pos[:, 0].mean()
        pos[:, 2] -= pos[:, 2].mean()
    return pos, nor, col, uv, tl, idx, np.zeros(0, np.int64)

def brush(piece, amt=0.09):
    """A second painted pass: soft brush variation and a little light from above. Hue stays."""
    pos, nor, col, uv, tl, idx, glow = piece
    n = np.sin(pos[:, 0] * 2.1 + 0.4) * np.cos(pos[:, 2] * 1.7) * np.sin(pos[:, 1] * 2.4 + 1.2)
    broad = np.sin(pos[:, 0] * 0.55 + pos[:, 1] * 0.35)
    k = (1 + amt * (0.65 * n + 0.35 * broad)) * (0.92 + 0.12 * np.clip(nor[:, 1], -1, 1))
    col = np.clip(col * k[:, None], 0, 1)
    return pos, nor, col, uv, tl, idx, glow

def activities(blob, index):
    def go(name, piece):
        pack(name, *piece, blob, index)
    # clothes hang from y=0 (the line); posts are dropped and re-hung by the course along its own spline
    W = os.path.join(PIX, 'pixor-library-washing-line.glb')
    for piece, node in (('cloth-sheet', 'Washing sheet'), ('cloth-shirt', 'Washing shirt'),
                        ('cloth-sock', 'Washing sock A'), ('cloth-towel', 'Washing towel')):
        go(piece, brush(pixor_parts(W, keep={node}, hang=True), 0.07))
    go('bracket', pixor_parts(os.path.join(PIX, 'pixor-library-sign-inn.glb'), keep={'Sign bracket'}, wall=True))
    go('boat-fish', brush(pixor_parts(os.path.join(PIX, 'pixor-library-fishing-boat.glb'), foot=True)))
    go('bollard', pixor_parts(os.path.join(PIX, 'pixor-library-pier-post.glb'), foot=True))
    go('balloon', pixor_parts(os.path.join(PIX, 'pixor-library-hot-air-balloon.glb'), foot=True))
    go('lamp-oil', pixor_parts(os.path.join(PIX, 'pixor-library-street-lamp-oil.glb'), foot=True))
    go('lamp-post', pixor_parts(os.path.join(PIX, 'pixor-library-lamp-post.glb'), foot=True))
    go('sign-inn', pixor_parts(os.path.join(PIX, 'pixor-library-sign-inn.glb'), drop={'Sign post'}, wall=True))
    go('sign-shop', pixor_parts(os.path.join(PIX, 'pixor-library-sign-shop.glb'), drop={'Sign post'}, wall=True))
    go('banner', pixor_parts(os.path.join(PIX, 'pixor-library-banner-street.glb'), drop={'Banner poles'}, hang=True))
    go('chimney', pixor_parts(os.path.join(PIX, 'pixor-library-chimney-pot.glb'), drop={'Chimney smoke A', 'Chimney smoke B', 'Chimney smoke C'}, foot=True))
    go('vent', pixor_parts(os.path.join(PIX, 'pixor-library-steam-vent.glb'), drop={'Steam'}, foot=True))
    go('pinwheel', pixor_parts(os.path.join(PIX, 'pixor-library-pinwheel.glb'), foot=True, scale=4))
    go('windmill', pixor_parts(os.path.join(PIX, 'pixor-library-windmill.glb'), foot=True))
    K = os.path.join(ROOT, 'art', 'props', 'kenney')
    go('boat-small', kenney_piece(os.path.join(K, 'pirate', 'boat-row-small.glb'), os.path.join(K, 'pirate', 'colormap.png')))
    go('boat-large', kenney_piece(os.path.join(K, 'pirate', 'boat-row-large.glb'), os.path.join(K, 'pirate', 'colormap.png')))
    go('crane', kenney_piece(os.path.join(K, 'pirate', 'mast-ropes.glb'), os.path.join(K, 'pirate', 'colormap.png')))
    go('pennant', kenney_piece(os.path.join(K, 'pirate', 'flag-pennant.glb'), os.path.join(K, 'pirate', 'colormap.png'), foot=False))
    go('pennant-dark', kenney_piece(os.path.join(K, 'pirate', 'flag-pirate-pennant.glb'), os.path.join(K, 'pirate', 'colormap.png'), foot=False))
    go('lights', kenney_piece(os.path.join(K, 'holiday', 'lights-colored.glb'), os.path.join(K, 'holiday', 'colormap.png'), foot=False))
    go('awning', kenney_piece(os.path.join(K, 'city', 'detail-awning.glb'), os.path.join(K, 'city', 'colormap.png')))
    go('awning-wide', kenney_piece(os.path.join(K, 'city', 'detail-awning-wide.glb'), os.path.join(K, 'city', 'colormap.png')))
    go('stall-red', kenney_piece(os.path.join(K, 'town', 'stall-red.glb'), os.path.join(K, 'town', 'colormap.png')))
    go('stall-green', kenney_piece(os.path.join(K, 'town', 'stall-green.glb'), os.path.join(K, 'town', 'colormap.png')))

def main():
    os.makedirs(OUT, exist_ok=True)
    blob = bytearray()
    index = {}
    pack('lantern', *lantern(), blob, index)
    pack('rail', *rail(), blob, index)
    pack('beacon', *beacon(), blob, index)
    activities(blob, index)
    open(os.path.join(OUT, 'props.bin'), 'wb').write(blob)
    json.dump({'version': 1, 'pieces': index}, open(os.path.join(OUT, 'props.json'), 'w'), separators=(',', ':'))
    print('props.bin', len(blob) // 1024, 'KiB')

def beacon():
    k = json.load(open(KIT_JSON))
    e = k['pieces']['lantern']
    raw = open(KIT_BIN, 'rb').read()
    pos = np.frombuffer(raw, dtype=np.float32, count=e['v'] * 3, offset=e['pos']).astype(float).reshape(-1, 3).copy()
    nor = np.frombuffer(raw, dtype=np.int8, count=e['v'] * 3, offset=e['nrm']).astype(float).reshape(-1, 3) / 127
    colb = np.frombuffer(raw, dtype=np.uint8, count=e['v'] * 4, offset=e['col']).astype(float).reshape(-1, 4)
    idx = np.frombuffer(raw, dtype=np.uint32, count=e['i'], offset=e['idx']).astype(np.int64).copy()
    lum = (colb[:, :3] / 255) @ np.array([0.3, 0.59, 0.11])
    pos[:, 0] -= pos[:, 0].mean()
    pos[:, 2] -= pos[:, 2].mean()
    ymax = max(pos[:, 1].max(), 1e-3)
    head = (pos[:, 1] > ymax * 0.62) | (lum > 0.82)
    stand = np.stack([pos[:, 0], pos[:, 1] / ymax, pos[:, 2]], 1)
    g = paint(stand, ROCK, 3.5)
    col = grad(lum, '#3a3344', '#d5ccd8')
    col *= (0.78 + 0.3 * g)[:, None]
    col[head] = grad(lum, '#ffb15c', '#fff3c9')[head]
    nor = nor / np.maximum(np.linalg.norm(nor, axis=1, keepdims=True), 1e-6)
    uv2 = np.stack([np.mod(stand[:, 0] * 3.5 + 0.5, 1), np.mod(stand[:, 1], 1)], 1)
    tl = np.where(head, -1, 3).astype(float)
    faces = idx.reshape(-1, 3)
    is_head = head[faces].all(axis=1)
    return pos, nor, col, uv2, tl, faces[~is_head].reshape(-1), faces[is_head].reshape(-1)

if __name__ == '__main__':
    main()
