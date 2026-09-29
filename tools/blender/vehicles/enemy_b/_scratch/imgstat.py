import bpy, sys, glob, numpy as np, os
for f in sorted(glob.glob(sys.argv[-1] + '/*')):
    im = bpy.data.images.load(f)
    n = im.size[0]*im.size[1]*4
    a = np.zeros(n, np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(-1,4)
    print(os.path.basename(f), im.size[:], im.colorspace_settings.name, 'mean RGB', a[:,:3].mean(0).round(3), 'min', a[:,:3].min().round(3), 'max', a[:,:3].max().round(3))
