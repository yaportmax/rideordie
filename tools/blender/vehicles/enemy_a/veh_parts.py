"""Reusable vehicle parts: wheels, seats, engine, lights, mirrors, spikes, plates ...  (coordinates: x=left, f=forward, z=up)"""
from veh_lib import *

_WHEEL_CACHE = {}


def _grid_faces(bm, verts, n_rings, N, wrap=True):
    for j in range(n_rings - 1):
        for i in range(N):
            k = (i + 1) % N
            bm.faces.new((verts[j][i], verts[j][k], verts[j + 1][k], verts[j + 1][i]))


def _tire_mesh(name, R, W, rim_r, style, N, seed):
    """Tyre around the X axis, centre plane at x=0, width W.  Left/outer side is +X."""
    h = R - rim_r
    hw = W / 2
    gd = {"street": 0.012, "offroad": 0.028, "mud": 0.038, "paddle": 0.045, "slick": 0.004}.get(style, 0.02)
    side = [(0.80 * hw, rim_r + 0.012), (hw, rim_r + 0.40 * h), (0.91 * hw, R - 0.17 * h)]
    J = 6 if style in ("mud", "offroad", "paddle") else 5
    tw = 0.78 * hw
    bm = bmesh.new()
    rings = []       # list of (w, callable r(i))
    for w, r in side:
        rings.append((-w, lambda i, r=r: r))
    shoulder_r = R - 0.006
    for j in range(J + 1):
        w = -tw + 2 * tw * j / J
        jn = abs(2 * j / J - 1)
        rings.append((w, None, j, jn))
    for w, r in reversed(side):
        rings.append((w, lambda i, r=r: r))
    verts = []
    for ring in rings:
        w = ring[0]
        row = []
        for i in range(N):
            th = 2 * math.pi * i / N
            if ring[1] is not None:
                r = ring[1](i)
            else:
                j, jn = ring[2], ring[3]
                r = R - 0.003
                if style in ("offroad", "mud"):
                    per = 4
                    sh = int(round((2.0 if style == "offroad" else 2.0) * jn))
                    on = ((i + sh) % per) < 2
                    if j == J // 2:
                        on = ((i) % per) < 3        # centre rib, mostly solid
                    if jn > 0.9:
                        on = ((i + sh) % per) < 3   # shoulder lugs
                    r = R if on else R - gd
                elif style == "paddle":
                    per = 8
                    sh = int(round(3.0 * jn))
                    on = ((i + sh) % per) < 3
                    r = R if on else R - gd
                elif style == "street":
                    on = not (j in (J // 3, J - J // 3))
                    r = R if on else R - gd
                    if (i % 6) == 0 and jn > 0.4:
                        r = R - gd * 0.6
            row.append(bm.verts.new((w, math.sin(th) * r, math.cos(th) * r)))
        verts.append(row)
    _grid_faces(bm, verts, len(rings), N)
    # make normals point outward: check one face on the tread
    bm.faces.ensure_lookup_table()
    f0 = bm.faces[len(bm.faces) // 2]
    c = f0.calc_center_median()
    radial = Vector((0, c.y, c.z)).normalized()
    if f0.normal.dot(radial) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def _rim_mesh(name, rim_r, W, style, spokes, lugs, N=24):
    """Rim + hub + rotor as one mesh (material `rim`); outer face toward +X."""
    hw = W / 2
    bm = bmesh.new()
    # barrel: closed revolve of a small profile (w, r)
    Wr = 0.84 * hw
    t = 0.008
    prof = [(-Wr, rim_r - t), (-Wr, rim_r + 0.020), (-Wr + 0.016, rim_r + 0.020), (-Wr + 0.03, rim_r + 0.002),
            (Wr - 0.03, rim_r + 0.002), (Wr - 0.016, rim_r + 0.020), (Wr, rim_r + 0.020), (Wr, rim_r - t)]
    rings = []
    for (w, r) in prof:
        rings.append([bm.verts.new((w, math.sin(2 * math.pi * i / N) * r, math.cos(2 * math.pi * i / N) * r)) for i in range(N)])
    for j in range(len(prof)):
        jn = (j + 1) % len(prof)
        for i in range(N):
            k = (i + 1) % N
            bm.faces.new((rings[j][i], rings[j][k], rings[jn][k], rings[jn][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    def cyl_x(w0, w1, r0, r1, sides, cy=0.0, cz=0.0, cap0=True, cap1=True):
        a = [bm.verts.new((w0, cy + math.sin(2 * math.pi * i / sides) * r0, cz + math.cos(2 * math.pi * i / sides) * r0)) for i in range(sides)]
        b = [bm.verts.new((w1, cy + math.sin(2 * math.pi * i / sides) * r1, cz + math.cos(2 * math.pi * i / sides) * r1)) for i in range(sides)]
        if cap0:
            bm.faces.new(a[::-1])
        if cap1:
            bm.faces.new(b)
        for i in range(sides):
            k = (i + 1) % sides
            bm.faces.new((a[i], b[i], b[k], a[k]))

    face_w = Wr * 0.62 if style != "deep" else Wr * 0.35
    # spokes / disc wedges
    hub_r = 0.075
    for s in range(spokes):
        a0 = 2 * math.pi * s / spokes
        sec = 2 * math.pi / spokes
        aw_in, aw_out = sec * 0.34, sec * 0.30 if style != "star" else sec * 0.16
        r_in, r_out = hub_r * 0.8, rim_r - 0.006
        pts = []
        for r, aw in ((r_in, aw_in), (r_out, aw_out)):
            pts.append((r, a0 - aw / 2))
        pts_l = [(r_in, a0 - aw_in / 2), (r_out, a0 - aw_out / 2), (r_out, a0 + aw_out / 2), (r_in, a0 + aw_in / 2)]
        th = 0.026
        lo = [bm.verts.new((face_w - th, math.sin(a) * r, math.cos(a) * r)) for r, a in pts_l]
        hi = [bm.verts.new((face_w, math.sin(a) * r * 1.0, math.cos(a) * r * 1.0)) for r, a in pts_l]
        bm.faces.new(lo[::-1])
        bm.faces.new(hi)
        for i in range(4):
            k = (i + 1) % 4
            bm.faces.new((lo[i], lo[k], hi[k], hi[i]))
    cyl_x(face_w - 0.02, face_w + 0.012, hub_r, hub_r * 0.9, 14)                  # hub
    cyl_x(face_w + 0.012, face_w + 0.03, hub_r * 0.55, hub_r * 0.35, 12)          # centre cap
    for l in range(lugs):
        a = 2 * math.pi * l / lugs + 0.3
        cyl_x(face_w + 0.010, face_w + 0.034, 0.0125, 0.0105, 6, math.sin(a) * hub_r * 0.78, math.cos(a) * hub_r * 0.78)
    # brake rotor + hat (visible through spokes)
    cyl_x(Wr * 0.15, Wr * 0.15 + 0.014, rim_r * 0.74, rim_r * 0.74, 24)
    cyl_x(Wr * 0.15, face_w - 0.02, hub_r * 0.9, hub_r * 0.9, 12, cap0=False, cap1=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def build_wheel(V, name, hub, side, R, W, rim_r, tire="offroad", spokes=8, lugs=5, rim_style="steel", N=64, key=None):
    """Build wheel `name` (e.g. 'wheel_FL') with hub centre `hub` (x,f,z).  side=+1 left(+X outward) / -1 right.
    Wheels with the same key+side share mesh data."""
    key = key or (R, W, rim_r, tire, spokes, lugs, rim_style)
    ck = (key, side)
    if ck not in _WHEEL_CACHE:
        me_t = _tire_mesh("tire_%s_%s" % (len(_WHEEL_CACHE), side), R, W, rim_r, tire, N, 0)
        me_r = _rim_mesh("rim_%s_%s" % (len(_WHEEL_CACHE), side), rim_r, W, rim_style, spokes, lugs)
        if side < 0:
            for me in (me_t, me_r):
                me.transform(Matrix.Diagonal((-1, 1, 1, 1)))
                me.flip_normals()
        me_t.materials.append(V.M["rubber_tire"])
        me_r.materials.append(V.M["rim"])
        _WHEEL_CACHE[ck] = (me_t, me_r)
    me_t, me_r = _WHEEL_CACHE[ck]
    ot = bpy.data.objects.new(name + "_tire", me_t)
    orr = bpy.data.objects.new(name + "_rim", me_r)
    for o in (ot, orr):
        bpy.context.collection.objects.link(o)
        reg(o, name)
    V.pivot(name, *hub)
    return ot, orr


def reset_wheel_cache():
    _WHEEL_CACHE.clear()


def finish_wheel_shading():
    seen = set()
    for (ck, me) in [(k, v) for k, v in _WHEEL_CACHE.items()]:
        for m in me:
            if m.name in seen:
                continue
            seen.add(m.name)
            for p in m.polygons:
                p.use_smooth = True
            try:
                m.shade_smooth()
            except Exception:
                pass
            try:
                m.set_sharp_from_angle(angle=40 * D2R)
            except Exception:
                pass
