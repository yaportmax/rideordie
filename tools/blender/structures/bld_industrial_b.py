"""silo_group + wind_turbine (fork B2)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_industrial_lib import *


# ==================================================================================================== silo_group
def silo(p, cx, cz, r, h, n=16, broken=None, tint=None, courses=None):
    """Concrete silo with pour lines, hoops and a flat roof. broken = dict(sector=(a0,a1), drop=metres) for a ruined top."""
    courses = courses or int(h / 3.25)
    ys = [h * i / courses for i in range(courses + 1)]
    if broken:
        a0, a1, drop = broken["sector"], broken["sector"][1], broken["drop"]
        rr = random.Random(int(cx * 7 + cz))
        top_drop = {}
        for j in range(n):
            ang = (-360.0 * j / n) % 360
            inside = (broken["sector"][0] <= ang <= broken["sector"][1])
            top_drop[j] = (drop * (0.45 + 0.55 * rr.random())) if inside else 0.0
        # taper the breakage at the sector edges
        rings_y = ys
        def skip(i, j):
            # face between ring i and i+1 is removed if its lower edge is above the local broken height
            return ys[i] >= h - top_drop[j] - 1e-3 and top_drop[j] > 0
        shell_skip(p, "concrete", cx, cz, [(r, y) for y in ys], n, skip=skip, sub=3.6, tint=tint)
        # inner dark shell (visible through the break) + rim caps
        shell_skip(p, "concrete_dark", cx, cz, [(r - 0.35, y) for y in ys], n, inward=True, skip=skip, sub=3.5, tint=0.6)
        for j in range(n):
            if top_drop[j] > 0:
                y = h - top_drop[j]
                a = -360.0 * j / n
                x0, z0 = polar(cx, cz, r, a)
                x1, z1 = polar(cx, cz, r - 0.35, a)
                p.tube("rebar", (x0, y - 0.1, z0), (x0 + 0.15 * math.cos(j), y + 0.7 + 0.5 * ((j * 7) % 3) / 2, z0 + 0.1), 0.016, sides=4, smooth=False, caps=False)
    else:
        revolve(p, "concrete", cx, cz, [(r, y) for y in ys], n, sub=3.6, tint=tint)
    for y in ys[2:-1:3]:
        revolve(p, "concrete_dark", cx, cz, [(r + 0.05, y - 0.08), (r + 0.05, y + 0.08)], n)
    for y in (9.75,):
        if y < h - 0.5:
            revolve(p, "metal_dark", cx, cz, [(r + 0.09, y - 0.09), (r + 0.09, y + 0.09)], n)
    p.cyl("concrete_dark", (cx, 0.3, cz), r + 0.35, 0.6, "y", sides=n)
    if not broken:
        revolve(p, "concrete", cx, cz, [(r + 0.12, h), (r + 0.12, h + 0.35), (r - 0.4, h + 0.4), (r * 0.5, h + 0.55), (0.0, h + 0.6)], n, sub=3.0, tint=tint)
        p.box("concrete_dark", (cx + 0.9, h + 0.85, cz - 0.6), (1.1, 0.5, 1.1), bevel=0.02)
        p.cyl("metal_dark", (cx - 1.0, h + 0.9, cz + 0.8), 0.35, 0.55, "y", sides=8)
    # base door (dark) + chute
    p.box("metal_dark", (cx, 0.9, cz + r + 0.02), (0.9, 1.5, 0.1))
    p.tube("rust", (cx, 1.6, cz + r + 0.2), (cx, 0.55, cz + r + 0.9), 0.22, sides=8)


def silo_group():
    p = Piece("silo_group", seed=51, ground_y=0.0, dirt_h=3.5, dirt_amt=0.55, streak_amt=0.5, noise_amt=0.36, ao_dist=3.5)
    p.notes = dict(desc="Grain elevator complex: 4 concrete silos (one with a collapsed top), central-rear elevator tower with head house, enclosed conveyor gantry over the silo tops, steel shed and two corrugated bins.",
                   footprint=[42, 34], silo_height=26, tower_height=37, front="+Z")
    R, H, S = 3.6, 26.0, 7.3
    cen = [(-S / 2, S / 2), (S / 2, S / 2), (-S / 2, -S / 2), (S / 2, -S / 2)]
    silo(p, *cen[0], R, H, tint=0.8)
    silo(p, *cen[1], R, H, tint=0.8)
    silo(p, *cen[2], R, H, tint=0.8)
    silo(p, *cen[3], R, H, broken=dict(sector=(20.0, 200.0), drop=7.5), tint=0.8)
    # star gap between silos: dark filler + top walkways
    p.bx("concrete_dark", (-1.0, 1.0), (0, H - 0.5), (-1.0, 1.0), skip=("ny",), sub=4.0)
    for cx, cz in (cen[0], cen[1], cen[2]):
        pass
    # elevator tower at the back
    TZ = -12.5
    p.bx("concrete", (-3.0, 3.0), (0, 37.0), (TZ - 3.0, TZ + 3.0), skip=("ny",), sub=3.4, tint=0.8)
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("concrete_dark", (sx * 3.0 - 0.28 if sx > 0 else -3.28, sx * 3.0 + 0.28 if sx > 0 else -2.72), (0, 37.0), (TZ + sz * 3.0 - (0.28 if sz > 0 else 0.28) + (0 if sz > 0 else 0), TZ + sz * 3.0 + 0.28), sub=9.0)
    for x in (-1.5, 1.5):
        p.bx("concrete_dark", (x - 0.15, x + 0.15), (0, 33.0), (TZ + 3.0, TZ + 3.16), sub=9.0)
    # head house + gable roof
    p.bx("concrete", (-3.6, 3.6), (37.0, 43.0), (TZ - 3.6, TZ + 3.6), skip=("ny",), sub=3.6, tint=0.8)
    p.extrude("rust", [(-3.9, 43.0), (3.9, 43.0), (0.0, 45.6)], TZ - 3.9, TZ + 3.9)
    for zz in (TZ - 3.6, TZ + 3.6):
        pass
    for k in range(3):
        x = -2.2 + k * 2.2
        p.bx("metal_dark", (x - 0.6, x + 0.6), (39.0, 41.2), (TZ + 3.6, TZ + 3.7))
        p.bx("metal_dark", (x - 0.6, x + 0.6), (39.0, 41.2), (TZ - 3.7, TZ - 3.6))
    p.bx("metal_dark", (3.6, 3.7), (39.0, 41.4), (TZ - 1.4, TZ + 1.4))
    # broken wall panel on the head house (dark opening + jut rebar)
    p.bx("metal_dark", (-3.7, -3.6), (38.4, 42.0), (TZ - 1.8, TZ + 1.8))
    for k in range(6):
        p.tube("rebar", (-3.65, 42.0, TZ - 1.6 + 0.6 * k), (-3.65 - 0.5 - 0.2 * (k % 2), 42.4 + 0.15 * (k % 3), TZ - 1.6 + 0.6 * k), 0.015, sides=4, smooth=False, caps=False)
    # enclosed gantry from head house over the silo tops
    gy = H + 2.6
    p.extrude("rust", [(-1.0, gy), (1.0, gy), (1.0, gy + 2.2), (0.0, gy + 2.6), (-1.0, gy + 2.2)], TZ + 3.6, S / 2 + 4.6)
    for z in (-6.0, -2.0, 2.0):
        for sx in (-1, 1):
            p.bx("metal_dark", (sx * 1.0 - 0.02 if sx > 0 else -1.02, sx * 1.0 + 0.02 if sx > 0 else -0.98), (gy + 0.9, gy + 1.7), (z - 0.7, z + 0.7))
    # gantry supports on silo tops
    for (cx, cz) in (cen[0], cen[1]):
        p.tube("steel_beam", (0.0, H + 0.6, cz), (0.0, gy, cz), 0.14, sides=6)
        p.beam("steel_beam", (-1.0, gy - 0.05, cz), (1.0, gy - 0.05, cz), 0.3, 0.3)
    for (cx, cz) in (cen[2], cen[3]):
        p.beam("steel_beam", (-1.0, gy - 0.05, cz), (1.0, gy - 0.05, cz), 0.3, 0.3)
    p.tube("steel_beam", (0.0, 0, S / 2 + 4.5), (0.0, gy - 0.1, S / 2 + 4.5), 0.16, sides=6)
    # tower ladder cage + hoops on front face
    ladder(p, (1.9, 0.5, TZ + 3.1), (1.9, 36.6, TZ + 3.1), width=0.5, rung=0.75, side=(1, 0, 0))
    # shed
    SX, SZ = -19.5, 0.0
    p.extrude_x("rust", [(-4.0, 0.0), (4.0, 0.0), (4.0, 5.4), (0.0, 7.0), (-4.0, 5.4)], SX - 6.5, SX + 6.5, sub=3.0)
    p.bx("metal_dark", (SX - 1.7, SX + 1.7), (0, 4.0), (SZ + 3.99, SZ + 4.1))
    for k in range(9):
        x = SX - 6.0 + k * 1.5
        p.bx("metal_bare", (x - 0.05, x + 0.05), (0, 5.3), (SZ + 4.0, SZ + 4.08))
    # broken roof sheets: rafters showing
    for k in range(5):
        x = SX - 5.0 + k * 2.5
        p.beam("steel_beam", (x, 5.4, -4.0), (x, 7.0, 0.0), 0.12, 0.12)
        p.beam("steel_beam", (x, 7.0, 0.0), (x, 5.4, 4.0), 0.12, 0.12)
    # corrugated steel bins
    def bin_(cx, cz, h_=9.0, r_=2.6):
        n = 12
        prof = [(r_, 3.0)]
        y = 3.0
        while y < 3.0 + h_:
            prof += [(r_ + 0.08, y + 0.22), (r_, y + 0.45)]
            y += 0.45 * 2
        yt = prof[-1][1]
        revolve(p, "paint2", cx, cz, prof, n, tint=0.62)
        revolve(p, "rust", cx, cz, [(r_ + 0.05, yt), (r_ * 0.55, yt + 1.4), (0.0, yt + 2.1)], n)
        for k in range(4):
            a = 45 + 90 * k
            x0, z0 = polar(cx, cz, r_ * 0.95, a)
            p.tube("steel_beam", (x0, 0, z0), (x0, 3.2, z0), 0.14, sides=6)
        for k in range(4):
            a = 45 + 90 * k
            a2 = 45 + 90 * (k + 1)
            xa, za = polar(cx, cz, r_ * 0.95, a)
            xb, zb = polar(cx, cz, r_ * 0.95, a2)
            p.tube("steel_beam", (xa, 2.0, za), (xb, 2.0, zb), 0.06, sides=4, smooth=False, caps=False)
        p.cone = None
        p.tube("metal_dark", (cx, 3.0, cz), (cx, 2.0, cz), 0.35, sides=8, r2=0.2)
    bin_(15.0, 8.5)
    bin_(15.5, -3.0, 7.5, 2.3)
    # concrete pad + collision
    p.bx("concrete_dark", (-27, 21), (0, 0.14), (-17, 14), skip=("ny",), sub=6.0)
    for (cx, cz) in cen:
        p.chull([(polar(cx, cz, R, a * 30)[0], y, polar(cx, cz, R, a * 30)[1]) for a in range(12) for y in (0.0, H)])
    p.cbx((-3.0, 3.0), (0, 43.0), (TZ - 3.0, TZ + 3.0))
    p.cbx((-27.0 + 6.5, -12.5 - 0.0), (0, 6.5), (-4.0, 4.0))
    p.cbx((-27.0 + 6.5 - 6.5 + 0.0, -13.0), (0, 6.5), (-4.0, 4.0)) if False else None
    for (cx, cz, r_) in ((15.0, 8.5, 2.6), (15.5, -3.0, 2.3)):
        p.chull([(polar(cx, cz, r_, a * 45)[0], y, polar(cx, cz, r_, a * 45)[1]) for a in range(8) for y in (0.0, 12.0)])
    p.socket("front", (0, 0, 10))
    return p


# ==================================================================================================== wind_turbine
def blade_rings(y0, y1, L_total, R0, n=10, root_c=2.4, breakage=None):
    """Airfoil rings in blade-local coords: radial = +Y, chord = X, thickness = Z. y is radius from the hub axis."""
    ts = [0.0, 0.04, 0.10, 0.20, 0.32, 0.45, 0.58, 0.72, 0.86, 0.95, 1.0]
    rings = []
    for t in ts:
        y = R0 + t * L_total
        if y < y0 - 1e-6 or y > y1 + 1e-6:
            continue
        if t < 0.10:
            c = root_c + (3.7 - root_c) * (t / 0.10)
            th = root_c * 0.92 + (0.95 - root_c * 0.92) * (t / 0.10)
        else:
            u = (t - 0.10) / 0.90
            c = 3.7 * (1 - u) + 0.55 * u
            th = 0.95 * (1 - u) + 0.16 * u
        tw = math.radians(13 * (1 - t) + 1.5 * t)
        pts = []
        for k in range(n):
            a = 2 * math.pi * k / n
            xc = math.cos(a) * c / 2
            zt = math.sin(a) * th / 2 * (1 - 0.35 * math.cos(a))
            xr = xc * math.cos(tw) - zt * math.sin(tw)
            zr = xc * math.sin(tw) + zt * math.cos(tw)
            pts.append((xr, y, zr))
        rings.append(pts)
    return rings


def wind_turbine():
    p = Piece("wind_turbine", seed=52, ground_y=0.0, dirt_h=4.0, dirt_amt=0.5, streak_amt=0.35, noise_amt=0.3, ao_dist=3.0)
    HUB_Y, HUB_Z, L, R0 = 60.0, 4.6, 32.0, 1.5
    p.notes = dict(desc="Dead wind turbine: 60 m tapered tower, nacelle facing +Z, 3 blades frozen (one snapped and hanging). Origin = tower base centre.",
                   hub_height=60, rotor_radius=33.5, total_height=94, blade_angles_deg=[95, 215, 335], rotor_axis="+Z")
    n = 16
    ys = [i * 6.0 for i in range(11)]
    rad = lambda y: 2.25 - 0.9 * (y / 60.0)
    revolve(p, "paint", 0, 0, [(rad(y), y) for y in ys], n, sub=6.0, tint=0.72)
    for y in ys[1:]:
        revolve(p, "metal_bare", 0, 0, [(rad(y) + 0.06, y - 0.12), (rad(y) + 0.06, y + 0.12)], n)
    # base: concrete foundation + flange bolts + door + transformer
    p.cyl("concrete_dark", (0, 0.3, 0), 4.6, 0.6, "y", sides=24)
    revolve(p, "metal_dark", 0, 0, [(2.45, 0.6), (2.45, 1.0)], n)
    for k in range(24):
        a = k * 15
        c = polar(0, 0, 2.35, a)
        p.cyl("metal_bare", (c[0], 1.05, c[1]), 0.07, 0.12, "y", sides=6)
    p.bx("metal_dark", (-0.55, 0.55), (0.6, 2.7), (rad(1.0) - 0.05, rad(1.0) + 0.2))
    p.bx("steel_beam", (-0.7, 0.7), (0.6, 2.85), (rad(1.0) + 0.02, rad(1.0) + 0.06))
    p.box("metal_bare", (3.6, 0.9, 3.4), (2.2, 1.8, 1.6), bevel=0.03, sub=1.5)
    p.box("metal_dark", (3.6, 1.85, 3.4), (2.3, 0.1, 1.7))
    for k in range(3):
        p.tube("metal_dark", (3.6 - 0.6 + 0.6 * k, 1.8, 3.4), (1.0 + 0.3 * k, 0.25, 2.6), 0.06, sides=4, smooth=False, caps=False)
    # yaw ring + nacelle
    revolve(p, "metal_dark", 0, 0, [(1.5, 59.6), (1.6, 60.2)], n)
    p.box("paint", (0, HUB_Y + 1.7, -0.5), (3.7, 3.4, 10.4), bevel=0.22, bsegs=2, sub=2.4, tint=0.78)
    p.box("metal_dark", (0, HUB_Y + 3.45, -1.5), (2.2, 0.16, 4.5))
    for k in range(6):
        z = -3.0 + k * 0.7
        p.box("metal_dark", (0, HUB_Y + 3.5, z), (2.0, 0.06, 0.2))
    p.box("metal_dark", (0, HUB_Y + 1.7, -5.75), (3.3, 2.6, 0.2))
    p.tube("metal_dark", (1.0, HUB_Y + 3.4, -4.6), (1.0, HUB_Y + 5.3, -4.6), 0.04, sides=4, smooth=False)
    p.cyl("light_tail", (1.0, HUB_Y + 5.4, -4.6), 0.1, 0.18, "y", sides=8)
    p.tube("metal_dark", (-1.0, HUB_Y + 3.4, -4.6), (-1.0, HUB_Y + 4.7, -4.6), 0.03, sides=4, smooth=False)
    for k in range(3):
        a = k * 120
        p.box("metal_bare", (-1.0 + 0.25 * math.cos(a * D2R), HUB_Y + 4.75, -4.6 + 0.25 * math.sin(a * D2R)), (0.12, 0.08, 0.08), rot=(0, a, 0))
    # hub + spinner (axis +Z)
    Mh = xf((0, HUB_Y + 1.7, HUB_Z), (90, 0, 0))
    spin = [(1.55, -0.6), (1.65, 0.3), (1.5, 1.4), (1.0, 2.5), (0.45, 3.2), (0.0, 3.5)]
    p.loft("paint", [ring(0, 0, y, r, 16) for r, y in spin], closed=True, cap_a=True, cap_b=False, M=Mh, tint=0.8)
    # blade roots (pitch bearings) + blades
    angs = [95.0, 215.0, 335.0]
    hub = (0.0, HUB_Y + 1.7, HUB_Z)
    for bi, phi in enumerate(angs):
        Mb = xf(hub, (0, 0, phi - 90.0))
        p.tube("metal_bare", Mb @ Vector((0, 1.0, 0.0)), Mb @ Vector((0, 2.2, 0.0)), 1.28, sides=12)
        if bi != 2:
            rings = blade_rings(0, 1e9, L, R0)
            p.loft("paint", rings, closed=True, cap_a=True, cap_b=True, M=Mb, tint=0.72, sub=0)
            p.cbeam(Mb @ Vector((0, 2.0, 0)), Mb @ Vector((0, R0 + L, 0)), 3.0, 0.8, up=(0, 0, 1))
        else:
            y_br = R0 + 0.42 * L
            root = blade_rings(0, y_br, L, R0)
            # jagged break ring
            rr = random.Random(9)
            jag = [(x + rr.uniform(-0.25, 0.25), y_br + rr.uniform(0.0, 1.6) * (1 if k % 2 == 0 else 0.3), z) for k, (x, _, z) in enumerate(root[-1])]
            root.append(jag)
            p.loft("paint", root, closed=True, cap_a=True, cap_b=True, M=Mb, tint=0.72)
            p.cbeam(Mb @ Vector((0, 2.0, 0)), Mb @ Vector((0, y_br, 0)), 3.0, 0.8, up=(0, 0, 1))
            tip = blade_rings(y_br + 1.0, 1e9, L, R0)
            pivot = Vector((1.55, y_br + 1.0, 0.0))
            Rz = Matrix.Rotation(math.radians(-62.0), 4, "Z")
            Mt = Mb @ Matrix.Translation(pivot) @ Rz @ Matrix.Translation(-pivot)
            p.loft("paint", tip, closed=True, cap_a=True, cap_b=True, M=Mt, tint=0.7)
            # torn fibre strip linking the break
            p.tube("paint", Mb @ Vector((-1.0, y_br + 1.0, 0.0)), Mt @ Vector((-0.8, y_br + 1.1, 0.0)), 0.08, sides=4, smooth=False)
    # collision
    p.chull([(polar(0, 0, 2.3, a * 30)[0], y, polar(0, 0, 2.3, a * 30)[1]) for a in range(12) for y in (0.0, 0.7)] + [(polar(0, 0, 1.4, a * 30)[0], 59.8, polar(0, 0, 1.4, a * 30)[1]) for a in range(12)])
    p.cbx((-1.85, 1.85), (HUB_Y, HUB_Y + 3.4), (-5.7, 4.7))
    p.socket("hub", hub)
    p.socket("beacon", (1.0, HUB_Y + 5.5, -4.6))
    return p
