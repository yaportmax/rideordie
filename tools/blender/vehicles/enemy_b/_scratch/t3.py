import bpy, numpy as np
n=64
im = bpy.data.images.new('a', n, n, alpha=False)
a = np.random.rand(n,n,4).astype(np.float32); a[...,3]=1
def mean(): 
    b=np.zeros(n*n*4,np.float32); im.pixels.foreach_get(b); return b.reshape(-1,4)[:,:3].mean().round(3)
im.pixels.foreach_set(a.ravel()); print('after set', mean(), a[...,:3].mean().round(3))
im.colorspace_settings.name='Non-Color'; print('after cs', mean())
im.file_format='JPEG'; print('after fmt', mean())
im.pack(); print('after pack', mean(), im.packed_file is not None)
im.update(); print('after update', mean())
