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


# ================================================================================================ v2 wheels
# Tyre = closed carcass (sidewall bulge, rounded shoulder, flat tread floor) + separate crisp lug blocks sitting on the floor.
# Rim = closed barrel (flanges, bead seats, drop centre) + style centre (steel disc with windows / star spokes / deep dish),
# raised hub, hex lug nuts, centre cap and a brake rotor with hat (the caliper is static -> built into the body, see caliper()).
# Local frame: axle = X (outer face +X), wheel centre at the origin.  Points are (w, y, z) with w along X.
TREAD = {
    #          groove depth, lugs per row, rows (w-range as fraction of tread half width), shoulder lugs, row stagger, lug length fraction
    "mud":     dict(gd=0.034, B=16, rows=[(-0.10, 1.0), (-1.0, 0.10)], shoulder=True, stagger=0.5, lug_frac=0.55),
    "offroad": dict(gd=0.026, B=18, rows=[(-0.08, 1.0), (-1.0, 0.08)], shoulder=True, stagger=0.5, lug_frac=0.52),
    "at":      dict(gd=0.020, B=19, rows=[(0.04, 1.0), (-1.0, -0.04)], shoulder=True, stagger=0.5, lug_frac=0.60),
    "street":  dict(gd=0.012, B=22, rows=[(0.10, 1.0), (-1.0, -0.10)], shoulder=False, stagger=0.5, lug_frac=0.80),
    "paddle":  dict(gd=0.050, B=12, rows=[(0.0, 1.0), (-1.0, 0.0)], shoulder=False, stagger=0.0, lug_frac=0.16, chevron=0.035),
}


def _bm_quad_box(bm, c8, faces_out):
    """8 verts (bottom 4 then top 4, same winding) -> 5 faces (no bottom)."""
    v = [bm.verts.new(p) for p in c8]
    ref = sum((x.co for x in v), Vector()) / 8.0
    fs = [(4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for f in fs:
        try:
            fc = bm.faces.new([v[i] for i in f])
        except ValueError:
            continue
        fc.normal_update()
        if fc.normal.dot(fc.calc_center_median() - ref) < 0:
            fc.normal_flip()


def tire_mesh_v2(name, R, W, rim_r, style="offroad", N=40):
    T = TREAD[style]
    bm = bmesh.new()
    h = R - rim_r
    hw = W / 2
    gd = T["gd"]
    floor = R - gd
    tw = 0.84 * hw
    prof = [(-0.84 * hw, rim_r + 0.006), (-0.985 * hw, rim_r + 0.30 * h), (-hw, rim_r + 0.55 * h), (-0.965 * hw, floor - 0.25 * gd - 0.10 * h),
            (-tw, floor), (tw, floor), (0.965 * hw, floor - 0.25 * gd - 0.10 * h),
            (hw, rim_r + 0.55 * h), (0.985 * hw, rim_r + 0.30 * h), (0.84 * hw, rim_r + 0.006), (0.0, rim_r - 0.004)]
    rings = []
    for i in range(N):
        a = 2 * math.pi * i / N
        rings.append([bm.verts.new((w, math.sin(a) * r, math.cos(a) * r)) for w, r in prof])
    fs = []
    for i in range(N):
        A, Bq = rings[i], rings[(i + 1) % N]
        for j in range(len(prof)):
            k = (j + 1) % len(prof)
            fs.append(bm.faces.new((A[j], A[k], Bq[k], Bq[j])))
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    # ---- lugs
    B = T["B"]
    pitch = 2 * math.pi / B
    lug_faces = []

    def rp(w, a, r):
        return (w, math.sin(a) * r, math.cos(a) * r)
    for ri, (u0, u1) in enumerate(T["rows"]):
        off = (T["stagger"] * pitch) * (ri % 2)
        for b in range(B):
            a0 = b * pitch + off
            a1 = a0 + pitch * T["lug_frac"]
            w0, w1 = u0 * tw, u1 * tw
            chev = T.get("chevron", 0.0)
            if chev:
                # paddle: sweep the outer end back (chevron) - two halves meet at the centre line
                sgn = 1 if u1 > 0 else -1
                wa, wb = (0.0, sgn * tw)
                pa0, pa1 = a0, a1
                pb0, pb1 = a0 + chev / R * 1.0, a1 + chev / R * 1.0
                c8 = [rp(wa, pa0, floor - 0.004), rp(wb, pb0, floor - 0.004), rp(wb, pb1, floor - 0.004), rp(wa, pa1, floor - 0.004),
                      rp(wa, pa0, R), rp(wb, pb0, R), rp(wb, pb1, R), rp(wa, pa1, R)]
                if sgn < 0:
                    c8 = [c8[1], c8[0], c8[3], c8[2], c8[5], c8[4], c8[7], c8[6]]
                _bm_quad_box(bm, c8, lug_faces)
                continue
            # lug = strip of cross-sections along w: [inner end, (tread edge, shoulder end)] -> one bent block when it wraps the shoulder
            secs = []
            if T["shoulder"] and (u1 >= 0.99 or u0 <= -0.99):
                sgn = 1 if u1 >= 0.99 else -1
                wi = w0 if sgn > 0 else w1
                ro_top = R - 0.26 * h
                ro_bot = floor - 0.30 * gd - 0.12 * h
                secs = [(wi, floor - 0.004, R, 0.0), (sgn * tw, floor - 0.004, R, 0.0), (sgn * 0.995 * hw, ro_bot, ro_top, pitch * 0.07)]
                if sgn < 0:
                    secs = secs[::-1]
            else:
                secs = [(w0, floor - 0.004, R, 0.0), (w1, floor - 0.004, R, 0.0)]
            rows_v = []
            for (w, rb, rt, shrink) in secs:
                rows_v.append([bm.verts.new(rp(w, a0 + shrink, rb)), bm.verts.new(rp(w, a1 - shrink, rb)),
                               bm.verts.new(rp(w, a1 - shrink, rt)), bm.verts.new(rp(w, a0 + shrink, rt))])
            def _out(f, ref):
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - ref) < 0:
                    f.normal_flip()
            for i in range(len(rows_v) - 1):
                A_, B_ = rows_v[i], rows_v[i + 1]
                ref = sum((v.co for v in A_ + B_), Vector()) / 8.0
                for j in (1, 2, 3):              # side, top, side (no bottom)
                    k = (j + 1) % 4
                    f = bm.faces.new((A_[j], A_[k], B_[k], B_[j]))
                    _out(f, ref)
                if i == 0:
                    f = bm.faces.new(rows_v[0][::-1])
                    _out(f, ref)
                if i == len(rows_v) - 2:
                    f = bm.faces.new(rows_v[-1])
                    _out(f, ref)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def rim_mesh_v2(name, rim_r, W, style="steel", spokes=6, lugs=5, N=20, rotor=True, hub_spike=0.0):
    hw = W / 2
    Wr = 0.84 * hw
    bm = bmesh.new()
    allf = []

    def revolve(loop, n=N, closed_loop=True, a0=0.0):
        rings = []
        for i in range(n):
            a = a0 + 2 * math.pi * i / n
            rings.append([bm.verts.new((w, math.sin(a) * r, math.cos(a) * r)) for w, r in loop])
        fs = []
        L = len(loop)
        for i in range(n):
            A, Bq = rings[i], rings[(i + 1) % n]
            for j in range(L if closed_loop else L - 1):
                k = (j + 1) % L
                fs.append(bm.faces.new((A[j], A[k], Bq[k], Bq[j])))
        bmesh.ops.recalc_face_normals(bm, faces=fs)
        return fs

    def solid(prof, n=N, a0=0.0, cx=0.0, cy=0.0):
        """solid of revolution about X (optionally off-axis at (cy, cz)): prof [(w, r)], r=0 -> pole."""
        rings = []
        for w, r in prof:
            if r <= 1e-7:
                rings.append([bm.verts.new((w, cx, cy))])
            else:
                rings.append([bm.verts.new((w, cx + math.sin(a0 + 2 * math.pi * i / n) * r, cy + math.cos(a0 + 2 * math.pi * i / n) * r)) for i in range(n)])
        fs = []
        for i in range(len(rings) - 1):
            A, Bq = rings[i], rings[i + 1]
            for j in range(n):
                k = (j + 1) % n
                if len(A) == 1:
                    fs.append(bm.faces.new((A[0], Bq[j], Bq[k])))
                elif len(Bq) == 1:
                    fs.append(bm.faces.new((A[j], A[k], Bq[0])))
                else:
                    fs.append(bm.faces.new((A[j], A[k], Bq[k], Bq[j])))
        if len(rings[0]) > 1:
            fs.append(bm.faces.new(rings[0][::-1]))
        if len(rings[-1]) > 1:
            fs.append(bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(bm, faces=fs)
        return fs

    def wedge(r0, r1, a_c, aw0, aw1, wa0, wa1, th, taper_w=0.0):
        """radial spoke from r0 to r1 centred on angle a_c, angular half-widths aw0 (inner) aw1 (outer); face plane w from wa0 (inner) to wa1 (outer)."""
        pts = [(r0, a_c - aw0, wa0), (r1, a_c - aw1, wa1), (r1, a_c + aw1, wa1), (r0, a_c + aw0, wa0)]
        lo = [bm.verts.new((w - th, math.sin(a) * r, math.cos(a) * r)) for r, a, w in pts]
        hi = [bm.verts.new((w, math.sin(a) * r, math.cos(a) * r)) for r, a, w in pts]
        fs = [bm.faces.new(lo[::-1]), bm.faces.new(hi)]
        for i in range(4):
            k = (i + 1) % 4
            fs.append(bm.faces.new((lo[i], lo[k], hi[k], hi[i])))
        bmesh.ops.recalc_face_normals(bm, faces=fs)

    # ---- barrel (closed loop): outer flange lip, bead seat, drop centre, inner flange, inner skin
    t = 0.005
    loop = [(Wr + 0.004, rim_r + 0.020), (Wr - 0.014, rim_r + 0.018), (0.18 * Wr, rim_r - 0.004),
            (0.05 * Wr, rim_r - 0.028), (-0.60 * Wr, rim_r - 0.028), (-Wr + 0.012, rim_r + 0.004), (-Wr - 0.004, rim_r + 0.020),
            (-Wr, rim_r - t - 0.006), (Wr, rim_r - t - 0.004)]
    revolve(loop)
    hub_r = 0.078
    if style == "deep":
        face_w = -0.15 * Wr
    elif style == "star":
        face_w = 0.40 * Wr
    else:
        face_w = 0.22 * Wr
    rin = rim_r - 0.033          # inner skin radius at the drop centre
    rlip = rim_r - 0.006
    if style in ("steel", "deep", "beadlock"):
        # outer ring (dish) from the barrel lip down to the window ring
        rw = 0.80 * rim_r
        dish = [(Wr - 0.02, rlip), (face_w + 0.010, rw + 0.004), (face_w - 0.008, rw - 0.004), (Wr - 0.032, rlip - 0.012)]
        revolve(dish)
        # centre disc (dished towards the hub)
        rc = 0.50 * rim_r
        solid([(face_w - 0.010, rc + 0.004), (face_w + 0.002, rc + 0.004), (face_w + 0.016, rc * 0.70), (face_w + 0.020, hub_r * 1.05)], n=N)
        # window bridges between rc and rw
        n_sp = spokes
        sec = 2 * math.pi / n_sp
        for s in range(n_sp):
            a_c = s * sec + sec / 2
            wedge(rc - 0.004, rw + 0.002, a_c, sec * 0.23, sec * 0.21, face_w + 0.002, face_w, 0.010)
    elif style == "star":
        rc = 0.30 * rim_r
        solid([(face_w - 0.012, 0.0), (face_w - 0.012, rc), (face_w + 0.004, rc), (face_w + 0.022, hub_r * 1.1), (face_w + 0.022, 0.0)], n=N)
        sec = 2 * math.pi / spokes
        for s in range(spokes):
            a_c = s * sec
            wedge(rc - 0.01, rim_r - 0.008, a_c, sec * 0.16, sec * 0.07, face_w + 0.012, Wr - 0.016, 0.022)
        # thin lip ring where the spokes land
        revolve([(Wr - 0.012, rlip), (Wr - 0.002, rlip + 0.004), (Wr - 0.002, rlip - 0.018), (Wr - 0.02, rlip - 0.018)])
    # raised hub + lug nuts + centre cap
    solid([(face_w + 0.018, 0.0), (face_w + 0.018, hub_r), (face_w + 0.030, hub_r * 0.92), (face_w + 0.030, 0.0)], n=12)
    for l in range(lugs):
        a = 2 * math.pi * l / lugs + 0.3
        cy, cz = math.sin(a) * hub_r * 0.66, math.cos(a) * hub_r * 0.66
        solid([(face_w + 0.028, 0.0125), (face_w + 0.046, 0.0125), (face_w + 0.050, 0.0)], n=6, cx=cy, cy=cz, a0=math.pi / 6)
    if hub_spike > 0:
        # chariot-style spinner: hex collar + long cone along the axle
        solid([(face_w + 0.03, 0.0), (face_w + 0.03, 0.040), (face_w + 0.062, 0.040), (face_w + 0.068, 0.030), (face_w + 0.068, 0.0)], n=6, a0=math.pi / 6)
        solid([(face_w + 0.066, 0.0), (face_w + 0.066, 0.028), (face_w + 0.066 + hub_spike * 0.35, 0.022), (face_w + 0.066 + hub_spike, 0.0)], n=8)
    else:
        solid([(face_w + 0.03, 0.030), (face_w + 0.048, 0.026), (face_w + 0.056, 0.012), (face_w + 0.058, 0.0)], n=10)
    if style == "beadlock":
        a, b = 0.905 * hw, 0.975 * hw
        revolve([(a, rim_r - 0.01), (b, rim_r - 0.01), (b, rim_r + 0.058), (a, rim_r + 0.058)], n=26)
        rb = rim_r + 0.031
        nb = 16
        for q in range(nb):
            an = 2 * math.pi * (q + 0.5) / nb
            solid([(b - 0.002, 0.0), (b - 0.002, 0.011), (b + 0.012, 0.010), (b + 0.014, 0.0)], n=6, cx=math.sin(an) * rb, cy=math.cos(an) * rb)
    if rotor:
        rr0, rr1 = 0.30 * rim_r, 0.80 * rim_r
        wr = min(face_w - 0.05, 0.05 * Wr) - 0.02
        revolve([(wr + 0.012, rr0), (wr + 0.012, rr1), (wr - 0.012, rr1), (wr - 0.012, rr0)], n=16)
        # hat
        revolve([(wr + 0.012, rr0 + 0.002), (face_w - 0.010, hub_r * 0.95), (wr + 0.006, rr0 - 0.006)], n=12)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return me


def caliper(name, hub, sd, rim_r, W, g="body", m="metal_dark", front=True, face_w_frac=0.22):
    """Static brake caliper hugging the rotor at the rear of the disc (x,f,z hub, sd = +1 left / -1 right)."""
    hw = W / 2
    Wr = 0.84 * hw
    wr = min(face_w_frac * Wr - 0.05, 0.05 * Wr) - 0.02
    rr1 = 0.80 * rim_r
    ang = 30 * D2R if front else 150 * D2R          # angle round the disc (0 = top, + towards the rear)
    r = rr1 - 0.035
    f = hub[1] - math.sin(ang) * r
    z = hub[2] + math.cos(ang) * r
    x = hub[0] + sd * wr
    # long side (f) follows the rotor tangent at that angle
    return bx(name, (x, f, z), (0.055, 0.12, 0.065), m, bevel=0.012, seg=1, g=g, pitch=ang / D2R)


def build_wheel2(V, name, hub, side, R, W, rim_r, tire="offroad", rim_style="steel", spokes=6, lugs=5, key=None, N=40, NR=20, hub_spike=0.0):
    """v2 wheel (see tire_mesh_v2 / rim_mesh_v2).  Wheels with the same key+side share mesh data."""
    key = key or (R, W, rim_r, tire, rim_style, spokes, lugs)
    ck = ("v2", key, side)
    if ck not in _WHEEL_CACHE:
        me_t = tire_mesh_v2("tire_%s_%s" % (len(_WHEEL_CACHE), side), R, W, rim_r, tire, N)
        me_r = rim_mesh_v2("rim_%s_%s" % (len(_WHEEL_CACHE), side), rim_r, W, rim_style, spokes, lugs, NR, hub_spike=hub_spike)
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
