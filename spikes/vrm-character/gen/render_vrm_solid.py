import bpy, addon_utils, sys
bpy.ops.wm.read_factory_settings(use_empty=True); addon_utils.enable('io_scene_vrm', default_set=True)
bpy.ops.import_scene.vrm(filepath=sys.argv[-2])
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.display.shading.color_type='TEXTURE'; sc.display.shading.light='STUDIO'; sc.display.shading.color_type='SINGLE'
sc.render.resolution_x=800; sc.render.resolution_y=800
cam=bpy.data.objects.new('c',bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=2.0; cam.location=(0,-4,0.8); cam.rotation_euler=(1.5708,0,0)
sc.render.filepath=sys.argv[-1]; bpy.ops.render.render(write_still=True); print('OUT ok')
