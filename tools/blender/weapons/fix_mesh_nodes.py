"""Post-export fix for the weapon GLBs: every named part node (body, slide, trigger, crane, cylinder, lever, ...) becomes a pure
transform node whose geometry lives in a child node `mesh_<name>`.

Why: three.js turns a glTF node that has a single-primitive mesh into a THREE.Mesh carrying the node's name.  The game's load-time
merge (src/core/merge.js mergeRigid) then counts such a part mesh as a mesh of its PARENT group, bakes it into the parent's merged
mesh and removes the node - with its children (e.g. the revolver's `crane` took the `cylinder`, `eject` and `mag_well` with it, and
single-material triggers stopped animating).  With the geometry one level down every animated node survives as an Object3D.
Idempotent; runs automatically at the end of gunlib.export_gltf().
    python tools/blender/weapons/fix_mesh_nodes.py [gun ...]      (in place, public/models/weapons/<gun>.glb)
"""
import json
import os
import struct
import sys


def read_glb(path):
    b = open(path, "rb").read()
    magic, ver, total = struct.unpack_from("<III", b, 0)
    assert magic == 0x46546C67, path
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
        data = data + b"\x00" * ((4 - len(data) % 4) % 4)
        body += struct.pack("<II", len(data), typ) + data
    open(path, "wb").write(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)


def split_mesh_nodes(path, verbose=True):
    js, chunks = read_glb(path)
    nodes = js["nodes"]
    moved = []
    for i in range(len(nodes)):
        n = nodes[i]
        name = n.get("name", "")
        if "mesh" not in n or not name or name.startswith("mesh_") or "skin" in n:
            continue
        child = {"name": "mesh_" + name, "mesh": n.pop("mesh")}
        nodes.append(child)
        n.setdefault("children", []).append(len(nodes) - 1)
        moved.append(name)
    if moved:
        write_glb(path, js, chunks)
    if verbose:
        print("fix_mesh_nodes %s: %s" % (os.path.basename(path), ", ".join(moved) if moved else "nothing to do"))
    return moved


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    wdir = os.path.join(here, "..", "..", "..", "public", "models", "weapons")
    names = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(wdir) if f.endswith(".glb"))
    for g in names:
        split_mesh_nodes(os.path.join(wdir, g + ".glb"))
