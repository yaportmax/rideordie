"""Buggy-only helpers: paddle tyres, beadlock rims, coil springs, bucket seats."""
from veh_lib import *
from veh_parts import _rim_mesh

_CACHE = {}


def paddle_tire_mesh(name, R, W, rim_r, N=72, paddles=12, lug=0.05, J=8):
    """Sand-paddle tyre around X (centre plane x=0, outer face +X)."""
    h = R - rim_r
    hw = W / 2
    side = [(0.80 * hw, rim_r + 0.012), (hw, rim_r + 0.42 * h), (0.93 * hw, R - 0.14 * h)]
    tw = 0.80 * hw
    per = N // paddles
    prof = [1.0, 1.0, 0.45, 0.0, 0.0, 0.45]
    prof = (prof * 4)[:per] if per != 6 else prof
    bm = bmesh.new()
    rings = []
    for w, r in side:
        rings.append((-w, r, None))
    for j in range(J + 1):
        w = -tw + 2 * tw * j / J
        jn = abs(2 * j / J - 1)
        rings.append((w, None, (j, jn)))
    for w, r in reversed(side):
        rings.append((w, r, None))
    verts = []
    for w, r0, jj in rings:
        row = []
        for i in range(N):
            th = 2 * math.pi * i / N
            if r0 is not None:
                r = r0
            else:
                j, jn = jj
                sh = int(round(3.0 * jn))
                hh = prof[(i + sh) % per]
                if jn > 0.92:
                    hh *= 0.85
                r = R - lug * (1.0 - hh)
            row.append(bm.verts.new((w, math.sin(th) * r, math.cos(th) * r)))
        verts.append(row)
    for j in range(len(rings) - 1):
        for i in range(N):
            k = (i + 1) % N
            bm.faces.new((verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i]))
    bm.faces.ensure_lookup_table()
    f0 = bm.faces[len(bm.faces) // 2]
    c = f0.calc_center_median()
    if f0.normal.dot(Vector((0, c.y, c.z)).normalized()) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def beadlock_rim_mesh(name, rim_r, W, spokes=6, lugs=6, ring_bolts=16, N=24):
    """Steel rim with a bolted beadlock ring on the outer face (material `rim`)."""
    me = _rim_mesh(name, rim_r, W, "steel", spokes, lugs, N)
    hw = W / 2
    bm = bmesh.new()
    bm.from_mesh(me)
    a, b = 0.905 * hw, 0.975 * hw
    r0, r1 = rim_r - 0.01, rim_r + 0.058
    prof = [(a, r0), (b, r0), (b, r1), (a, r1)]
    Nn = 28
    rr = []
    for w, r in prof:
        rr.append([bm.verts.new((w, math.sin(2 * math.pi * i / Nn) * r, math.cos(2 * math.pi * i / Nn) * r)) for i in range(Nn)])
    for j in range(4):
        jn = (j + 1) % 4
        for i in range(Nn):
            k = (i + 1) % Nn
            bm.faces.new((rr[j][i], rr[j][k], rr[jn][k], rr[jn][i]))
    # bolts on the ring
    rb = rim_r + 0.031
    for q in range(ring_bolts):
        an = 2 * math.pi * (q + 0.5) / ring_bolts
        cy, cz = math.sin(an) * rb, math.cos(an) * rb
        s6 = 6
        base = [bm.verts.new((b, cy + math.sin(2 * math.pi * i / s6) * 0.0115, cz + math.cos(2 * math.pi * i / s6) * 0.0115)) for i in range(s6)]
        top = [bm.verts.new((b + 0.013, cy + math.sin(2 * math.pi * i / s6) * 0.0100, cz + math.cos(2 * math.pi * i / s6) * 0.0100)) for i in range(s6)]
        bm.faces.new(top)
        for i in range(s6):
            k = (i + 1) % s6
            bm.faces.new((base[i], base[k], top[k], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return me


def build_buggy_wheel(V, name, hub, side, R, W, rim_r, kind="paddle", spokes=6, key=None):
    key = key or (R, W, rim_r, kind)
    ck = (key, side)
    if ck not in _CACHE:
        n = len(_CACHE)
        if kind == "paddle":
            me_t = paddle_tire_mesh("btire_%d" % n, R, W, rim_r)
        else:
            from veh_parts import _tire_mesh
            me_t = _tire_mesh("btire_%d" % n, R, W, rim_r, "offroad", 64, 0)
        me_r = beadlock_rim_mesh("brim_%d" % n, rim_r, W, spokes=spokes, lugs=6, ring_bolts=14 if kind != "paddle" else 18)
        if side < 0:
            for me in (me_t, me_r):
                me.transform(Matrix.Diagonal((-1, 1, 1, 1)))
                me.flip_normals()
        me_t.materials.append(V.M["rubber_tire"])
        me_r.materials.append(V.M["rim"])
        for me in (me_t, me_r):
            for p in me.polygons:
                p.use_smooth = True
            try:
                me.set_sharp_from_angle(angle=42 * D2R)
            except Exception:
                pass
        _CACHE[ck] = (me_t, me_r)
    me_t, me_r = _CACHE[ck]
    ot = bpy.data.objects.new(name + "_tire", me_t)
    orr = bpy.data.objects.new(name + "_rim", me_r)
    for o in (ot, orr):
        bpy.context.collection.objects.link(o)
        reg(o, name)
    V.pivot(name, *hub)
    return ot, orr


def _perp(d):
    d = Vector(d).normalized()
    a = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(a).normalized()
    v = d.cross(u).normalized()
    return u, v


def coil_spring(name, p0, p1, r, turns, wire, m, g="body", per_turn=7, taper=None):
    """Helical spring between two (x,f,z) points."""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    u, v = _perp(d)
    n = int(turns * per_turn)
    pts = []
    for i in range(n + 1):
        t = i / n
        ang = 2 * math.pi * turns * t
        rr = r * (1.0 if not taper else (taper[0] + (taper[1] - taper[0]) * t))
        p = a + d * t + u * (math.cos(ang) * rr) + v * (math.sin(ang) * rr)
        pts.append((p.x, p.y, p.z))
    return tube(name, pts, wire, m, res=0, caps=False, g=g)
