import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
import post
rng = np.random.default_rng(3)
s=256
n = post._noise(rng, s, 2.4)
print("NOISE", np.isnan(n).sum(), n.min(), n.max())
sc = post._scratches(rng, s, 50)
print("SCR", np.isnan(sc).sum(), sc.min(), sc.max())
b = post._blur(n, 0.8)
print("BLUR", np.isnan(b).sum(), b.min(), b.max())
img = make_grunge("dbg", 256, 'paint', 0.8, 1, out_dir="C:/Users/yapor/AppData/Local/Temp")
px=np.empty(256*256*4,dtype=np.float32); img.pixels.foreach_get(px); print("IMG", np.isnan(px).sum(), px.mean())
