import bpy, bmesh, mathutils, sys, time
from mathutils import geometry, Vector
print("VERSION", bpy.app.version_string)
# delaunay
pts = [(0,0),(1,0),(1,1),(0,1)] + [(0.5,0.5),(0.25,0.25),(0.75,0.75)]
edges=[(0,1),(1,2),(2,3),(3,0)]
for ot in range(0,6):
    try:
        r = geometry.delaunay_2d_cdt([Vector(p) for p in pts], edges, [], ot, 1e-6)
        print("cdt", ot, len(r[0]), len(r[2]))
    except Exception as e:
        print("cdt fail", ot, e)
r = geometry.delaunay_2d_cdt([Vector(p) for p in pts], [], [[0,1,2,3]], 1, 1e-6)
print("cdt faces", len(r[0]), len(r[2]))
# exporter enums
try:
    p = bpy.ops.export_scene.gltf.get_rna_type().properties
    print("vc", [i.identifier for i in p['export_vertex_color'].enum_items])
    print("imgfmt", [i.identifier for i in p['export_image_format'].enum_items])
    print([k for k in p.keys() if 'jpeg' in k or 'webp' in k or 'unused' in k or 'active' in k])
except Exception as e:
    print("exp fail", e)
# cycles
sc = bpy.context.scene
try:
    sc.render.engine = 'CYCLES'
    print("cycles ok")
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX','CUDA','NONE'):
        try:
            prefs.compute_device_type = dt
            prefs.get_devices()
            print(dt, [(d.name, d.type, d.use) for d in prefs.devices])
        except Exception as e:
            print("dev fail", dt, e)
except Exception as e:
    print("cycles fail", e)
import numpy
print("numpy", numpy.__version__)
print([i.identifier for i in bpy.types.BakeSettings.bl_rna.properties['target'].enum_items])
