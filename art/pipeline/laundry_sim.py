"""Bake the washing-line garments with a light Blender cloth sim.

No sourced garment was good enough, so these are simulated, then frozen.
Silhouettes are quad grids (the remesh), pinned at the peg, and run under a
light wind plus turbulence for 70 frames. Thickness (4 mm) is applied after the
bake: a closed shell does not drape in Blender's background cloth solver.
The result is decimated to about 4k triangles in total.

    blender --background --python art/pipeline/laundry_sim.py

If Blender is not installed: `pip install bpy`, then run this file with it.
Axes on export (glTF Y-up): peg at the origin, cloth hangs down (−Y),
width along +Z so the chase camera (looking along the route) sees the face.
"""
import math
import os
import sys

try:
    import bpy
    import bmesh
    from mathutils import Vector
except ImportError:
    sys.exit('Blender is required for this step. Install it, or: pip install bpy')

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DST = os.path.join(ROOT, 'art', 'props', 'grab3d', 'lod', 'laundry.glb')

# Budgets sum to ~4k. Pegs are a few dozen triangles on top.
BUDGET = {
    'set-sheet': 1100,
    'set-shirt': 1000,
    'set-towel': 550,
    'set-dress': 1000,
    'set-sock': 180,
    'set-sock-b': 180,
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 70
    scene.gravity = (0, 0, -9.81)


def new_mesh(name, nu, nv, inside):
    """Quad grid in the Blender YZ plane (width Y, hang −Z). `inside(y, z)` keeps a vertex.

    Z = 0 is the peg line; the cloth hangs toward −Z. glTF Y-up turns that into −Y,
    and Blender +Y into glTF +Z (across the street, facing the chase camera).
    """
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    width_hint = 1.2
    # oversize the grid; `inside` cuts the silhouette
    ys = [((i / (nu - 1)) - 0.5) * width_hint for i in range(nu)]
    zs = [-(j / (nv - 1)) for j in range(nv)]
    keep = {}
    for j in range(nv):
        for i in range(nu):
            if inside(ys[i], zs[j]):
                keep[(i, j)] = bm.verts.new((0.0, ys[i], zs[j]))
    bm.verts.ensure_lookup_table()
    for j in range(nv - 1):
        for i in range(nu - 1):
            quad = [keep.get((i, j)), keep.get((i + 1, j)), keep.get((i + 1, j + 1)), keep.get((i, j + 1))]
            if all(quad):
                bm.faces.new(quad)
    loose = [v for v in bm.verts if not v.link_faces]
    for v in loose:
        bm.verts.remove(v)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def shirt(y, z):
    """Body plus sleeves. z in [-1, 0], y in [-0.6, 0.6] before scaling."""
    body = abs(y) < 0.16 + 0.05 * max(0, -z) and z > -0.72
    sleeve = abs(z + 0.16) < 0.12 and abs(y) < 0.46 and abs(y) > 0.10
    return body or sleeve


def sheet(y, z):
    return abs(y) < 0.55 and z > -1.05


def towel(y, z):
    return abs(y) < 0.26 and z > -0.82


def dress(y, z):
    bodice = abs(y) < 0.15 and -0.28 < z <= 0
    skirt = abs(y) < 0.16 + 0.22 * max(0, (-z - 0.22)) and -0.95 < z <= -0.18
    return bodice or skirt


def sock(y, z):
    """Tapered cuff-to-toe, denser than a two-column ribbon once scaled to 14 cm."""
    t = min(1.0, max(0.0, -z / 0.34))
    return abs(y) < 0.11 * (1 - 0.35 * t) and z > -0.34


def scale_to(obj, width, height):
    """Fit the current Y/Z extents to the garment size, peg line staying at z=0."""
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    w = max(ys) - min(ys)
    h = max(0.001, -min(zs))
    sx, sz = width / w, height / h
    for v in obj.data.vertices:
        v.co.y *= sx
        v.co.z *= sz
    obj.data.update()


def pin_top(obj):
    vg = obj.vertex_groups.get('pin') or obj.vertex_groups.new(name='pin')
    zs = [v.co.z for v in obj.data.vertices]
    top = max(zs)
    ids = [v.index for v in obj.data.vertices if v.co.z > top - 0.012]
    # sleeves of a shirt should not all be pinned; the shoulder line is enough,
    # and the grid's top row is the peg line for every garment.
    if not ids:
        ids = [max(obj.data.vertices, key=lambda v: v.co.z).index]
    vg.add(ids, 1.0, 'REPLACE')
    return vg


def peg(obj):
    """A small bevelled wooden peg at the pin, parented later by joining."""
    ys = [v.co.y for v in obj.data.vertices if v.co.z > -0.02]
    cz = 0.0
    cy = sum(ys) / len(ys) if ys else 0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.012, cy, cz + 0.012))
    peg_o = bpy.context.object
    peg_o.name = obj.name + '-peg'
    peg_o.scale = (0.012, 0.045, 0.016)
    bpy.ops.object.transform_apply(scale=True)
    b = peg_o.modifiers.new('b', 'BEVEL')
    b.width = 0.002
    b.segments = 2
    bpy.context.view_layer.objects.active = peg_o
    bpy.ops.object.modifier_apply(modifier='b')
    return peg_o


def clothify(obj):
    # Sim the open surface. A 4 mm closed shell does not drape under Blender's
    # cloth solver in background mode, so the thickness is applied after the bake.
    pin_top(obj)
    mod = obj.modifiers.new('cloth', 'CLOTH')
    s = mod.settings
    # Silk-weight cloth. Cotton stiffness plus a downward wind left the
    # sheets at the rest pose; these values billow and then settle.
    s.quality = 6
    s.mass = 0.18
    s.air_damping = 2.5
    s.tension_stiffness = 6
    s.compression_stiffness = 6
    s.shear_stiffness = 5
    s.bending_stiffness = 0.08
    s.tension_damping = 6
    s.compression_damping = 6
    s.shear_damping = 4
    s.bending_damping = 0.5
    s.effector_weights.wind = 1
    s.effector_weights.turbulence = 1
    # Blender 4 pins with the vertex group alone (weight 1 = held at the peg).
    s.vertex_group_mass = 'pin'
    if hasattr(s, 'pin_stiffness'):
        s.pin_stiffness = 1
    vg = obj.vertex_groups['pin']
    pinned = sum(
        1 for v in obj.data.vertices
        if any(g.group == vg.index and g.weight > 0.5 for g in v.groups)
    )
    print(f'  {obj.name} verts={len(obj.data.vertices)} faces={len(obj.data.polygons)} pinned={pinned}')
    return mod


def add_wind():
    """Wind blows along the empty's local −Z. Aim that at +X, across the sheet."""
    bpy.ops.object.effector_add(type='WIND', location=(0.0, 0.0, -0.4))
    wind = bpy.context.object
    wind.rotation_euler = (0.22, -math.pi / 2, 0.0)
    wind.field.strength = 180
    wind.field.noise = 0.35
    wind.field.flow = 0.25
    wind.field.use_max_distance = False
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, -0.45))
    turb = bpy.context.object
    turb.field.strength = 12
    turb.field.size = 0.45
    turb.field.flow = 0.3
    turb.field.use_max_distance = False
    bpy.context.view_layer.update()
    direction = wind.matrix_world.to_3x3() @ Vector((0, 0, -1))
    print('wind dir', tuple(round(c, 3) for c in direction))


def simulate(garments):
    """frame_set does not step the cloth cache in background mode. Bake it."""
    scene = bpy.context.scene
    scene.frame_set(1)
    for obj in garments:
        mod = obj.modifiers.get('cloth')
        if mod is None:
            continue
        mod.point_cache.frame_start = scene.frame_start
        mod.point_cache.frame_end = scene.frame_end
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        with bpy.context.temp_override(active_object=obj, object=obj, point_cache=mod.point_cache):
            result = bpy.ops.ptcache.bake(bake=True)
        print(obj.name, 'bake', result)
    scene.frame_set(scene.frame_end)


def apply_cloth(obj):
    """modifier_apply ignores a background cloth cache. Copy the evaluated mesh instead."""
    bpy.context.scene.frame_set(bpy.context.scene.frame_end)
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    baked = ev.to_mesh().copy()
    ev.to_mesh_clear()
    xs = [v.co.x for v in baked.vertices]
    ys = [v.co.y for v in baked.vertices]
    zs = [v.co.z for v in baked.vertices]
    print(
        f'  {obj.name} evaluated'
        f' x {min(xs):+.3f}..{max(xs):+.3f}'
        f' y {min(ys):+.3f}..{max(ys):+.3f}'
        f' z {min(zs):+.3f}..{max(zs):+.3f}'
    )
    for mod in list(obj.modifiers):
        if mod.type == 'CLOTH':
            obj.modifiers.remove(mod)
    old = obj.data
    obj.data = baked
    obj.data.name = obj.name
    if old.users == 0:
        bpy.data.meshes.remove(old)


def thicken(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    solid = obj.modifiers.new('solid', 'SOLIDIFY')
    solid.thickness = 0.004
    solid.offset = 0
    bpy.ops.object.modifier_apply(modifier='solid')


def decimate(obj, target):
    cur = len(obj.data.polygons)
    if cur <= target:
        return
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    m = obj.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target / cur
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')


def join_peg(obj, peg_o):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    peg_o.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.join()


def main():
    reset()
    specs = [
        ('set-sheet', 28, 26, sheet, 1.10, 1.05),
        ('set-shirt', 34, 28, shirt, 0.92, 0.78),
        ('set-towel', 18, 26, towel, 0.50, 0.78),
        ('set-dress', 30, 32, dress, 0.78, 0.95),
        ('set-sock', 24, 28, sock, 0.14, 0.32),
        ('set-sock-b', 24, 28, sock, 0.14, 0.32),
    ]
    garments = []
    # Effectors have to exist before the cloth modifier, or the bake ignores them.
    add_wind()
    for name, nu, nv, fn, w, h in specs:
        obj = new_mesh(name, nu, nv, fn)
        scale_to(obj, w, h)
        if len(obj.data.polygons) < 4:
            raise SystemExit(f'{name} silhouette is empty')
        clothify(obj)
        garments.append(obj)
        print(f'{name} grid tris={len(obj.data.polygons)}')
    pegs = [peg(o) for o in garments]
    print('simulating 70 frames')
    simulate(garments)
    for obj, peg_o, (name, *_) in zip(garments, pegs, specs):
        apply_cloth(obj)
        thicken(obj)
        decimate(obj, BUDGET[name])
        join_peg(obj, peg_o)
        print(f'{name} baked tris={len(obj.data.polygons)}')
    # drop the force fields
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=True)
    print('wrote', DST)


if __name__ == '__main__':
    main()
