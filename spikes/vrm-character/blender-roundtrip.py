# Headless Blender (bpy) round trip: import VRM -> recolour a material + decimate -> export VRM.
import sys, os, bpy, addon_utils
bpy.ops.wm.read_factory_settings(use_empty=True)
print('ENABLE', addon_utils.enable('io_scene_vrm', default_set=True))
r = bpy.ops.import_scene.vrm(filepath='/workspace/vrmspike/models/VRM1_Constraint_Twist_Sample.vrm')
print('IMPORT', r)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print('MESHES', len(meshes), 'TRIS', tris, 'ARMATURES', [o.name for o in bpy.data.objects if o.type == 'ARMATURE'])
for o in meshes: print('  ', o.name, sum(len(p.vertices) - 2 for p in o.data.polygons), [m.name for m in o.data.materials][:6])
# proof edit: decimate the body meshes to ~50% (keeps skin weights) 
for o in meshes:
    if o.data.shape_keys: continue  # keep face morphs intact
    d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = 0.5
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='dec')
tris2 = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print('TRIS_AFTER', tris2)
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.ops.object.select_all(action='SELECT')
r = bpy.ops.export_scene.vrm(filepath='/workspace/vrmspike/blender/out_roundtrip.vrm')
print('EXPORT', r, os.path.getsize('/workspace/vrmspike/blender/out_roundtrip.vrm'))
