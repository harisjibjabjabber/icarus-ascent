# Auto-rig a generated T-pose mesh onto the VRM placeholder humanoid skeleton (headless Blender):
# orient + scale the mesh, refit arm/leg joints to it, bone-heat weights on humanoid bones only,
# MToon material with the baked texture, export VRM 1.0.  Usage: rig.py <mesh.obj> <texture.png> <out.vrm>
import bpy, addon_utils, sys, numpy as np, mathutils
obj_path, tex_path, out_path = sys.argv[-3:]
bpy.ops.wm.read_factory_settings(use_empty=True); addon_utils.enable('io_scene_vrm', default_set=True)
bpy.ops.import_scene.vrm(filepath='/workspace/vrmspike/models/VRM1_Constraint_Twist_Sample.vrm')
arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
old_meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tmpl_mat = bpy.data.materials['Tops_01_CLOTH']
hb = arm.data.vrm_addon_extension.vrm1.humanoid.human_bones
bn = lambda n: getattr(hb, n).node.bone_name

bpy.ops.wm.obj_import(filepath=obj_path, forward_axis='Y', up_axis='Z')
g = bpy.context.selected_objects[0]; g.name = 'Icarus'
bpy.context.view_layer.objects.active = g
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=1e-6); bpy.ops.object.mode_set(mode='OBJECT')
print('WELDED verts', len(g.data.vertices))  # weld UV-seam splits first: UVs live on loops, so they survive
R = mathutils.Matrix(((0, 0, 1), (-1, 0, 0), (0, -1, 0))).to_4x4()  # TripoSR: front +X, up -Y -> VRM: front -Y, up +Z
g.data.transform(mathutils.Matrix.Rotation(-1.5707963, 4, 'Y') @ R)
v = np.array([x.co[:] for x in g.data.vertices])
H = 1.55; s = H / (v[:, 2].max() - v[:, 2].min())
g.data.transform(mathutils.Matrix.Scale(s, 4))
v = np.array([x.co[:] for x in g.data.vertices])
off = mathutils.Vector((-(v[:, 0].max() + v[:, 0].min()) / 2, -np.median(v[:, 1]), -v[:, 2].min()))
g.data.transform(mathutils.Matrix.Translation(off))
v = np.array([x.co[:] for x in g.data.vertices])
print('MESH bbox', v.min(0).round(3), v.max(0).round(3))
# decimate the marching-cubes mesh to a game budget
d = g.modifiers.new('dec', 'DECIMATE'); d.ratio = 24000 / len(g.data.polygons)
bpy.context.view_layer.objects.active = g; bpy.ops.object.modifier_apply(modifier='dec')
v = np.array([x.co[:] for x in g.data.vertices])
# --- fit joints ---
span = v[:, 0].max()
far = v[np.abs(v[:, 0]) > 0.6 * span]
arm_z = float(np.median(far[:, 2]))
knee = v[(np.abs(v[:, 2] - 0.42) < 0.03)]
lx = float(np.median(knee[knee[:, 0] > 0][:, 0])) if (knee[:, 0] > 0).any() else 0.077
print('FIT span', round(span, 3), 'arm_z', round(arm_z, 3), 'leg_x', round(lx, 3))
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
def chain(root):
    out = [root]; [out.extend(chain(c)) for c in root.children]; return out
for side, sg in (('left', 1), ('right', -1)):
    sh = eb[bn(f'{side}_shoulder')]; x0 = abs(sh.head.x); tip = 0.596
    k = (span * 0.985 - x0) / (tip - x0); dz = arm_z - 1.274
    for b in chain(sh):
        for p in (b.head, b.tail):
            p.x = sg * (x0 + (abs(p.x) - x0) * k); p.z += dz
    ul = eb[bn(f'{side}_upper_leg')]; dx = sg * lx - ul.head.x
    for b in chain(ul):
        b.head.x += dx; b.tail.x += dx
bpy.ops.object.mode_set(mode='OBJECT')
# --- weights: humanoid bones only ---
humanoid = {getattr(hb, n).node.bone_name for n in dir(hb) if not n.startswith('_') and hasattr(getattr(hb, n), 'node')}
skip = {bn('left_eye'), bn('right_eye')}
for b in arm.data.bones: b.use_deform = b.name in humanoid and b.name not in skip
for o in old_meshes: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
r = bpy.ops.object.parent_set(type='ARMATURE_AUTO'); print('PARENT', r, 'groups', len(g.vertex_groups))
if not any(vx.groups for vx in g.data.vertices):
    # bone heat fails on self-intersecting generated meshes: distance-to-bone-segment weights instead
    bones = [b for b in arm.data.bones if b.use_deform]
    A = np.array([(arm.matrix_world @ b.head_local)[:] for b in bones]); B = np.array([(arm.matrix_world @ b.tail_local)[:] for b in bones])
    P = np.array([(g.matrix_world @ vx.co)[:] for vx in g.data.vertices])
    AB = B - A; t = np.clip(np.einsum('pbk,bk->pb', P[:, None, :] - A[None], AB) / np.maximum((AB ** 2).sum(1), 1e-9), 0, 1)
    D = np.linalg.norm(P[:, None, :] - (A[None] + t[..., None] * AB[None]), axis=2) + 1e-4
    top = np.argsort(D, axis=1)[:, :3]
    for b in bones:
        if b.name not in g.vertex_groups: g.vertex_groups.new(name=b.name)
    names = [b.name for b in bones]; hip = names.index(bn('hips'))
    legs = [names.index(bn(n)) for n in ('left_upper_leg', 'right_upper_leg', 'left_lower_leg', 'right_lower_leg')]
    for i, row in enumerate(top):
        w = 1 / D[i, row] ** 4; w /= w.sum()
        dleg = D[i, legs].min()
        if 0.35 < P[i, 2] < 0.95 and dleg > 0.085:  # skirt cloth away from the legs: follow the hips, not one leg
            k = min(1.0, (dleg - 0.085) / 0.06) * min(1.0, (P[i, 2] - 0.35) / 0.15)
            near = legs[int(np.argmin(D[i, legs]))]
            row = np.array([hip, near]); w = np.array([0.35 + 0.5 * k, 0.65 - 0.5 * k])
        for j, wj in zip(row, w):
            if wj > 0.02: g.vertex_groups[bones[j].name].add([i], float(wj), 'REPLACE')
    print('FALLBACK distance weights on', len(P), 'verts')
empty = sum(1 for vx in g.data.vertices if not vx.groups); print('UNWEIGHTED verts', empty, '/', len(g.data.vertices))
# --- MToon material with the baked texture ---
img = bpy.data.images.load(tex_path)
m = tmpl_mat.copy(); m.name = 'Icarus_MToon'
mt = m.vrm_addon_extension.mtoon1
mt.pbr_metallic_roughness.base_color_texture.index.source = img
mt.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source = img
mt.pbr_metallic_roughness.base_color_factor = (1, 1, 1, 1)
mt.extensions.vrmc_materials_mtoon.shade_color_factor = (0.78, 0.7, 0.8)
mt.extensions.vrmc_materials_mtoon.outline_width_mode = 'worldCoordinates'
mt.extensions.vrmc_materials_mtoon.outline_width_factor = 0.004
g.data.materials.clear(); g.data.materials.append(m)
mt.extensions.vrmc_materials_mtoon.matcap_factor = (0, 0, 0)
ext = mt.extensions.vrmc_materials_mtoon
for tex in (mt.normal_texture, mt.emissive_texture, ext.shading_shift_texture, ext.rim_multiply_texture, ext.matcap_texture, ext.outline_width_multiply_texture, ext.uv_animation_mask_texture):
    tex.index.source = None
mt.emissive_factor = (0, 0, 0)
ext.shading_toony_factor = 0.8; ext.shading_shift_factor = -0.1; ext.gi_equalization_factor = 0.9
mt.extensions.vrmc_materials_mtoon.parametric_rim_color_factor = (1.0, 0.85, 0.66)
bpy.context.view_layer.objects.active = g; g.select_set(True)
sm = g.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.6; sm.iterations = 6
bpy.ops.object.modifier_move_to_index(modifier='sm', index=0); bpy.ops.object.modifier_apply(modifier='sm')
bpy.ops.object.shade_smooth()
mt.double_sided = False; ext.rim_lighting_mix_factor = 0.3; ext.parametric_rim_fresnel_power_factor = 4.0
arm.data.vrm_addon_extension.vrm1.meta.name = 'Icarus (TripoSR test)'
bpy.ops.object.select_all(action='SELECT')
print('EXPORT', bpy.ops.export_scene.vrm(filepath=out_path))
