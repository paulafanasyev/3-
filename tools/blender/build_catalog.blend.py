"""Build a labelled Blender gallery from GLB files in a directory.
Run: blender --background --python build_catalog.blend.py -- ./glb ./Svetlana_Units_Catalog.blend
"""
import bpy, os, sys, math
from mathutils import Vector, Matrix
args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
src = os.path.abspath(args[0] if args else os.path.dirname(__file__))
dst = os.path.abspath(args[1] if len(args)>1 else os.path.join(src,'Svetlana_Units_Catalog.blend'))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
units=bpy.data.collections.new('UNITS | imported GLB'); scene.collection.children.link(units)
stage=bpy.data.collections.new('CATALOG | labels and stage'); scene.collection.children.link(stage)
def mat(name, color, metallic=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF')
 if bs: bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Metallic'].default_value=metallic
 return m
plinth_mat=mat('Graphite plinth',(0.09,0.12,0.15),.3); text_mat=mat('Warm white text',(.88,.92,.9)); floor_mat=mat('Dark floor',(.035,.045,.06),.1)
names={'ashigaru_yari':'Ashigaru spear','ashigaru_yumi':'Ashigaru archer','samurai':'Samurai','peasant':'Peasant militia','militia1':'Militia I','militia2':'Militia II','militia3':'Militia III','infantry1':'Infantry I','infantry2':'Infantry II','infantry3':'Infantry III','gun1':'Field gun I','gun2':'Field gun II','tank1':'Riveted tank I','tank2':'Tank II','tank3':'Tank III','biplane':'Recon biplane','fighter':'Jet fighter','drone':'Strike drone','helicopter':'Helicopter'}
files=sorted(f for f in os.listdir(src) if f.lower().endswith('.glb'))
if not files: raise RuntimeError('No GLB files found: '+src)
cols=4; dx=5.0; dy=5.0
for i,fn in enumerate(files):
 key=os.path.splitext(fn)[0]; before=set(bpy.data.objects.keys())
 bpy.ops.import_scene.gltf(filepath=os.path.join(src,fn))
 objs=[o for o in bpy.data.objects if o.name not in before]
 for o in objs:
  for c in list(o.users_collection): c.objects.unlink(o)
  units.objects.link(o)
 bpy.context.view_layer.update()
 pts=[o.matrix_world @ Vector(v) for o in objs if o.type=='MESH' for v in o.bound_box]
 if pts:
  lo=Vector((min(p.x for p in pts),min(p.y for p in pts),min(p.z for p in pts))); hi=Vector((max(p.x for p in pts),max(p.y for p in pts),max(p.z for p in pts)))
  center=(lo+hi)*.5; extent=max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z,.001)
 else: center=Vector((0,0,0)); extent=1
 x=(i%cols)*dx; y=-(i//cols)*dy; scale=2.1/extent
 parent=bpy.data.objects.new('UNIT_ROOT_'+key,None); units.objects.link(parent)
 for o in objs:
  world=o.matrix_world.copy(); o.parent=parent; o.matrix_parent_inverse=Matrix.Identity(4); o.matrix_world=world
 parent.location=(x-center.x*scale,y-center.y*scale,-center.z*scale); parent.scale=(scale,scale,scale)
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=1.55,depth=.14,location=(x,y,-.12))
 p=bpy.context.object; p.name='PLINTH_'+key; p.data.materials.append(plinth_mat)
 for c in list(p.users_collection): c.objects.unlink(p)
 stage.objects.link(p)
 bpy.ops.object.text_add(location=(x,y-2,.02)); t=bpy.context.object; t.name='LABEL_'+key
 t.data.body=names.get(key,key.replace('_',' ').title()); t.data.size=.34; t.data.align_x='CENTER'; t.data.materials.append(text_mat)
 for c in list(t.users_collection): c.objects.unlink(t)
 stage.objects.link(t)
rows=math.ceil(len(files)/cols); cx=(cols-1)*dx/2; cy=-(rows-1)*dy/2
bpy.ops.mesh.primitive_plane_add(size=1,location=(cx,cy,-.35)); floor=bpy.context.object; floor.name='CATALOG_FLOOR'; floor.scale=(cols*dx/2+2,rows*dy/2+2,1); floor.data.materials.append(floor_mat)
for c in list(floor.users_collection): c.objects.unlink(floor)
stage.objects.link(floor)
bpy.ops.object.light_add(type='AREA',location=(cx-4,5,15)); keylight=bpy.context.object; keylight.data.energy=4500; keylight.data.shape='DISK'; keylight.data.size=12
bpy.ops.object.light_add(type='AREA',location=(cx+10,cy-8,10)); fill=bpy.context.object; fill.data.energy=2500; fill.data.size=10
bpy.ops.object.camera_add(location=(cx,cy+8,25)); cam=bpy.context.object; cam.data.type='ORTHO'; cam.data.ortho_scale=max(cols*dx+3,rows*dy+4); cam.rotation_euler=(Vector((cx,cy,0))-cam.location).to_track_quat('-Z','Y').to_euler(); scene.camera=cam
scene.render.engine='BLENDER_EEVEE_NEXT'; scene.render.resolution_x=1800; scene.render.resolution_y=max(1000,int(1800*rows/cols)); scene.render.resolution_percentage=60; scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(os.path.dirname(dst),'Svetlana_Units_Catalog.png')
os.makedirs(os.path.dirname(dst),exist_ok=True); bpy.ops.wm.save_as_mainfile(filepath=dst)
print('Saved',dst,'| GLB files:',len(files))
