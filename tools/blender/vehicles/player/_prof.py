import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
from tiers import tier
from truck import Truck
n = int(os.environ.get('TIER','1'))
new_scene()
C = tier(n)
T = Truck(C)
def tris(p): return sum(len(f.verts)-2 for f in p.bm.faces)
for name in ['chassis','exhaust','engine','inner_fenders','hood','fenders','front_end','bumper_front','windshield','cab_shell','doors','dash','seats','bed','rear_end','gunner_frame']:
    before = tris(T.b); pb = {k: tris(v) for k,v in T.parts.items()}
    getattr(T,name)()
    after = tris(T.b); pa = {k: tris(v) for k,v in T.parts.items()}
    dp = sum(pa[k]-pb.get(k,0) for k in pa)
    print("%-14s body +%6d  parts +%6d" % (name, after-before, dp))
