"""Quick preview builds with flat colours (no textures) to iterate on garment shapes."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body as B
import cloth
import garments as G
import mh
import parts
import rig
from glb import Glb

OUT = "C:/Dev/rideordie/public/models/characters/_qa"
os.makedirs(OUT, exist_ok=True)


def skin_prim(glb, ch, mat):
    m = mh.split_seams(ch.pos, mh.vertex_normals(ch.pos, ch.tv), ch.body.vt, ch.tv, ch.tt)
    j, w = mh.top4(ch.W[m["src"]])
    return dict(pos=mh.to_final(m["pos"]), nrm=mh.to_final(m["nrm"]), uv=m["uv"], joints=j, weights=w, idx=m["idx"], material=mat)


def piece_prim(pc, mat):
    return dict(pos=mh.to_final(pc["pos"]), nrm=mh.to_final(pc["nrm"]), uv=pc["uv"], joints=pc["joints"], weights=pc["weights"],
                idx=pc["idx"].reshape(-1).astype(np.uint32), material=mat)


def write(ch, prims, path):
    glb = prims[0]["_glb"]
    heads = ch.heads_final
    nodes, sock = rig.add_skeleton(glb, heads)
    for p in prims:
        p.pop("_glb", None)
    mesh = glb.mesh("body", prims)
    skin = glb.skin(nodes, rig.inverse_bind(heads), nodes[0])
    mnode = glb.node("body_mesh", mesh=mesh, skin=skin)
    root = glb.node("preview", children=[nodes[0], mnode])
    glb.g["scenes"][0]["nodes"] = [root]
    return glb.save(path)


if __name__ == "__main__":
    spec = dict(macro=dict(gender=1.0, age=0.5, muscle=0.6, weight=0.35, height=0.5, race="caucasian"), height=1.82, skin="young_african_male")
    ch = B.Char(spec)
    fit = cloth.CFit(ch)
    glb = Glb()
    tex = glb.texture_array("skin_albedo", B.skin_image(spec["skin"], 1024), "jpg", 88)
    prims = []
    p = skin_prim(glb, ch, glb.material("skin", base_tex=tex, rough=0.8))
    p["_glb"] = glb
    prims.append(p)
    pcs = []
    tank = cloth.torso_top(fit, "tank", off=0.014, bridge=0.04)
    pcs.append((cloth.finish(tank, fit), (0.1, 0.55, 0.55, 1)))
    pn = cloth.pants(fit, off=0.022, bridge=0.03)
    pcs.append((cloth.finish(pn, fit), (0.3, 0.3, 0.2, 1)))
    for pc, col in pcs:
        pc["uv"] = pc["uv_m"]
        prims.append(piece_prim(pc, glb.material("cloth", color=col, rough=0.85, double_sided=True)))
        print(len(pc["idx"]), "tris")
    print("bytes", write(ch, prims, OUT + "/prev.glb"))
