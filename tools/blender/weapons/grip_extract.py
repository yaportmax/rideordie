"""Dump every weapon GLB's triangles (rest pose) in the G frame (mm: +X fwd, +Y left, +Z up) plus its sockets, for the
fp_arms hand-placement fit (tools/characters/fp_arms_fit.py).
    blender -b --factory-startup -P tools/blender/weapons/grip_extract.py -- rifle pistol ...   -> tools/characters/_cache/fp_arms/gun_<name>.npz
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "tools", "characters", "_cache", "fp_arms")
SOCKS = ("grip_R", "grip_L", "sight", "muzzle", "mag_well", "stock", "eject")


def g_of(v):
    return (-v[1] * 1000.0, v[0] * 1000.0, v[2] * 1000.0)


def dump(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "public", "models", "weapons", name + ".glb"))
    dg = bpy.context.evaluated_depsgraph_get()
    tris, oid, names = [], [], []
    socks = {}
    for ob in bpy.context.scene.objects:
        if ob.name in SOCKS:
            m = ob.matrix_world
            socks[ob.name] = np.array(g_of(m.translation))
            socks[ob.name + "_rot"] = np.array([[m[r][c] for c in range(3)] for r in range(3)])
        if ob.type != "MESH":
            continue
        # attribute the mesh to its nearest named ancestor node that is not a plain mesh holder
        tag = ob.name
        p = ob
        while p.parent is not None and p.name.startswith(("Mesh", "mesh")):
            p = p.parent
            tag = p.name
        eo = ob.evaluated_get(dg)
        me = eo.to_mesh()
        me.calc_loop_triangles()
        M = ob.matrix_world
        co = np.array([g_of(M @ v.co) for v in me.vertices])
        idx = np.array([t.vertices[:] for t in me.loop_triangles], int)
        if len(idx):
            tris.append(co[idx])
            oid.append(np.full(len(idx), len(names)))
            names.append(tag)
        eo.to_mesh_clear()
    tris = np.concatenate(tris)
    oid = np.concatenate(oid)
    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(os.path.join(OUT, "gun_%s.npz" % name), tris=tris, oid=oid, names=np.array(names),
                        **{"s_" + k: v for k, v in socks.items()})
    print("GUN", name, len(tris), "tris", names, sorted(k for k in socks if not k.endswith("_rot")))


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in argv or ["pistol", "revolver", "smg", "shotgun", "rifle", "lmg", "sniper", "rpg"]:
        dump(n)
