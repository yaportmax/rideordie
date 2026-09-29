"""MakeHuman proxy assets (eyes, hair, brows, lashes, teeth) fitted to a Char and returned as skinned primitives."""
import glob
import os

import numpy as np
from PIL import Image

import mh

A = mh.ASSETS


def fit_asset(ch, mhclo, keep=None, tri_filter=None):
    """Fit a MakeHuman proxy (.mhclo) to the shaped body: returns arrays in FINAL space, skinned by the body's weights."""
    pv, pvt, pf, refs = mh.fit_proxy(ch.body, mhclo)
    ptv, ptt = mh.triangulate(pf, (lambda g: True) if keep is None else keep)
    if tri_filter is not None:
        k = tri_filter(ptv, ptt, pvt)
        ptv, ptt = ptv[k], ptt[k]
    ppos = mh.to_game(pv) + ch.lift
    pn = mh.vertex_normals(ppos, ptv)
    pm = mh.split_seams(ppos, pn, pvt, ptv, ptt)
    pj, pw = mh.proxy_weights(ch.body, ch.sk, refs)
    src = pm["src"]
    return dict(pos=mh.to_final(pm["pos"]), nrm=mh.to_final(pm["nrm"]), uv=pm["uv"], joints=pj[src], weights=pw[src],
                idx=pm["idx"])


def eyes(ch, colour="brown"):
    # (the cornea shells map to the transparent corner of the texture: drop them, the eyeball gets a clearcoat instead)
    d = fit_asset(ch, A + "/eyes/high-poly/high-poly.mhclo",
                  tri_filter=lambda tv, tt, vt: ~((vt[tt].mean(axis=1)[:, 0] > 0.85) & (vt[tt].mean(axis=1)[:, 1] < 0.2)))
    tex = np.asarray(Image.open(A + "/eyes/materials/%s_eye.png" % colour).convert("RGB").resize((512, 512), Image.LANCZOS))
    return d, tex


def hair_asset(ch, name):
    d = fit_asset(ch, A + "/hair/%s/%s.mhclo" % (name, name))
    src = glob.glob(A + "/hair/%s/*diffuse*.png" % name)[0]
    return d, src


def tint_hair_texture(src, colour, size=1024, strength=1.0, lift=0.0):
    """Recolour a MakeHuman hair texture: keep its luminance strand detail, replace the hue with `colour` (linear-ish sRGB 0..1)."""
    im = Image.open(src).convert("RGBA")
    if im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a[..., :3] @ np.array([0.3, 0.59, 0.11], np.float32)
    lum = lum / max(np.percentile(lum[a[..., 3] > 0.5], 90), 1e-3) if (a[..., 3] > 0.5).any() else lum
    col = np.array(colour, np.float32)
    rgb = np.clip((lum[..., None] * 0.85 + lift) * col[None, None, :], 0, 1)
    rgb = rgb * strength + a[..., :3] * (1.0 - strength)
    out = np.concatenate([np.clip(rgb, 0, 1), a[..., 3:4]], axis=-1)
    return (out * 255 + 0.5).astype(np.uint8)
