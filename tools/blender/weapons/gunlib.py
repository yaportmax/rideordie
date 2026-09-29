"""RIDE OR DIE weapons library: hard-surface firearm modelling helpers (units in MILLIMETRES in scripts).

Authoring frame ("G frame", right handed):  +X = forward (muzzle),  +Y = LEFT,  +Z = up.   Origin = pistol-grip centre (right palm).
Final GLB frame is produced automatically at build time: G(x,y,z) -> Blender(y,-x,z)  ==>  glTF: muzzle +Z, left +X, up +Y, metres.

Typical script:
    from gunlib import *
    G = Gun("pistol")
    body = G.part("body")
    body.box((100, 20, 30), c=(0, 0, 50), mat="gun_black", bevel=0.8)
    G.socket("muzzle", (134, 0, 54))
    G.finish()            # builds nodes, textures (unless --flat), exports public/models/weapons/pistol.glb
"""
import bpy
import bmesh
import math
import os
import sys
import time
from mathutils import Vector, Matrix, Euler

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rod_lib as RL  # noqa: E402

S = 0.001          # mm -> m
D2R = math.pi / 180.0
OUT_DIR = os.path.join(RL.PUBLIC, "models", "weapons")
R_G2B = Matrix.Rotation(-90 * D2R, 4, "Z")   # G frame -> Blender frame (fwd +X -> -Y, left +Y -> +X)


def rotm(rot):
    return Euler([a * D2R for a in rot], "XYZ").to_matrix().to_4x4()


def hand_sockets():
    """Fitted grip_R / grip_L transforms per gun (G frame mm + Euler XYZ deg), see tools/characters/fp_arms_place.py."""
    import json
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hand_sockets.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def xform(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    return Matrix.Translation(loc) @ rotm(rot) @ Matrix.Scale(scale, 4)


# ------------------------------------------------------------------------------------------- 2D helpers
def fillet_poly(pts, radii, segs=4):
    """Round the corners of a closed 2D polygon. radii: scalar or per-vertex list (0 = keep sharp)."""
    n = len(pts)
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * n
    out = []
    for i in range(n):
        P = Vector(pts[i]); A = Vector(pts[i - 1]); B = Vector(pts[(i + 1) % n])
        r = radii[i]
        if r <= 1e-6:
            out.append((P.x, P.y)); continue
        u = (A - P); v = (B - P)
        lu, lv = u.length, v.length
        u.normalize(); v.normalize()
        cosang = max(-1.0, min(1.0, u.dot(v)))
        th = math.acos(cosang)
        if th < 1e-3 or abs(th - math.pi) < 1e-3:
            out.append((P.x, P.y)); continue
        t = r / math.tan(th / 2)
        tmax = min(lu, lv) * 0.5
        if t > tmax:
            r = r * tmax / t; t = tmax
        T1 = P + u * t; T2 = P + v * t
        C = P + (u + v).normalized() * (r / math.sin(th / 2))
        a1 = math.atan2(T1.y - C.y, T1.x - C.x); a2 = math.atan2(T2.y - C.y, T2.x - C.x)
        d = a2 - a1
        while d > math.pi: d -= 2 * math.pi
        while d < -math.pi: d += 2 * math.pi
        for k in range(segs + 1):
            a = a1 + d * k / segs
            out.append((C.x + r * math.cos(a), C.y + r * math.sin(a)))
    return out


def rrect_ring(w, h, r=0.0, n=3, c=(0, 0)):
    """Rounded-rectangle ring (CCW) of (y,z) points: width w (y), height h (z), corner radius r."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    if r <= 1e-4:
        pts = [(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]
        return [(c[0] + a, c[1] + b) for a, b in pts]
    pts = []
    corners = [(w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180)]
    for cx, cz, a0 in corners:
        for k in range(n + 1):
            a = (a0 + 90.0 * k / n) * D2R
            pts.append((c[0] + cx + r * math.cos(a), c[1] + cz + r * math.sin(a)))
    return pts


def ellipse_ring(w, h, N=16, c=(0, 0), phase=0.0):
    return [(c[0] + w / 2 * math.cos(phase + 2 * math.pi * k / N), c[1] + h / 2 * math.sin(phase + 2 * math.pi * k / N)) for k in range(N)]


def catmull(pts, n=6):
    """Catmull-Rom subdivision of a 3D polyline (through the points)."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return P
    out = []
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


# ------------------------------------------------------------------------------------------- bmesh builders (all return a bmesh, mm)
def _fin(bm, xf=None, c=None, rot=None):
    if rot is not None and any(rot):
        bmesh.ops.transform(bm, matrix=rotm(rot), verts=bm.verts)
    if c is not None and any(c):
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c), verts=bm.verts)
    if xf is not None:
        bmesh.ops.transform(bm, matrix=xf, verts=bm.verts)
    return bm


def box_bm(size, c=(0, 0, 0), rot=(0, 0, 0), taper=None, xf=None):
    """Box centred at c. taper=(ky,kz): scale of the +x end cross-section relative to the -x end (applied before rot)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        x, y, z = v.co
        if taper:
            f = x + 0.5
            ky = 1 + (taper[0] - 1) * f; kz = 1 + (taper[1] - 1) * f
            v.co = (x * sx, y * sy * ky, z * sz * kz)
        else:
            v.co = (x * sx, y * sy, z * sz)
    return _fin(bm, xf, c, rot)


def prism_bm(pts, y0, y1, fillet=0.0, fsegs=4, c=None, rot=None, xf=None):
    """Extrude a side-profile polygon [(x,z),...] across y in [y0,y1]."""
    if fillet:
        pts = fillet_poly(pts, fillet, fsegs)
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        try:
            bm.faces.new((a[i], a[j], b[j], b[i]))
        except ValueError:
            pass
    try:
        bm.faces.new(a)
        bm.faces.new(b)
    except ValueError:
        pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _fin(bm, xf, c, rot)


def _ax(axis, t, a, b):
    if axis == "x":
        return (t, a, b)
    if axis == "y":
        return (b, t, a)
    return (a, b, t)


def lathe_bm(profile, segs=24, axis="x", c=(0, 0, 0), rot=(0, 0, 0), mod=None, cap=True, phase=0.0, scale=(1, 1), xf=None):
    """Revolve profile [(t, r), ...] around `axis` through point c. mod(k)->radius multiplier for segment k (knurl/flutes/hex).
    scale=(sa,sb) squashes the cross-section (oval barrels)."""
    bm = bmesh.new()
    rings = []
    for t, r in profile:
        if r <= 1e-9:
            rings.append([bm.verts.new(_ax(axis, t, 0.0, 0.0))])
        else:
            ring = []
            for k in range(segs):
                a = phase + 2 * math.pi * k / segs
                rr = r * (mod(k) if mod else 1.0)
                ring.append(bm.verts.new(_ax(axis, t, rr * math.cos(a) * scale[0], rr * math.sin(a) * scale[1])))
            rings.append(ring)
    for i in range(len(rings) - 1):
        r0, r1 = rings[i], rings[i + 1]
        for k in range(segs):
            k2 = (k + 1) % segs
            try:
                if len(r0) == 1 and len(r1) == 1:
                    continue
                if len(r0) == 1:
                    bm.faces.new((r0[0], r1[k2], r1[k]))
                elif len(r1) == 1:
                    bm.faces.new((r0[k], r0[k2], r1[0]))
                else:
                    bm.faces.new((r0[k], r0[k2], r1[k2], r1[k]))
            except ValueError:
                pass
    if cap:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _fin(bm, xf, c, rot)


def cyl_bm(p0, p1, r0, r1=None, segs=16, cap=True, mod=None, phase=0.0, roll=0.0):
    """Cylinder/cone between two arbitrary points (radius r0 at p0, r1 at p1)."""
    p0 = Vector(p0); p1 = Vector(p1)
    d = p1 - p0
    L = d.length
    bm = lathe_bm([(0, r0), (L, r0 if r1 is None else r1)], segs, "z", mod=mod, cap=cap, phase=phase)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    M = Matrix.Translation(p0) @ q.to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


def sphere_bm(r=1.0, c=(0, 0, 0), scale=(1, 1, 1), usegs=16, vsegs=10, rot=(0, 0, 0), xf=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=usegs, v_segments=vsegs, radius=r)
    for v in bm.verts:
        v.co = (v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])
    return _fin(bm, xf, c, rot)


def loft_bm(sections, cap=True, xf=None, c=None, rot=None):
    """Loft rings along +X. sections = [(x, [(y,z), ...]), ...] equal vertex counts, rings CCW seen from +x."""
    bm = bmesh.new()
    n = len(sections[0][1])
    rings = []
    for x, ring in sections:
        assert len(ring) == n, "loft rings need equal vertex counts"
        rings.append([bm.verts.new((x, y, z)) for y, z in ring])
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            try:
                bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
            except ValueError:
                pass
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _fin(bm, xf, c, rot)


def sweep_bm(path, radius=1.0, segs=10, profile=None, smooth=0, cap=True, closed=False, up=(0, 0, 1), xf=None):
    """Sweep a circle (radius scalar or fn(frac)) or a custom 2D profile [(a,b)..] along a 3D polyline (parallel transport)."""
    P = [Vector(p) for p in path]
    if smooth:
        P = catmull(P, smooth)
    n = len(P)
    bm = bmesh.new()
    if profile is None:
        prof = [(math.cos(2 * math.pi * k / segs), math.sin(2 * math.pi * k / segs)) for k in range(segs)]
    else:
        prof = list(profile)
    m = len(prof)
    rings = []
    tang = []
    for i in range(n):
        if closed:
            t = (P[(i + 1) % n] - P[i - 1])
        elif i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = P[i + 1] - P[i - 1]
        t.normalize(); tang.append(t)
    nrm = Vector(up)
    if abs(nrm.dot(tang[0])) > 0.95:
        nrm = Vector((1, 0, 0))
    frames = []
    for i in range(n):
        t = tang[i]
        nrm = (nrm - t * nrm.dot(t))
        if nrm.length < 1e-6:
            nrm = t.orthogonal()
        nrm.normalize()
        bnm = t.cross(nrm)
        frames.append((nrm.copy(), bnm))
    for i in range(n):
        r = radius(i / max(1, n - 1)) if callable(radius) else radius
        nn, bb = frames[i]
        rings.append([bm.verts.new(P[i] + nn * (a * r) + bb * (b * r)) for a, b in prof])
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        i2 = (i + 1) % n
        for k in range(m):
            k2 = (k + 1) % m
            try:
                bm.faces.new((rings[i][k], rings[i][k2], rings[i2][k2], rings[i2][k]))
            except ValueError:
                pass
    if cap and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _fin(bm, xf)


def merge_bm(bms):
    """Merge several bmeshes into one (no boolean)."""
    dst = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("_m")
        b.to_mesh(me)
        dst.from_mesh(me)
        bpy.data.meshes.remove(me)
    return dst


def mirror_bm(bm, both=True):
    """Return the mesh mirrored across y=0 (both=True: original + mirror merged)."""
    m = bm.copy()
    for v in m.verts:
        v.co.y = -v.co.y
    bmesh.ops.reverse_faces(m, faces=m.faces)
    if both:
        return merge_bm([bm, m])
    return m



def prism_x_bm(pts_yz, x0, x1, fillet=0.0, fsegs=4, xf=None):
    """Extrude a front-view polygon [(y,z),...] along x in [x0,x1]."""
    if fillet:
        pts_yz = fillet_poly(pts_yz, fillet, fsegs)
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in pts_yz]
    b = [bm.verts.new((x1, y, z)) for y, z in pts_yz]
    n = len(pts_yz)
    for i in range(n):
        j = (i + 1) % n
        try:
            bm.faces.new((a[i], a[j], b[j], b[i]))
        except ValueError:
            pass
    try:
        bm.faces.new(a); bm.faces.new(b)
    except ValueError:
        pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _fin(bm, xf)


def rail_bm(x0, x1, z_base, width=21.2, height=5.4, pitch=10.16, slot=5.32, first=None, base=2.2):
    """Picatinny rail along x (z_base = underside). Returns one merged bmesh (no bevel; add with bevel ~0.35)."""
    parts = []
    hw = width / 2
    parts.append(box_bm((x1 - x0, width - 4.0, base), c=((x0 + x1) / 2, 0, z_base + base / 2)))
    x = x0 if first is None else first
    ridge = pitch - slot
    while x + ridge <= x1 + 1e-6:
        prof = [(-hw + 1.6, z_base + base * 0.5), (hw - 1.6, z_base + base * 0.5), (hw, z_base + base + 1.6), (hw - 0.5, z_base + height),
                (-hw + 0.5, z_base + height), (-hw, z_base + base + 1.6)]
        parts.append(prism_x_bm(prof, x, x + ridge))
        x += pitch
    return merge_bm(parts)


def screw_bm(pos, axis=(0, 1, 0), r=1.6, h=0.9, segs=10, slot=True):
    """Small slotted screw head (dome) at pos pointing along `axis` (outward normal)."""
    p = Vector(pos); a = Vector(axis).normalized()
    bm = lathe_bm([(-0.4, r), (0, r), (h * 0.7, r * 0.93), (h, r * 0.62), (h, 0)], segs, "z")
    if slot:
        sl = box_bm((r * 2.4, r * 0.32, h * 0.7), c=(0, 0, h))
        bm = bool_op(bm, [sl])
    q = Vector((0, 0, 1)).rotation_difference(a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def hex_bolt_bm(pos, axis=(0, 1, 0), r=2.4, h=1.6):
    p = Vector(pos); a = Vector(axis).normalized()
    bm = lathe_bm([(-0.3, r), (h, r), (h, 0)], 6, "z", phase=0.5236)
    q = Vector((0, 0, 1)).rotation_difference(a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


# ---- ammunition (mm). Profiles are (t, r) along +x with t=0 at the case head.
AMMO = {
    # rim_r, rim_t, groove_r, groove_w, body_r0 (at head), body_r1 (at shoulder start / mouth), shoulder=(x0,x1) or None, neck_r, len, bullet_r, oal, tip_r, pointy
    "9mm":    dict(rim_r=4.98, rim_t=1.2, groove_r=4.3, groove_w=0.9, body_r0=4.94, body_r1=4.74, shoulder=None, neck_r=4.74, len=19.15, bullet_r=4.5, oal=29.7, tip_r=1.7, p=2.3, q=0.55),
    "357":    dict(rim_r=5.6, rim_t=1.5, groove_r=4.82, groove_w=0.3, body_r0=4.86, body_r1=4.78, shoulder=None, neck_r=4.78, len=32.6, bullet_r=4.54, oal=40.5, tip_r=2.2, p=2.0, q=0.5),
    "762x39": dict(rim_r=5.67, rim_t=1.5, groove_r=4.9, groove_w=1.0, body_r0=5.66, body_r1=5.03, shoulder=(26.5, 30.5), neck_r=4.3, len=38.7, bullet_r=3.96, oal=56.0, tip_r=1.2, p=2.0, q=0.6),
    "556":    dict(rim_r=4.8, rim_t=1.3, groove_r=4.15, groove_w=1.0, body_r0=4.78, body_r1=4.5, shoulder=(33.0, 36.4), neck_r=3.25, len=44.7, bullet_r=2.85, oal=57.4, tip_r=0.5, p=2.0, q=0.62),
    "762x51": dict(rim_r=5.97, rim_t=1.3, groove_r=5.1, groove_w=1.0, body_r0=5.77, body_r1=5.5, shoulder=(37.5, 42.5), neck_r=4.4, len=51.2, bullet_r=3.91, oal=69.9, tip_r=0.6, p=2.0, q=0.62),
    "300wm":  dict(rim_r=6.75, rim_t=1.3, groove_r=5.9, groove_w=1.0, body_r0=6.2, body_r1=5.9, shoulder=(53.0, 59.0), neck_r=4.55, len=66.5, bullet_r=3.91, oal=84.5, tip_r=0.6, p=2.0, q=0.62),
}


def case_profile(kind="9mm", fired=False):
    d = AMMO[kind]
    r, t = d["rim_r"], d["rim_t"]
    p = [(0.35, 0.0), (0.35, 2.6), (0.0, 2.6), (0.0, r - 0.35), (0.35, r), (t, r), (t, d["groove_r"]), (t + d["groove_w"], d["groove_r"]),
         (t + d["groove_w"], d["body_r0"])]
    if d["shoulder"]:
        s0, s1 = d["shoulder"]
        p += [(s0, d["body_r1"]), (s1, d["neck_r"] + 0.03), (d["len"] - 0.1, d["neck_r"])]
    else:
        p += [(d["len"] - 0.1, d["body_r1"])]
    end_r = p[-1][1]
    if fired:
        p += [(d["len"], end_r + 0.25), (d["len"] - 0.05, end_r - 0.4), (d["len"] - 7.5, end_r - 0.5), (d["len"] - 7.5, 0.0)]
    else:
        p += [(d["len"], end_r - 0.25), (d["len"], 0.0)]
    return p


def primer_profile():
    return [(-0.06, 0.0), (-0.06, 1.85), (0.05, 2.0), (1.0, 2.0), (1.0, 0.0)]


def bullet_profile(kind="9mm", n=7):
    d = AMMO[kind]
    r, L, oal = d["bullet_r"], d["len"], d["oal"]
    seat = L - (5.0 if not d["shoulder"] else 5.5)
    x1 = L + (oal - L) * 0.28
    pts = [(seat, 0.0), (seat, r), (x1, r)]
    for k in range(1, n + 1):
        f = k / n
        rr = r * (1 - f ** d["p"]) ** d["q"]
        pts.append((x1 + (oal - x1) * f, max(rr, d["tip_r"] * (1 - f) + 0.0 if k < n else d["tip_r"] * 0.0)))
    pts[-1] = (oal, d["tip_r"] * 0.6)
    pts.append((oal, 0.0))
    return pts


def round_bms(kind="9mm", segs=14, at=(0, 0, 0), rot=(0, 0, 0), fired=False, bullet=True, primer=True):
    """Return dict(case=bm, bullet=bm, primer=bm) for a cartridge with its head at `at`, pointing along +x (then rot deg)."""
    M = Matrix.Translation(at) @ rotm(rot)
    out = {"case": lathe_bm(case_profile(kind, fired), segs, "x", xf=M)}
    if bullet and not fired:
        out["bullet"] = lathe_bm(bullet_profile(kind), segs, "x", xf=M)
    if primer:
        out["primer"] = lathe_bm(primer_profile(), max(8, segs - 4), "x", xf=M)
    return out


def bool_op(bm, cutters, op="DIFFERENCE", solver="EXACT"):
    """Boolean `bm` with a list of bmeshes via a transient modifier. Returns the resulting bmesh (bm is consumed)."""
    if not cutters:
        return bm
    cb = merge_bm(cutters) if len(cutters) > 1 else cutters[0]
    ma = bpy.data.meshes.new("_a"); bm.to_mesh(ma)
    mb = bpy.data.meshes.new("_b"); cb.to_mesh(mb)
    oa = bpy.data.objects.new("_a", ma); ob = bpy.data.objects.new("_b", mb)
    bpy.context.collection.objects.link(oa); bpy.context.collection.objects.link(ob)
    md = oa.modifiers.new("B", "BOOLEAN")
    md.operation = op; md.solver = solver; md.object = ob
    if solver == "EXACT":
        md.use_self = len(cutters) > 1 or op == "UNION"
    dg = bpy.context.evaluated_depsgraph_get()
    ev = oa.evaluated_get(dg)
    me = ev.to_mesh()
    r = bmesh.new()
    r.from_mesh(me)
    ev.to_mesh_clear()
    bpy.data.objects.remove(oa); bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(ma); bpy.data.meshes.remove(mb)
    bm.free()
    if len(cutters) > 1:
        cb.free()
    return clean_bm(r, 1e-3, 1e-6)


def clean_bm(bm, dist=2e-3, min_area=1e-5):
    """Merge near-duplicate verts and dissolve degenerate edges/faces (bevel/boolean slivers make Blender's UV island scaling explode).
    Topology stays closed (no holes) - never just delete the collapsed faces."""
    if os.environ.get("ROD_NOCLEAN"):
        return bm
    try:
        mode = os.environ.get("ROD_CLEAN", "both")
        if mode in ("both", "doubles"):
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
        if mode in ("both", "dissolve"):
            bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
    except Exception as ex:      # pragma: no cover
        print("WARN clean failed", ex)
    return bm


def bevel_bm(bm, width, segs=2, angle=30.0, sel=None):
    """Bevel every edge sharper than `angle` degrees (in place). sel(edge)->bool restricts the edge set.
    `width` may also be a list of passes [(width, segs, sel_or_None), ...]."""
    if isinstance(width, (list, tuple)):
        for w, sg, sl in width:
            bevel_bm(bm, w, sg, angle if sl is None else 20.0, sl)
        return bm
    if width <= 0:
        return bm
    thr = angle * D2R
    edges = []
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle(0.0) > thr and (sel is None or sel(e)):
                    edges.append(e)
            except Exception:
                pass
    if not edges:
        return bm
    try:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs, profile=0.5,
                        affect="EDGES", clamp_overlap=True, loop_slide=True)
    except Exception as ex:  # pragma: no cover
        print("WARN bevel failed:", ex)
    return clean_bm(bm)


def bm_tris(bm):
    return sum(len(f.verts) - 2 for f in bm.faces)


# ------------------------------------------------------------------------------------------- palette
# name -> flat fallback values (used with --flat; the texture pipeline replaces them with baked maps)
PALETTE = {
    "gun_metal": dict(base=(0.045, 0.05, 0.058), metal=1.0, rough=0.38),
    "gun_black": dict(base=(0.014, 0.014, 0.016), metal=0.6, rough=0.5),
    "gun_steel": dict(base=(0.50, 0.51, 0.53), metal=1.0, rough=0.26),
    "polymer": dict(base=(0.03, 0.032, 0.034), metal=0.0, rough=0.55),
    "wood": dict(base=(0.20, 0.09, 0.035), metal=0.0, rough=0.5),
    "rubber": dict(base=(0.012, 0.012, 0.012), metal=0.0, rough=0.85),
    "brass": dict(base=(0.62, 0.40, 0.11), metal=1.0, rough=0.3),
    "glass_lens": dict(base=(0.02, 0.05, 0.09), metal=0.0, rough=0.03, alpha=0.4, double_sided=True),
    "paint": dict(base=(0.75, 0.75, 0.75), metal=0.0, rough=0.5),
}


def palette_mat(name):
    p = dict(PALETTE.get(name, dict(base=(0.5, 0.5, 0.5), metal=0.0, rough=0.5)))
    base = p.pop("base")
    m = RL.mat(name, base, **p)
    return m


def export_gltf(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.context.scene.objects:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_materials="EXPORT", export_cameras=False, export_lights=False, export_extras=False,
              export_image_format=os.environ.get("ROD_IMG", "WEBP"), export_image_quality=int(os.environ.get("ROD_IMGQ", "90")),
              export_texcoords=True, export_normals=True,
              export_tangents=False, export_animations=False, export_skins=False)
    try:
        kw["export_vertex_color"] = "NONE"
        bpy.ops.export_scene.gltf(**kw)
    except TypeError:
        kw.pop("export_vertex_color", None)
        bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path, "%.1f KB" % (os.path.getsize(path) / 1024))


# ------------------------------------------------------------------------------------------- Part / Gun
class Part:
    """One glTF node worth of geometry. Coordinates are authored in G-frame mm; `pivot` is the node origin."""

    def __init__(self, gun, name, pivot=(0, 0, 0), parent=None):
        self.gun, self.name, self.pivot, self.parent = gun, name, Vector(pivot), parent
        self.bm = bmesh.new()
        self.mats = []
        self.obj = None

    def mat_index(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, bm, mat="gun_metal", bevel=0.5, segs=2, angle=30.0, cut=None, op="DIFFERENCE", sym=False, smooth_angle=None):
        """Finish a raw shell (boolean cutters -> bevel -> material) and add it to the part."""
        if cut:
            bm = bool_op(bm, cut, op)
        if bevel:
            bevel_bm(bm, bevel, segs, angle)
        if sym:
            bm = mirror_bm(bm, True)
        mi = self.mat_index(mat)
        for f in bm.faces:
            f.material_index = mi
        me = bpy.data.meshes.new("_p")
        bm.to_mesh(me)
        bm.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        return self

    # convenience wrappers ------------------------------------------------------------------
    def box(self, size, c=(0, 0, 0), rot=(0, 0, 0), mat="gun_metal", bevel=0.5, taper=None, **kw):
        return self.add(box_bm(size, c, rot, taper), mat, bevel, **kw)

    def prism(self, pts, y0, y1, mat="gun_metal", bevel=0.5, fillet=0.0, fsegs=4, **kw):
        return self.add(prism_bm(pts, y0, y1, fillet, fsegs), mat, bevel, **kw)

    def lathe(self, profile, c=(0, 0, 0), axis="x", mat="gun_metal", bevel=0.0, segs=24, mod=None, cap=True, rot=(0, 0, 0), scale=(1, 1), phase=0.0, **kw):
        return self.add(lathe_bm(profile, segs, axis, c, rot, mod, cap, phase, scale), mat, bevel, **kw)

    def cyl(self, p0, p1, r0, r1=None, mat="gun_metal", bevel=0.0, segs=16, cap=True, mod=None, phase=0.0, **kw):
        return self.add(cyl_bm(p0, p1, r0, r1, segs, cap, mod, phase), mat, bevel, **kw)

    def sphere(self, r, c=(0, 0, 0), scale=(1, 1, 1), mat="gun_metal", bevel=0.0, usegs=16, vsegs=10, rot=(0, 0, 0), **kw):
        return self.add(sphere_bm(r, c, scale, usegs, vsegs, rot), mat, bevel, **kw)

    def loft(self, sections, mat="gun_metal", bevel=0.5, cap=True, c=None, rot=None, xf=None, **kw):
        return self.add(loft_bm(sections, cap, xf, c, rot), mat, bevel, **kw)

    def sweep(self, path, radius=1.0, mat="gun_metal", bevel=0.0, segs=10, profile=None, smooth=0, cap=True, closed=False, **kw):
        return self.add(sweep_bm(path, radius, segs, profile, smooth, cap, closed), mat, bevel, **kw)

    def tris(self):
        return bm_tris(self.bm)

    # build ----------------------------------------------------------------------------------
    def make_object(self, smooth_angle=38.0):
        bm = self.bm
        thr = smooth_angle * D2R
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2:
                try:
                    e.smooth = e.calc_face_angle(0.0) < thr
                except Exception:
                    e.smooth = True
        M = R_G2B @ Matrix.Scale(S, 4) @ Matrix.Translation(-self.pivot)
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        for m in self.mats:
            me.materials.append(palette_mat(m))
        o = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(o)
        o.location = R_G2B @ (self.pivot * S)
        if not os.environ.get("ROD_NOWN"):
            # weighted normals: big flat faces stay flat next to bevel strips (exported as custom split normals)
            wn = o.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
            wn.mode = "FACE_AREA"
            wn.weight = 60
            wn.keep_sharp = True
            wn.thresh = 0.01
        self.obj = o
        return o


class Gun:
    def __init__(self, name):
        RL.reset()
        self.name = name
        self.parts = {}
        self.sockets = {}
        self.args = RL.argv()
        self.t0 = time.time()
        self.notes = {}
        self.motions = []
        self.remarks = []

    def part(self, name, pivot=(0, 0, 0), parent=None):
        p = Part(self, name, pivot, parent)
        self.parts[name] = p
        return p

    def socket(self, name, pos, rot=(0, 0, 0), parent=None, size=0.02):
        """Empty socket. rot (deg, G frame) is relative to the canonical orientation (+Z fwd, +Y up in glTF).
        grip_R / grip_L: if hand_sockets.json (fitted by tools/characters/fp_arms_place.py against the fp_arms hands) has an
        entry for this gun, its position + rotation replace the authored ones (the authored values stay as the fallback)."""
        if name in ("grip_R", "grip_L"):
            hs = hand_sockets().get(self.name, {}).get(name)
            if hs:
                pos, rot = hs["pos"], tuple(hs["rot"])
        self.sockets[name] = (Vector(pos), rot, parent, size)

    def motion(self, node, kind, axis, amount, note=""):
        """Document how the game should animate a moving node (written to notes/<gun>.json -> README).
        kind: 'translate' (mm along axis, G frame) | 'rotate' (deg about axis through the node origin, right-hand rule, G frame).
        axis is given in the G frame (+X fwd, +Y left, +Z up) and converted to glTF (X left, Y up, Z fwd) in the notes."""
        ax = Vector(axis).normalized()
        self.motions.append(dict(node=node, kind=kind, axis_g=list(axis), axis_gltf=[round(ax.y, 4), round(ax.z, 4), round(ax.x, 4)], amount=amount, note=note))

    def remark(self, text):
        self.remarks.append(text)

    # ------------------------------------------------------------------------------------
    def tri_report(self):
        rows = [(n, p.tris()) for n, p in self.parts.items()]
        return rows, sum(t for _, t in rows)

    def build(self):
        objs = {}
        for n, p in self.parts.items():
            objs[n] = p.make_object()
        for n, (pos, rot, parent, size) in self.sockets.items():
            e = RL.empty(n, (0, 0, 0), size=size)
            e.location = R_G2B @ (pos * S)
            Mr = R_G2B @ rotm(rot) @ R_G2B.inverted()
            e.rotation_euler = Mr.to_euler()
            objs[n] = e
        bpy.context.view_layer.update()
        for n, p in self.parts.items():
            if p.parent:
                o, par = objs[n], objs[p.parent]
                o.parent = par
                o.matrix_parent_inverse = par.matrix_world.inverted()
        for n, (pos, rot, parent, size) in self.sockets.items():
            if parent:
                o, par = objs[n], objs[parent]
                o.parent = par
                o.matrix_parent_inverse = par.matrix_world.inverted()
        bpy.context.view_layer.update()
        self.objs = objs
        return objs

    def write_notes(self, path, total):
        import json
        nd = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes")
        os.makedirs(nd, exist_ok=True)
        def gl(v):   # G-frame mm -> glTF-frame mm (x=left, y=up, z=forward)
            return [round(v.y, 2), round(v.z, 2), round(v.x, 2)]
        parts = {n: dict(pivot=gl(p.pivot), parent=p.parent, tris=p.tris(), materials=p.mats) for n, p in self.parts.items()}
        sock = {n: dict(pos=gl(v[0]), rot_deg=list(v[1]), parent=v[2]) for n, v in self.sockets.items()}
        data = dict(name=self.name, tris=total, glb_kb=round(os.path.getsize(path) / 1024), parts=parts, sockets=sock, motions=self.motions,
                    remarks=self.remarks, style_keys=sorted(self.notes.get("style", {}).keys()))
        json.dump(data, open(os.path.join(nd, self.name + ".json"), "w"), indent=1)

    def finish(self, bake=None, size=2048, style=None):
        """Build nodes, texture (unless --flat), export."""
        rows, total = self.tri_report()
        print("TRIS", self.name, total, " ".join("%s=%d" % r for r in rows))
        self.build()
        if bake is None:
            bake = not self.args.get("flat")
        if bake:
            import gunfinish
            gunfinish.finish_textures(self, size=int(self.args.get("size", size)), style=style)
        path = os.path.join(OUT_DIR, self.name + ".glb")
        export_gltf(path)
        self.write_notes(path, total)
        print("DONE %s in %.1fs" % (self.name, time.time() - self.t0))
        return path
