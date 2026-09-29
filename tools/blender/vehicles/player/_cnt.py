import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
from tiers import tier
from truck import Truck
new_scene()
C = tier(int(os.environ.get("TIER","1")))
T = Truck(C)
T.wheels_build()
pt = T.wheels['wheel_FL']
o = pt.build()
me=o.data
me.calc_loop_triangles()
from collections import Counter
c=Counter()
for t in me.loop_triangles: c[me.materials[t.material_index].name]+=1
print(c, sum(c.values()))
