import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from rod_lib import *
reset()
paint = mat("paint", (0.85, 0.85, 0.85), metal=0.2, rough=0.35, clearcoat=0.6)
red = mat("marker_front", (0.9, 0.05, 0.05), rough=0.5)
blue = mat("marker_left", (0.05, 0.1, 0.9), rough=0.5)
body = box("body", (1.8, 4.0, 1.0), (0, 0, 0.8), paint, bevel=0.06, segs=3)
box("nose", (1.0, 0.4, 0.4), (0, -2.1, 0.8), red, bevel=0.03)      # FRONT = -Y  -> should end up +Z in glTF
box("left_mark", (0.3, 1.0, 0.4), (0.95, 0, 1.3), blue, bevel=0.03)  # LEFT = +X
smooth_by_angle(body, 40)
export_glb("models/_test/orient.glb")
print("tris", tri_count())
