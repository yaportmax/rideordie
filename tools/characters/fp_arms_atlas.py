"""fp_arms stage 2 (Blender): UV atlas (seams, per-region texel density, packing), Cycles AO bake, export to npz."""
import os

import bmesh
import bpy
import numpy as np

from fp_arms_blender import REGION, activate, b2g, log, vg_matrix

# relative texel density (linear) per region
DENSITY = {"skin_hand": 1.25, "skin_arm": 0.42, "glove": 1.0, "glove_palm": 1.0, "hem": 1.0, "wrap": 0.62, "strap": 0.85,
           "watch": 1.4, "glass": 1.4, "metal": 1.2, "cord": 0.85}


def set_face_attr(ob, name, values):
    me = ob.data
    at = me.attributes.get(name) or me.attributes.new(name, "INT", "FACE")
    at.data.foreach_set("value", np.asarray(values, np.int32))


def face_attr(ob, name):
    at = ob.data.attributes[name]
    a = np.zeros(len(ob.data.polygons), np.int32)
    at.data.foreach_get("value", a)
    return a


def ensure_uv(ob):
    if not ob.data.uv_layers.get("UVMap"):
        ob.data.uv_layers.new(name="UVMap")
    ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]


def mark_seams_by_region(ob):
    reg = face_attr(ob, "region")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and reg[fs[0].index] != reg[fs[1].index]:
            e.seam = True
    bm.to_mesh(ob.data)
    bm.free()


def unwrap(ob, method="MH"):
    """MH: seams from the MakeHuman islands + angle-based unwrap. SMART: smart project. STRIP: strip coords split per turn."""
    activate(ob)
    ensure_uv(ob)
    if method == "STRIP":
        me = ob.data
        st = me.uv_layers["strip"].data
        uv = me.uv_layers["UVMap"].data
        seg = ob.get("turn_len", 0.25)
        # split the strip into ~turn-long islands: every face gets u relative to its island start
        for poly in me.polygons:
            us = [st[li].uv[0] for li in poly.loop_indices]
            k = np.floor(min(us) / seg + 1e-6)
            for li in poly.loop_indices:
                uv[li].uv = (st[li].uv[0] - k * seg, st[li].uv[1])
        return
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if method == "SEAMS":
        bpy.ops.object.mode_set(mode="OBJECT")
        mark_seams_by_region(ob)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.002, fill_holes=True)
    elif method == "MH":
        bpy.ops.uv.seams_from_islands(mark_seams=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        mark_seams_by_region(ob)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.002)
    else:
        bpy.ops.uv.smart_project(angle_limit=1.05, island_margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_islands(bm, uvl):
    """Union-find over faces sharing an edge with identical UVs on both sides."""
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) != 2 or e.seam:
            continue
        a, b = fs
        la = {l.vert.index: l[uvl].uv.copy() for l in a.loops}
        lb = {l.vert.index: l[uvl].uv.copy() for l in b.loops}
        ok = all((la[v.index] - lb[v.index]).length < 1e-6 for v in e.verts)
        if ok:
            ra, rb = find(a.index), find(b.index)
            if ra != rb:
                parent[ra] = rb
    return [find(i) for i in range(len(bm.faces))]


def pack_atlas(ob, dens_face):
    """Uniform texel density (average islands scale), then per-island scale by region density, then pack."""
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    uvl = bm.loops.layers.uv["UVMap"]
    isl = np.array(uv_islands(bm, uvl))
    for r in np.unique(isl):
        fs = np.flatnonzero(isl == r)
        k = float(np.median(dens_face[fs]))
        loops = [l for i in fs for l in bm.faces[int(i)].loops]
        c = sum((l[uvl].uv for l in loops), loops[0][uvl].uv * 0) / len(loops)
        for l in loops:
            l[uvl].uv = c + (l[uvl].uv - c) * k
    bm.to_mesh(ob.data)
    bm.free()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=0.006, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    log("islands", len(np.unique(isl)))


def bake_ao(ob, size, path, samples=96):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    img = bpy.data.images.new("ao", size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    mat = bpy.data.materials.new("bake")
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    ob.data.uv_layers.active = ob.data.uv_layers["UVMap"]
    activate(ob)
    scn.render.bake.margin = 12
    scn.world = scn.world or bpy.data.worlds.new("w")
    bpy.ops.object.bake(type="AO", margin=12)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    log("AO baked", path)


def export(ob, names, path, ao_path):
    """Triangles, split by (vertex, uv, normal): pos/nrm (game space), uv (glTF), strip, weights, region -> npz."""
    me = ob.data
    me.calc_loop_triangles()
    reg = face_attr(ob, "region")
    uvd = me.uv_layers["UVMap"].data
    std = me.uv_layers["strip"].data if me.uv_layers.get("strip") else None
    cn = me.corner_normals
    Wt = vg_matrix(ob, names)
    P = np.array([v.co[:] for v in me.vertices])
    key, out_v, out_uv, out_n, out_st, out_r, idx = {}, [], [], [], [], [], []
    for lt in me.loop_triangles:
        r = int(reg[lt.polygon_index])
        for li in lt.loops:
            v = me.loops[li].vertex_index
            uv = tuple(uvd[li].uv)
            n = tuple(cn[li].vector)
            k = (v, round(uv[0], 6), round(uv[1], 6), round(n[0], 3), round(n[1], 3), round(n[2], 3), r)
            j = key.get(k)
            if j is None:
                j = len(out_v)
                key[k] = j
                out_v.append(v)
                out_uv.append((uv[0], 1.0 - uv[1]))
                out_n.append(n)
                out_st.append(tuple(std[li].uv) if std is not None else (0.0, 0.0))
                out_r.append(r)
            idx.append(j)
    out_v = np.array(out_v)
    np.savez(path, pos=b2g(P[out_v]), nrm=b2g(np.array(out_n)), uv=np.array(out_uv), strip=np.array(out_st),
             weights=Wt[out_v].astype(np.float32), region=np.array(out_r, np.int32), idx=np.array(idx, np.uint32),
             bones=np.array(names), ao=ao_path)
    log("exported", len(out_v), "verts", len(idx) // 3, "tris ->", path)
