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

def main():
    os.makedirs(OUT, exist_ok=True)
    blob = bytearray()
    index = {}
    pack('lantern', *lantern(), blob, index)
    pack('rail', *rail(), blob, index)
    # beacon's grain sample used the wrong helper above; recompute cleanly
    pack('beacon', *beacon(), blob, index)
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
