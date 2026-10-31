# Render a GLB from front / side / 3-4 views with Blender workbench (vertex colours / textures)
import bpy, sys, math, mathutils
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = mathutils.Vector((1e9,)*3); mx = -mn
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c); mn = mathutils.Vector(map(min, mn, w)); mx = mathutils.Vector(map(max, mx, w))
ctr = (mn + mx) / 2; size = max(mx - mn)
print('BBOX', tuple(round(v,3) for v in mn), tuple(round(v,3) for v in mx), 'tris', sum(len(o.data.polygons) for o in objs))
sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = sys.argv[-3] if len(sys.argv) > 4 else 'TEXTURE'
sc.render.resolution_x, sc.render.resolution_y = 600, 800; sc.render.film_transparent = False
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.1
up = 'Z' if (mx - mn).z >= (mx - mn).y else 'Y'
for name, ang in [('front', 0), ('side', 90), ('threeq', 35), ('back', 180)]:
    a = math.radians(ang); d = size * 3
    if up == 'Z': cam.location = ctr + mathutils.Vector((math.sin(a) * d, -math.cos(a) * d, 0))
    else: cam.location = ctr + mathutils.Vector((math.sin(a) * d, 0, math.cos(a) * d))
    dirv = ctr - cam.location; cam.rotation_euler = dirv.to_track_quat('-Z', up).to_euler()
    sc.render.filepath = f'{out}-{name}.png'; bpy.ops.render.render(write_still=True)
