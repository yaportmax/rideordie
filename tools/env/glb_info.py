"""Pure-python GLB inspector.  usage: glb_info.py file.glb [--json]   -> tris, bbox, materials (with texture/alpha info), nodes."""
import json, struct, sys
import numpy as np


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    off = 12
    js, bin_ = None, None
    while off < length:
        cl, ct = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + cl]
        if ct == 0x4E4F534A:
            js = json.loads(chunk)
        elif ct == 0x004E4942:
            bin_ = chunk
        off += 8 + cl
    return js, bin_


def accessor(js, bin_, idx):
    a = js["accessors"][idx]
    bv = js["bufferViews"][a["bufferView"]]
    comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[a["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride")
    cs = np.dtype(comp).itemsize
    if stride and stride != cs * n:
        arr = np.frombuffer(bin_, dtype=np.uint8, count=a["count"] * stride, offset=off).reshape(a["count"], stride)[:, :cs * n].copy().view(comp).reshape(a["count"], n)
    else:
        arr = np.frombuffer(bin_, dtype=comp, count=a["count"] * n, offset=off).reshape(a["count"], n)
    return arr


def info(path):
    js, bin_ = read_glb(path)
    tris = 0
    mn = np.array([1e9] * 3); mx = np.array([-1e9] * 3)
    # walk nodes with translation/scale only (props are baked; nodes may have TRS)
    def node_matrix(n):
        M = np.eye(4)
        if "matrix" in n:
            M = np.array(n["matrix"]).reshape(4, 4).T
        else:
            t = n.get("translation", [0, 0, 0]); s = n.get("scale", [1, 1, 1]); q = n.get("rotation", [0, 0, 0, 1])
            x, y, z, w = q
            R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                          [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                          [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
            M[:3, :3] = R * np.array(s)
            M[:3, 3] = t
        return M
    scene = js["scenes"][js.get("scene", 0)]
    stack = [(i, np.eye(4)) for i in scene["nodes"]]
    names = []
    while stack:
        i, P = stack.pop()
        n = js["nodes"][i]
        M = P @ node_matrix(n)
        names.append(n.get("name", str(i)))
        if "mesh" in n:
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                pos = accessor(js, bin_, pr["attributes"]["POSITION"]).astype(np.float64)
                p = (M[:3, :3] @ pos.T).T + M[:3, 3]
                mn = np.minimum(mn, p.min(0)); mx = np.maximum(mx, p.max(0))
                if "indices" in pr:
                    tris += js["accessors"][pr["indices"]]["count"] // 3
                else:
                    tris += len(pos) // 3
        for c in n.get("children", []):
            stack.append((c, M))
    mats = []
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        mats.append(dict(name=m.get("name"), alpha=m.get("alphaMode", "OPAQUE"), double=m.get("doubleSided", False),
                         base=("tex" if "baseColorTexture" in pbr else pbr.get("baseColorFactor")),
                         mr="metallicRoughnessTexture" in pbr, normal="normalTexture" in m, occl="occlusionTexture" in m,
                         emissive=m.get("emissiveFactor")))
    vcol = any("COLOR_0" in pr["attributes"] for me in js.get("meshes", []) for pr in me["primitives"])
    return dict(tris=tris, min=mn.round(3).tolist(), max=mx.round(3).tolist(), size=(mx - mn).round(3).tolist(), materials=mats, nodes=names,
                images=len(js.get("images", [])), vcolor=vcol, extensions=js.get("extensionsUsed", []))


if __name__ == "__main__":
    r = info(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(r))
    else:
        for k, v in r.items():
            print(k, v)
