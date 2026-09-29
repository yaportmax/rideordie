"""Render far-distance billboard textures FROM the actual pine GLB (software orthographic rasteriser: textured, alpha-tested, vertex-colour AO,
   depth-cued so the interior of the crown is darker).  Two views (front along -Z, side along -X) side by side in ONE 512x512 RGBA png.
   usage: render_billboards.py pine_a pine_b pine_c     -> props texture cache billboard_<name>.png + billboard_<name>.json (quad width in metres)"""
import io
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_info import read_glb, accessor

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PTEX = os.environ.get("ROD_PROP_TEX", "C:/Dev/art_cache/rideordie/props_tex")
SS = 2


def load_model(path):
    js, bin_ = read_glb(path)
    imgs = []
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        off = bv.get("byteOffset", 0)
        imgs.append(Image.open(io.BytesIO(bin_[off: off + bv["byteLength"]])).convert("RGBA"))
    mats = []
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        tex = None
        if "baseColorTexture" in pbr:
            ti = pbr["baseColorTexture"]["index"]
            tex = np.asarray(imgs[js["textures"][ti]["source"]], dtype=np.float32) / 255.0
        mats.append(dict(tex=tex, factor=np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3], np.float32),
                         mask=m.get("alphaMode") == "MASK", cutoff=m.get("alphaCutoff", 0.5)))

    def node_matrix(n):
        M = np.eye(4)
        if "matrix" in n:
            return np.array(n["matrix"]).reshape(4, 4).T
        t = n.get("translation", [0, 0, 0]); s = n.get("scale", [1, 1, 1]); x, y, z, w = n.get("rotation", [0, 0, 0, 1])
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M[:3, :3] = R * np.array(s)
        M[:3, 3] = t
        return M

    tris = []          # (pos 3x3, uv 3x2, col 3x3, mat index)
    stack = [(i, np.eye(4)) for i in js["scenes"][js.get("scene", 0)]["nodes"]]
    while stack:
        i, P = stack.pop()
        n = js["nodes"][i]
        M = P @ node_matrix(n)
        if "mesh" in n:
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                pos = accessor(js, bin_, pr["attributes"]["POSITION"]).astype(np.float64)
                pos = (M[:3, :3] @ pos.T).T + M[:3, 3]
                uv = accessor(js, bin_, pr["attributes"]["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in pr["attributes"] else np.zeros((len(pos), 2), np.float32)
                if "COLOR_0" in pr["attributes"]:
                    acc = js["accessors"][pr["attributes"]["COLOR_0"]]
                    col = accessor(js, bin_, pr["attributes"]["COLOR_0"]).astype(np.float32)
                    if acc["componentType"] == 5121:
                        col /= 255.0
                    elif acc["componentType"] == 5123:
                        col /= 65535.0
                    col = col[:, :3]
                else:
                    col = np.ones((len(pos), 3), np.float32)
                idx = accessor(js, bin_, pr["indices"]).reshape(-1) if "indices" in pr else np.arange(len(pos))
                mi = pr.get("material", 0)
                for k in range(0, len(idx) - 2, 3):
                    a, b, c = idx[k], idx[k + 1], idx[k + 2]
                    tris.append((pos[[a, b, c]], uv[[a, b, c]], col[[a, b, c]], mi))
        for c in n.get("children", []):
            stack.append((c, M))
    return tris, mats


def render_view(tris, mats, view, Wm, Hm, Wpx, Hpx):
    """view 'A': camera at +Z looking -Z (screen x = X);  'B': camera at +X looking -X (screen x = -Z).  Returns rgba float (Hpx, Wpx, 4) at SS scale."""
    W, H = Wpx * SS, Hpx * SS
    zbuf = np.full((H, W), -1e9, np.float32)
    rgb = np.zeros((H, W, 3), np.float32)
    got = np.zeros((H, W), bool)
    dep = np.zeros((H, W), np.float32)
    for pos, uv, col, mi in tris:
        if view == "A":
            sx = pos[:, 0]; d = pos[:, 2]
        else:
            sx = -pos[:, 2]; d = pos[:, 0]
        px_ = sx / Wm * W + W / 2
        py_ = H - pos[:, 1] / Hm * H
        x0, x1 = int(max(0, math.floor(px_.min()))), int(min(W - 1, math.ceil(px_.max())))
        y0, y1 = int(max(0, math.floor(py_.min()))), int(min(H - 1, math.ceil(py_.max())))
        if x1 < x0 or y1 < y0:
            continue
        den = (py_[1] - py_[2]) * (px_[0] - px_[2]) + (px_[2] - px_[1]) * (py_[0] - py_[2])
        if abs(den) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((py_[1] - py_[2]) * (gx - px_[2]) + (px_[2] - px_[1]) * (gy - py_[2])) / den
        w1 = ((py_[2] - py_[0]) * (gx - px_[2]) + (px_[0] - px_[2]) * (gy - py_[2])) / den
        w2 = 1 - w0 - w1
        ins = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if not ins.any():
            continue
        z = w0 * d[0] + w1 * d[1] + w2 * d[2]
        m = mats[mi]
        if m["tex"] is not None:
            u = w0 * uv[0, 0] + w1 * uv[1, 0] + w2 * uv[2, 0]
            v = w0 * uv[0, 1] + w1 * uv[1, 1] + w2 * uv[2, 1]
            th, tw = m["tex"].shape[:2]
            ci = np.clip((u % 1.0) * tw, 0, tw - 1).astype(np.int32)
            ri = np.clip((v % 1.0) * th, 0, th - 1).astype(np.int32)
            s = m["tex"][ri, ci]
            alpha = s[..., 3]
            base = s[..., :3]
        else:
            base = np.ones(gx.shape + (3,), np.float32)
            alpha = np.ones(gx.shape, np.float32)
        base = base * m["factor"]
        if m["mask"]:
            ins &= alpha > m["cutoff"]
        vc = (w0[..., None] * col[0] + w1[..., None] * col[1] + w2[..., None] * col[2])
        c = base * vc
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        win = ins & (z > sub)
        if not win.any():
            continue
        zbuf[y0:y1 + 1, x0:x1 + 1] = np.where(win, z, sub)
        rgb[y0:y1 + 1, x0:x1 + 1][win] = c[win]
        got[y0:y1 + 1, x0:x1 + 1] |= win
        dep[y0:y1 + 1, x0:x1 + 1][win] = z[win]
    return rgb, got, dep, zbuf


def shade_and_pack(rgb, got, dep, Hm):
    H, W = got.shape
    if got.any():
        d = dep[got]
        lo, hi = np.percentile(d, 3), np.percentile(d, 97)
        dn = np.clip((dep - lo) / max(hi - lo, 1e-6), 0, 1)
    else:
        dn = np.zeros_like(dep)
    yy = 1.0 - (np.arange(H)[:, None] / H)
    shade = (0.80 + 0.20 * dn ** 0.85) * (0.92 + 0.08 * yy) * 1.0
    out = rgb * shade[..., None]
    return out


def to_final(out, got, Wpx, Hpx):
    a = got.astype(np.float32)
    pm = np.concatenate([out * a[..., None], a[..., None]], -1)
    small = pm.reshape(Hpx, SS, Wpx, SS, 4).mean((1, 3))
    al = small[..., 3]
    col = np.where(al[..., None] > 1e-3, small[..., :3] / np.maximum(al[..., None], 1e-3), 0)
    solid = al > 0.3
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    col = col[idx[0], idx[1]]
    return np.concatenate([col, al[..., None]], -1)


def bake(name):
    path = os.path.join(ROOT, "public", "models", "props", name + ".glb")
    tris, mats = load_model(path)
    allp = np.concatenate([t[0] for t in tris], 0)
    Hm = float(allp[:, 1].max())
    Wm = 2.0 * max(abs(allp[:, 0]).max(), abs(allp[:, 2]).max()) * 1.03
    Wpx, Hpx = 256, 512
    views = []
    for v in ("A", "B"):
        rgb, got, dep, zb = render_view(tris, mats, v, Wm, Hm * 1.01, Wpx, Hpx)
        views.append(to_final(shade_and_pack(rgb, got, dep, Hm), got, Wpx, Hpx))
    sheet = np.concatenate(views, 1)
    img = Image.fromarray((np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    img.save(os.path.join(PTEX, "billboard_%s.png" % name), optimize=True)
    json.dump(dict(width_m=round(Wm, 3), height_m=round(Hm * 1.01, 3)), open(os.path.join(PTEX, "billboard_%s.json" % name), "w"))
    print("billboard", name, "%.2f x %.2f m" % (Wm, Hm))


if __name__ == "__main__":
    for n in sys.argv[1:]:
        bake(n)
