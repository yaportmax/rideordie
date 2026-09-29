"""Rock / pillar geometry generators (own module: envlib.MB.rock is the simple version)."""
import math, random
import bmesh
from mathutils import Vector, Matrix, noise as mnoise


def add_rock(mb, m, seed=0, size=(1, 1, 1), center=(0, 0, 0), subdiv=3, cuts=7, rough=0.05, bury=0.12, strata=0.0, rot_z=None,
             cut_strength=0.9, roundness=0.0, macro=0.22, ridge=0.03, stretch=None, chips=3):
    """Angular rock: icosphere -> low-frequency macro deformation -> big planar cuts (facets) -> a few small chip cuts -> gentle surface noise.
       size = bbox extents (x, y, z) of the finished rock (before burying by `bury` fraction of height)."""
    bm = mb.bm(m)
    rnd = random.Random(seed)
    vs = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)["verts"]
    off = Vector((rnd.uniform(-50, 50), rnd.uniform(-50, 50), rnd.uniform(-50, 50)))
    big = []
    for _ in range(cuts):
        n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0.35, 0.6))).normalized()
        big.append((n, rnd.uniform(0.68, 0.88)))
    small = []
    for _ in range(chips):
        n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0.2, 0.8))).normalized()
        small.append((n, rnd.uniform(0.86, 0.95)))
    st = stretch or (1.0, 1.0, 1.0)
    for v in vs:
        p = v.co.copy()
        d = 1.0 + mnoise.noise(p * 0.9 + off) * macro + mnoise.noise(p * 1.9 + off * 1.3) * macro * 0.45
        d += ridge * (1.0 - abs(mnoise.noise(p * 2.6 + off * 1.6)) * 2.0)
        p = Vector((p.x * d * st[0], p.y * d * st[1], p.z * d * st[2]))
        for (n, dist) in big:
            ex = p.dot(n) - dist
            if ex > 0:
                p -= n * ex * cut_strength * (1.0 - 0.6 * roundness)
        for (n, dist) in small:
            ex = p.dot(n) - dist
            if ex > 0:
                p -= n * ex * 0.8 * (1.0 - 0.6 * roundness)
        u = p.normalized()
        p += u * (mnoise.noise(p * 3.0 + off * 1.7) * rough + mnoise.noise(p * 7.0 + off * 2.3) * rough * 0.35)
        if strata > 0:
            z = p.z * 3.0
            step = z - math.floor(z)
            p.z += (step - 0.5) * strata * 0.05
            k = 0.5 + 0.5 * math.sin(z * 6.283)
            p.x *= 1 + strata * 0.05 * k
            p.y *= 1 + strata * 0.05 * k
        v.co = p
    mn = Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs)))
    mx = Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))
    ext = mx - mn
    ang = rnd.uniform(0, 2 * math.pi) if rot_z is None else math.radians(rot_z)
    Rz = Matrix.Rotation(ang, 3, "Z")
    for v in vs:
        q = Vector(((v.co.x - (mn.x + mx.x) / 2) / ext.x * size[0], (v.co.y - (mn.y + mx.y) / 2) / ext.y * size[1], (v.co.z - mn.z) / ext.z * size[2]))
        q.z = max(q.z - size[2] * bury, 0.0)
        v.co = Rz @ q + Vector(center)
    return vs


def _prof(pts, t):
    for i in range(len(pts) - 1):
        t0, r0 = pts[i]
        t1, r1 = pts[i + 1]
        if t <= t1:
            k = (t - t0) / max(1e-6, t1 - t0)
            k = k * k * (3 - 2 * k)
            return r0 + (r1 - r0) * k
    return pts[-1][1]


def add_pillar(mb, m, height, profile, seed, layers, ex=1.0, ey=1.0, seg=32, rings=44, tile=6.0, flute=0.08, erosion=0.15,
               lean=0.04, squareness=4.0, ledge=0.10, twist=10.0):
    """Hoodoo / butte: stacked strata layers (hard ledges protrude, soft layers recess), lean, blocky cross-section, ragged top.
       Cylindrical UVs (u around, v up) at `tile` metres per texture tile.  Returns (vertices, layer_kind list)."""
    bm = mb.bm(m)
    uvl = bm.loops.layers.uv.verify()
    off = Vector((seed * 3.7, seed * 1.3, seed * 2.1))
    rnd = random.Random(seed)
    layer_kind = [rnd.choice([0.0, 0.0, 1.0]) for _ in range(layers + 1)]
    layer_rot = [rnd.uniform(-twist, twist) * math.pi / 180 for _ in range(layers + 1)]
    circ = 2 * math.pi * profile[3][1]
    rows = []
    for i in range(rings + 1):
        t = i / rings
        z = t * height
        rp = _prof(profile, t)
        lk = t * layers
        k = int(min(layers - 1, math.floor(lk)))
        f = lk - k
        fs = min(1.0, max(0.0, (f - 0.55) / 0.45))
        fs = fs * fs * (3 - 2 * fs)                     # sharp-ish change at the layer boundary (ledge)
        hard = layer_kind[k] * (1 - fs) + layer_kind[k + 1] * fs
        rot = layer_rot[k] * (1 - fs) + layer_rot[k + 1] * fs
        strat = 1.0 - ledge * (1.0 - hard) - 0.03 * f            # soft layers recess, slight talus slope inside each layer
        cx = lean * height * mnoise.noise(Vector((t * 1.6, 0.3, 0.7)) + off)
        cy = lean * height * mnoise.noise(Vector((0.4, t * 1.6, 0.9)) + off)
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg + rot
            c, s = math.cos(a), math.sin(a)
            sq = (abs(c) ** squareness + abs(s) ** squareness) ** (-1.0 / squareness)      # superellipse radius factor (blocky)
            n_low = mnoise.noise(Vector((c * 1.1, s * 1.1, t * 2.4)) + off)
            n_fl = mnoise.noise(Vector((c * 3.4, s * 3.4, t * 1.1)) + off * 1.7)
            n_hi = mnoise.noise(Vector((c * 7.0, s * 7.0, t * 10.0)) + off * 2.3)
            r = rp * strat * (1.0 + 0.9 * (sq - 1.0)) * 0.93 * (1 + erosion * n_low + flute * n_fl + 0.03 * n_hi)
            ring.append(bm.verts.new((cx + c * r * ex, cy + s * r * ey, z)))
        rows.append(ring)
    for i in range(rings):
        for j in range(seg):
            a, b = rows[i][j], rows[i][(j + 1) % seg]
            c2, d = rows[i + 1][(j + 1) % seg], rows[i + 1][j]
            fc = bm.faces.new((a, b, c2, d))
            zs = (i * height / rings / tile, (i + 1) * height / rings / tile)
            us = (j * circ / seg / tile, (j + 1) * circ / seg / tile)
            for lp, uv in zip(fc.loops, ((us[0], zs[0]), (us[1], zs[0]), (us[1], zs[1]), (us[0], zs[1]))):
                lp[uvl].uv = uv
    top = rows[-1]
    cx = sum(v.co.x for v in top) / seg
    cy = sum(v.co.y for v in top) / seg
    for j, v in enumerate(top):                          # ragged, slightly dropped rim
        v.co.z += mnoise.noise(Vector((j * 0.7, 3.3, 1.1)) + off) * height * 0.012
    apex = bm.verts.new((cx, cy, height + profile[-1][1] * 0.06))
    for j in range(seg):
        fc = bm.faces.new((top[j], top[(j + 1) % seg], apex))
        for lp in fc.loops:
            lp[uvl].uv = (lp.vert.co.x / tile, lp.vert.co.y / tile)
    return layer_kind
