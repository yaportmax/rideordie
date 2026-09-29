"""fp_arms stage 2 helpers (inside Blender): small mesh kit, wrist strap, watch, bracelet, weight transfer, skin culling."""
import math

import bmesh
import numpy as np
from mathutils.bvhtree import BVHTree

from fp_arms_blender import (MM, SIDES, CUFF_LEN, WRAP_FROM, V, unit, smoothstep, mesh_from, vg_matrix, set_vgroups,
                             verts_np, log)


# ----------------------------------------------------------------------------------------------- small mesh kit
def loft_rings(rings, closed=True, cap0=False, cap1=False):
    """rings: list of (N,3) point loops (same N) -> verts, quads (+ fan caps)."""
    rings = [np.asarray(r, float) for r in rings]
    n = len(rings[0])
    verts = np.concatenate(rings)
    faces = []
    for k in range(len(rings) - 1):
        for i in range(n if closed else n - 1):
            a = k * n + i
            b = k * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    extra = []
    if cap0:
        c = len(verts) + len(extra)
        extra.append(rings[0].mean(0))
        faces += [(c, (i + 1) % n, i) for i in range(n)]
    if cap1:
        c = len(verts) + len(extra)
        extra.append(rings[-1].mean(0))
        base = (len(rings) - 1) * n
        faces += [(c, base + i, base + (i + 1) % n) for i in range(n)]
    if extra:
        verts = np.concatenate([verts, np.array(extra)])
    return verts, faces


def join_parts(parts):
    V_, F_ = [], []
    base = 0
    for v, f in parts:
        V_.append(np.asarray(v, float))
        F_ += [tuple(int(x) + base for x in fc) for fc in f]
        base += len(v)
    return np.concatenate(V_), F_


def lathe(profile, n, frame, centre, phase=0.0):
    """profile [(radius, height)] around frame[2]; frame = (a, c, nrm) unit vectors."""
    a, c, nn = frame
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False) + phase
    return [centre + np.outer(np.cos(ang) * r, a) + np.outer(np.sin(ang) * r, c) + nn * h for r, h in profile]


def band_on(field, s_c, width, t, n=56, base_off=0.0, rows=(0.0, 0.0, 0.12, 0.5, 0.88, 1.0, 1.0), roundness=0.55):
    """Closed strap lying on `field` (a Limb) at axial fraction s_c: width (m), thickness t, rounded edges.
    Returns verts, faces, strip uv (along m, across m)."""
    L = field.L
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    rings = []
    rr = np.asarray(rows)
    for k, v in enumerate(rr):
        z = (v - 0.5) * width
        edge = min(v, 1 - v) / 0.12
        h = t * (1 - roundness * (1 - min(1.0, edge)) ** 2)
        if k == 0 or k == len(rr) - 1:
            h = 0.0
        rings.append(field.point(np.full(n, s_c + z / L), th, base_off + h))
    verts = np.concatenate(rings)
    faces = []
    for k in range(len(rr) - 1):
        for i in range(n):
            a = k * n + i
            b = k * n + (i + 1) % n
            faces.append((a, a + n, b + n, b))
    mid = rings[len(rings) // 2]
    circ = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(mid, axis=0), axis=1))])
    uv = [(circ[i], v * width) for v in rr for i in range(n)]
    return verts, faces, np.array(uv)


def set_strip_uv(ob, uv):
    me = ob.data
    uvl = me.uv_layers.get("strip") or me.uv_layers.new(name="strip")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = tuple(uv[me.loops[li].vertex_index])


def box_pts(c, frame, size, bevel=0.0):
    """Rounded box (loft of rounded rectangles) in frame (a, b, n) centred at c."""
    a, b, n = frame
    sx, sy, sz = [x / 2 for x in size]
    bv = max(bevel, 1e-4)

    def rr(hx, hy, z, r):
        pts = []
        for qx, qy, a0 in ((hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180), (hx - r, -hy + r, 270)):
            for k in range(3):
                t = math.radians(a0 + k * 45)
                pts.append((qx + r * math.cos(t), qy + r * math.sin(t), z))
        return np.array([c + a * p[0] + b * p[1] + n * p[2] for p in pts])
    rings = [rr(sx - bv * 0.6, sy - bv * 0.6, -sz, bv * 0.4), rr(sx, sy, -sz + bv * 0.6, bv), rr(sx, sy, sz - bv * 0.6, bv),
             rr(sx - bv * 0.6, sy - bv * 0.6, sz, bv * 0.4)]
    return loft_rings(rings, cap0=True, cap1=True)


def cyl_pts(p0, axis, r, length, n=12):
    axis = unit(axis)
    u = unit(np.cross(axis, [0.3, 0.5, 0.8]))
    w = np.cross(axis, u)
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)

    def ring(rr, h):
        return p0 + axis * h + np.outer(np.cos(ang) * rr, u) + np.outer(np.sin(ang) * rr, w)
    return loft_rings([ring(r, -0.5 * MM), ring(r, length - 0.4 * MM), ring(r * 0.8, length)], cap1=True)


def frame_pts(c, frame, w, h, t, bar):
    """Flat rectangular buckle frame (outer w x h, bar width, thickness t)."""
    a, b, n = frame

    def rect(hw, hh, z):
        return np.array([c + a * x + b * y + n * z for x, y in ((hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh))])
    loops = [rect(w / 2, h / 2, 0), rect(w / 2, h / 2, t), rect(w / 2 - bar, h / 2 - bar, t), rect(w / 2 - bar, h / 2 - bar, 0)]
    verts = np.concatenate(loops)
    faces = []
    for k in range(4):
        nk = ((k + 1) % 4) * 4
        for i in range(4):
            faces.append((k * 4 + i, k * 4 + (i + 1) % 4, nk + (i + 1) % 4, nk + i))
    return verts, faces


def surface_frame(field, s, th, off):
    p = field.point(np.array([s]), np.array([th]), off)[0]
    nrm = unit(p - field.centre(np.array([s]))[0])
    a = unit(field.ax - nrm * (field.ax @ nrm))
    return p, (a, np.cross(nrm, a), nrm)


# ----------------------------------------------------------------------------------------------- strap, watch, bracelet
def ulnar_theta(sk, lb, side):
    d0, lat, dorsal = sk.hand_frame(side)
    return math.atan2(float(lat @ lb.e2), float(lat @ lb.e1))


def build_strap(sk, side, gfield):
    """Glove wrist strap: a band round the cuff + an overlapping tab with a snap (back / little-finger side)."""
    L = gfield.L
    s_c = 1.0 - CUFF_LEN * 0.52 / L
    tu = ulnar_theta(sk, gfield, side)
    v1, f1, uv1 = band_on(gfield, s_c, 0.016, 1.3 * MM, n=64, base_off=0.15 * MM)
    sgn = 1.0 if side == "Left" else -1.0
    th0, th1 = tu - sgn * 0.2, tu - sgn * 1.5
    n = 18
    th = np.linspace(th0, th1, n)
    rows = np.array([0.0, 0.0, 0.1, 0.5, 0.9, 1.0, 1.0])
    rings, uv = [], []
    for k, v in enumerate(rows):
        pts = []
        for i, t_ in enumerate(th):
            q = i / (n - 1)
            endw = 1.0 - 0.55 * smoothstep(0.75, 1.0, q) * (abs(v - 0.5) * 2) ** 2
            z = (v - 0.5) * 0.0185 * endw
            edge = min(v, 1 - v) / 0.1
            h = 1.3 * MM * (1 - 0.55 * (1 - min(1.0, edge)) ** 2) if 0 < k < len(rows) - 1 else 0.25 * MM
            pts.append(gfield.point(np.array([s_c + z / L]), np.array([t_]), 1.55 * MM + h)[0])
            uv.append((q * 0.035, v * 0.0185))
        rings.append(np.array(pts))
    v2 = np.concatenate(rings)
    f2 = []
    for k in range(len(rows) - 1):
        for i in range(n - 1):
            a = k * n + i
            f2.append((a, a + 1, a + n + 1, a + n) if sgn > 0 else (a, a + n, a + n + 1, a + 1))
    V_, F_ = join_parts([(v1, f1), (v2, f2)])
    strap = mesh_from("strap_" + side, V_, F_)
    set_strip_uv(strap, np.concatenate([uv1, np.array(uv)]))
    # snap button on the tab
    tb = th0 + (th1 - th0) * 0.66
    cen, fr = surface_frame(gfield, s_c, tb, 2.75 * MM)
    rings = lathe([(4.4 * MM, -0.4 * MM), (4.6 * MM, 0.4 * MM), (4.2 * MM, 1.2 * MM), (3.1 * MM, 1.65 * MM), (1.5 * MM, 1.85 * MM)], 24, fr, cen)
    snap = mesh_from("snap_" + side, *loft_rings(rings, cap1=True))
    return strap, snap


def build_watch(sk, side, wfield):
    """Rugged field watch worn on the INSIDE of the left wrist (readable while the hand holds a handguard)."""
    L = wfield.L
    s_w = 1.0 - (CUFF_LEN + 0.020) / L
    th_face = math.pi                                   # palmar side
    v1, f1, uv1 = band_on(wfield, s_w, 0.021, 2.1 * MM, n=64, base_off=0.2 * MM)
    strap = mesh_from("watchstrap_" + side, v1, f1)
    set_strip_uv(strap, uv1)
    base, fr = surface_frame(wfield, s_w, th_face, 2.4 * MM)
    a, c, nrm = fr
    R = 20.0 * MM
    prof = [(R * 0.84, -1.6 * MM), (R * 0.95, -0.2 * MM), (R, 1.6 * MM), (R, 7.2 * MM), (R * 0.975, 8.4 * MM),
            (R * 0.955, 8.8 * MM), (R * 0.99, 9.0 * MM), (R * 0.995, 10.7 * MM), (R * 0.94, 11.7 * MM), (R * 0.80, 12.1 * MM),
            (R * 0.745, 11.8 * MM), (R * 0.735, 10.9 * MM)]
    N = 60
    rings = lathe(prof, N, fr, base)
    ang = np.linspace(0, 2 * np.pi, N, endpoint=False)
    lobes = np.cos(ang * 6) ** 8                          # 12 grip lobes
    for k in (6, 7, 8):
        rel = rings[k] - base
        h = rel @ nrm
        rad = rel - np.outer(h, nrm)
        rings[k] = base + np.outer(h, nrm) + rad * (1 + 0.04 * lobes)[:, None]
    case = mesh_from("watchcase_" + side, *loft_rings(rings, cap0=True))
    gl = lathe([(R * 0.735, 10.9 * MM), (R * 0.5, 11.25 * MM)], N, fr, base)
    glass = mesh_from("watchglass_" + side, *loft_rings(gl, cap1=True))
    parts = []
    for sa in (-1, 1):
        for sc in (-1, 1):
            p0 = base + a * sa * (R + 2.2 * MM) + c * sc * 7.2 * MM + nrm * 3.4 * MM
            parts.append(box_pts(p0, fr, (6.0 * MM, 4.4 * MM, 5.6 * MM), bevel=1.2 * MM))
            q0 = base + c * sc * (R - 0.6 * MM) + a * sa * 8.0 * MM + nrm * 5.4 * MM
            parts.append(cyl_pts(q0, c * sc, 2.0 * MM, 3.2 * MM, 12))
    lugs = mesh_from("watchlugs_" + side, *join_parts(parts))
    b0, bfr = surface_frame(wfield, s_w, 0.3, 2.6 * MM)
    buckle = mesh_from("watchbuckle_" + side, *frame_pts(b0, bfr, 24 * MM, 17 * MM, 2.4 * MM, 2.2 * MM))
    return strap, case, glass, lugs, buckle


def build_bracelet(sk, side, wfield):
    """Paracord (cobra weave) bracelet with a side-release buckle on the right wrist, over the wraps."""
    L = wfield.L
    s_b = 1.0 - (CUFF_LEN + 0.017) / L
    n, ring_n = 56, 10
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ph = np.linspace(0, 2 * np.pi, ring_n, endpoint=False)
    W_, T_ = 0.0092, 2.5 * MM
    rings = []
    for k in range(ring_n):
        z = math.cos(ph[k]) * W_
        o = 2.9 * MM + T_ * 0.95 + math.sin(ph[k]) * T_
        rings.append(wfield.point(np.full(n, s_b + z / L), th, o))
    P = np.array(rings).transpose(1, 0, 2)
    verts = P.reshape(-1, 3)
    faces, uv = [], []
    for i in range(n):
        for k in range(ring_n):
            a = i * ring_n + k
            b = i * ring_n + (k + 1) % ring_n
            c_ = ((i + 1) % n) * ring_n + (k + 1) % ring_n
            d = ((i + 1) % n) * ring_n + k
            faces.append((a, d, c_, b))
    circ = 2 * np.pi * float(wfield.radius(np.array([s_b]), np.array([0.0]))[0] + 5 * MM)
    for i in range(n):
        for k in range(ring_n):
            uv.append((circ * i / n, k / ring_n * 0.03))
    cord = mesh_from("cord_" + side, verts, faces)
    set_strip_uv(cord, np.array(uv))
    b0, bfr = surface_frame(wfield, s_b, 0.25, 6.2 * MM)
    buckle = mesh_from("cordbuckle_" + side, *box_pts(b0, bfr, (20 * MM, 26 * MM, 6.0 * MM), bevel=2.0 * MM))
    return cord, buckle


# ----------------------------------------------------------------------------------------------- skinning of added parts
def transfer_weights(dst, src, names, rigid=False):
    """Weights for `dst` from the nearest point on `src` (inverse-distance over the face corners); rigid = one averaged set."""
    Ws = vg_matrix(src, names)
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.faces.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    P = verts_np(dst)
    out = np.zeros((len(P), len(names)))
    for i, p in enumerate(P):
        loc, nrm, fi, d = bvh.find_nearest(V(p))
        f = bm.faces[fi]
        wv = np.array([1.0 / max((loc - q.co).length, 1e-5) for q in f.verts])
        wv /= wv.sum()
        out[i] = sum(wv[k] * Ws[f.verts[k].index] for k in range(len(wv)))
    bm.free()
    if rigid:
        out[:] = out.mean(0)
    out /= np.maximum(out.sum(1, keepdims=True), 1e-9)
    set_vgroups(dst, names, out)


def cull_skin(skin, flags, sk, limbs):
    """Delete skin hidden under the glove (all but two rings under the hems) and under the wraps."""
    me = skin.data
    nf = len(me.polygons)
    vert_faces = {}
    for p in me.polygons:
        for v in p.vertices:
            vert_faces.setdefault(v, []).append(p.index)
    edge_v = set()
    for p in me.polygons:
        if flags[p.index]:
            for v in p.vertices:
                if any(not flags[q] for q in vert_faces[v]):
                    edge_v.add(v)
    ring2 = set(edge_v)
    for v in edge_v:
        for q in vert_faces[v]:
            if flags[q]:
                ring2.update(me.polygons[q].vertices)
    P = verts_np(skin)
    Wt = vg_matrix(skin, sk.bones)
    kill = set()
    for p in me.polygons:
        vs = list(p.vertices)
        if flags[p.index] and not any(v in ring2 for v in vs):
            kill.add(p.index)
            continue
        for side in SIDES:
            lb = limbs[side]
            wf = Wt[vs, sk.bones.index(side + "ForeArm")] + Wt[vs, sk.bones.index(side + "Hand")]
            if wf.min() < 0.5:
                continue
            s = lb.s_of(P[vs])
            if s.min() > WRAP_FROM + 0.016 / lb.L and s.max() < 1.0 - CUFF_LEN / lb.L + 0.006 / lb.L:
                kill.add(p.index)
                break
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    log("skin culled", len(kill), "of", nf)
