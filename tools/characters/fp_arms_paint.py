"""fp_arms stage 3 (numpy venv): texture painting from exact 3D fields + GLB assembly.  See fp_arms.py."""
import io
import os
import sys
import time

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import uvbake as U  # noqa: E402
from glb import Glb, FLOAT, UBYTE  # noqa: E402
import fp_arms_rig as RIG  # noqa: E402

CACHE = os.path.join(HERE, "_cache", "fp_arms")
SOCKETS = None
REGION = {"skin": 0, "glove": 1, "glove_palm": 2, "wrap": 3, "watch": 4, "strap": 5, "metal": 6, "cord": 7, "glass": 8, "nail": 9,
          "hem": 10}


# ============================================================================================================ GLB
def webp_bytes(arr, quality=90, lossless=False):
    im = Image.fromarray(np.asarray(arr, np.uint8))
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6, lossless=lossless)
    return buf.getvalue()


def add_webp(glb, key, arr, quality):
    data = webp_bytes(arr, quality)
    view = glb._view(data)
    glb.g["images"].append({"bufferView": view, "mimeType": "image/webp", "name": key})
    glb.g["textures"].append({"sampler": 0, "name": key, "extensions": {"EXT_texture_webp": {"source": len(glb.g["images"]) - 1}}})
    return len(glb.g["textures"]) - 1, len(data)


def write_glb(path, geo, S, tex, rig, clips):
    g = Glb(generator="ride-or-die fp_arms")
    bones = rig.bones
    # skeleton (identity rest rotations; translations = head offsets)
    node = {}
    for b in bones:
        p = rig.parent[b]
        t = rig.H[b] if p is None else rig.H[b] - rig.H[p]
        node[b] = g.node(b, t=t)
    for b in bones:
        p = rig.parent[b]
        if p is not None:
            g.g["nodes"][node[p]].setdefault("children", []).append(node[b])
    socks = SOCKETS or RIG.sockets(S)
    for name, (pos, q) in socks.items():
        hb = "RightHand" if name.endswith("_R") else "LeftHand"
        n = g.node(name, t=pos - rig.H[hb], r=q)
        g.g["nodes"][node[hb]].setdefault("children", []).append(n)
    ibms = []
    for b in bones:
        M = np.eye(4)
        M[:3, 3] = -rig.H[b]
        ibms.append(M)
    skin = g.skin([node[b] for b in bones], ibms, node["Spine2"], name="fp_arms")
    # material
    sizes = {}
    ti_a, sizes["albedo"] = add_webp(g, "fp_arms_albedo", tex["albedo"], 90)
    ti_o, sizes["orm"] = add_webp(g, "fp_arms_orm", tex["orm"], 90)
    ti_n, sizes["normal"] = add_webp(g, "fp_arms_normal", tex["normal"], 92)
    mat = g.material("fp_arms", color=(1, 1, 1, 1), metallic=1.0, rough=1.0, base_tex=ti_a, mr_tex=ti_o, occ_tex=ti_o, normal_tex=ti_n,
                     srgb=False)
    prim = dict(pos=geo["pos"], nrm=geo["nrm"], uv=geo["uv"], idx=geo["idx"], material=mat)
    # skin weights: top four influences
    Wt = geo["weights"].astype(np.float64)
    j = np.argsort(-Wt, axis=1)[:, :4]
    w = np.take_along_axis(Wt, j, axis=1)
    prim["joints"] = j
    prim["weights"] = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    mesh = g.mesh("arms", [prim])
    mnode = g.node("arms", mesh=mesh, skin=skin)
    # clips: finger tracks only (one frame)
    for cname, locs in clips.items():
        samplers, channels = [], []
        tin = g.accessor(np.zeros(1, np.float32), "SCALAR", minmax=True)
        for b in bones:
            if not any(f in b for f in RIG.FINGERS):
                continue
            q = RIG.R.from_matrix(locs.get(b, np.eye(3))).as_quat()
            out = g.accessor(np.asarray([q], np.float32), "VEC4")
            samplers.append({"input": tin, "output": out, "interpolation": "LINEAR"})
            channels.append({"sampler": len(samplers) - 1, "target": {"node": node[b], "path": "rotation"}})
        g.g["animations"].append({"name": cname, "samplers": samplers, "channels": channels})
    root = g.node("fp_arms", children=[node["Spine2"], mnode])
    g.g["scenes"][0]["nodes"] = [root]
    g.g.setdefault("extensionsUsed", []).append("EXT_texture_webp")
    g.g["extensionsRequired"] = ["EXT_texture_webp"]
    # Glb.save rewrites extensionsUsed from material extensions only: keep ours
    used = list(g.g["extensionsUsed"])
    size = g.save(path)
    if "EXT_texture_webp" not in g.g.get("extensionsUsed", []):
        g.g["extensionsUsed"] = used + [e for e in g.g.get("extensionsUsed", []) if e not in used]
        size = g.save(path)
    print("fp_arms: %s  %.2f MB  tris %d  verts %d  textures %s" % (path, size / 1e6, len(geo["idx"]) // 3, len(geo["pos"]),
                                                                    {k: "%d KB" % (v // 1024) for k, v in sizes.items()}))
    return size


# ============================================================================================================ quick paint
def quick_textures(geo, size):
    idx = geo["idx"].reshape(-1, 3)
    # debug palette: skin tan, glove blue, (palm) navy, wrap yellow, watch white, strap red, metal cyan, cord green, glass orange,
    # nail pink, hem magenta
    cols = np.array([[0.36, 0.24, 0.17], [0.05, 0.1, 0.6], [0.02, 0.02, 0.3], [0.6, 0.55, 0.05], [0.8, 0.8, 0.8],
                     [0.6, 0.05, 0.05], [0.05, 0.6, 0.6], [0.1, 0.6, 0.1], [0.9, 0.4, 0.0], [0.9, 0.5, 0.6], [0.8, 0.05, 0.8]])
    img, mask = U.rasterize(geo["uv"], idx, cols[geo["region"]], size)
    img = U.dilate(img, mask, 16)
    ao = np.asarray(Image.open(str(geo["ao"])).convert("L").resize((size, size)), np.float32) / 255.0
    alb = img * (0.4 + 0.6 * ao[..., None])
    alb = np.clip(alb, 0, 1)
    orm = np.stack([ao, np.full_like(ao, 0.7), np.zeros_like(ao)], -1)
    nrm = U.flat_normal(size)
    return dict(albedo=(alb * 255).astype(np.uint8), orm=(orm * 255).astype(np.uint8), normal=nrm)


# ============================================================================================================ stage 3
def stage3(geo_npz, src_npz, out_glb, size, quick=False, reuse=False):
    t0 = time.time()
    geo = dict(np.load(geo_npz))
    S = np.load(src_npz)
    rig = RIG.FpRig(S)
    assert [str(b) for b in geo["bones"]] == rig.bones
    import fp_arms_fit as FIT
    global SOCKETS
    poses, SOCKETS, _ = FIT.solve_poses(rig, S)
    for cname, sides in poses.items():
        print("  %s  R %s | L %s" % (cname, {k: v for k, v in sides["Right"].items() if not k.startswith("_")},
                                     {k: v for k, v in sides["Left"].items() if not k.startswith("_")}))
    clips = {name: rig.finger_locals(p) for name, p in poses.items()}
    tex_cache = os.path.join(CACHE, "tex.npz")
    if quick:
        tex = quick_textures(geo, size)
    elif reuse and os.path.exists(tex_cache):
        tex = dict(np.load(tex_cache))
    else:
        import fp_arms_tex
        tex = fp_arms_tex.paint(geo, rig, size)
        np.savez_compressed(tex_cache, **tex)
    write_glb(out_glb, geo, S, tex, rig, clips)
    print("stage3 %.1fs" % (time.time() - t0))
