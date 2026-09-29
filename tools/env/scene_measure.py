"""foliage colour stats of a QA render: pixels whose green dominates (g > b + 10 and g >= r - 5) below the horizon band.  usage: scene_measure.py png [ymin ymax]"""
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
H = a.shape[0]
y0 = int(sys.argv[2]) if len(sys.argv) > 2 else int(H * 0.22)
y1 = int(sys.argv[3]) if len(sys.argv) > 3 else int(H * 0.60)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
m = (g > b + 10) & (g >= r - 5)
m[:y0] = False; m[y1:] = False
px = a[m]
print("foliage px", len(px))
if len(px):
    lum = px @ np.array([0.2126, 0.7152, 0.0722])
    for q in (10, 50, 90, 98):
        sel = px[(lum >= np.percentile(lum, q - 4)) & (lum <= np.percentile(lum, min(100, q + 4)))]
        print("p%02d" % q, sel.mean(0).round(0))
