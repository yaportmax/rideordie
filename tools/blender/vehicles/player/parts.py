"""parts - reusable truck components (wheels, seats, lamps, mirrors, springs, engine ...).  Game coords everywhere."""
import math
import random
from mathutils import Vector
import vlib
from vlib import *  # noqa


# ------------------------------------------------------------------------------------------------- wheels
def _polar_disc(pt, m, hub, side, r0, r1, ax, n, hole_rows, thick=0.004, hole_r=(0.55, 0.9)):
    """Flat annulus (in the y-z plane at axial offset ax) with slot holes; thickened along the axle."""
    hx, hf, hz = hub
    bm = bmesh.new()
    radii = [r0, r0 + (r1 - r0) * hole_r[0], r0 + (r1 - r0) * hole_r[1], r1]
    rings = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        rings.append([bm.verts.new(PV((hx + ax * side, hf + r * ca, hz + r * sa))) for r in radii])
    for i in range(n):
        hole = (i % hole_rows[0]) in hole_rows[1]
        for j in range(3):
            if j == 1 and hole:
                continue
            try:
                bm.faces.new((rings[i][j], rings[(i + 1) % n][j], rings[(i + 1) % n][j + 1], rings[i][j + 1]))
            except ValueError:
                pass
    bm.normal_update()
    # orient outward along side*x
    s = sum(f.normal.x for f in bm.faces) * side
    if s < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
    vlib._thicken(bm, thick)
    pt.add_bm(bm, m)


PATTERNS = {3: [1.0, 0.0, 0.0], 4: [1.0, 0.0, 0.0, 1.0], 5: [1.0, 0.0, 0.0, 0.0, 1.0], 2: [1.0, 0.0]}


def build_wheel(pt, hub, side, R, W, rimR, style='steel', tread='bald', seg=56, lug_pitch=3, lug_depth=0.0, skew=1,
                shoulder=0.6, beadlock=False, nuts=5, rust=0.0, drum=False, seed=1):
    """Tyre + rim + hub + brake at world hub position `hub` (x,f,z).  side=+1 => outer face toward +x."""
    hx, hf, hz = hub
    hs = R - rimR
    hw = W / 2.0
    tp = [
        (rimR - 0.014, -hw * 0.60),
        (rimR + 0.10 * hs, -hw * 0.86),
        (rimR + 0.42 * hs, -hw * 1.00),
        (rimR + 0.76 * hs, -hw * 0.985),
        (R - 0.045 * (R / 0.34), -hw * 0.91),
        (R - 0.010, -hw * 0.80),
        (R, -hw * 0.62), (R, -hw * 0.31), (R, 0.0), (R, hw * 0.31), (R, hw * 0.62),
        (R - 0.010, hw * 0.80),
        (R - 0.045 * (R / 0.34), hw * 0.91),
        (rimR + 0.76 * hs, hw * 0.985),
        (rimR + 0.42 * hs, hw * 1.00),
        (rimR + 0.10 * hs, hw * 0.86),
        (rimR - 0.014, hw * 0.60),
    ]
    # extra sidewall rib for chunky tyres
    # index bookkeeping (profile indexes of tread columns) after insertion
    tread_idx = {}
    for j, (r_, a_) in enumerate(tp):
        if r_ >= R - 0.0505 * (R / 0.34) and abs(a_) <= hw * 0.93:
            tread_idx[j] = a_
    rnd = random.Random(seed)
    jitter = [rnd.uniform(-0.15, 0.15) for _ in range(seg)]

    def tfn(i, j, rad, ax):
        if lug_depth <= 0 or j not in tread_idx:
            return rad, ax
        col = abs(tread_idx[j]) / hw          # 0 centre .. 0.93 shoulder
        shift = int(round(skew * col * 2.6))
        k = (i + shift) % lug_pitch
        d = PATTERNS[lug_pitch][k]
        depth = lug_depth * d
        if col > 0.7:
            # shoulder lugs stand proud / deep
            depth = lug_depth * (0.4 + 0.9 * d)
            rad += lug_depth * shoulder * (1 if d < 0.5 else 0)
        elif col < 0.05:
            depth = lug_depth * (0.55 * d + 0.25)
        return rad - depth, ax
    pt.lathe('rubber_tire', tp, hub, n=seg, fn=tfn, side=side)

    # ---- rim
    xo = hw * 0.93
    lip = [
        (rimR - 0.052, -0.50 * hw), (rimR - 0.046, -0.15 * hw), (rimR - 0.050, 0.30 * hw),
        (rimR - 0.020, 0.70 * hw), (rimR + 0.006, 0.84 * hw), (rimR + 0.016, xo - 0.006), (rimR + 0.010, xo + 0.008),
        (rimR - 0.006, xo + 0.004), (rimR - 0.020, xo - 0.014),
    ]
    rm = 'rim'
    nr = 28 if R < 0.4 else 32
    pt.lathe(rm, lip, hub, n=nr, side=side)
    dish = 0.34 * hw
    hub_r = 0.075 if R < 0.5 else 0.09
    if style == 'steel':
        # stamped disc + slots + hub boss
        prof = [(rimR - 0.048, 0.34 * hw), (rimR - 0.075, dish + 0.02), (hub_r + 0.012, dish + 0.012),
                (hub_r, dish - 0.012 + 0.03), (hub_r * 0.86, dish + 0.034)]
        pt.lathe(rm, prof, hub, n=nr, side=side)
        _polar_disc(pt, rm, hub, side, hub_r + 0.02, rimR - 0.07, dish + 0.02, 32, (4, (1, 2)), 0.005, (0.38, 0.86))
        for k in range(nuts):
            a = 2 * math.pi * k / nuts + 0.3
            pt.cyl('chrome' if rust < 0.5 else 'metal_bare', (hx + side * (dish + 0.048), hf + 0.06 * math.cos(a), hz + 0.06 * math.sin(a)),
                   0.013, 0.02, axis='x', n=6)
        pt.cyl('metal_dark', (hx + side * (dish + 0.052), hf, hz), 0.033, 0.03, axis='x', n=10)
    else:
        # open spokes (alloy / beefy) so the brake shows behind
        ns = 6 if R < 0.46 else 8
        prof = [(hub_r + 0.02, dish + 0.02), (hub_r + 0.014, dish + 0.055), (hub_r * 0.7, dish + 0.06), (hub_r * 0.55, dish + 0.035)]
        pt.lathe(rm, prof, hub, n=16, side=side)
        for k in range(ns):
            a = 2 * math.pi * k / ns + 0.2
            ca, sa = math.cos(a), math.sin(a)
            p0 = (hx + side * (dish + 0.03), hf + (hub_r + 0.01) * ca, hz + (hub_r + 0.01) * sa)
            p1 = (hx + side * (dish + 0.02), hf + (rimR - 0.05) * ca, hz + (rimR - 0.05) * sa)
            pt.sweep('rim', [p0, ((p0[0] + p1[0]) / 2 + side * 0.008, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), p1],
                     [(0.03, 0.012), (-0.03, 0.012), (-0.024, -0.012), (0.024, -0.012)], up=(side, 0, 0), scale=[1.0, 1.15, 1.25])
        for k in range(nuts):
            a = 2 * math.pi * k / nuts + 0.3
            pt.cyl('chrome', (hx + side * (dish + 0.06), hf + 0.06 * math.cos(a), hz + 0.06 * math.sin(a)), 0.013, 0.022, axis='x', n=6)
        pt.cyl('metal_dark', (hx + side * (dish + 0.066), hf, hz), 0.032, 0.03, axis='x', n=10)
        # inner barrel disc back (so daylight isn't visible between spokes): inner hub plate
        pt.cyl('metal_dark', (hx + side * (0.05), hf, hz), rimR - 0.06, 0.006, axis='x', n=32)
    if beadlock:
        # outer clamp ring with bolts
        ring = [(rimR + 0.030, xo - 0.030), (rimR + 0.034, xo + 0.02), (rimR - 0.045, xo + 0.026), (rimR - 0.048, xo - 0.028)]
        pt.lathe('metal_dark', ring, hub, n=32, side=side, closed=True)
        nb = 16
        for k in range(nb):
            a = 2 * math.pi * k / nb
            pt.cyl('metal_bare', (hx + side * (xo + 0.03), hf + (rimR - 0.008) * math.cos(a), hz + (rimR - 0.008) * math.sin(a)),
                   0.0085, 0.014, axis='x', n=5)
    # ---- hub, brake, axle stub
    pt.cyl('metal_dark', (hx + side * 0.02, hf, hz), 0.055, 0.14, axis='x', n=10)
    if drum:
        pt.cyl('metal_dark', (hx + side * -0.02, hf, hz), rimR - 0.075, 0.09, axis='x', n=24, bev=0.006, r2=rimR - 0.085)
        pt.cyl('rust' if rust > 0.2 else 'metal_dark', (hx + side * 0.02, hf, hz), rimR - 0.10, 0.02, axis='x', n=16)
    else:
        pt.cyl('rust' if rust > 0.3 else 'metal_bare', (hx + side * 0.005, hf, hz), rimR - 0.052, 0.014, axis='x', n=20)
        # caliper
        pt.box('metal_dark', (hx + side * 0.0, hf + 0.0, hz + rimR - 0.09), (0.05, 0.085, 0.07), bev=0.0)
        pt.box('metal_bare', (hx + side * 0.028, hf - 0.005, hz + rimR - 0.09), (0.012, 0.06, 0.05), bev=0.0)
    pt.cyl('metal_dark', (hx - side * 0.12, hf, hz), 0.05, 0.16, axis='x', n=8)


# ------------------------------------------------------------------------------------------------- misc small parts
def bolt(pt, c, r=0.008, h=0.006, m='metal_bare', axis='f', n=6):
    pt.cyl(m, c, r, h, axis=axis, n=n)


def rivet_row(pt, p0, p1, count, r=0.006, m='metal_bare', axis='x', dome=True):
    a, b = Vector(p0), Vector(p1)
    for i in range(count):
        t = i / max(count - 1, 1)
        c = a + (b - a) * t
        if dome:
            pt.sph(m, tuple(c), r, n=6, sc=(1, 1, 1))
        else:
            pt.cyl(m, tuple(c), r, r * 0.8, axis=axis, n=6)


def weld_seam(pt, p0, p1, r=0.006, m='metal_bare', bumps=None):
    """A bead of weld: chain of overlapping squashed spheres between two points."""
    a, b = Vector(p0), Vector(p1)
    L = (b - a).length
    n = max(2, int(L / (r * 1.4)))
    d = (b - a).normalized()
    for i in range(n):
        c = a + (b - a) * (i / (n - 1))
        pt.sph(m, tuple(c), r, n=5)


def bolt_circle(pt, c, R, count, r, axis='f', m='metal_bare', h=0.008, plane='xz', n=6):
    for i in range(count):
        a = 2 * math.pi * i / count
        if plane == 'xz':
            p = (c[0] + R * math.cos(a), c[1], c[2] + R * math.sin(a))
        elif plane == 'fz':
            p = (c[0], c[1] + R * math.cos(a), c[2] + R * math.sin(a))
        else:
            p = (c[0] + R * math.cos(a), c[1] + R * math.sin(a), c[2])
        pt.cyl(m, p, r, h, axis=axis, n=n)


def leaf_spring(pt, xc, f0, f1, z_top, sag=0.05, leaves=5, w=0.055, m='metal_dark', mm='metal_dark'):
    """Semi-elliptic leaf spring under axle: arc from f0..f1 (f0 rear, f1 front) with `leaves` stacked plates."""
    for k in range(leaves):
        shrink = k * (f1 - f0) * 0.09
        a, b = f0 + shrink, f1 - shrink
        pts = []
        for i in range(6):
            t = i / 5
            f = a + (b - a) * t
            z = z_top - sag * (1 - (2 * t - 1) ** 2) * (1 - k * 0.1) + k * 0.011
            pts.append((xc, f, z))
        pt.sweep(m, pts, [(w / 2, 0.005), (-w / 2, 0.005), (-w / 2, -0.005), (w / 2, -0.005)], up=(1, 0, 0))
    # eye rolled ends
    pt.cyl(mm, (xc, f0, z_top - 0.005 + 0.0), 0.018, w, axis='x', n=8)
    pt.cyl(mm, (xc, f1, z_top - 0.005 + 0.0), 0.018, w, axis='x', n=8)


def coil_spring(pt, c, r, h, turns=6, wire=0.007, m='metal_dark', axis='z', n=8, seg=6):
    """Helical coil spring along z between c and c+h (axis z only)."""
    pts = []
    steps = turns * seg
    for i in range(steps + 1):
        a = 2 * math.pi * i / seg
        t = i / steps
        pts.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2] + h * t))
    pt.sweep(m, pts, circle_prof(wire, 5))


def shock(pt, a, b, r=0.018, m='metal_dark', spring=False):
    """Shock absorber from lower point a to upper point b."""
    A, B = Vector(a), Vector(b)
    mid = A + (B - A) * 0.45
    pt.cyl2('metal_bare', A, mid, r * 0.55, n=8)
    pt.cyl2(m, mid, B, r, n=8)
    pt.cyl('rubber', tuple(A), r * 1.1, r * 1.4, axis='x', n=6)
    pt.cyl('rubber', tuple(B), r * 1.1, r * 1.4, axis='x', n=6)
    if spring:
        pass


def gauge(pt, c, r, rot=(0, 0, 0), face='interior', needle=True):
    """Round instrument: chrome bezel torus + dark face + glass dome + needle (axis = +f facing driver => -f?)."""
    x, f, z = c
    # gauge faces backward (toward driver, -f), tilted by rot pitch
    pt.cyl('chrome', c, r, 0.012, axis='f', n=20, bev=0.002, rot=rot)
    pt.cyl('metal_dark', (x, f - 0.004, z), r * 0.88, 0.012, axis='f', n=20, rot=rot)


def hex_nut(pt, c, r, axis='x', m='metal_bare', h=None):
    pt.cyl(m, c, r, h or r * 0.8, axis=axis, n=6, bev=r * 0.12)


def mirror(pt, base, side, arm=0.20, size=(0.02, 0.16, 0.22), rear=True, m='plastic', frame='metal_dark', glass='chrome'):
    """Wing mirror on an arm: base=(x,f,z) at the door; side=+1 (left) or -1."""
    x, f, z = base
    tip = (x + side * arm, f - 0.02, z + 0.06)
    pt.tube(frame, [base, (x + side * arm * 0.55, f, z + 0.02), tip], 0.008, n=8, rad=0.0)
    # housing
    c = (tip[0] + side * 0.02, tip[1] - 0.02, tip[2] + 0.02)
    pt.box(m, c, size, bev=0.012, seg=2)
    pt.box(glass, (c[0] - side * (size[0] / 2 - 0.002), c[1], c[2]), (0.004, size[1] * 0.86, size[2] * 0.86), bev=0.002, seg=1)


def door_handle(pt, c, side, length=0.13, m='chrome'):
    x, f, z = c
    pt.box('metal_dark', (x, f, z), (0.014, length + 0.03, 0.05), bev=0.006, seg=1)
    pt.box(m, (x + side * 0.012, f, z), (0.014, length, 0.026), bev=0.006, seg=2)
    pt.cyl('chrome', (x + side * 0.004, f + length * 0.62, z + 0.045), 0.011, 0.01, axis='x', n=8)


def headlamp(pt_body, pt_lamp, c, side, w=0.17, h=0.17, kind='round', bezel='chrome', depth=0.09, out_z=0.0):
    """Headlamp assembly: bucket + chrome bezel (into pt_body) + reflector bowl + lens (into pt_lamp)."""
    x, f, z = c
    if kind == 'round':
        r = w / 2
        pt_body.cyl('metal_dark', (x, f - depth * 0.5, z), r * 1.02, depth, axis='f', n=16)
        pt_body.cyl(bezel, (x, f + 0.005, z), r * 1.1, 0.02, axis='f', n=20, bev=0.005, r2=r * 1.02)
        pt_lamp.cyl('chrome', (x, f - 0.005, z), r * 0.92, 0.03, axis='f', n=18, r2=r * 0.5)
        pt_lamp.sph('light_head', (x, f + 0.0, z), r * 0.82, n=14, sc=(1, 0.28, 1))
        pt_lamp.sph('light_head', (x, f - 0.005, z), r * 0.28, n=8, sc=(1, 0.5, 1))
    else:
        pt_body.box('metal_dark', (x, f - depth * 0.5, z), (w * 1.02, depth, h * 1.02), bev=0.008)
        pt_body.box(bezel, (x, f + 0.005, z), (w * 1.12, 0.02, h * 1.14), bev=0.008, seg=2)
        pt_lamp.box('chrome', (x, f - 0.01, z), (w * 0.95, 0.035, h * 0.92), bev=0.012, taper=(0.75, 1.0))
        pt_lamp.box('light_head', (x, f + 0.004, z), (w * 0.9, 0.012, h * 0.84), bev=0.02, seg=2)
        # lens fluting
        for i in range(4):
            pt_lamp.box('light_head', (x + (i - 1.5) * w * 0.2, f + 0.012, z), (0.006, 0.006, h * 0.8), bev=0.0)


def taillamp(pt_body, pt_lamp, c, side, w=0.09, h=0.24, depth=0.06, kind='vert'):
    x, f, z = c
    pt_body.box('metal_dark', (x, f + depth * 0.5, z), (w * 1.1, depth, h * 1.08), bev=0.006)
    pt_body.box('chrome', (x, f - 0.001, z), (w * 1.14, 0.014, h * 1.12), bev=0.006, seg=2)
    pt_lamp.box('light_tail', (x, f - 0.008, z + h * 0.16), (w * 0.9, 0.012, h * 0.58), bev=0.008, seg=2)
    pt_lamp.box('light_amber', (x, f - 0.008, z - h * 0.30), (w * 0.9, 0.012, h * 0.24), bev=0.006, seg=2)



# ------------------------------------------------------------------------------------------------- seats & interior
def bench_seat(pt, c, w=1.3, depth=0.5, back_h=0.62, cushion='fabric', trim='fabric', tilt=12, lean=0.0, split=True):
    """Bench seat: cushion, backrest, headrest lumps. c = centre of cushion base (x,f,z)."""
    x, f, z = c
    pt.box('metal_dark', (x, f, z - 0.05), (w * 0.94, depth * 0.9, 0.06), bev=0.01)
    # cushion (rounded loft)
    pt.box(cushion, (x, f, z + 0.03), (w, depth, 0.12), bev=0.04, seg=2)
    if split:
        for sx in (-w * 0.25, w * 0.25):
            pt.box(trim, (x + sx, f + 0.02, z + 0.095), (w * 0.44, depth * 0.85, 0.03), bev=0.012, seg=2)
    # backrest tilted back
    bf = f - depth / 2 + 0.03
    pt.box(cushion, (x, bf - 0.05, z + back_h * 0.5 + 0.07), (w, 0.12, back_h), bev=0.045, seg=2, rot=(-tilt, 0, 0))
    for sx in (-w * 0.25, w * 0.25):
        pt.box(trim, (x + sx, bf - 0.005, z + back_h * 0.5 + 0.09), (w * 0.42, 0.04, back_h * 0.86), bev=0.018, seg=2, rot=(-tilt, 0, 0))
    # headrest rolls
    pt.box(cushion, (x, bf - 0.09, z + back_h + 0.03), (w * 0.9, 0.09, 0.09), bev=0.035, seg=2, rot=(-tilt, 0, 0))


def bucket_seat(pt, c, w=0.5, depth=0.5, back_h=0.6, cushion='leather', trim='fabric', tilt=12):
    x, f, z = c
    pt.box('metal_dark', (x, f, z - 0.05), (w * 0.9, depth * 0.85, 0.06), bev=0.01)
    pt.box(cushion, (x, f, z + 0.03), (w, depth, 0.12), bev=0.04, seg=2)
    for sx in (-w * 0.5, w * 0.5):
        pt.box(cushion, (x + sx * 0.92, f + 0.01, z + 0.09), (0.09, depth * 0.95, 0.10), bev=0.04, seg=2)
    bf = f - depth / 2 + 0.03
    pt.box(cushion, (x, bf - 0.05, z + back_h * 0.5 + 0.07), (w, 0.12, back_h), bev=0.045, seg=2, rot=(-tilt, 0, 0))
    for sx in (-w * 0.5, w * 0.5):
        pt.box(cushion, (x + sx * 0.92, bf + 0.0, z + back_h * 0.5 + 0.09), (0.09, 0.14, back_h * 0.85), bev=0.04, seg=2, rot=(-tilt, 0, 0))
    pt.box(trim, (x, bf - 0.005, z + back_h * 0.5 + 0.09), (w * 0.62, 0.04, back_h * 0.86), bev=0.018, seg=2, rot=(-tilt, 0, 0))
    pt.box(cushion, (x, bf - 0.10, z + back_h + 0.06), (w * 0.6, 0.09, 0.15), bev=0.04, seg=2, rot=(-tilt, 0, 0))


def steering_wheel(pt, c, r=0.19, rot=(-25, 0, 0), rim='rubber', hub='plastic', spokes=3, rim_r=0.014):
    """Steering wheel with centre c, plane tilted by rot (pitch) - wheel faces backward (-f) toward the driver."""
    x, f, z = c
    M_ = rotm(*rot)

    def loc(dx, df, dz):
        v = M_ @ PV((dx, df, dz))
        return (v.x + x, -(v.y) + f * 0 + f - 0, v.z + z) if False else G(Vector(P(x, f, z)) + v)
    # rim: torus lying in the x-z plane (axis f)
    pt.torus(rim, c, r, rim_r, axis='f', nR=28, nr=8)
    pt.cyl(hub, c, 0.045, 0.05, axis='f', n=14, bev=0.008)
    for i in range(spokes):
        a = math.pi * 2 * i / spokes + (math.pi / 2 if spokes == 3 else math.pi / 4)
        if spokes == 3:
            a = [math.pi, 0.0, -math.pi / 2][i]
        p1 = (x + (r - 0.01) * math.cos(a), f, z + (r - 0.01) * math.sin(a))
        pt.cyl2(hub, c, p1, 0.011, n=8)


# ------------------------------------------------------------------------------------------------- misc props
def jerry_can(pt, c, rot=(0, 0, 0), size=(0.34, 0.16, 0.46), m='paint2', dent=False):
    """Classic NATO jerry can. c = centre."""
    x, f, z = c
    sx, sf, sz = size
    # body with chamfer bevel and X embossing
    pt.box(m, c, size, rot=rot, bev=0.018, seg=3)
    # embossed X
    for sgn in (1, -1):
        for side_f in (-1, 1):
            a = (x - sx * 0.3, f + side_f * (sf / 2 + 0.002), z - sz * 0.3 * sgn)
            b = (x + sx * 0.3, f + side_f * (sf / 2 + 0.002), z + sz * 0.3 * sgn)
            pt.cyl2('metal_dark', a, b, 0.006, n=5)
    # handle + spout
    pt.box('metal_dark', (x, f, z + sz / 2 + 0.03), (sx * 0.62, 0.035, 0.05), bev=0.01)
    pt.cyl('metal_dark', (x + sx * 0.3, f, z + sz / 2 + 0.02), 0.028, 0.06, axis='z', n=12, bev=0.005)
    pt.cyl('metal_bare', (x + sx * 0.3, f, z + sz / 2 + 0.055), 0.03, 0.02, axis='z', n=12, bev=0.004)
    pt.cyl('rubber', (x - sx * 0.3, f, z + sz / 2 + 0.02), 0.02, 0.05, axis='z', n=10)


def exhaust_pipe(pt, path, r=0.03, muffler=None, tip=None, m='metal_dark', rust='rust'):
    pt.tube(m, path, r, n=10, rad=0.12, k=5)
    if muffler:
        c, ml, mr = muffler
        pt.cyl(m, c, mr, ml, axis='f', n=16, bev=0.01)
        pt.cyl('rust', (c[0], c[1], c[2]), mr * 1.005, ml * 0.15, axis='f', n=16)


def sandbag(pt, c, rot=(0, 0, 0), size=(0.4, 0.22, 0.14)):
    pt.sph('canvas', c, 0.5, n=10, sc=(size[0], size[1], size[2]), rot=rot)
    x, f, z = c
    pt.box('canvas', (x, f, z + size[2] * 0.4), (size[0] * 0.8, size[1] * 0.5, 0.02), bev=0.005)
