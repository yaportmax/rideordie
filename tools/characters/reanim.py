"""Re-bake the animation clips of existing character GLBs without rebuilding meshes/textures (seconds instead of minutes).

    C:/Dev/conduit/art_src/venv/Scripts/python.exe tools/characters/reanim.py [id ...] [--only clip1,clip2] [--out DIR]

Reads public/models/characters/<id>.glb, takes the rest skeleton (bone node translations; every rest rotation is identity)
and the `body` mesh (exact ground contact for the falls), rebuilds the clips with anim.build_clips (same per-character
parameters as the full build: ANIM_PARAMS below), drops the old animations, compacts the buffer and writes the file back.
--only keeps every other existing clip and replaces/adds just the listed ones (fast iteration on one clip).
Sockets and meshes are untouched.
"""
import json
import os
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import anim  # noqa: E402
import mh  # noqa: E402
from glb import Glb  # noqa: E402

OUT_DIR = "C:/Dev/rideordie/public/models/characters"
IDS = ["hero_gunner", "hero_driver", "raider_a", "raider_b", "raider_c", "raider_d", "raider_driver",
       "raider_a2", "raider_b2", "raider_c2", "raider_d2", "raider_driver2"]
# per-character clip parameters (keep in sync with the c_<id>.py builds: ctx.bulk / ctx.seat)
ANIM_PARAMS = {"raider_c": dict(bulk=1.25, role="gunner"), "hero_driver": dict(seat=dict(wheel_up=0.37, wheel_fwd=0.66), role="driver"),
               "raider_driver": dict(role="driver"), "hero_gunner": dict(role="gunner"), "raider_a": dict(role="gunner"),
               "raider_b": dict(role="gunner"), "raider_d": dict(role="gunner"),
               "raider_a2": dict(role="gunner"), "raider_b2": dict(role="gunner"), "raider_c2": dict(bulk=1.25, role="gunner"),
               "raider_d2": dict(role="gunner"), "raider_driver2": dict(role="driver")}

_NP = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8, 5120: np.int8, 5122: np.int16}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67
    jl, jt = struct.unpack_from("<II", b, 12)
    js = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl, bt = struct.unpack_from("<II", b, off)
    return js, bytearray(b[off + 8:off + 8 + bl])


def accessor_data(js, binb, ai):
    a = js["accessors"][ai]
    v = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(_NP[a["componentType"]])
    n = _NC[a["type"]]
    start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = v.get("byteStride", 0)
    if stride and stride != dt.itemsize * n:
        raw = np.frombuffer(bytes(binb[start:start + stride * a["count"]]), np.uint8).reshape(a["count"], stride)
        arr = raw[:, :dt.itemsize * n].copy().view(dt).reshape(a["count"], n)
    else:
        arr = np.frombuffer(bytes(binb[start:start + dt.itemsize * n * a["count"]]), dt).reshape(a["count"], n)
    if a.get("normalized") and dt.kind in "ui":
        arr = arr.astype(np.float32) / float(np.iinfo(dt).max)
    return arr


def rest_heads(js):
    """World rest positions of the skeleton bones (mh.BONE_NAMES order) from the node tree (identity rotations)."""
    nodes = js["nodes"]
    name_to_i = {n.get("name"): i for i, n in enumerate(nodes)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    heads = np.zeros((len(mh.BONE_NAMES), 3))
    bone_nodes = []
    for b, name in enumerate(mh.BONE_NAMES):
        i = name_to_i[name]
        bone_nodes.append(i)
        p = np.zeros(3)
        k = i
        while k is not None:
            p += np.asarray(nodes[k].get("translation", [0, 0, 0]), float)
            k = parent.get(k)
        heads[b] = p
    return heads, bone_nodes


def body_mesh(js, binb):
    nodes = js["nodes"]
    for n in nodes:
        if n.get("name") == "body" and "mesh" in n:
            prim = js["meshes"][n["mesh"]]["primitives"][0]
            at = prim["attributes"]
            pos = accessor_data(js, binb, at["POSITION"]).astype(float)
            j = accessor_data(js, binb, at["JOINTS_0"]).astype(int)
            w = accessor_data(js, binb, at["WEIGHTS_0"]).astype(float)
            w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-9)
            return pos, j, w
    return None


def existing_clips(js, binb, bone_nodes):
    """Decode the existing animations back into anim.py clip dicts (times, rot (T,B,4), hips_t (T,3)), resampled at 30 fps."""
    out = {}
    node_to_bone = {n: b for b, n in enumerate(bone_nodes)}
    for a in js.get("animations", []):
        T = 0.0
        tracks = []
        for ch in a["channels"]:
            s = a["samplers"][ch["sampler"]]
            t = accessor_data(js, binb, s["input"])[:, 0].astype(float)
            v = accessor_data(js, binb, s["output"]).astype(float)
            T = max(T, float(t[-1]))
            tracks.append((ch["target"]["node"], ch["target"]["path"], t, v))
        n = int(round(T * anim.FPS))
        times = np.arange(n + 1) / anim.FPS
        rot = np.tile(np.array([0, 0, 0, 1.0]), (len(times), len(bone_nodes), 1))
        hips = None
        for node, path, t, v in tracks:
            b = node_to_bone.get(node)
            if b is None:
                continue
            if path == "rotation":
                if len(t) == 1:
                    rot[:, b] = v[0]
                else:
                    from scipy.spatial.transform import Rotation as R, Slerp
                    sl = Slerp(t, R.from_quat(v))
                    rot[:, b] = sl(np.clip(times, t[0], t[-1])).as_quat()
            elif path == "translation" and b == 0:
                hips = np.stack([np.interp(times, t, v[:, k]) for k in range(3)], axis=1)
        rot /= np.linalg.norm(rot, axis=-1, keepdims=True)
        if hips is None:
            hips = np.tile(np.asarray(js["nodes"][bone_nodes[0]].get("translation", [0, 0, 0]), float), (len(times), 1))
        out[a["name"]] = dict(times=times, rot=rot, hips_t=hips, loop=False, note="(kept)")
    return out


def compact_without_animations(js, binb):
    """Drop animations and every accessor/bufferView only they used; returns a Glb ready for new clips."""
    js = json.loads(json.dumps(js))
    js.pop("animations", None)
    used_acc = set()
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            used_acc.update(p["attributes"].values())
            if "indices" in p:
                used_acc.add(p["indices"])
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            used_acc.add(s["inverseBindMatrices"])
    used_views = {js["accessors"][a]["bufferView"] for a in used_acc}
    for im in js.get("images", []):
        if "bufferView" in im:
            used_views.add(im["bufferView"])
    view_map, new_views, new_bin = {}, [], bytearray()
    for vi in sorted(used_views):
        v = js["bufferViews"][vi]
        while len(new_bin) % 4:
            new_bin.append(0)
        off = len(new_bin)
        new_bin += binb[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
        nv = dict(v)
        nv["byteOffset"] = off
        nv["buffer"] = 0
        view_map[vi] = len(new_views)
        new_views.append(nv)
    acc_map, new_acc = {}, []
    for ai in sorted(used_acc):
        a = dict(js["accessors"][ai])
        a["bufferView"] = view_map[a["bufferView"]]
        acc_map[ai] = len(new_acc)
        new_acc.append(a)
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: acc_map[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = acc_map[p["indices"]]
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = acc_map[s["inverseBindMatrices"]]
    for im in js.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = view_map[im["bufferView"]]
    js["bufferViews"] = new_views
    js["accessors"] = new_acc
    js["animations"] = []
    for k in ("skins", "materials", "images", "textures", "samplers"):
        js.setdefault(k, [])
    g = Glb()
    g.g = js
    g.bin = new_bin
    g.uses_visibility = "KHR_node_visibility" in js.get("extensionsUsed", [])
    js.pop("extensionsUsed", None)
    return g


def reanim(cid, only=None, out_dir=OUT_DIR, verbose=True, recompress=False, src=None):
    t0 = time.time()
    path = src or os.path.join(out_dir, cid + ".glb")
    if not os.path.exists(path):
        path = os.path.join(OUT_DIR, cid + ".glb")
    js, binb = read_glb(path)
    heads, bone_nodes = rest_heads(js)
    if recompress:
        clips = existing_clips(js, binb, bone_nodes)
        keep = anim.role_filter(ANIM_PARAMS.get(cid, {}).get("role"))
        if keep is not None:
            clips = {k: v for k, v in clips.items() if keep(k)}
        g = compact_without_animations(js, binb)
        anim.write_clips(g, bone_nodes, clips)
        os.makedirs(out_dir, exist_ok=True)
        size = g.save(os.path.join(out_dir, cid + ".glb"))
        print("%s: recompressed %d clips, %.2f MB, %.1fs" % (cid, len(clips), size / 1e6, time.time() - t0), flush=True)
        return clips
    mesh = body_mesh(js, binb)
    kw = dict(ANIM_PARAMS.get(cid, {}))
    clips = anim.build_clips(heads, only=only, mesh=mesh, foot_sole=0.0, **kw)
    if only:
        old = existing_clips(js, binb, bone_nodes)
        old.update(clips)
        clips = old
    g = compact_without_animations(js, binb)
    order = list(clips.keys())
    anim.write_clips(g, bone_nodes, {k: clips[k] for k in order})
    os.makedirs(out_dir, exist_ok=True)
    size = g.save(os.path.join(out_dir, cid + ".glb"))
    if verbose:
        print("%s: %d clips, %.2f MB, %.1fs" % (cid, len(clips), size / 1e6, time.time() - t0), flush=True)
    return clips


if __name__ == "__main__":
    args = sys.argv[1:]
    only = None
    out = OUT_DIR
    if "--only" in args:
        i = args.index("--only")
        only = args[i + 1].split(",")
        del args[i:i + 2]
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i:i + 2]
    rec = "--recompress" in args
    src_dir = None
    if "--src" in args:
        i = args.index("--src")
        src_dir = args[i + 1]
        del args[i:i + 2]
    args = [a for a in args if a != "--recompress"]
    for cid in (args or IDS):
        reanim(cid, only, out, recompress=rec, src=os.path.join(src_dir, cid + ".glb") if src_dir else None)
