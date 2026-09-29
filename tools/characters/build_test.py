import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body as B
import garments
import mh
import parts
import rig
from glb import Glb

OUT = "C:/Dev/rideordie/public/models/characters/_qa"
os.makedirs(OUT, exist_ok=True)

hair_name = sys.argv[1] if len(sys.argv) > 1 else "short03"
spec = dict(macro=dict(gender=1.0, age=0.5, muscle=0.6, weight=0.35, height=0.5, race="caucasian"), height=1.82, skin="young_african_male")
ch = B.Char(spec)
glb = Glb()
prims = []
tv, tt = ch.tv, ch.tt
nrm = mh.vertex_normals(ch.pos, tv)
m = mh.split_seams(ch.pos, nrm, ch.body.vt, tv, tt)
j, w = mh.top4(ch.W[m["src"]])
fpos = mh.to_final(m["pos"])
fnrm = mh.to_final(m["nrm"])
tex = glb.texture_array("skin_albedo", B.skin_image(spec["skin"], 2048), "jpg", 90)
mat = glb.material("skin", base_tex=tex, rough=0.8)
prims.append(dict(pos=fpos, nrm=fnrm, uv=m["uv"], joints=j, weights=w, idx=m["idx"], material=mat))
print("body tris", len(m["idx"]) // 3, "verts", len(fpos))
# eyes
ed, etex = parts.eyes(ch, "brown")
emat = glb.material("eye", base_tex=glb.texture_array("eye_tex", etex, "jpg", 92), rough=0.25,
                    extensions={"KHR_materials_clearcoat": {"clearcoatFactor": 1.0, "clearcoatRoughnessFactor": 0.03}})
ed["material"] = emat
prims.append(ed)
# garments
for kind, opts, col in (("tunic", {"sleeves": "none", "length": "thigh"}, (0.05, 0.5, 0.5, 1)), ("breeches", {}, (0.3, 0.28, 0.2, 1)), ("boots", {"height": 0.25}, (0.2, 0.12, 0.07, 1))):
    for gm, part in garments.build(ch.body, ch.sk, ch.pos, ch.nrm, ch.tv, kind, dict(opts, seed=3)):
        pr = garments.finish(gm, float(ch.pos[:, 1].max()), ch.sk)
        pr["pos"] = mh.to_final(pr["pos"])
        pr["nrm"] = mh.to_final(pr["nrm"])
        pr["material"] = glb.material("cloth_" + kind, color=col, rough=0.85, double_sided=True)
        prims.append(pr)
        print(kind, len(pr["idx"]) // 3)
heads = ch.heads_final
nodes, sock = rig.add_skeleton(glb, heads)
mesh = glb.mesh("body", prims)
skin = glb.skin(nodes, rig.inverse_bind(heads), nodes[0])
mnode = glb.node("body_mesh", mesh=mesh, skin=skin)
root = glb.node("test", children=[nodes[0], mnode])
glb.g["scenes"][0]["nodes"] = [root]
print("bytes", glb.save(OUT + "/test_body.glb"))
