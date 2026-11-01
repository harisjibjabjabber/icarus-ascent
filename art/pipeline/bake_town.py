"""Bake the witch-town kit: premade CC0 pieces -> one compact binary (public/town/kit.bin + kit.json).
Retexture happens HERE (art/TOWN_ASSET_PLAN.md section 2), so the game needs no textures for the town:
  * every vertex gets a colour sampled from the source texture at its UV, pushed through a per-material palette
    (gradient map: keep the source luminance = modelled detail, recolour into our Mediterranean palette);
  * a role byte marks what the game may tint per house (plaster colour, shutter colour, roof variation).
Sources: Quaternius Medieval Village MegaKit (CC0), Kenney Fantasy Town Kit 2.0 (CC0), Kenney Pirate Kit 2.1 (CC0).
Roofs also get a *_lite LOD (Blender decimate, art/pipeline/decimate.py)."""
import json, struct, os, base64, io
import numpy as np
from PIL import Image
MVM = '/workspace/assets-dl/mvm/glTF/'
KT = '/workspace/assets-dl/kenney-town/Models/GLB format/'
KP = '/workspace/assets-dl/pirate/Models/GLB format/'
LITE = '/workspace/town-src/'
OUT = os.environ.get('OUT', 'public/town/')
FIXED, PLASTER, SHUTTER, ROOF, TRIM = 0, 1, 2, 3, 4
hexc = lambda h: np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
def grad(a, b, lo=0.1, hi=0.8):
    A, B = hexc(a), hexc(b)
    return lambda lum: A + (B - A) * np.clip((lum - lo) / (hi - lo), 0, 1)[:, None]
# material -> (role, colour function of (source rgb [n,3]))
LUM = lambda c: c @ np.array([0.3, 0.59, 0.11])
MAT = {
    'MI_Plaster': (PLASTER, lambda c: np.repeat((0.9 + 0.1 * np.clip(LUM(c) / max(1e-3, LUM(c).mean()), 0.6, 1.2))[:, None].clip(0, 1), 3, 1)),
    'MI_RoundTiles': (ROOF, lambda c: grad('#8e3f2a', '#f29a62', 0.15, 0.7)(LUM(c))),
    'MI_WoodTrim': (TRIM, lambda c: grad('#cdbba2', '#f1e6d2', 0.1, 0.6)(LUM(c))),
    'MI_WoodTrim_Wear': (SHUTTER, lambda c: grad('#a8a8a8', '#ffffff', 0.1, 0.6)(LUM(c))),
    'MI_Brick': (FIXED, lambda c: grad('#8f8088', '#ece2d2')(LUM(c))),
    'MI_RockTrim': (FIXED, lambda c: grad('#8a7c86', '#e8dccb')(LUM(c))),
    'MI_UnevenBrick': (FIXED, lambda c: grad('#8a7c86', '#eadfce')(LUM(c))),
    'MI_RedBrick': (FIXED, lambda c: grad('#8e4a3a', '#e09a78')(LUM(c))),
    'MI_MetalOrnaments': (FIXED, lambda c: np.repeat(hexc('#3b3440')[None], len(c), 0)),
    'MI_WindowGlass': (FIXED, lambda c: np.repeat(hexc('#4a6a80')[None], len(c), 0)),
}
SKIP = {'MI_Vine'}
# hi-fi pass: source material -> layer of the painted detail array (public/town/detail-array.webp, built by
# art/pipeline/build_detail_array.py); 255 = no texture (Kenney palette pieces, glass, metal). UVs are kept so the
# runtime can sample the kit's own (repainted) textures in place of the flat vertex colour.
LAYER = {'MI_Plaster': 0, 'MI_RoundTiles': 1, 'MI_WoodTrim': 2, 'MI_WoodTrim_Wear': 2, 'MI_RockTrim': 3, 'MI_UnevenBrick': 4, 'MI_Brick': 5, 'MI_RedBrick': 5}
def load(path):
    if path.endswith('.glb'):
        b = open(path, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l])
        off = 20 + l; bl = struct.unpack('<I', b[off:off + 4])[0]; bufs = [b[off + 8:off + 8 + bl]]
    else:
        j = json.load(open(path)); bufs = [open(os.path.join(os.path.dirname(path), x['uri']), 'rb').read() for x in j['buffers']]
    return j, bufs
def acc(j, bufs, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = {'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'SCALAR': 1}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    o = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride')
    buf = bufs[bv.get('buffer', 0)]
    if stride and stride != n * np.dtype(dt).itemsize:
        raw = np.frombuffer(buf, dtype=np.uint8, count=stride * (a['count'] - 1) + n * np.dtype(dt).itemsize, offset=o)
        return np.stack([np.frombuffer(raw[k * stride:k * stride + n * np.dtype(dt).itemsize].tobytes(), dt) for k in range(a['count'])])
    arr = np.frombuffer(buf, dtype=dt, count=a['count'] * n, offset=o)
    return arr.reshape(-1, n) if n > 1 else arr
_img = {}
def image(j, bufs, path, ti):
    src = j['textures'][ti]['source']; im = j['images'][src]
    key = (path, src)
    if key not in _img:
        if 'uri' in im: data = Image.open(os.path.join(os.path.dirname(path), im['uri']))
        else:
            bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
            data = Image.open(io.BytesIO(bufs[bv.get('buffer', 0)][o:o + bv['byteLength']]))
        _img[key] = np.array(data.convert('RGB')).astype(float) / 255
    return _img[key]
def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def node_mat(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    M = np.eye(4); R = qmat(n.get('rotation', [0, 0, 0, 1])); S = np.diag(n.get('scale', [1, 1, 1]))
    M[:3, :3] = R @ S; M[:3, 3] = n.get('translation', [0, 0, 0]); return M
def bake(path, mat_override=None):
    j, bufs = load(path)
    P, Nn, C, R, I, U, L = [], [], [], [], [], [], []; base = 0
    def walk(ni, M):
        nonlocal base
        n = j['nodes'][ni]; M = M @ node_mat(n)
        if 'mesh' in n:
            for pr in j['meshes'][n['mesh']]['primitives']:
                mi = pr.get('material'); mj = j['materials'][mi] if mi is not None else {}
                name = mj.get('name', '')
                if name in SKIP: continue
                pos = acc(j, bufs, pr['attributes']['POSITION']).astype(float)
                nor = acc(j, bufs, pr['attributes']['NORMAL']).astype(float) if 'NORMAL' in pr['attributes'] else np.zeros_like(pos)
                idx = acc(j, bufs, pr['indices']).astype(np.int64) if 'indices' in pr else np.arange(len(pos))
                pbr = mj.get('pbrMetallicRoughness', {})
                if 'baseColorTexture' in pbr and 'TEXCOORD_0' in pr['attributes']:
                    uv = acc(j, bufs, pr['attributes']['TEXCOORD_0']).astype(float); img = image(j, bufs, path, pbr['baseColorTexture']['index'])
                    h, w = img.shape[:2]
                    # average a small footprint around the UV (texel noise would alias into vertex colours)
                    cs = 0
                    for du, dv in ((0, 0), (0.004, 0), (0, 0.004), (-0.004, 0), (0, -0.004)):
                        px = (((uv[:, 0] + du) % 1) * w).astype(int).clip(0, w - 1); py = (((uv[:, 1] + dv) % 1) * h).astype(int).clip(0, h - 1)
                        cs = cs + img[py, px]
                    src = cs / 5
                else:
                    src = np.repeat(np.array(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3])[None], len(pos), 0)
                role, fn = MAT.get(name, (FIXED, None))
                if mat_override: role, fn = mat_override.get(name, (role, fn))
                col = fn(src) if fn else src
                p4 = np.c_[pos, np.ones(len(pos))] @ M.T; nr = nor @ np.linalg.inv(M[:3, :3]).T
                nl = np.linalg.norm(nr, axis=1, keepdims=True); nr = nr / np.where(nl > 0, nl, 1)
                uv0 = acc(j, bufs, pr['attributes']['TEXCOORD_0']).astype(float) if 'TEXCOORD_0' in pr['attributes'] else np.zeros((len(pos), 2))
                lay = LAYER.get(name, 255) if 'TEXCOORD_0' in pr['attributes'] else 255
                P.append(p4[:, :3]); Nn.append(nr); C.append(col); R.append(np.full(len(pos), role)); I.append(idx + base); base += len(pos)
                U.append(uv0); L.append(np.full(len(pos), lay))
        for c in n.get('children', []): walk(c, M)
    for r in j['scenes'][j.get('scene', 0)]['nodes']: walk(r, np.eye(4))
    return np.concatenate(P), np.concatenate(Nn), np.concatenate(C), np.concatenate(R), np.concatenate(I), np.concatenate(U), np.concatenate(L)
PIECES = {
    # Quaternius walls: 2 m wide, 3.12 m tall, exterior face +Z at z = 0.09
    'wall': MVM + 'Wall_Plaster_Straight.gltf', 'wallWin': MVM + 'Wall_Plaster_Window_Wide_Round.gltf',
    'wallWinThin': MVM + 'Wall_Plaster_Window_Thin_Round.gltf', 'wallWinFlat': MVM + 'Wall_Plaster_Window_Wide_Flat.gltf',
    'wallDoor': MVM + 'Wall_Plaster_Door_Round.gltf', 'wallBase': MVM + 'Wall_Plaster_Straight_Base.gltf',
    'wallArch': MVM + 'Wall_Arch.gltf', 'door': MVM + 'Door_1_Round.gltf',
    'shutWide': MVM + 'WindowShutters_Wide_Round_Open.gltf', 'shutThin': MVM + 'WindowShutters_Thin_Round_Open.gltf',
    'balcony': MVM + 'Balcony_Simple_Straight.gltf', 'chimney': MVM + 'Prop_Chimney2.gltf',
    'roof44': MVM + 'Roof_RoundTiles_4x4.gltf', 'roof46': MVM + 'Roof_RoundTiles_4x6.gltf', 'roof66': MVM + 'Roof_RoundTiles_6x6.gltf',
    'roof44lite': LITE + 'Roof_RoundTiles_4x4_lite.glb', 'roof46lite': LITE + 'Roof_RoundTiles_4x6_lite.glb', 'roof66lite': LITE + 'Roof_RoundTiles_6x6_lite.glb',
    'roofTower': MVM + 'Roof_Tower_RoundTiles.gltf', 'stairs': MVM + 'Stairs_Exterior_Straight.gltf',
    'fence': MVM + 'Prop_MetalFence_Simple.gltf',
    # Kenney Fantasy Town (palette atlas)
    'lantern': KT + 'lantern.glb', 'bannerRed': KT + 'banner-red.glb', 'bannerGreen': KT + 'banner-green.glb',
    'stallRed': KT + 'stall-red.glb', 'stallGreen': KT + 'stall-green.glb', 'cart': KT + 'cart.glb', 'fountain': KT + 'fountain-round.glb',
    'tree': KT + 'tree.glb', 'treeHigh': KT + 'tree-high.glb', 'treeRound': KT + 'tree-high-round.glb', 'hedge': KT + 'hedge.glb',
    'stairsStone': KT + 'stairs-stone.glb', 'poles': KT + 'poles.glb',
    # Kenney Pirate (harbour)
    'barrel': KP + 'barrel.glb', 'crate': KP + 'crate.glb', 'crateBottles': KP + 'crate-bottles.glb',
    'boatSmall': KP + 'boat-row-small.glb', 'boatLarge': KP + 'boat-row-large.glb', 'ship': KP + 'ship-small.glb',
    'dock': KP + 'structure-platform-dock.glb', 'dockSmall': KP + 'structure-platform-dock-small.glb', 'platform': KP + 'platform-planks.glb',
}
os.makedirs(OUT, exist_ok=True)
index = {}; blob = bytearray()
for name, path in PIECES.items():
    if not os.path.exists(path): print('MISSING', name, path); continue
    P, N, C, R, I, U, L = bake(path)
    v = len(P); entry = {'v': v, 'i': len(I), 'min': P.min(0).round(3).tolist(), 'max': P.max(0).round(3).tolist()}
    def put(arr):
        global blob
        while len(blob) % 4: blob.append(0)
        o = len(blob); blob += arr.tobytes(); return o
    entry['pos'] = put(P.astype(np.float32))
    entry['nrm'] = put(np.round(N * 127).clip(-127, 127).astype(np.int8))
    entry['col'] = put(np.c_[np.round(np.clip(C, 0, 1) * 255), R].astype(np.uint8))
    entry['idx'] = put(I.astype(np.uint32))
    entry['uv'] = put(U.astype(np.float32))
    entry['tl'] = put(L.astype(np.uint8))
    index[name] = entry
    print(f'{name:12s} v={v:6d} tris={len(I)//3:6d} size={np.round(P.max(0)-P.min(0),2).tolist()}')
open(OUT + 'kit.bin', 'wb').write(blob)
json.dump({'version': 2, 'pieces': index}, open(OUT + 'kit.json', 'w'), separators=(',', ':'))
print('kit.bin', len(blob) // 1024, 'KiB')
