import bpy, sys
src, dst, ratio = sys.argv[-3], sys.argv[-2], float(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='d')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
