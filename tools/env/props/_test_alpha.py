import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
new_scene()
m = pmat("leaf_test", albedo_file="C:/Dev/art_cache/rideordie/props_tex/_card_test.png", alpha="MASK", double_sided=True, rough=0.9)
mb = MB()
mb.card(m, (0,0,0), 1.0, 1.0, yaw=0)
mb.card(m, (0,0,0), 1.0, 1.0, yaw=90)
finish("_test_card", mb, "foliage", ao=None)
