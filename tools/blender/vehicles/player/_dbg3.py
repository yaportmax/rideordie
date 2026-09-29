import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
new_scene()
p = Part("t")
p.cyl2('spike', (0,0,0), (0,0,1.0), 0.2, r2=0.02, n=8)
xs=[(round(v.co.z,2), round(math.hypot(v.co.x,v.co.y),2)) for v in p.bm.verts]
print("CONE", sorted(set(xs)))
p2=Part("t2"); p2.cyl('spike',(0,0,0),0.2,1.0,axis='z',n=8,r2=0.02)
print("CYL", sorted(set((round(v.co.z,2), round(math.hypot(v.co.x,v.co.y),2)) for v in p2.bm.verts)))
p3=Part("t3"); p3.cyl('spike',(0,0,0),0.2,1.0,axis='f',n=8,r2=0.02)
print("CYLF", sorted(set((round(-v.co.y,2), round(math.hypot(v.co.x,v.co.z),2)) for v in p3.bm.verts)))
