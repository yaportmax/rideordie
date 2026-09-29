"""fp_arms stage 2 (runs inside Blender): geometry, UVs, AO bake -> _cache/fp_arms/stage2.npz.  See fp_arms.py.

Blender frame: game (x left, y up, z fwd) -> Blender (x, -z, y).  All lengths in metres.
"""
import math
import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_cache", "fp_arms")
SHOTS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "shots", "weapons", "arms")
MM = 0.001
FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")
SIDES = ("Left", "Right")

# ----------------------------------------------------------------------------------------------- design parameters
GLOVE_OFF = 0.95 * MM          # glove shell over the skin
KNUCKLE_PAD = 2.4 * MM         # padded knuckle bar (extra)
FINGER_CUT = {"Thumb": 0.70, "Index": 0.40, "Middle": 0.40, "Ring": 0.42, "Pinky": 0.45}   # along the middle phalanx
CUFF_LEN = 0.030               # glove cuff past the wrist joint (m)
CUFF_FLARE = 4.2 * MM          # cuff offset at its open end (clears the wraps)
WRAP_W = 0.034                 # cloth strip width
WRAP_PITCH = 0.0235            # advance per turn
WRAP_T = 1.35 * MM             # cloth thickness
WRAP_FROM = 0.18               # forearm fraction (0 = elbow, 1 = wrist) where the wraps start
WRAP_SEG = 24                  # segments per turn
REGION = {"skin": 0, "glove": 1, "glove_palm": 2, "wrap": 3, "watch": 4, "strap": 5, "metal": 6, "cord": 7, "glass": 8, "nail": 9, "hem": 10}


def log(*a):
    print("fp:", *a, flush=True)


def g2b(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def b2g(p):
    p = np.asarray(p, float)
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1)


def V(a):
    return Vector((float(a[0]), float(a[1]), float(a[2])))


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_from(name, verts, faces, uv_faces=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    if uv_faces is not None:
        uvl = me.uv_layers.new(name="UVMap")
        k = 0
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uv_faces[k]
                k += 1
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def activate(ob):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mods(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def vg_matrix(ob, names):
    """(V, B) vertex-group weights for the given group names."""
    Wt = np.zeros((len(ob.data.vertices), len(names)), np.float64)
    gi = {g.index: names.index(g.name) for g in ob.vertex_groups if g.name in names}
    for v in ob.data.vertices:
        for g in v.groups:
            j = gi.get(g.group)
            if j is not None:
                Wt[v.index, j] = g.weight
    return Wt


def set_vgroups(ob, names, Wt):
    ob.vertex_groups.clear()
    for bi, bn in enumerate(names):
        vg = ob.vertex_groups.new(name=bn)
        idx = np.flatnonzero(Wt[:, bi] > 1e-4)
        for i in idx:
            vg.add([int(i)], float(Wt[i, bi]), "REPLACE")


def nearest_dist(P, Q):
    """Distance from every point of P to the nearest point of Q (mathutils KD tree)."""
    from mathutils.kdtree import KDTree
    kd = KDTree(len(Q))
    for i, q in enumerate(Q):
        kd.insert(V(q), i)
    kd.balance()
    return np.array([kd.find(V(p))[2] for p in P])


def verts_np(ob):
    a = np.zeros(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def normals_np(ob):
    a = np.zeros(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("normal", a)
    return a.reshape(-1, 3)


# ----------------------------------------------------------------------------------------------- skeleton helpers
class Skel:
    def __init__(self, S):
        names = [str(n) for n in S["all_bones"]]
        self.H = {n: g2b(S["heads"][i]) for i, n in enumerate(names)}
        self.bones = [str(b) for b in S["bones"]]

    def h(self, n):
        return np.asarray(self.H[n], float)

    def hand_frame(self, side):
        w = self.h(side + "Hand")
        d0 = self.h(side + "HandMiddle1") - w
        d0 /= np.linalg.norm(d0)
        lat = self.h(side + "HandPinky1") - self.h(side + "HandIndex1")
        lat /= np.linalg.norm(lat)
        dorsal = np.cross(d0, lat) * (1.0 if side == "Left" else -1.0)
        dorsal -= d0 * np.dot(dorsal, d0)
        dorsal /= np.linalg.norm(dorsal)
        return d0, lat, dorsal


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-12)


class Limb:
    """Forearm cylinder frame + a smoothed skin radius field r(s, theta) (s: 0 elbow .. 1 wrist; theta 0 = dorsal)."""

    def __init__(self, sk, side, bvh, s_range=(-0.25, 1.12)):
        self.side = side
        e, w = sk.h(side + "ForeArm"), sk.h(side + "Hand")
        self.e, self.w = e, w
        self.L = float(np.linalg.norm(w - e))
        self.ax = (w - e) / self.L
        _, _, dorsal = sk.hand_frame(side)
        e1 = dorsal - self.ax * np.dot(dorsal, self.ax)
        self.e1 = unit(e1)
        self.e2 = np.cross(self.ax, self.e1)
        NS, NT = 100, 96
        self.sv = np.linspace(s_range[0], s_range[1], NS)
        self.tv = np.linspace(0, 2 * np.pi, NT, endpoint=False)
        off = np.zeros((NS, 2))
        for it in range(3):
            R = np.zeros((NS, NT))
            for i, s in enumerate(self.sv):
                c = e + self.ax * s * self.L + self.e1 * off[i, 0] + self.e2 * off[i, 1]
                pts = []
                for j, th in enumerate(self.tv):
                    d = self.e1 * math.cos(th) + self.e2 * math.sin(th)
                    hit = bvh.ray_cast(V(c), V(d), 0.2)
                    r = (hit[0] - V(c)).length if hit[0] is not None else 0.04
                    R[i, j] = r
                    pts.append(np.array([r * math.cos(th), r * math.sin(th)]))
                if it < 2:
                    off[i] += np.mean(pts, axis=0) * 0.9
            self.off = off
        from_sc = R.copy()
        # smooth: circular blur in theta, light blur in s
        k = np.array([1, 4, 6, 4, 1], float) / 16.0
        for _ in range(2):
            R = sum(np.roll(R, i - 2, axis=1) * k[i] for i in range(5))
        Rp = np.pad(R, ((2, 2), (0, 0)), mode="edge")
        R = sum(Rp[i:i + NS] * k[i] for i in range(5))
        self.R = R
        self.R_raw = from_sc

    def centre(self, s):
        s = np.asarray(s, float)
        ox = np.interp(s, self.sv, self.off[:, 0])
        oy = np.interp(s, self.sv, self.off[:, 1])
        return self.e + np.multiply.outer(s * self.L, self.ax) + np.multiply.outer(ox, self.e1) + np.multiply.outer(oy, self.e2)

    def radius(self, s, th):
        s = np.clip(np.asarray(s, float), self.sv[0], self.sv[-1])
        th = np.mod(np.asarray(th, float), 2 * np.pi)
        fi = (s - self.sv[0]) / (self.sv[1] - self.sv[0])
        fj = th / (2 * np.pi) * len(self.tv)
        i0 = np.clip(np.floor(fi).astype(int), 0, len(self.sv) - 2)
        j0 = np.floor(fj).astype(int) % len(self.tv)
        j1 = (j0 + 1) % len(self.tv)
        a, b = fi - i0, fj - np.floor(fj)
        R = self.R
        return (R[i0, j0] * (1 - a) * (1 - b) + R[i0 + 1, j0] * a * (1 - b) + R[i0, j1] * (1 - a) * b + R[i0 + 1, j1] * a * b)

    def point(self, s, th, off=0.0):
        s = np.asarray(s, float)
        th = np.asarray(th, float)
        c = self.centre(s)
        d = np.multiply.outer(np.cos(th), self.e1) + np.multiply.outer(np.sin(th), self.e2)
        r = self.radius(s, th) + off
        return c + d * r[..., None]

    def s_of(self, P):
        return (np.asarray(P) - self.e) @ self.ax / self.L

    def theta_of(self, P):
        s = self.s_of(P)
        q = np.asarray(P) - self.centre(s)
        return np.mod(np.arctan2(q @ self.e2, q @ self.e1), 2 * np.pi)


# ----------------------------------------------------------------------------------------------- skin
def build_skin(S, sk):
    ob = mesh_from("skin", g2b(S["pos"]), S["quads"], S["quv"].reshape(-1, 2))
    set_vgroups(ob, sk.bones, S["weights"].astype(np.float64))
    return ob


def subdivide(ob, levels=1):
    m = ob.modifiers.new("sub", "SUBSURF")
    m.levels = levels
    m.render_levels = levels
    m.uv_smooth = "PRESERVE_BOUNDARIES"
    m.boundary_smooth = "PRESERVE_CORNERS"
    apply_mods(ob)


def finger_region(sk, Wt, side, f):
    ids = [sk.bones.index("%sHand%s%d" % (side, f, k)) for k in (1, 2, 3)]
    return Wt[:, ids].sum(1)


def cut_planes(sk, side):
    """Glove openings: (point, normal pointing to the exposed side) per finger + the cuff plane."""
    out = {}
    for f in FINGERS:
        j2 = sk.h("%sHand%s2" % (side, f))
        j3 = sk.h("%sHand%s3" % (side, f))
        if f == "Thumb":
            p = j2 + (j3 - j2) * FINGER_CUT[f]
            n = unit(j3 - j2)
        else:
            p = j2 + (j3 - j2) * FINGER_CUT[f]
            n = unit(j3 - j2)
        out[f] = (p, n)
    return out


def glove_cut(ob, sk, limbs):
    """Bisect the skin at every glove opening (exact straight edge loops) and return the per-face glove flag."""
    names = sk.bones
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dl = bm.verts.layers.deform.verify()
    bidx = {g.name: g.index for g in ob.vertex_groups}

    def wsum(v, bnames):
        d = v[dl]
        return sum(d.get(bidx[b], 0.0) for b in bnames)

    for side in SIDES:
        planes = cut_planes(sk, side)
        for f in FINGERS:
            p, n = planes[f]
            bn = ["%sHand%s%d" % (side, f, k) for k in (1, 2, 3)]
            faces = [fc for fc in bm.faces if all(wsum(v, bn) > 0.55 for v in fc.verts)
                     and abs((fc.calc_center_median() - V(p)).dot(V(n))) < 0.012
                     and (fc.calc_center_median() - V(p)).length < 0.03]
            geom = list({e for fc in faces for e in fc.edges}) + faces + list({v for fc in faces for v in fc.verts})
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=V(p), plane_no=V(n))
        # cuff opening
        lb = limbs[side]
        s_c = 1.0 - CUFF_LEN / lb.L
        pc = lb.e + lb.ax * s_c * lb.L
        faces = [fc for fc in bm.faces if abs((fc.calc_center_median() - V(pc)).dot(V(lb.ax))) < 0.015
                 and (fc.calc_center_median() - V(pc)).length < 0.07 and wsum(fc.verts[0], [side + "ForeArm", side + "Hand"]) > 0.5]
        geom = list({e for fc in faces for e in fc.edges}) + faces + list({v for fc in faces for v in fc.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=V(pc), plane_no=V(lb.ax))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    # classify faces
    Wt = vg_matrix(ob, names)
    P = verts_np(ob)
    flags = np.zeros(len(ob.data.polygons), bool)
    cen = np.array([p.center[:] for p in ob.data.polygons])
    for side in SIDES:
        planes = cut_planes(sk, side)
        lb = limbs[side]
        s_c = 1.0 - CUFF_LEN / lb.L
        hand_ids = [names.index(n) for n in names if n.startswith(side + "Hand")]
        fa = names.index(side + "ForeArm")
        for pi, poly in enumerate(ob.data.polygons):
            vs = list(poly.vertices)
            wh = Wt[vs][:, hand_ids].sum(1).mean()
            wf = Wt[vs, fa].mean()
            if wh + wf < 0.5:
                continue
            c = cen[pi]
            if lb.s_of(c) < s_c:
                continue
            ok = True
            for f in FINGERS:
                reg = finger_region(sk, Wt[vs], side, f).mean()
                if reg > 0.5:
                    p, n = planes[f]
                    ok = np.dot(c - p, n) < 0
                    break
            flags[pi] = ok
    return flags


def region_masks(ob, sk):
    """Per-vertex helper fields in the Blender frame."""
    Wt = vg_matrix(ob, sk.bones)
    return Wt


# ----------------------------------------------------------------------------------------------- glove
def knuckle_pad_field(sk, side, P, N):
    """0..1 mask of the moulded knuckle guard (lobes over the MCP knuckles joined by a bar)."""
    d0, lat, dorsal = sk.hand_frame(side)
    up = smoothstep(0.30, 0.65, N @ dorsal)
    lobes = np.zeros(len(P))
    for f in ("Index", "Middle", "Ring", "Pinky"):
        k = sk.h("%sHand%s1" % (side, f))
        d = P - k
        a = d @ d0                     # toward the fingertips
        c = d @ lat
        r = np.sqrt(((a + 0.001) / 0.0105) ** 2 + (c / 0.0095) ** 2)
        lobes = np.maximum(lobes, smoothstep(1.0, 0.72, r))
    mcp = np.array([sk.h("%sHand%s1" % (side, f)) for f in ("Index", "Middle", "Ring", "Pinky")])
    a, b = mcp[0], mcp[-1]
    ab = b - a
    t = ((P - a) @ ab) / (ab @ ab)
    along = (P - (a + np.outer(np.clip(t, 0, 1), ab))) @ d0
    bar = smoothstep(0.0125, 0.0085, np.abs(along + 0.009)) * smoothstep(-0.12, 0.02, t) * smoothstep(1.12, 0.98, t)
    return np.clip(np.maximum(lobes, 0.55 * bar), 0, 1) * up


def build_glove(skin, flags, sk, limbs):
    """Offset shell of the glove faces + rolled hems at every opening.  The covered skin (minus a 1-ring margin) is removed."""
    names = sk.bones
    P = verts_np(skin)
    N = normals_np(skin)
    Wt = vg_matrix(skin, names)
    me = skin.data
    gf = np.flatnonzero(flags)
    # vertex set of the glove
    gv = sorted({v for i in gf for v in me.polygons[i].vertices})
    vmap = {v: i for i, v in enumerate(gv)}
    Pg = P[gv]
    Ng = N[gv]
    # offset field
    off = np.full(len(gv), GLOVE_OFF)
    for side in SIDES:
        lb = limbs[side]
        sel = np.array([Wt[v, [names.index(n) for n in names if n.startswith((side + "Hand", side + "ForeArm"))]].sum() > 0.5 for v in gv])
        s = lb.s_of(Pg)
        d0, lat, dorsal = sk.hand_frame(side)
        # cuff flare over the wraps
        wrist_s = 1.0
        fl = smoothstep(wrist_s + 0.005, wrist_s - CUFF_LEN / lb.L, s)
        off = np.where(sel, off + (CUFF_FLARE - GLOVE_OFF) * fl, off)
        # padded knuckle guard: one moulded lobe per knuckle (index..pinky) on a low bar, dorsal side only
        pad = knuckle_pad_field(sk, side, Pg, Ng)
        off = np.where(sel, off + KNUCKLE_PAD * pad, off)
    Po = Pg + Ng * off[:, None]
    faces = [[vmap[v] for v in me.polygons[i].vertices] for i in gf]
    uvl = me.uv_layers[0].data
    uvf = [tuple(uvl[li].uv) for i in gf for li in me.polygons[i].loop_indices]
    glove = mesh_from("glove", Po, faces, uvf)
    set_vgroups(glove, names, Wt[gv])
    # hems: every open boundary loop gets a rolled bead + a rim tucked under the skin surface
    bm = bmesh.new()
    bm.from_mesh(glove.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    dl = bm.verts.layers.deform.verify()
    bnd = [e for e in bm.edges if e.is_boundary]
    bverts = list({v for e in bnd for v in e.verts})
    # bead: push the last ring of the shell outward a little (rolled edge) - boundary verts + a 2 mm band
    Pn = np.array([v.co[:] for v in bm.verts])
    dist = nearest_dist(Pn, np.array([v.co[:] for v in bverts]))
    bead = np.exp(-(dist / 0.0016) ** 2) * 0.32 * MM
    for v in bm.verts:
        v.co += v.normal * float(bead[v.index])
    # rim: extrude boundary edges twice (down to the skin, then under it)
    ret = bmesh.ops.extrude_edge_only(bm, edges=bnd)
    newv = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
    newf = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMFace)]
    for v in newv:
        n = sum((f.normal for f in v.link_faces), Vector()).normalized() if v.link_faces else Vector((0, 0, 1))
        src = [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in bverts]
        base = src[0] if src else v
        nn = base.normal
        v.co = base.co - nn * (float(off[min(base.index, len(off) - 1)]) + 0.35 * MM)
    bm.faces.ensure_lookup_table()
    hem = [f.index for f in newf]
    bm.to_mesh(glove.data)
    bm.free()
    glove.data.update()
    glove["hem_faces"] = hem
    for p in glove.data.polygons:
        p.use_smooth = True
    return glove


# ----------------------------------------------------------------------------------------------- reduction / seams
def boundary_distance(ob):
    """Distance of every vertex to the nearest open-boundary vertex (inf when closed)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bv = np.array([v.co[:] for v in bm.verts if v.is_boundary])
    bm.free()
    P = verts_np(ob)
    if len(bv) == 0:
        return np.full(len(P), 1e9)
    return nearest_dist(P, bv)


def decimate(ob, ratio, keep_w, factor=8.0):
    """Collapse decimation; keep_w (per vertex, 0..1) = how strongly a vertex is protected."""
    vg = ob.vertex_groups.new(name="_decim")
    for i, w in enumerate(1.0 - np.clip(keep_w, 0, 1)):
        vg.add([i], float(w), "REPLACE")
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    m.vertex_group = "_decim"
    m.vertex_group_factor = factor
    m.use_collapse_triangulate = False
    n0 = len(ob.data.polygons)
    apply_mods(ob)
    ob.vertex_groups.remove(ob.vertex_groups["_decim"])
    log("decimate", ob.name, n0, "->", len(ob.data.polygons))


def split_faces(ob, mask, name):
    """Move the faces where mask is True into a new object (vertex groups kept)."""
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    bpy.context.scene.collection.objects.link(new)
    for o, keep in ((ob, ~mask), (new, mask)):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
    return new


def glove_seams(glove, sk, limbs):
    """Pattern seams: every glove is split into a back and a palm panel along the sides of the hand, the fingers, the thumb
    and the cuff (like a sewn glove).  Marks edge seams between faces of different panels."""
    names = sk.bones
    Wt = vg_matrix(glove, names)
    me = glove.data
    cen = np.array([p.center[:] for p in me.polygons])
    side_of = np.zeros(len(me.polygons), int)
    for side in SIDES:
        d0, lat, dorsal = sk.hand_frame(side)
        lb = limbs[side]
        sid = [i for i, n in enumerate(names) if n.startswith(side)]
        chains = {}
        for f in FINGERS:
            J = [sk.h("%sHand%s%d" % (side, f, k)) for k in (1, 2, 3)]
            J.append(J[2] + (J[2] - J[1]) * 0.9)
            if f != "Thumb":
                J.insert(0, sk.h(side + "Hand") + (J[0] - sk.h(side + "Hand")) * 0.5)
            chains[f] = np.array(J)
        for pi, poly in enumerate(me.polygons):
            vs = list(poly.vertices)
            if Wt[vs][:, sid].sum(1).mean() < 0.5:
                continue
            c = cen[pi]
            best, bw = None, 0.35
            for f in FINGERS:
                w = finger_region(sk, Wt[vs], side, f).mean()
                if w > bw:
                    best, bw = f, w
            if best is not None:
                J = chains[best]
                dmin, q = 1e9, None
                for a, b in zip(J[:-1], J[1:]):
                    t = np.clip(np.dot(c - a, b - a) / np.dot(b - a, b - a), 0, 1)
                    qq = a + (b - a) * t
                    dd = np.linalg.norm(c - qq)
                    if dd < dmin:
                        dmin, q = dd, qq
                ref = dorsal
                if best == "Thumb":
                    ax = unit(J[2] - J[1])
                    ref = unit(np.cross(ax, lat) * (1.0 if side == "Left" else -1.0))
                side_of[pi] = 1 if np.dot(c - q, ref) > 0 else 2
            elif lb.s_of(c) < 1.0:
                side_of[pi] = 1 if np.dot(c - lb.centre(np.array([lb.s_of(c)]))[0], lb.e1) > 0 else 2
            else:
                w = sk.h(side + "Hand")
                m = sk.h(side + "HandMiddle1")
                a = m - w
                t = np.clip(np.dot(c - w, a) / np.dot(a, a), 0, 1.2)
                side_of[pi] = 1 if np.dot(c - (w + a * t), dorsal) > 0 else 2
    bm = bmesh.new()
    bm.from_mesh(me)
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and side_of[fs[0].index] != side_of[fs[1].index]:
            e.seam = True
    bm.to_mesh(me)
    bm.free()
    glove["panel"] = side_of.tolist()
    return side_of


# ----------------------------------------------------------------------------------------------- wraps
def build_wrap(lb, side, seed=1):
    """Shingled spiral cloth strip, wound from the elbow toward the wrist (each turn laps over the previous one's wrist
    edge, so the rolled lips face the elbow = the first-person camera).  Ends 12 mm under the glove cuff."""
    rng = np.random.default_rng(seed)
    L = lb.L
    z0 = WRAP_FROM * L
    z1 = L - CUFF_LEN + 0.012
    U = (z1 - z0 - WRAP_W) / WRAP_PITCH
    nu = int(math.ceil(U * WRAP_SEG)) + 1
    u = np.linspace(0.0, U, nu)
    hand = 1.0 if side == "Left" else -1.0
    th = 0.6 + hand * 2 * np.pi * u
    zc = z0 + WRAP_W / 2 + (z1 - z0 - WRAP_W) * u / U
    ov = (WRAP_W - WRAP_PITCH) / WRAP_W
    # rows across the strip: (v, lift-over-previous flag)
    vs = np.array([0.0, 0.0, 0.12, ov - 0.04, ov + 0.12, 1.0])
    # low-frequency cloth irregularity along the strip
    def lf(n, amp, k):
        x = np.linspace(0, 1, n)
        out = np.zeros(n)
        for f in range(1, 7):
            out += rng.normal() * np.sin(2 * np.pi * (f * k * x + rng.random())) / f
        return out * amp / 1.6
    wob_z = lf(nu, 0.0016, U / 2)          # edge wander (m)
    wob_o = lf(nu, 0.00045, U / 1.5)       # looseness
    tilt = lf(nu, 0.0013, U / 3)
    zc = zc + lf(nu, 0.0022, U / 4) * smoothstep(0.0, 0.6, u) * smoothstep(U, U - 0.6, u)     # uneven pitch
    verts, uvs = [], []
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(lb.point(zc / L, th, 0.004), axis=0), axis=1))])
    for i in range(nu):
        prev_layer = min(1.0, max(0.0, u[i] - 0.85) / 0.3)        # first turn lies on the skin
        for k, v in enumerate(vs):
            z = zc[i] - WRAP_W / 2 + v * WRAP_W + wob_z[i] * (1 - v) + tilt[i] * (v - 0.5)
            over = (1 - smoothstep(ov - 0.10, ov + 0.06, v)) * prev_layer
            o = WRAP_T * (1.0 + over) + wob_o[i] + 0.25 * MM
            if k == 0:
                o -= WRAP_T * 0.95            # lip: the cut edge of the cloth
            elif k == 1:
                o -= WRAP_T * 0.18            # rolled edge
            p = lb.point(z / L, th[i], o)
            verts.append(p)
            uvs.append((arc[i], v * WRAP_W))
    nv = len(vs)
    faces = []
    for i in range(nu - 1):
        for k in range(nv - 1):
            a = i * nv + k
            faces.append((a, a + nv, a + nv + 1, a + 1))
    # the cut start of the tape (near the elbow): a thin end wall down to the skin
    base = len(verts)
    for k, v in enumerate(vs):
        q = np.asarray(verts[k], float)
        c = lb.centre(np.array([lb.s_of(q)]))[0]
        verts.append(q - unit(q - c) * WRAP_T * 1.1)
        uvs.append((-0.002, v * WRAP_W))
    for k in range(nv - 1):
        faces.append((k, k + 1, base + k + 1, base + k))
    ob = mesh_from("wrap_" + side, verts, faces)
    ob["turn_len"] = 0.19
    # strip uv (metres along, metres across)
    me = ob.data
    uvl = me.uv_layers.new(name="strip")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = uvs[vi]
    return ob


# ----------------------------------------------------------------------------------------------- previews
def preview(name, views, res=(1000, 750), lens=55, engine="WB"):
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = res
    if engine == "WB":
        scn.render.engine = "BLENDER_WORKBENCH"
        sh = scn.display.shading
        sh.light = "STUDIO"
        sh.color_type = "OBJECT"
        sh.show_cavity = True
        sh.cavity_type = "BOTH"
        sh.show_shadows = True
        sh.shadow_intensity = 0.4
        scn.display.render_aa = "8"
    else:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
        scn.eevee.taa_render_samples = 24
    cam = bpy.data.objects.get("pcam")
    if cam is None:
        cam = bpy.data.objects.new("pcam", bpy.data.cameras.new("pcam"))
        scn.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.005
    scn.camera = cam
    os.makedirs(SHOTS, exist_ok=True)
    files = []
    for vi, (target, direction, dist) in enumerate(views):
        t = V(target)
        d = V(direction).normalized()
        cam.location = t + d * dist
        cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
        scn.render.filepath = os.path.join(SHOTS, "%s_%d.png" % (name, vi))
        bpy.ops.render.render(write_still=True)
        files.append(scn.render.filepath)
    log("preview", name, len(views))
    return files


def colour(ob, c):
    ob.color = (c[0], c[1], c[2], 1.0)


# ----------------------------------------------------------------------------------------------- main
def stage2(src, out, args):
    import fp_arms_kit as K
    import fp_arms_atlas as A
    t0 = time.time()
    reset_scene()
    S = np.load(src)
    sk = Skel(S)
    names = sk.bones
    skin = build_skin(S, sk)
    subdivide(skin, 1)
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    limbs = {s: Limb(sk, s, bvh) for s in SIDES}
    flags = glove_cut(skin, sk, limbs)
    glove = build_glove(skin, flags, sk, limbs)
    log("glove", len(glove.data.polygons), "faces  %.1fs" % (time.time() - t0))
    wraps = {s: build_wrap(limbs[s], s, seed=3 if s == "Left" else 7) for s in SIDES}

    def field(ob, s):
        b = bmesh.new()
        b.from_mesh(ob.data)
        tree = BVHTree.FromBMesh(b)
        b.free()
        return Limb(sk, s, tree, s_range=(0.55, 1.08))
    parts = []            # (object, region, unwrap method, rigid)
    for s in SIDES:
        gf = field(glove, s)
        wf = field(wraps[s], s)
        strap, snap = K.build_strap(sk, s, gf)
        parts += [(strap, "strap", "STRIP", False), (snap, "metal", "SMART", True)]
        if s == "Left":
            wstrap, case, glass, lugs, buckle = K.build_watch(sk, s, wf)
            parts += [(wstrap, "strap", "STRIP", False), (case, "watch", "SMART", True), (glass, "glass", "SMART", True),
                      (lugs, "watch", "SMART", True), (buckle, "metal", "SMART", True)]
        else:
            cord, cbuckle = K.build_bracelet(sk, s, wf)
            parts += [(cord, "cord", "STRIP", False), (cbuckle, "watch", "SMART", True)]
        parts.append((wraps[s], "wrap", "STRIP", False))
    log("parts built %.1fs" % (time.time() - t0))
    # consistent outward winding: parametric bands/strips face away from the forearm axis; closed hard parts recalculated
    for ob, reg, meth, rigid in parts:
        side = "Left" if ob.name.endswith("Left") else "Right"
        orient_outward(ob, limbs[side], closed=(meth == "SMART" or reg == "cord"))
    for ob, reg, meth, rigid in parts:
        K.transfer_weights(ob, skin, names, rigid=rigid)
    K.cull_skin(skin, flags, sk, limbs)
    log("weights + cull %.1fs" % (time.time() - t0))
    # triangle budget: collapse-decimate the dense MakeHuman fingertips, the upper arms and the glove shells
    # (open boundaries / hems protected)
    Wt = vg_matrix(skin, names)
    hand_v = Wt[:, [i for i, n in enumerate(names) if "Hand" in n]].sum(1) > 0.5
    fmask = np.array([hand_v[list(p.vertices)].mean() > 0.5 for p in skin.data.polygons])
    skin_hand = split_faces(skin, fmask, "skin_hand")
    decimate(skin_hand, 0.52, np.exp(-(boundary_distance(skin_hand) / 0.0025) ** 2))
    decimate(skin, 0.42, np.exp(-(boundary_distance(skin) / 0.004) ** 2))
    gd = boundary_distance(glove)
    decimate(glove, 0.50, np.exp(-(gd / 0.0035) ** 2))
    activate(skin)
    skin_hand.select_set(True)
    bpy.ops.object.join()
    log("reduced %.1fs" % (time.time() - t0))
    A.set_face_attr(skin, "region", np.zeros(len(skin.data.polygons)))
    # hem faces after decimation: faces whose vertices all lie within 0.1 mm of the open boundary band
    gd = boundary_distance(glove)
    gr = np.array([REGION["hem"] if gd[list(p.vertices)].min() < 1e-6 else REGION["glove"] for p in glove.data.polygons])
    A.set_face_attr(glove, "region", gr)
    glove_seams(glove, sk, limbs)
    for ob, reg, meth, rigid in parts:
        A.set_face_attr(ob, "region", np.full(len(ob.data.polygons), REGION[reg]))
        if meth == "SMART":
            mark_sharp(ob, 50)
    A.unwrap(skin, "MH")
    A.unwrap(glove, "SEAMS")
    for ob, reg, meth, rigid in parts:
        A.unwrap(ob, meth)
    objs = [skin, glove] + [p[0] for p in parts]
    for ob in objs:
        if not ob.data.uv_layers.get("strip"):
            ob.data.uv_layers.new(name="strip")
    activate(skin)
    for ob in objs:
        ob.select_set(True)
    bpy.ops.object.join()
    arms = skin
    arms.name = "arms"
    log("joined", len(arms.data.polygons), "faces  %.1fs" % (time.time() - t0))
    reg = A.face_attr(arms, "region")
    Wt = vg_matrix(arms, names)
    hand_w = Wt[:, [i for i, n in enumerate(names) if "Hand" in n]].sum(1)
    inv = {v: k for k, v in REGION.items()}
    dens = np.zeros(len(arms.data.polygons))
    for p in arms.data.polygons:
        r = inv[int(reg[p.index])]
        if r == "skin":
            r = "skin_hand" if hand_w[list(p.vertices)].mean() > 0.5 else "skin_arm"
        dens[p.index] = A.DENSITY.get(r, 1.0)
    A.pack_atlas(arms, dens)
    os.makedirs(CACHE, exist_ok=True)
    ao_path = os.path.join(CACHE, "ao.png")
    if "--noao" not in args:
        A.bake_ao(arms, 2048, ao_path, samples=64 if "--fast" not in args else 16)
    A.export(arms, names, out, ao_path)
    log("stage2 done %.1fs" % (time.time() - t0))
    if "--preview" in args:
        colour(arms, (0.5, 0.4, 0.33))
        for side in ("Right", "Left"):
            hr = sk.h(side + "Hand")
            d0, lat, dors = sk.hand_frame(side)
            c = hr + d0 * 0.03
            lb = limbs[side]
            views = [(c, dors * 1.0 - lb.ax * 0.6, 0.30), (c, -dors + lat * 0.2, 0.30), (c, lat * 0.8 + dors * 0.3 - d0 * 0.3, 0.30),
                     (lb.e + lb.ax * lb.L * 0.7, dors * 0.4 - lb.ax * 0.9 + np.array([0, 0, 0.3]), 0.42)]
            preview("geo_" + side, views)


def orient_outward(ob, lb, closed=False):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    cen = np.array([f.calc_center_median()[:] for f in bm.faces])
    nrm = np.array([f.normal[:] for f in bm.faces])
    s = lb.s_of(cen)
    rad = cen - lb.centre(s)
    score = float(np.mean(np.sum(rad / np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-9) * nrm, axis=1)))
    flipped = False
    if (score < 0 and not closed) or score < -0.5:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        flipped = True
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log("orient", ob.name, "score %.2f" % score, "flipped" if flipped else "")


def mark_sharp(ob, deg):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    lim = math.radians(deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > lim:
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()
