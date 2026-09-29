import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *
from parts import *
new_scene()
w1 = Part("wheel_FL", origin=(0,0,0.34))
build_wheel(w1, (0,0,0.34), +1, 0.34, 0.19, 0.19, style='steel', tread='bald', seg=48, rust=0.5)
o1=w1.build()
w2 = Part("wheel_A", origin=(1.2,0,0.5))
build_wheel(w2, (1.2,0,0.5), +1, 0.5, 0.31, 0.25, style='alloy', tread='mud', seg=72, lug_pitch=3, lug_depth=0.03, shoulder=0.5, beadlock=True)
o2=w2.build()
w3 = Part("wheel_B", origin=(-1.2,0,0.5))
build_wheel(w3, (-1.2,0,0.5), -1, 0.42, 0.27, 0.22, style='alloy', tread='at', seg=64, lug_pitch=3, lug_depth=0.02)
o3=w3.build()
for o in (o1,o2,o3): weighted_normals(o)
print("tris", mesh_stats([o1,o2,o3]), [mesh_stats([o]) for o in (o1,o2,o3)])
export("models/_test/wheel.glb", [o1,o2,o3])
