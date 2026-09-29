import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
V = Vehicle("t_pipe", style=dict(seed=3, rust=0.6, dirt=0.7, wear=0.6))
bx("hood", (0, 0.5, 0.9), (1.6, 1.5, 0.06), "paint", bevel=0.012, g="panel_hood")
V.pivot("panel_hood", 0, -0.2, 0.9)
bx("tubx", (0, -0.5, 0.5), (1.9, 3.0, 0.7), "paint2", bevel=0.02, g="body")
bx("plate", (0.6, 0.0, 0.5), (0.02, 0.6, 0.4), "armor", bevel=0.006, g="body")
cyl("axle", (0, -1, 0.3), 0.05, 1.6, "x", "metal_dark", g="body")
bx("bumper", (0, 1.4, 0.4), (1.9, 0.2, 0.25), "chrome", bevel=0.015, g="panel_bumper_F")
tube("bar", [(0.8, 0, 1.0), (0.8, -1, 1.5), (-0.8, -1, 1.5), (-0.8, 0, 1.0)], 0.03, "metal_bare", fillet=0.15, g="body")
sock("seat_driver", 0.4, 0, 0.6)
V.finish()
