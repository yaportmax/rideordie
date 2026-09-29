import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
from tiers import tier
from truck import Truck
n = int(os.environ.get('TIER','1'))
t0=time.time()
new_scene()
C = tier(n)
T = Truck(C)
T.build_all()
print("built", time.time()-t0)
objs=[T.b.build()]
for p in T.parts.values(): objs.append(p.build())
for p in T.wheels.values(): objs.append(p.build())
print("objs", time.time()-t0)
for o in objs: weighted_normals(o)
tot = mesh_stats(objs)
print("tris", tot, {o.name: mesh_stats([o]) for o in objs})
export("models/_test/dev.glb", objs + vlib._SOCKETS)
print("total", time.time()-t0)
