# Assemble Quaternius CC0 Superhero_Female head/body + Female_Peasant outfit + Hair_Long into a VRM 1.0 with MToon.
import bpy, sys, mathutils
Q='/workspace/freevrm/q/'
OUT=sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
import addon_utils; addon_utils.enable('io_scene_vrm', default_set=True)
files=[Q+'Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Female_FullBody.gltf',
 Q+'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/Female_Peasant.gltf',
 Q+'Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf']
for f in files: bpy.ops.import_scene.gltf(filepath=f)
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']; A=arms[0]
for o in list(bpy.data.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
for o in bpy.data.objects:
    if o.type=='MESH':
        for m in o.modifiers:
            if m.type=='ARMATURE': m.object=A
        o.parent=A
for a in arms[1:]: bpy.data.objects.remove(a)
# hide body skin under the outfit: delete body faces whose centre is inside clothing (ray parity test against outfit meshes)
body=bpy.data.objects['Superhero_Female']
cloth=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('Female_Peasant')]
dg=bpy.context.evaluated_depsgraph_get()
from mathutils.bvhtree import BVHTree
trees=[BVHTree.FromObject(o,dg) for o in cloth]
import bmesh
bm=bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
M=body.matrix_world
kill=[]
for f in bm.faces:
    c=M@f.calc_center_median(); n=(M.to_3x3()@f.normal).normalized()
    hit=False
    for t in trees:
        loc,_,_,d=t.ray_cast(c+n*0.001,n,0.06)
        if loc is not None: hit=True;break
    if not (c.z>1.33 and abs(c.x)<0.13): kill.append(f)  # keep only head/neck/upper chest; outfit covers the rest (incl. gloves)
print('body faces',len(bm.faces),'hidden',len(kill))
bmesh.ops.delete(bm,geom=kill,context='FACES'); bm.to_mesh(body.data); bm.free()
# scale 1.78 m -> ~1.62 m to match the placeholder heroine
A.scale=(0.91,0.91,0.91)
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active=A
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
# humanoid mapping (UE names)
ext=A.data.vrm_addon_extension; ext.spec_version='1.0'
hb=ext.vrm1.humanoid.human_bones
M={'hips':'pelvis','spine':'spine_01','chest':'spine_02','upper_chest':'spine_03','neck':'neck_01','head':'Head',
 'left_shoulder':'clavicle_l','left_upper_arm':'upperarm_l','left_lower_arm':'lowerarm_l','left_hand':'hand_l',
 'right_shoulder':'clavicle_r','right_upper_arm':'upperarm_r','right_lower_arm':'lowerarm_r','right_hand':'hand_r',
 'left_upper_leg':'thigh_l','left_lower_leg':'calf_l','left_foot':'foot_l','left_toes':'ball_l',
 'right_upper_leg':'thigh_r','right_lower_leg':'calf_r','right_foot':'foot_r','right_toes':'ball_r'}
for s in 'lr':
    S='left' if s=='l' else 'right'
    for fq,fu in (('thumb','thumb'),('index','index'),('middle','middle'),('ring','ring'),('little','pinky')):
        segs=('metacarpal','proximal','distal') if fq=='thumb' else ('proximal','intermediate','distal')
        for i,sg in enumerate(segs): M[f'{S}_{fq}_{sg}']=f'{fu}_0{i+1}_{s}'
for k,v in M.items(): getattr(hb,k).node.bone_name=v
meta=ext.vrm1.meta; meta.vrm_name='Quaternius Peasant (CC0 assembly)'; meta.license_url='https://vrm.dev/licenses/1.0/'
a=meta.authors.add(); a.value='Quaternius (CC0); assembled by Icarus project'
meta.avatar_permission='everyone'; meta.commercial_usage='corporation'; meta.allow_redistribution=True; meta.modification='allowModificationRedistribution'; meta.credit_notation='unnecessary'
meta.other_license_url='https://creativecommons.org/publicdomain/zero/1.0/'
# MToon for every material, keep base colour texture
IMG={}
LIGHT=bpy.data.images.load(Q+'Universal Base Characters[Standard]/Base Characters/Textures/T_Superhero_Female_Light_BaseColor.png')
for m in list(bpy.data.materials):
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type=='TEX_IMAGE' and n.image and not any(k in n.image.name for k in ('Normal','Rough','ORM')): IMG[m.name]=n.image
    if m.name.startswith('MI_Superhero_Female'): IMG[m.name]=LIGHT
import numpy as np
for k,im in list(IMG.items()):
    if 'Hair' in im.name and not im.get('tinted'):
        px=np.array(im.pixels[:]).reshape(-1,4); lum=px[:,:3].mean(1,keepdims=True)
        px[:,:3]=np.clip(lum*np.array([[0.80,0.50,0.33]])*1.25,0,1); im.pixels[:]=px.ravel(); im['tinted']=1; im.pack()
print('IMG',{k:v.name for k,v in IMG.items()})
for m in [bpy.data.materials[k] for k in [x.name for x in bpy.data.materials]]:
    if m.name.startswith('MToon Outline'): continue
    img=IMG.get(m.name)
    mt=m.vrm_addon_extension.mtoon1; mt.enabled=True
    mt.alpha_mode='OPAQUE'; mt.double_sided=False
    e=mt.extensions.vrmc_materials_mtoon
    if img:
        mt.pbr_metallic_roughness.base_color_texture.index.source=img; e.shade_multiply_texture.index.source=img
    for tex in (mt.normal_texture, mt.emissive_texture, e.shading_shift_texture, e.rim_multiply_texture, e.matcap_texture, e.outline_width_multiply_texture, e.uv_animation_mask_texture): tex.index.source=None
    e.matcap_factor=(0,0,0); mt.emissive_factor=(0,0,0)
    e.shade_color_factor=(0.8,0.72,0.78); e.shading_toony_factor=0.8; e.shading_shift_factor=-0.1; e.gi_equalization_factor=0.9
    eye = 'eye' in m.name.lower() or 'brow' in m.name.lower()
    e.outline_width_mode='none' if eye else 'worldCoordinates'; e.outline_width_factor=0.0035
    print('MAT',m.name,img.name if img else None, m.blend_method if hasattr(m,'blend_method') else '')
bpy.ops.object.select_all(action='SELECT')
print('EXPORT',bpy.ops.export_scene.vrm(filepath=OUT))
