import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_decals import *
import numpy as np
out = os.path.join(SCRATCH)
os.makedirs(out, exist_ok=True)
for nm, fn in (("skull", skull_alpha), ("tally", tally_alpha), ("xmark", xmark_alpha)):
    a = fn(512)
    img = bpy.data.images.new(nm + "_v", 512, 512, alpha=False)
    px = np.zeros((512, 512, 4), np.float32)
    px[..., 0] = px[..., 1] = px[..., 2] = 1.0 - a[::-1]
    px[..., 3] = 1
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(out, nm + "_preview.png")
    img.file_format = "PNG"
    img.save()
print("ok")
