import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *

new_scene()
rk = pmat("rock_red", tex="rock_red", uv_m=1.8, rough=0.9)
mb = MB()
mb.rock(rk, seed=4, size=(1.6, 1.3, 1.0), subdiv=3, cuts=8)
finish("_test_rock", mb, "rock", ao=dict(samples=24, dist=0.9))

new_scene()
rust = pmat("rust_metal", tex="rust_metal", uv_m=1.0, rough=0.7, metal=0.6)
mb = MB()
mb.lathe(rust, [(0.0, 0.0), (0.27, 0.0), (0.29, 0.02), (0.29, 0.86), (0.27, 0.88), (0.0, 0.88)], seg=16)
finish("_test_barrel", mb, "furniture", ao=dict(samples=16, dist=0.5))
