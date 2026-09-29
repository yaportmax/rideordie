"""Run inside Blender:  blender -b --factory-startup -P blender_decimate.py -- in.npz out.npz ratio [symmetry]
in.npz : verts (V,3), faces (T,3), uv (T,3,2) per corner, imp (V,) importance 0..1 (1 = keep detail)
out.npz: verts (V',3), faces (T',3), uv (T',3,2)
"""
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, ratio = argv[0], argv[1], float(argv[2])
sym = len(argv) > 3 and argv[3] == "1"
d = np.load(src)
verts, faces, uv, imp = d["verts"], d["faces"], d["uv"], d["imp"]

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("m")
mesh.from_pydata(verts.tolist(), [], faces.tolist())
mesh.update()
uvl = mesh.uv_layers.new(name="uv")
uvl.data.foreach_set("uv", uv.reshape(-1, 2).astype(np.float32).ravel())
obj = bpy.data.objects.new("m", mesh)
bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
vg = obj.vertex_groups.new(name="imp")
for i in range(len(verts)):
    vg.add([i], float(imp[i]), "REPLACE")
mod = obj.modifiers.new("dec", "DECIMATE")
mod.decimate_type = "COLLAPSE"
mod.ratio = ratio
mod.vertex_group = "imp"
mod.vertex_group_factor = 1.0
mod.invert_vertex_group = True
mod.use_collapse_triangulate = True
if sym:
    mod.use_symmetry = True
    mod.symmetry_axis = "X"
dg = bpy.context.evaluated_depsgraph_get()
ev = obj.evaluated_get(dg)
me = ev.to_mesh()
me.calc_loop_triangles()
nv = len(me.vertices)
V = np.empty(nv * 3, np.float32)
me.vertices.foreach_get("co", V)
V = V.reshape(-1, 3)
tris = np.empty(len(me.loop_triangles) * 3, np.int32)
me.loop_triangles.foreach_get("vertices", tris)
tris = tris.reshape(-1, 3)
loops = np.empty(len(me.loop_triangles) * 3, np.int32)
me.loop_triangles.foreach_get("loops", loops)
loops = loops.reshape(-1, 3)
uvd = np.empty(len(me.loops) * 2, np.float32)
me.uv_layers["uv"].data.foreach_get("uv", uvd)
uvd = uvd.reshape(-1, 2)
uv_out = uvd[loops]
np.savez(dst, verts=V, faces=tris, uv=uv_out)
print("decimated", len(faces), "->", len(tris), "tris,", len(verts), "->", nv, "verts")
