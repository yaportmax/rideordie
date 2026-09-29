"""Debug: bake a few kit parts next to plain boxes and print the mean baked albedo / edge mask per object (scratch output only)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import veh_pipeline
from veh_pipeline import *
from veh_kit import *

MODE = argv().get("mode", "")
def _dbg(key):
    def h(ctx, col):
        g = ctx["g"]
        v = ctx[key]
        return g.rgb(v, v, v)
    return h
ST = dict(seed=3, rust=0.5, dirt=0.5, wear=0.8, scratch=0.5)
if MODE:
    ST["hooks"] = {"armor": _dbg("edge"), "wood": _dbg("dirt"), "metal_dark": _dbg("rust")}
V = Vehicle("t_kit", style=ST)
jerry_can("jc", (0.0, 0.0, 0.5), yaw=0, m="armor", g="body")
bx("box_armor", (0.6, 0.0, 0.75), (0.17, 0.34, 0.47), "armor", g="body")
crate("cr", (0.0, 1.0, 0.5), (0.40, 0.28, 0.22), g="body")
bx("box_wood", (0.6, 1.0, 0.61), (0.40, 0.28, 0.22), "wood", g="body")
objs = {o.name: o for o in bpy.context.scene.objects if o.type == "MESH"}
for n, o in objs.items():
    me = o.data
    c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    out = sum(1 for p in me.polygons if p.normal.dot(p.center - c) > 0)
    print("NORMALS %-10s faces %d outward %d" % (n, len(me.polygons), out))
veh_pipeline.OUT_DIR = SCRATCH
V.finish(bake=True)
img = bpy.data.images.get("t_kit_albedo")
import numpy as np
r = img.size[0]
arr = np.empty(r * r * 4, dtype=np.float32)
img.pixels.foreach_get(arr)
arr = arr.reshape(r, r, 4)
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    me = o.data
    uvl = me.uv_layers.active
    by = {}
    for p in me.polygons:
        uv = sum((uvl.data[l].uv for l in p.loop_indices), Vector((0, 0))) / p.loop_total
        v = arr[min(int(uv.y * r), r - 1), min(int(uv.x * r), r - 1)][:3]
        mn = o.material_slots[p.material_index].material.name
        by.setdefault(mn, []).append(v)
    for mn, vs in by.items():
        print("ALB %-12s %-10s n=%d mean=%s" % (o.name, mn, len(vs), np.round(np.mean(vs, axis=0), 3)))
