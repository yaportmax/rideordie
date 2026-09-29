"""Character assembly: materials, primitives, skeleton, skin, clips -> GLB."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import body as B
import mh
import rig
from glb import Glb

OUT_DIR = "C:/Dev/rideordie/public/models/characters"


class Ctx:
    """One character under construction."""

    def __init__(self, name, spec):
        self.name = name
        self.spec = spec
        self.ch = B.Char(spec)
        self.glb = Glb()
        self.mats = {}
        self.groups = {"main": []}          # node group -> list of prims (final space, skinned)
        self.notes = {}
        self.stats = {}

    # -- materials -------------------------------------------------------------------------------
    def material(self, name, **kw):
        if name not in self.mats:
            self.mats[name] = self.glb.material(name, **kw)
        return self.mats[name]

    def has_material(self, name):
        return name in self.mats

    # -- primitives -----------------------------------------------------------------------------
    def add(self, prim, material, group="main", label=None):
        """prim: dict(pos, nrm, uv, joints, weights, idx[, color]) in FINAL space."""
        p = dict(prim)
        p["material"] = material
        p["idx"] = np.asarray(p["idx"]).reshape(-1).astype(np.uint32)
        p["_label"] = label
        self.groups.setdefault(group, []).append(p)
        self.stats[(group, label)] = len(p["idx"]) // 3

    def tri_count(self, group=None):
        n = 0
        for g, prims in self.groups.items():
            if group is None or g == group:
                n += sum(len(p["idx"]) // 3 for p in prims)
        return n

    # -- output ---------------------------------------------------------------------------------
    def save(self, path, clips=None, hidden_groups=(), socket_pos=None, socket_rot=None, extras=None, split_by_label=False):
        glb = self.glb
        heads = self.ch.heads_final
        nodes, sock = rig.add_skeleton(glb, heads, socket_pos, socket_rot)
        skin = glb.skin(nodes, rig.inverse_bind(heads), nodes[0])
        mesh_nodes = []
        for gname, prims in self.groups.items():
            if not prims:
                continue
            if split_by_label:
                by = {}
                for p in prims:
                    by.setdefault(p.get("_label") or "x", []).append(p)
                for lab, pl in by.items():
                    clean = [{k: v for k, v in p.items() if not k.startswith("_")} for p in pl]
                    mesh = glb.mesh(lab, clean)
                    mesh_nodes.append(glb.node(lab, mesh=mesh, skin=skin, hidden=gname in hidden_groups))
                continue
            clean = [{k: v for k, v in p.items() if not k.startswith("_")} for p in prims]
            mesh = glb.mesh(gname, clean)
            nm = "body" if gname == "main" else gname
            mesh_nodes.append(glb.node(nm, mesh=mesh, skin=skin, hidden=gname in hidden_groups))
        if clips:
            import anim
            anim.write_clips(glb, nodes, clips)
        root = glb.node(self.name, children=[nodes[0]] + mesh_nodes, extras=extras)
        glb.g["scenes"][0]["nodes"] = [root]
        size = glb.save(path)
        return size
