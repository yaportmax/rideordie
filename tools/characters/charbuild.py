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


def _save_atlas(self, path, clips, hidden_groups, socket_pos, socket_rot, extras, sizes):
    """Draw-call-lean export: one `body` atlas material (+ `hair`, `eye`), one primitive per node."""
    import atlas
    out = Glb()
    merged = atlas.merge(self, out, sizes)
    heads = self.ch.heads_final
    nodes, sock = rig.add_skeleton(out, heads, socket_pos, socket_rot)
    skin = out.skin(nodes, rig.inverse_bind(heads), nodes[0])
    mesh_nodes = []
    names = {"body": "body", "hair": "hair", "eye": "eyes"}
    for gname, prims in merged.items():
        for p in prims:
            nm = names[p["_label"]] if gname == "main" else gname
            clean = {k: v for k, v in p.items() if not k.startswith("_")}
            mesh = out.mesh(nm, [clean])
            mesh_nodes.append(out.node(nm, mesh=mesh, skin=skin, hidden=gname in hidden_groups))
    if clips:
        import anim
        anim.write_clips(out, nodes, clips)
    root = out.node(self.name, children=[nodes[0]] + mesh_nodes, extras=extras)
    out.g["scenes"][0]["nodes"] = [root]
    return out.save(path)



def contract_name(n):
    """Map internal material names onto the ASSET_SPEC palette (prefix variants of palette names are kept)."""
    fixed = {"plastic_shell": "plastic", "paint_grenade": "metal_grenade"}
    if n in fixed:
        return fixed[n]
    if n.startswith("webbing_"):
        return "cloth_" + n
    return n


class Ctx:
    """One character under construction."""

    def __init__(self, name, spec):
        self.name = name
        self.spec = spec
        self.ch = B.Char(spec)
        self.glb = Glb()
        self.glb.lazy = True          # textures are only registered here; the atlas merge writes the real file
        self.mats = {}
        self.clamped = {"skin", "eye", "hair", "hair_face"}   # materials whose textures are atlases (not tiling)
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
    def save(self, path, clips=None, hidden_groups=(), socket_pos=None, socket_rot=None, extras=None, split_by_label=False,
             atlas_sizes=None):
        if atlas_sizes is not None:
            return _save_atlas(self, path, clips, hidden_groups, socket_pos, socket_rot, extras, atlas_sizes)
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
        for m in glb.g.get("materials", []):
            m["name"] = contract_name(m["name"])
        root = glb.node(self.name, children=[nodes[0]] + mesh_nodes, extras=extras)
        glb.g["scenes"][0]["nodes"] = [root]
        size = glb.save(path)
        return size


def _save_final(self, path=None, hidden_groups=(), split_by_label=False, extras=None, atlas_sizes=None):
    """Final export: all clips baked from this character's own proportions + socket frames (needs anim.py)."""
    path = path or (OUT_DIR + "/" + self.name + ".glb")
    clips, sp, sr = None, None, None
    try:
        import anim
        heads = self.ch.heads_final
        prims = [p for p in self.groups.get("main", []) if p.get("_label") not in ("hair", "brows", "eyes")]
        mesh = None
        if prims:
            mesh = (np.concatenate([p["pos"] for p in prims]), np.concatenate([np.asarray(p["joints"]) for p in prims]),
                    np.concatenate([np.asarray(p["weights"]) for p in prims]))
        clips = anim.build_clips(heads, bulk=getattr(self, "bulk", 1.0), mesh=mesh, foot_sole=0.0,
                                 seat=getattr(self, "seat", None))
        sp, sr = anim.socket_frames(heads, clips)
    except ImportError:
        print("  (anim.py not available: exporting without clips)")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    size = self.save(path, clips=clips, hidden_groups=hidden_groups, socket_pos=sp, socket_rot=sr, extras=extras,
                     split_by_label=split_by_label, atlas_sizes=atlas_sizes if atlas_sizes is not None else getattr(self, "atlas_sizes", None))
    print("saved", path, "%.2f MB" % (size / 1e6), "tris", self.tri_count(), "(visible main: %d)" % self.tri_count("main"))
    return size


Ctx.save_final = _save_final


def _report(self, top=30, group=None):
    from collections import defaultdict
    d = defaultdict(int)
    for g, prims in self.groups.items():
        if group is not None and g != group:
            continue
        for p in prims:
            d[p.get("_label") or "?"] += len(p["idx"]) // 3
    print("  tri breakdown:", ", ".join("%s %d" % (k, v) for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:top]), "| total", sum(d.values()))


Ctx.report = _report
