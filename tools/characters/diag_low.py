import sys
import anim as A, reanim, anim_diag as D
cid = sys.argv[1]
names = sys.argv[2].split(",")
js, b = reanim.read_glb("C:/Dev/rideordie/public/models/characters/%s.glb" % cid)
heads, bn = reanim.rest_heads(js)
mesh = reanim.body_mesh(js, b)
clips = A.build_clips(heads, only=names, mesh=mesh, **reanim.ANIM_PARAMS.get(cid, {}))
rig = A.Rig(heads); rig.set_mesh(*mesh)
for n in names:
    c = clips[n]
    print(n, " ".join("%.2f:%s(%.2f,hips %.2f)" % (t, bone, y, c["hips_t"][int(round(t * 30))][1]) for t, y, bone in D.lowest_bones(rig, c, 6)))
