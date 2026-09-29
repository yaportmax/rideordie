import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
from tiers import tier
from truck import Truck
import numpy as np
new_scene()
C = tier(1); T = Truck(C); 
T.build_all()
body=T.b.build(); panels=[p.build() for p in T.parts.values()]; wheels=[p.build() for p in T.wheels.values()]
objs=[body]+panels
for o in objs+wheels: weighted_normals(o); ensure_col(o)
bake_ao(objs, dist=0.55, samples=24)
door = bpy.data.objects['panel_door_L']
def stats(o, tag):
    me=o.data; ca=me.color_attributes['Col']
    n=len(me.vertices)
    col=np.empty(n*4,dtype=np.float32); ca.data.foreach_get('color',col); col=col.reshape(-1,4)
    co=np.empty(n*3); me.vertices.foreach_get('co',co); co=co.reshape(-1,3)+np.array(o.matrix_world.translation)
    nm=np.empty(n*3); me.vertices.foreach_get('normal',nm); nm=nm.reshape(-1,3)
    out = nm[:,0]>0.9
    print(tag, "n", n, "outward-facing verts", out.sum(), "ao mean", col[out,0].mean(), "pcts", np.percentile(col[out,0],[5,25,50,75,95]))
    print("   by z", [ (round(z0,2), round(col[out&(co[:,2]>z0)&(co[:,2]<z0+0.2),0].mean(),2)) for z0 in (0.4,0.6,0.8) if (out&(co[:,2]>z0)&(co[:,2]<z0+0.2)).any()])
stats(door, "door_L")
