"""Industrial / tower structures (fork B2): water_tower, radio_tower, industrial_tanks, silo_group, wind_turbine,
crane, cooling_tower, oil_derrick.   ONLY=<id> bash run.sh bld_industrial.py"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_industrial_lib import *


# ==================================================================================================== water_tower
def water_tower():
    p = Piece("water_tower", seed=31, ground_y=0.0, dirt_h=3.5, dirt_amt=0.5, streak_amt=0.45, noise_amt=0.34, ao_dist=3.5)
    p.notes = dict(desc="Elevated steel water tank on 8 braced legs, ~27 m. Rusty red-brown tank with a pale band, gash in the tank wall, cone roof, gallery, ladder on +Z side.",
                   height=27.6, footprint_radius=7.2, tank_radius=4.2, gallery_y=19.0, ladder="+Z panel, ground to gallery")
    rng = random.Random(31)
    N, Rb, Rt, Ht = 8, 6.6, 4.5, 18.0
    Rf = lambda y: Rb + (Rt - Rb) * y / Ht
    ang = [22.5 + 45 * k for k in range(N)]
    legp = lambda k, y: (Rf(y) * math.cos(ang[k] * D2R), y, Rf(y) * math.sin(ang[k] * D2R))
    # foundations + legs
    for k in range(N):
        x0, _, z0 = legp(k, 0)
        p.box("concrete_dark", (x0, 0.3, z0), (1.5, 0.6, 1.5), rot=(0, -ang[k], 0), bevel=0.04, sub=1.2)
        p.tube("steel_beam", (x0, 0.55, z0), legp(k, Ht + 0.3), 0.23, sides=6, r2=0.19)
        p.box("metal_dark", (x0, 0.68, z0), (0.6, 0.1, 0.6), rot=(0, -ang[k], 0))
    # horizontal ring struts + tension rod diagonals
    levels = [0.9, 6.0, 12.0, 18.0]
    hangs, gone = {(1, 3, 1), (2, 6, 0)}, {(0, 5, 0), (1, 1, 1), (2, 2, 1), (1, 7, 0)}
    for li, y in enumerate(levels[1:], 1):
        for k in range(N):
            a, b = legp(k, y), legp((k + 1) % N, y)
            p.tube("steel_beam", a, b, 0.11, sides=6)
            # gusset plates
            p.box("steel_beam", a, (0.5, 0.5, 0.06), rot=(0, -ang[k] + 90, 0))
    for pi in range(3):
        ya, yb = levels[pi], levels[pi + 1]
        for k in range(N):
            k2 = (k + 1) % N
            for d, (qa, qb) in enumerate(((legp(k, ya), legp(k2, yb)), (legp(k2, ya), legp(k, yb)))):
                if (pi, k, d) in gone:
                    continue
                if (pi, k, d) in hangs:
                    qb = tuple(Vector(qa).lerp(Vector(qb), 0.6) + Vector((0, -1.4, 0)))
                p.tube("rebar", qa, qb, 0.042, sides=4, smooth=False)
    # central riser pipe
    p.cyl("rust", (0, 9.0, 0), 0.6, 18.0, "y", sides=12)
    for y in (3.0, 9.0, 15.0):
        p.cyl("metal_dark", (0, y, 0), 0.75, 0.22, "y", sides=12)
    p.cyl("rust", (0, 1.4, 0), 1.2, 0.5, "y", sides=12)
    # ring beam under the tank + radial support beams
    for k in range(N):
        a, b = legp(k, Ht + 0.3), legp((k + 1) % N, Ht + 0.3)
        p.beam("steel_beam", a, b, 0.4, 0.5)
    for k in range(N):
        a = legp(k, Ht + 0.3)
        p.beam("steel_beam", (0, Ht + 0.2, 0), a, 0.3, 0.4)
    # tank: dished bottom, side, eave, cone roof (hole in the side)
    n = 24
    prof = [(0.0, 17.6), (1.6, 17.75), (3.2, 18.1), (4.15, 18.7)]
    side_y = [19.4 + 1.2 * i for i in range(6)]          # 19.4 .. 25.4
    prof += [(4.2, y) for y in side_y]
    hole = {(2, 18), (2, 19), (3, 17), (3, 18), (3, 19), (3, 20), (4, 18), (4, 19), (4, 17), (1, 19), (3, 16), (2, 20)}
    # rings index: 0..3 bottom, 4.. side; side ring s -> index 4+s ; faces (i,j) between ring i and i+1
    def hole_skip(i, j):
        s = i - 4
        if s < 0:
            return False
        return (s, j) in hole
    shell_skip(p, "rust", 0, 0, prof, n, skip=hole_skip, sub=1.6)
    # inner shell visible through the hole
    inner = [(4.08, y) for y in side_y]
    shell_skip(p, "rubber", 0, 0, inner, n, inward=True, tint=0.8)
    # inner roof + floor so the hole does not show sky through the roof underside
    roof_in = [(4.2, 25.3), (3.2, 26.15), (1.9, 26.85), (0.55, 27.45), (0.0, 27.6)]
    revolve(p, "rubber", 0, 0, roof_in, n, inward=True, tint=0.8)
    revolve(p, "rubber", 0, 0, [(0.0, 17.85), (1.6, 18.0), (3.2, 18.35), (4.1, 18.9)], n, inward=True, tint=0.8)
    # pale band + weld rings
    band = [(4.24, 22.0), (4.24, 23.2)]
    shell_skip(p, "paint", 0, 0, band, n, skip=lambda i, j: (j in range(15, 22)), tint=0.62)
    for y in (19.4, 20.6, 21.8, 24.2, 25.4):
        revolve(p, "metal_dark", 0, 0, [(4.25, y - 0.07), (4.25, y + 0.07)], n)
    # cone roof + vent + rod
    roof = [(4.3, 25.4), (4.4, 25.55), (3.3, 26.3), (2.0, 27.0), (0.6, 27.6), (0.0, 27.75)]
    revolve(p, "rust", 0, 0, roof, n, sub=1.5)
    for k in range(12):
        a = k * 30.0
        p.tube("metal_dark", (polar(0, 0, 4.36, a)[0], 25.6, polar(0, 0, 4.36, a)[1]), (polar(0, 0, 0.62, a)[0], 27.66, polar(0, 0, 0.62, a)[1]), 0.035, sides=4, smooth=False)
    p.cyl("metal_dark", (0, 27.9, 0), 0.5, 0.5, "y", sides=10, r2=0.35)
    p.tube("metal_dark", (0, 28.1, 0), (0, 30.0, 0), 0.03, sides=4, smooth=False)
    p.cyl("light_tail", (0, 30.1, 0), 0.09, 0.18, "y", sides=6)
    # gallery: floor segments + railing (some missing)
    gy = 18.95
    for k in range(16):
        a = k * 22.5
        c = polar(0, 0, 4.85, a)
        p.box("rust", (c[0], gy, c[1]), (1.05, 0.09, 1.95), rot=(0, -a, 0), skip=("ny",), tint=0.6)
    rp = [(polar(0, 0, 5.4, k * 22.5)[0], gy + 0.05, polar(0, 0, 5.4, k * 22.5)[1]) for k in range(16)]
    railing(p, rp, h=1.1, closed=True, post_every=2.1, skip=lambda i: i in (4, 5, 11))
    # ladder to gallery on +Z panel, hoops
    zf = lambda y: Rf(y) * math.cos(22.5 * D2R) + 0.28
    ladder(p, (0, 0.4, zf(0.4)), (0, gy - 0.1, zf(gy - 0.1)), width=0.55, rung=0.5, side=(1, 0, 0))
    for y in (6.0, 12.0, 18.0):
        for s in (-1, 1):
            p.tube("metal_dark", (s * 0.27, y, zf(y) - 0.02), (s * 0.27, y, zf(y) - 0.3), 0.02, sides=4, smooth=False)
    for y in [3.5 + 2.4 * i for i in range(7)]:
        pts = [(0.55 * math.sin(t), y + 0.0, zf(y) + 0.42 - 0.55 * math.cos(t) + 0.0) for t in [(-1.4 + 2.8 * i / 6) for i in range(7)]]
        for a, b in zip(pts[:-1], pts[1:]):
            p.tube("metal_dark", a, b, 0.014, sides=4, smooth=False)
    # roof ladder on the tank side
    ladder(p, (-1.5, 19.2, 4.45), (-1.5, 25.6, 4.42), width=0.5, rung=0.38, side=(1, 0, 0))
    # collision
    for k in range(N):
        p.cbeam(legp(k, 0.5), legp(k, Ht + 0.3), 0.5, 0.5)
    p.cbx((-0.7, 0.7), (0, 18.0), (-0.7, 0.7))
    p.chull([polar(0, 0, 4.25, a * 22.5) and (polar(0, 0, 4.25, a * 22.5)[0], y, polar(0, 0, 4.25, a * 22.5)[1]) for a in range(16) for y in (17.7, 25.4)])
    p.chull([(polar(0, 0, 4.4, a * 22.5)[0], y, polar(0, 0, 4.4, a * 22.5)[1]) for a in range(8) for y in (25.4, 27.6)] + [(0, 27.8, 0)])
    p.socket("beacon", (0, 30.2, 0))
    p.socket("gallery", (0, gy, 5.0))
    return p


# ==================================================================================================== radio_tower
def radio_tower():
    p = Piece("radio_tower", seed=32, ground_y=0.0, dirt_h=3.0, dirt_amt=0.4, streak_amt=0.3, noise_amt=0.3, ao_dist=2.5, ao_amt=0.6)
    p.notes = dict(desc="60 m self-supporting steel lattice radio tower: 3 platforms with dishes and panel antennas, red beacons, bent upper section with a hanging dish, equipment shed at the base (+Z).",
                   height=63.0, base_half_width=3.4, top_half_width=0.9, beacons="sockets beacon_0..2")
    H, hw0, hw1, PAN = 58.0, 3.4, 0.85, 16
    BEND_Y = 39.9

    def shear(y):
        if y <= BEND_Y:
            return (0.0, 0.0)
        t = (y - BEND_Y)
        return (0.0, 0.34 * t)          # buckled: top leans toward +Z
    gone = {(11, 1, "d2"), (11, 2, "d1"), (12, 1, "d2"), (11, 3, "h"), (10, 0, "d1")}
    hang = {(11, 0, "d1"), (12, 2, "d2"), (10, 1, "d2")}
    lv = lattice_sheared(p, "steel_beam", 0, H, hw0, hw1, PAN, shear=shear, leg=0.12, brace=0.045, sides=4,
                         missing=lambda i, k, kind: (i, k, kind) in gone, hang=lambda i, k, kind: (i, k, kind) in hang)
    hwf = lambda y: hw0 + (hw1 - hw0) * y / H
    # foundations
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.box("concrete_dark", (sx * hw0, 0.35, sz * hw0), (1.5, 0.7, 1.5), bevel=0.05, sub=1.2)
    # platforms
    def platform(y, half, dishes=(), panels=()):
        dx, dz = shear(y)
        hw_ = hwf(y) + 0.9
        p.bx("rust", (dx - hw_, dx + hw_), (y - 0.05, y + 0.05), (dz - hw_, dz + hw_), sub=1.3)
        corners = [(dx + hw_, y + 0.05, dz + hw_), (dx - hw_, y + 0.05, dz + hw_), (dx - hw_, y + 0.05, dz - hw_), (dx + hw_, y + 0.05, dz - hw_)]
        railing(p, corners, h=1.05, closed=True, post_every=2.4, rails=2)
        # support brackets
        for sx in (-1, 1):
            for sz in (-1, 1):
                p.tube("steel_beam", (dx + sx * hwf(y - 1.0), y - 1.0, dz + sz * hwf(y - 1.0)), (dx + sx * hw_, y, dz + sz * hw_), 0.05, sides=4, smooth=False)
        return dx, dz, hw_
    for y in (19.0, 38.0):
        dx, dz, h_ = platform(y, hw1)
    # dishes mounted on outer railing at platform 1 and 2
    d1 = platform(19.0, 0)
    dish(p, (d1[0] + 0.0, 20.2, d1[1] + d1[2] + 0.4), (0, 0.05, 1), R=1.35, depth=0.42)
    dish(p, (d1[0] + d1[2] + 0.4, 20.4, d1[1] - 0.6), (1, 0.05, 0), R=1.0, depth=0.32)
    p.tube("metal_dark", (d1[0], 19.05, d1[1] + d1[2] - 0.1), (d1[0], 20.2, d1[1] + d1[2] + 0.35), 0.06, sides=6)
    d2 = platform(38.0, 0)
    dish(p, (d2[0] - d2[2] - 0.4, 39.4, d2[1] + 0.3), (-1, 0.1, 0), R=1.1, depth=0.34)
    dish(p, (d2[0] - 0.6, 39.6, d2[1] - d2[2] - 0.4), (0, 0.08, -1), R=0.8, depth=0.26)
    for sx in (-1.0, 0.0, 1.0):
        p.box("paint", (d2[0] + sx * 1.1, 39.2, d2[1] + d2[2] + 0.15), (0.32, 2.2, 0.14))
    # top: mast + antennas + beacon, on the bent top
    ty = H
    tdx, tdz = shear(ty)
    p.tube("metal_bare", (tdx, ty, tdz), (tdx, ty + 4.5, tdz), 0.09, sides=8, r2=0.05)
    p.tube("metal_dark", (tdx, ty + 4.5, tdz), (tdx, ty + 5.4, tdz), 0.025, sides=4, smooth=False)
    p.cyl("light_tail", (tdx, ty + 5.55, tdz), 0.11, 0.2, "y", sides=8)
    for y in (49.0, 53.5):
        dx, dz = shear(y)
        for sx in (-1, 1):
            p.box("paint", (dx + sx * (hwf(y) + 0.12), y, dz + hwf(y) + 0.12), (0.2, 2.4, 0.12))
    # obstruction beacons mid-height
    for i, y in enumerate((19.0, 38.0)):
        dx, dz = shear(y)
        p.cyl("light_tail", (dx + hwf(y), y + 1.2, dz + hwf(y)), 0.11, 0.2, "y", sides=8)
        p.socket("beacon_%d" % i, (dx + hwf(y), y + 1.3, dz + hwf(y)))
    p.socket("beacon_2", (tdx, ty + 5.7, tdz))
    # hanging broken dish on the bent section (cable + torn mount)
    hd = shear(51.0)
    p.tube("metal_dark", (hd[0] + 0.7, 51.0, hd[1] + hwf(51.0)), (hd[0] + 1.1, 47.7, hd[1] + hwf(51.0) + 0.5), 0.03, sides=4, smooth=False)
    dish(p, (hd[0] + 1.15, 46.9, hd[1] + hwf(51.0) + 0.55), (0.35, -0.8, 0.6), R=0.9, depth=0.28)
    # ladder + cable tray on the +Z face
    ladder(p, (0.0, 0.8, hw0 + 0.25), (0.0, 18.8, hwf(18.8) + 0.25), width=0.5, rung=0.34, side=(1, 0, 0))
    p.tube("metal_dark", (0.7, 0.6, hw0 + 0.15), (0.7, 18.8, hwf(18.8) + 0.15), 0.05, sides=4, smooth=False)
    p.tube("metal_dark", (0.9, 0.6, hw0 + 0.15), (0.9, 18.8, hwf(18.8) + 0.15), 0.05, sides=4, smooth=False)
    # equipment shed + AC unit + cable bridge
    p.bx("concrete_dark", (-1.8, 1.8), (0, 2.7), (5.5, 9.5), bevel=0.05, sub=1.5)
    p.bx("concrete_dark", (-2.0, 2.0), (2.7, 2.85), (5.3, 9.7))
    p.bx("metal_dark", (-0.5, 0.5), (0, 2.1), (9.48, 9.55))
    p.box("metal_bare", (2.55, 0.6, 7.5), (0.8, 1.2, 1.2), bevel=0.03)
    p.cyl("metal_dark", (2.55, 1.25, 7.5), 0.35, 0.06, "y", sides=10)
    p.tube("metal_dark", (0.0, 2.5, 5.5), (0.0, 2.5, hw0 + 0.3), 0.06, sides=4, smooth=False)
    p.beam("metal_dark", (0.0, 2.55, 5.5), (0.0, 2.55, hw0 + 0.3), 0.5, 0.06)
    # collision
    p.chull([(sx * hw0, 0, sz * hw0) for sx in (-1, 1) for sz in (-1, 1)] + [(sx * hwf(30), 30, sz * hwf(30)) for sx in (-1, 1) for sz in (-1, 1)])
    p.chull([(sx * hwf(30), 30, sz * hwf(30)) for sx in (-1, 1) for sz in (-1, 1)] + [(sx * hwf(H), H, shear(H)[1] + sz * hwf(H)) for sx in (-1, 1) for sz in (-1, 1)])
    p.cbx((-1.8, 1.8), (0, 2.85), (5.5, 9.5))
    return p


def _all():
    out = [("water_tower", water_tower), ("radio_tower", radio_tower)]
    import importlib
    for mod, names in (("bld_industrial_tanks", ["industrial_tanks"]), ("bld_industrial_b", ["silo_group", "wind_turbine"]),
                       ("bld_industrial_c", ["crane", "cooling_tower", "oil_derrick"])):
        try:
            m = importlib.import_module(mod)
        except ModuleNotFoundError:
            continue
        for n in names:
            if hasattr(m, n):
                out.append((n, getattr(m, n)))
    return out


if __name__ == "__main__":
    which = os.environ.get("ONLY", "")
    for pid, fn in _all():
        if which in ("", pid):
            fn().build()
