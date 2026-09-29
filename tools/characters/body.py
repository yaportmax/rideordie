"""Shaped MakeHuman body -> internal arrays (feet on the floor), face parts, skin texture handling."""
import glob
import os

import numpy as np
from PIL import Image

import mh

TEX_SRC = mh.ASSETS


class Char:
    """A shaped, skinned body in internal space (faces -Z) with its skeleton, weights and helper accessors."""

    def __init__(self, spec):
        self.spec = spec
        mh.SCALE = 1.0
        body = mh.Body().shape(spec["macro"], spec.get("extra", []))
        # Scale to the wanted standing height (soles to crown of the body mesh).
        idx = np.arange(13380)
        h0 = mh.to_game(body.v[idx])[:, 1]
        h = float(h0.max() - h0.min())
        self.sole = float(spec.get("sole", 0.03))
        mh.SCALE = (float(spec.get("height", 1.78)) - self.sole) / h
        self.scale = mh.SCALE
        self.body = body
        sk = mh.game_skeleton(body)
        pos_all = mh.to_game(body.v)
        ground = pos_all[idx, 1].min()
        self.lift = np.array([0.0, -ground + self.sole, 0.0])
        for k in sk["heads"]:
            sk["heads"][k] = sk["heads"][k] + self.lift
            sk["tails"][k] = sk["tails"][k] + self.lift
        self.sk = sk
        self.pos_all = pos_all + self.lift            # every MH vertex (incl. helper geometry)
        self.tv, self.tt = mh.triangulate(body.faces, lambda g: g == "body")
        self.vt = body.vt
        self.pos = self.pos_all[:13380]
        self.nrm = mh.vertex_normals(self.pos, self.tv)
        self.Wraw = mh.weight_matrix(body, sk, 13380)
        s = self.Wraw.sum(axis=1, keepdims=True)
        self.W = self.Wraw / np.maximum(s, 1e-9)
        self.top = np.argmax(self.W, axis=1)
        self.heads_final = np.array([mh.to_final(sk["heads"][n]) for n in mh.BONE_NAMES])

    def head_final(self, name):
        return mh.to_final(self.sk["heads"][name])

    def tail_final(self, name):
        return mh.to_final(self.sk["tails"][name])


def to_final_arrays(pos, nrm):
    return mh.to_final(pos), mh.to_final(nrm)


# --- textures ----------------------------------------------------------------------------------

def skin_image(name, size):
    src = glob.glob(TEX_SRC + "/skins/%s/*.png" % name)[0]
    im = Image.open(src).convert("RGB")
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im)
