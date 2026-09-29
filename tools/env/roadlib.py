"""Helpers for the road-furniture props (built on envlib).  Import after envlib:

    import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    from envlib import *
    from roadlib import *
"""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix, Euler, noise as mnoise
from envlib import *          # noqa
from envlib import _frame, PTEX     # noqa

# ------------------------------------------------------------------------------------------------- standard materials
def std():
    """shared materials for road furniture (created on first use in a scene)"""
    return dict(
        concrete=pmat("concrete", tex="concrete_p", uv_m=2.5, rough=0.9),
        concrete_cracked=pmat("concrete_cracked", tex="concrete_cracked_p", uv_m=2.0, rough=0.9),
        galv=pmat("galvanized", tex="galv_rust", uv_m=1.0, rough=0.5, metal=0.8),
        rust=pmat("rust_metal", tex="rust_metal", uv_m=1.0, rough=0.7, metal=0.6),
        wood=pmat("wood_rough", tex="wood_crate", uv_m=0.5, rough=0.9),
        planks=pmat("wood_planks", tex="wood_planks_d", uv_m=1.8, rough=0.9),
        rubber=pmat("rubber", color=(0.022, 0.022, 0.024), rough=0.88),
        orange=pmat("paint_orange", color=(0.62, 0.15, 0.025), rough=0.55),
        yellow=pmat("paint_yellow", color=(0.62, 0.40, 0.035), rough=0.55),
        white=pmat("reflective_white", color=(0.58, 0.58, 0.54), rough=0.35),
        red=pmat("paint_red", color=(0.30, 0.03, 0.025), rough=0.55),
        grey=pmat("paint_grey", color=(0.16, 0.17, 0.165), rough=0.6, metal=0.25),
        olive=pmat("paint_olive", color=(0.13, 0.15, 0.07), rough=0.6, metal=0.2),
        glass=pmat("insulator_glass", color=(0.07, 0.14, 0.08), rough=0.2),
        lens=pmat("lamp_lens", color=(0.25, 0.2, 0.1), rough=0.12),
        soot=pmat("burnt_black", color=(0.035, 0.03, 0.028), rough=0.85, metal=0.3),
    )


def np_noise(p, off, freq=1.0):
    return mnoise.noise(Vector(p) * freq + off)


# ------------------------------------------------------------------------------------------------- vertex colour grime
def grime_vc(objs, seed=1, dirt=0.35, ground=0.5, ground_h=0.6, tint=(0.62, 0.50, 0.36), soot=0.0, soot_up=False, contrast=1.0):
    """multiply grime into the existing COLOR_0: noise blotches, warm dust near the ground, optional soot (dark toward +Z when soot_up)."""
    off = Vector((seed * 3.7, seed * 1.3, seed * 2.9))
    for o in objs:
        me = o.data
        ca = me.color_attributes.get("Col")
        if ca is None:
            continue
        W = o.matrix_world
        for i, v in enumerate(me.vertices):
            p = W @ v.co
            n1 = mnoise.noise(p * 1.7 + off)
            n2 = mnoise.noise(p * 5.3 + off * 1.9)
            k = 1.0 - dirt * (0.5 + 0.5 * (n1 * 0.7 + n2 * 0.3)) * 0.6
            g = max(0.0, 1.0 - p.z / ground_h)
            g = g * g * ground
            c = list(ca.data[i].color)
            f = k * (1 - g * 0.55)
            r = c[0] * f * (1 - g * (1 - tint[0]) * 0.6)
            gg = c[1] * f * (1 - g * (1 - tint[1]) * 0.6)
            b = c[2] * f * (1 - g * (1 - tint[2]) * 0.6)
            if soot > 0:
                s = soot * (0.5 + 0.5 * (mnoise.noise(p * 2.3 + off * 0.7) * 0.7 + mnoise.noise(p * 7.1 + off) * 0.3))
                if soot_up:
                    s *= min(1.0, 0.35 + p.z / 1.2)
                s = max(0.0, min(0.9, s))
                r, gg, b = r * (1 - s), gg * (1 - s), b * (1 - s)
            ca.data[i].color = (r, gg, b, 1.0)


# ------------------------------------------------------------------------------------------------- generic mesh utilities
def transform_verts(mb, m, verts, M):
    """transform vertices (they may belong to several material bmeshes of `mb`; `m` is only a hint kept for API symmetry)"""
    vs = [v for v in verts if v.is_valid]
    left = set(id(v) for v in vs)
    ids = {}
    for (mat, bm) in mb.bms.values():
        bm.verts.index_update()
        bm.verts.ensure_lookup_table()
        sub = []
        for v in vs:
            i = v.index
            if 0 <= i < len(bm.verts) and bm.verts[i] == v:
                sub.append(v)
        if sub:
            bmesh.ops.transform(bm, matrix=M, verts=sub)


def rot_about(pivot, euler_deg):
    """matrix rotating about `pivot` (world) by euler XYZ degrees"""
    R = Euler([a * D2R for a in euler_deg]).to_matrix().to_4x4()
    return Matrix.Translation(pivot) @ R @ Matrix.Translation(-Vector(pivot))


def hexbolt(mb, m, pos, axis=(1, 0, 0), r=0.012, h=0.008):
    """hex bolt head sitting on a surface; axis = direction the bolt points away from the surface"""
    p0 = Vector(pos)
    ax = Vector(axis).normalized()
    return mb.cyl(m, p0, p0 + ax * h, r, r * 0.96, seg=6, caps=(False, True))


def subdiv_noise(mb, m, y_cuts=8, prof_cuts=1, amp=0.004, freq=6.0, seed=1, chips=None, axis=1):
    """subdivide all edges (many cuts along `axis` (1 = Y) edges, fewer across) then displace along the vertex normals with noise.
       chips = [(center Vector, radius, depth)]: local inward dents."""
    bm = mb.bm(m)
    bm.edges.ensure_lookup_table()
    long_e, cross_e = [], []
    for e in bm.edges:
        d = (e.verts[0].co - e.verts[1].co)
        if abs(d[axis]) > 0.7 * d.length:
            long_e.append(e)
        else:
            cross_e.append(e)
    if y_cuts > 0 and long_e:
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=y_cuts, use_grid_fill=True)
    if prof_cuts > 0:
        bm.edges.ensure_lookup_table()
        ce = []
        for e in bm.edges:
            d = (e.verts[0].co - e.verts[1].co)
            if abs(d[axis]) <= 0.7 * d.length and d.length > 0.12:
                ce.append(e)
        if ce:
            bmesh.ops.subdivide_edges(bm, edges=ce, cuts=prof_cuts, use_grid_fill=True)
    bm.normal_update()
    off = Vector((seed * 5.1, seed * 2.3, seed * 7.7))
    for v in bm.verts:
        p = v.co
        d = (mnoise.noise(p * freq + off) * 0.6 + mnoise.noise(p * freq * 2.7 + off) * 0.4) * amp
        for (c, r, dep) in chips or []:
            q = (p - Vector(c)).length
            if q < r:
                d -= dep * (1 - q / r) ** 2
        v.co = p + v.normal * d


# ------------------------------------------------------------------------------------------------- plates (signs / billboard)
def plate(mb, front_m, back_m, center, w, h, thick=0.02, seg=(12, 16), amp=0.006, dents=3, dent_depth=0.02, dent_r=0.12, corner_r=0.04, seed=0,
          rot=(0, 0, 0), fold=None, uv_rep=(1.0, 1.0), holes=None):
    """rectangular sheet: width along X, height along Z, thickness along Y; READABLE FRONT at +Y (= -Z in glTF, facing oncoming traffic when
       the road runs +Z).  Front quads use front_m (with UVs), back + rim use back_m.  Dents/bends displace both faces along Y.
       fold = (sx, sz, frac, depth): fold the (sx, sz) corner (signs +-1) by `depth` metres starting at `frac` (0..1) along the diagonal."""
    rnd = random.Random(seed)
    nx, nz = seg
    off = Vector((seed * 4.3, seed * 1.9, seed * 6.1))
    dl = [(rnd.uniform(-0.4, 0.4) * w, rnd.uniform(-0.4, 0.4) * h, rnd.uniform(0.6, 1.4) * dent_r * (1 if h < 3 else 3), rnd.choice([-1, 1]) * rnd.uniform(0.4, 1.0) * dent_depth) for _ in range(dents)]

    def disp(x, z):
        d = mnoise.noise(Vector((x * 1.3, z * 1.3, 0)) + off) * amp + mnoise.noise(Vector((x * 5, z * 5, 1)) + off) * amp * 0.35
        for (cx, cz, r, dd) in dl:
            q = math.hypot(x - cx, z - cz) / r
            if q < 1.0:
                d += dd * (1 - q * q) ** 2
        if fold:
            sx, sz, frac, dep = fold
            t = (x * sx / (w / 2) + z * sz / (h / 2)) / 2.0          # 0 centre .. 1 at that corner
            if t > frac:
                d += dep * ((t - frac) / (1 - frac)) ** 1.6
        return d

    def clampc(x, z):
        hx, hz = w / 2 - corner_r, h / 2 - corner_r
        dx, dz = abs(x) - hx, abs(z) - hz
        if dx > 0 and dz > 0:
            l = math.hypot(dx, dz)
            if l > corner_r:
                k = corner_r / l
                dx, dz = dx * k, dz * k
                return math.copysign(hx + dx, x), math.copysign(hz + dz, z)
        return x, z

    bf, bb = mb.bm(front_m), mb.bm(back_m)
    uvl = bf.loops.layers.uv.verify()
    F, B = [], []
    all_new = []
    gx = [(-w / 2 + w * i / nx) for i in range(nx + 1)]
    gz = [(-h / 2 + h * j / nz) for j in range(nz + 1)]
    for j in range(nz + 1):
        rf, rb = [], []
        for i in range(nx + 1):
            x, z = clampc(gx[i], gz[j])
            d = disp(x, z)
            rf.append(bf.verts.new((x, thick / 2 + d, z)))
            rb.append(bb.verts.new((x, -thick / 2 + d, z)))
        F.append(rf)
        B.append(rb)
    pins = []
    skip = set()
    if holes:                        # list of (i0, j0, i1, j1) cell ranges to omit
        for (i0, j0, i1, j1) in holes:
            for jj in range(j0, j1):
                for ii in range(i0, i1):
                    skip.add((ii, jj))
    for j in range(nz):
        for i in range(nx):
            if (i, j) in skip:
                continue
            f = bf.faces.new((F[j][i], F[j][i + 1], F[j + 1][i + 1], F[j + 1][i]))
            pins.append((f, Vector((0, 1, 0))))
            for lp in f.loops:
                gxv = gx[i] if lp.vert is F[j][i] or lp.vert is F[j + 1][i] else gx[i + 1]
                gzv = gz[j] if lp.vert is F[j][i] or lp.vert is F[j][i + 1] else gz[j + 1]
                lp[uvl].uv = ((w / 2 - gxv) / w * uv_rep[0], (gzv + h / 2) / h * uv_rep[1])
            pins.append((bb.faces.new((B[j][i], B[j + 1][i], B[j + 1][i + 1], B[j][i + 1])), Vector((0, -1, 0))))
    # rim strip (lives in the back material): duplicate the boundary front vertices into the back bmesh
    rimF = {}

    def rv(i, j):
        if (i, j) not in rimF:
            rimF[(i, j)] = bb.verts.new(F[j][i].co.copy())
        return rimF[(i, j)]
    for i in range(nx):
        if (i, 0) not in skip:
            pins.append((bb.faces.new((B[0][i], B[0][i + 1], rv(i + 1, 0), rv(i, 0))), Vector((0, 0, -1))))
        if (i, nz - 1) not in skip:
            pins.append((bb.faces.new((B[nz][i + 1], B[nz][i], rv(i, nz), rv(i + 1, nz))), Vector((0, 0, 1))))
    for j in range(nz):
        if (0, j) not in skip:
            pins.append((bb.faces.new((B[j + 1][0], B[j][0], rv(0, j), rv(0, j + 1))), Vector((-1, 0, 0))))
        if (nx - 1, j) not in skip:
            pins.append((bb.faces.new((B[j][nx], B[j + 1][nx], rv(nx, j + 1), rv(nx, j))), Vector((1, 0, 0))))
    R = Euler([a_ * D2R for a_ in rot]).to_matrix().to_4x4()
    M = Matrix.Translation(center) @ R
    bmesh.ops.transform(bf, matrix=M, verts=[v for r in F for v in r])
    bmesh.ops.transform(bb, matrix=M, verts=[v for r in B for v in r] + list(rimF.values()))
    R3 = R.to_3x3()
    for (pf, pn) in pins:
        mb.pinned.append((pf, R3 @ pn))
    return F, B


# ------------------------------------------------------------------------------------------------- profiles
def offset_outline(path, t):
    """thick outline of an open polyline of (x, z): returns a closed polygon (list of (x, z)) with thickness t"""
    n = len(path)
    left, right = [], []
    for i, (x, z) in enumerate(path):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, n - 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dz) or 1.0
        nx_, nz_ = -dz / l, dx / l
        left.append((x + nx_ * t / 2, z + nz_ * t / 2))
        right.append((x - nx_ * t / 2, z - nz_ * t / 2))
    return left + right[::-1]


def ibeam_profile(bf, d, tf, tw):
    """I-beam outline (x, z), flange width bf, depth d, flange thickness tf, web thickness tw (centred)"""
    a, b, c = bf / 2, tw / 2, d / 2
    return [(-a, -c), (a, -c), (a, -c + tf), (b, -c + tf), (b, c - tf), (a, c - tf), (a, c), (-a, c), (-a, c - tf), (-b, c - tf), (-b, -c + tf), (-a, -c + tf)]


def channel_profile(bf, d, tf, tw):
    a, c = bf / 2, d / 2
    return [(-a, -c), (a, -c), (a, -c + tf), (-a + tw, -c + tf), (-a + tw, c - tf), (a, c - tf), (a, c), (-a, c)]


def rounded_rect_profile(w, h, r, seg=3):
    pts = []
    for (cx, cz, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = (a0 + 90 * k / seg) * D2R
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def beam(mb, m, profile, p0, p1, roll=0.0):
    """extrude `profile` [(u, v)] between two arbitrary points (profile plane perpendicular to the axis)"""
    bm = mb.bm(m)
    p0, p1 = Vector(p0), Vector(p1)
    ax = (p1 - p0)
    L = ax.length
    uu, vv, ww = _frame(ax)
    if roll:
        R = Matrix.Rotation(roll * D2R, 3, ww)
        uu, vv = R @ uu, R @ vv
    ring0 = [bm.verts.new(p0 + uu * x + vv * z) for (x, z) in profile]
    ring1 = [bm.verts.new(p1 + uu * x + vv * z) for (x, z) in profile]
    n = len(profile)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    return ring0 + ring1


# ------------------------------------------------------------------------------------------------- barrel UV
BODY_V0 = 0.455


def cyl_uv(bm, z0, z1, v0=0.0, v1=1.0, flat=None, faces=None, u_off=0.0):
    """cylindrical UV about the Z axis: u = angle/2pi, v = v0 + (v1-v0)*(z-z0)/(z1-z0).  Faces facing up/down (|nz| > 0.55) use flat(p)->(u,v)
       if given (else the same cylindrical mapping)."""
    uvl = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in (faces if faces is not None else bm.faces):
        if flat is not None and abs(f.normal.z) > 0.55:
            for lp in f.loops:
                lp[uvl].uv = flat(lp.vert.co)
            continue
        us = [math.atan2(lp.vert.co.y, lp.vert.co.x) / (2 * math.pi) + 0.5 + u_off for lp in f.loops]
        if max(us) - min(us) > 0.5:
            us = [u + 1.0 if u < 0.5 else u for u in us]
        for lp, u in zip(f.loops, us):
            z = max(z0, min(z1, lp.vert.co.z))
            lp[uvl].uv = (u, v0 + (v1 - v0) * (z - z0) / (z1 - z0))


def barrel_uv(bm, height, radius):
    """cylindrical UV for the body and disc UV for lid/bottom (matches sign_textures.py barrel layout)"""
    cyl_uv(bm, 0.0, height, BODY_V0, 1.0, flat=lambda p: (0.2 + p.x / radius * 0.16, 0.265 + p.y / radius * 0.16), u_off=0.25)


def dent_verts(verts, dents, radial=True, center=(0, 0)):
    """dents = [(pos Vector, radius, depth)]: push vertices inward (toward the axis) near pos"""
    for v in verts:
        if not v.is_valid:
            continue
        for (p, r, d) in dents:
            q = (v.co - Vector(p)).length
            if q < r:
                k = d * (1 - (q / r) ** 2) ** 2
                dirv = Vector((v.co.x - center[0], v.co.y - center[1], 0))
                if dirv.length > 1e-6:
                    v.co -= dirv.normalized() * k
