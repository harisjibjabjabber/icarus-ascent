"""Collapse-decimate the sourced Grab3D set pieces and put each on the axes the course expects.

Run with Blender (the system `python3` does not ship bpy):

    blender --background --python art/pipeline/decimate_setpieces.py

If Blender is not installed: `pip install bpy` (or `apt install blender`) and run this file
with that interpreter instead. Decimate is Blender's collapse decimate, which keeps UVs.
"""
import math
import os
import sys

try:
    import bpy
    from mathutils import Matrix, Vector
except ImportError:
    sys.exit('Blender is required for this step. Install it, or: pip install bpy')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'art', 'props', 'grab3d')
DST = os.path.join(SRC, 'lod')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and len(o.data.polygons)]


def tri_count():
    return sum(len(o.data.polygons) for o in mesh_objects())


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def drop_name(substr):
    for o in list(bpy.context.scene.objects):
        if substr in o.name.lower():
            bpy.data.objects.remove(o, do_unlink=True)


def prep():
    """Unparent, apply transforms, join into one mesh so the decimate ratio is global."""
    meshes = mesh_objects()
    select_only(meshes)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        select_only(meshes)
        bpy.ops.object.join()
    o = mesh_objects()[0]
    select_only([o])
    return o


def foreach_co(o, fn):
    for v in o.data.vertices:
        v.co = fn(v.co)
    o.data.update()


def bounds(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def orient_foot(o):
    """Blender Z is up. Foot on z=0, centred in X/Y. glTF export then has Y up and the foot at y=0."""
    (x0, y0, z0), (x1, y1, z1) = bounds(o)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    foreach_co(o, lambda c, cx=cx, cy=cy, z0=z0: Vector((c.x - cx, c.y - cy, c.z - z0)))


def orient_balloon(o):
    """Knot (lowest point) at the origin, the bouquet toward +Z (glTF +Y)."""
    orient_foot(o)


def orient_awning(o):
    """Wall on Blender Y=0, street toward −Y (glTF +Z). Top bar at Z=0 so the valance hangs to −Y in glTF."""
    (x0, y0, z0), (x1, y1, z1) = bounds(o)

    def mean_z(side):
        band = []
        for v in o.data.vertices:
            near = v.co.y <= y0 + 0.05 if side < 0 else v.co.y >= y1 - 0.05
            if near:
                band.append(v.co.z)
        return sum(band) / len(band) if band else 0

    # The cassette is the higher end of the depth axis.
    if mean_z(-1) >= mean_z(1):
        wall = y0
        foreach_co(o, lambda c, wall=wall: Vector((c.x, wall - c.y, c.z)))
    else:
        wall = y1
        foreach_co(o, lambda c, wall=wall: Vector((c.x, c.y - wall, c.z)))
    (x0, y0, z0), (x1, y1, z1) = bounds(o)
    cx = (x0 + x1) / 2
    foreach_co(o, lambda c, cx=cx, z1=z1: Vector((c.x - cx, c.y, c.z - z1)))


def orient_boat(o):
    """Keel on Blender Z=0. Length along Y, bow toward −Y so glTF export puts the bow on +Z."""
    (x0, y0, z0), (x1, y1, z1) = bounds(o)

    def spread(side):
        xs = []
        for v in o.data.vertices:
            near = v.co.y <= y0 + 0.2 if side < 0 else v.co.y >= y1 - 0.2
            if near:
                xs.append(v.co.x)
        return (max(xs) - min(xs)) if len(xs) >= 3 else 1e9

    # The narrower end is the bow. glTF +Z = Blender −Y, so the bow wants to be the −Y end.
    if spread(-1) > spread(1):
        foreach_co(o, lambda c: Vector((c.x, -c.y, c.z)))
        (x0, y0, z0), (x1, y1, z1) = bounds(o)
    cx = (x0 + x1) / 2
    foreach_co(o, lambda c, cx=cx, z0=z0: Vector((c.x - cx, c.y, c.z - z0)))


def orient_crane(o):
    """Foot on z=0. Rotate the jib head onto −Y so it reaches toward glTF +Z (the street)."""
    (x0, y0, z0), (x1, y1, z1) = bounds(o)
    foreach_co(o, lambda c, z0=z0: Vector((c.x, c.y, c.z - z0)))
    base = [v.co for v in o.data.vertices if v.co.z < 0.4]
    if len(base) < 8:
        base = [v.co for v in o.data.vertices]
    bx = sum(v.x for v in base) / len(base)
    by = sum(v.y for v in base) / len(base)
    head = max(o.data.vertices, key=lambda v: v.co.z).co
    dx, dy = head.x - bx, head.y - by
    # Target direction is −Y. atan2(x, y) of (0, -1) is pi.
    ang = math.atan2(dx, dy)
    rot = math.pi - ang
    c, s = math.cos(rot), math.sin(rot)
    foreach_co(o, lambda p, c=c, s=s, bx=bx, by=by: Vector((
        c * (p.x - bx) - s * (p.y - by),
        s * (p.x - bx) + c * (p.y - by),
        p.z,
    )))


def decimate(o, target):
    cur = len(o.data.polygons)
    if cur <= target * 1.08:
        print(f'  keep {cur} tris (target {target})')
        return
    ratio = max(0.01, min(1.0, target / cur))
    select_only([o])
    m = o.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
    print(f'  {cur} -> {len(o.data.polygons)} tris (ratio {ratio:.3f})')


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_yup=True,
        export_apply=True, export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_image_format='JPEG',
    )


JOBS = [
    # (file, target tris or None, drop substring or None, orient)
    ('awning.glb', None, None, orient_awning),
    ('market-stall.glb', 4000, None, orient_foot),
    ('hot-air-balloon.glb', 3000, None, orient_foot),
    ('balloon.glb', 2000, None, orient_balloon),
    ('rowboat.glb', 2500, 'oar', orient_boat),
    ('chimney.glb', 1200, None, orient_foot),
    ('treadwheel-crane.glb', 4500, None, orient_crane),
]


def main():
    os.makedirs(DST, exist_ok=True)
    for name, target, drop, orient in JOBS:
        print('==', name)
        reset()
        src = os.path.join(SRC, name)
        bpy.ops.import_scene.gltf(filepath=src)
        if drop:
            drop_name(drop)
        o = prep()
        print(f'  imported {tri_count()} tris')
        if target:
            decimate(o, target)
        orient(o)
        lo, hi = bounds(o)
        print(f'  bounds {tuple(round(v, 3) for v in lo)} {tuple(round(v, 3) for v in hi)} tris={len(o.data.polygons)}')
        export(os.path.join(DST, name))


if __name__ == '__main__':
    main()
