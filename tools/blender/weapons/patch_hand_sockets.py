"""Write the fitted hand sockets (hand_sockets.json, from tools/characters/fp_arms_place.py) into the weapon GLBs in place:
only the grip_R / grip_L node transforms change (no rebuild, textures untouched).  The build scripts read the same JSON through
gunlib.hand_socket(), so a rebuild reproduces exactly these values.
    python tools/blender/weapons/patch_hand_sockets.py [gun ...]
"""
import json
import os
import struct
import sys

import numpy as np
from scipy.spatial.transform import Rotation as R

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
P = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], float)      # G (x fwd, y left, z up) -> glTF (x left, y up, z fwd)


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67
    off, chunks = 12, []
    while off < total:
        ln, typ = struct.unpack_from("<II", b, off)
        chunks.append([typ, b[off + 8: off + 8 + ln]])
        off += 8 + ln
    return json.loads(chunks[0][1].decode("utf8")), chunks


def write_glb(path, js, chunks):
    jb = json.dumps(js, separators=(",", ":")).encode("utf8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    chunks[0][1] = jb
    body = b""
    for typ, data in chunks:
        pad = (4 - len(data) % 4) % 4
        data = data + (b"\x00" * pad)
        body += struct.pack("<II", len(data), typ) + data
    out = struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
    open(path, "wb").write(out)


def node_world(js, i, parents):
    M = np.eye(4)
    chain = []
    while i is not None:
        chain.append(i)
        i = parents.get(i)
    for k in reversed(chain):
        n = js["nodes"][k]
        L = np.eye(4)
        if "matrix" in n:
            L = np.array(n["matrix"], float).reshape(4, 4).T
        else:
            L[:3, :3] = R.from_quat(n.get("rotation", [0, 0, 0, 1])).as_matrix() @ np.diag(n.get("scale", [1, 1, 1]))
            L[:3, 3] = n.get("translation", [0, 0, 0])
        M = M @ L
    return M


def patch(gun, entry):
    path = os.path.join(ROOT, "public", "models", "weapons", gun + ".glb")
    js, chunks = read_glb(path)
    parents = {c: i for i, n in enumerate(js["nodes"]) for c in n.get("children", [])}
    names = {n.get("name"): i for i, n in enumerate(js["nodes"])}
    for sock, v in entry.items():
        i = names[sock]
        W = np.eye(4)
        W[:3, :3] = P @ R.from_euler("xyz", v["rot"], degrees=True).as_matrix() @ P.T
        W[:3, 3] = P @ (np.asarray(v["pos"], float) / 1000.0)
        par = parents.get(i)
        Lm = np.linalg.inv(node_world(js, par, parents)) @ W if par is not None else W
        n = js["nodes"][i]
        old = (n.get("translation"), n.get("rotation"))
        n.pop("matrix", None)
        n["translation"] = [round(float(x), 6) for x in Lm[:3, 3]]
        q = R.from_matrix(Lm[:3, :3]).as_quat()
        if np.linalg.norm(q[:3]) < 1e-7:
            n.pop("rotation", None)
        else:
            n["rotation"] = [round(float(x), 7) for x in q]
        print("  %s %s: %s -> t %s r %s" % (gun, sock, old, n["translation"], n.get("rotation")))
    write_glb(path, js, chunks)


if __name__ == "__main__":
    S = json.load(open(os.path.join(HERE, "hand_sockets.json")))
    for g in sys.argv[1:] or sorted(S):
        patch(g, S[g])
