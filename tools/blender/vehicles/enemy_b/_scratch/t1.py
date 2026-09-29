import bpy, numpy as np, os, sys, json
print("numpy", np.__version__)
try:
    import scipy; print("scipy", scipy.__version__)
except Exception as e: print("no scipy")
try:
    import PIL; print("PIL")
except Exception as e: print("no PIL")
img = bpy.data.images.new("t", 8, 8)
arr = np.full((8,8,4), 0.5, np.float32); arr[...,3]=1
img.pixels.foreach_set(arr.ravel())
print("byte img readback", img.pixels[0], img.colorspace_settings.name)
out = os.path.join(os.environ.get("TEMP","."), "t1_test.png")
img.filepath_raw = out; img.file_format='PNG'; img.save()
d = open(out,'rb').read()
import zlib, struct
# decode png quickly: find IDAT
i=8; idat=b''
while i < len(d):
    ln = struct.unpack('>I', d[i:i+4])[0]; typ=d[i+4:i+8]
    if typ==b'IDAT': idat += d[i+8:i+8+ln]
    if typ==b'IHDR': print('IHDR', struct.unpack('>IIBBBBB', d[i+8:i+8+13]))
    i += 12+ln
raw = zlib.decompress(idat)
print("first bytes", list(raw[:8]))
print([e.identifier for e in bpy.types.Material.bl_rna.properties['blend_method'].enum_items])
