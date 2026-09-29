"""overpass_concrete - highway overpass crossing OVER the road at 90 degrees."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *

JERSEY = [(-0.30, 0.0), (0.30, 0.0), (0.21, 0.32), (0.125, 0.85), (-0.125, 0.85), (-0.21, 0.32)]   # (lateral, y) F-shape barrier


def strip_solid(p, mat, top_pts, y_bot, z0, z1, sub=2.0, tint=None, skip_bottom=True):
    """Solid under a polyline top profile [(x, y), ...] (x ascending or descending), bottom at y_bot, extruded z0..z1.
    Built from quads only (so vertex-colour AO/dirt has resolution): two side walls, the top strip, end walls."""
    n = len(top_pts)
    for i in range(n - 1):
        (xa, ya), (xb, yb) = top_pts[i], top_pts[i + 1]
        # side wall at z0 (faces -Z) and z1 (faces +Z): orientation depends on x direction
        fw = xb > xa
        q0 = [(xa, y_bot, z0), (xb, y_bot, z0), (xb, yb, z0), (xa, ya, z0)]
        q1 = [(xa, y_bot, z1), (xb, y_bot, z1), (xb, yb, z1), (xa, ya, z1)]
        if not fw:
            p.raw(mat, q0, [(0, 1, 2, 3)], sub=sub, tint=tint)
            p.raw(mat, q1, [(3, 2, 1, 0)], sub=sub, tint=tint)
        else:
            p.raw(mat, q0, [(3, 2, 1, 0)], sub=sub, tint=tint)
            p.raw(mat, q1, [(0, 1, 2, 3)], sub=sub, tint=tint)
        top = [(xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1)]
        if fw:
            p.raw(mat, top, [(0, 3, 2, 1)], sub=sub, tint=tint)
        else:
            p.raw(mat, top, [(0, 1, 2, 3)], sub=sub, tint=tint)
    # end walls
    (xa, ya), (xb, yb) = top_pts[0], top_pts[-1]
    for (x, y), up in ((top_pts[0], top_pts[0][0] < top_pts[-1][0]), (top_pts[-1], top_pts[-1][0] < top_pts[0][0])):
        q = [(x, y_bot, z0), (x, y_bot, z1), (x, y, z1), (x, y, z0)]
        # outward normal is -x for the first point when x ascends, +x for the last
        p.raw(mat, q, [(0, 1, 2, 3)] if up is False else [(3, 2, 1, 0)], sub=sub, tint=tint)


def overpass():
    L = 40.0
    HW = L / 2
    ZW = 12.0
    YU = 6.5          # underside of girders = clearance
    YT = 8.0          # road surface on deck
    p = Piece("overpass_concrete", seed=31, ground_y=0.0, dirt_h=2.2, dirt_amt=0.5, ao_dist=3.5, under_amt=0.3, streak_amt=0.35)
    p.notes = dict(desc="Concrete highway overpass crossing OVER the road at 90 deg. Deck runs along X (x -20..20), spans z 0..12; the road (x -7..7) passes underneath along +Z. Clearance 6.5 m under girders. Pier bents beside the road at x=+-9.6; end spans sit on sloped embankment abutments (x +-10.5..20). Deck top road surface at y=8.0 (node road_surface).",
                   clearance=YU, deck_top_y=YT, deck_size=[L, ZW], damage="one parapet section collapsed at +X/+Z corner with hanging rebar")
    # ---- road surface on top
    xs = [-HW + L * i / 20 for i in range(21)]
    zs = [0.9 + (ZW - 1.8) * i / 6 for i in range(7)]
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: YT)
    # ---- deck slab + girders + diaphragms
    p.bx("concrete", (-HW, HW), (YT - 0.4, YT - 0.02), (0, ZW), bevel=0.03, sub=3.0)
    gz = [1.3, 4.4, 7.6, 10.7]
    for z in gz:
        p.bx("concrete", (-HW, HW), (YU + 0.28, YT - 0.4), (z - 0.13, z + 0.13), sub=3.0)              # web
        p.bx("concrete", (-HW, HW), (YU, YU + 0.3), (z - 0.4, z + 0.4), bevel=0.04, sub=3.0)              # bottom bulb
        p.bx("concrete", (-HW, HW), (YT - 0.55, YT - 0.4), (z - 0.5, z + 0.5), sub=3.0)                   # top flange under slab
    for x in [-19.4, -14.0, -8.0, -2.7, 2.7, 8.0, 14.0, 19.4]:
        p.bx("concrete_dark", (x - 0.15, x + 0.15), (YU + 0.3, YT - 0.4), (0.4, ZW - 0.4), sub=2.5)
    # edge beams (fascia) both sides
    for z0, z1 in ((0.0, 0.3), (ZW - 0.3, ZW)):
        p.bx("concrete", (-HW, HW), (YU + 0.35, YT), (z0, z1), bevel=0.03, sub=3.0)
    # ---- parapets (F barrier) + rails, with damage
    for side, zc in ((0, 0.62), (1, ZW - 0.62)):
        sgn = 1 if side == 0 else -1
        segs = [(-HW, -13.0), (-13.0, -5.0), (-5.0, 4.0), (4.0, 12.0), (12.0, HW)]
        for k, (xa, xb) in enumerate(segs):
            broken = (side == 1 and k == 3)
            if broken:
                xb = 7.0          # collapsed from x=7 on
                xa = 4.0
            prof = [(zc + sgn * (-lat), YT + y) for lat, y in JERSEY]
            p.extrude_x("concrete", prof, xa + 0.02, xb - 0.02, sub=2.0, bevel=0.0, tint=1.0 - 0.06 * (k % 2))
    # top rail on parapet (steel post + 2 rails) - skip on the collapsed stretch
    for side, zc in ((0, 0.62), (1, ZW - 0.62)):
        xa, xb = -HW, HW
        for x in [xa + 0.4 + i * 2.5 for i in range(int(L / 2.5))]:
            if side == 1 and 4.0 <= x <= 9.0:
                continue
            p.bx("metal_dark", (x - 0.04, x + 0.04), (YT + 0.85, YT + 1.35), (zc - 0.04, zc + 0.04))
        if side == 0:
            p.tube("metal_dark", (xa, YT + 1.1, zc), (xb, YT + 1.1, zc), 0.035, sides=6)
            p.tube("metal_dark", (xa, YT + 1.35, zc), (xb, YT + 1.35, zc), 0.035, sides=6)
        else:
            for (a, b) in ((xa, 3.6), (9.6, xb)):
                p.tube("metal_dark", (a, YT + 1.1, zc), (b, YT + 1.1, zc), 0.035, sides=6)
                p.tube("metal_dark", (a, YT + 1.35, zc), (b, YT + 1.35, zc), 0.035, sides=6)
            # bent railing hanging off the broken section
            p.tube("metal_dark", (3.6, YT + 1.1, zc), (5.5, YT + 0.3, zc + 1.2), 0.035, sides=6)
            p.tube("metal_dark", (3.6, YT + 1.35, zc), (5.2, YT + 0.75, zc + 1.4), 0.035, sides=6)
            # broken concrete stubs + dangling rebar over the missing parapet
            for k in range(9):
                x = 7.0 + k * 0.22
                p.tube("rebar", (x, YT + 0.1, zc - 0.05 + (k % 3) * 0.05), (x + 0.15, YT + 0.45 + 0.1 * (k % 4), zc + 0.05), 0.012, sides=5)
            for k in range(7):
                x = 4.4 + k * 0.4
                p.tube("rebar", (x, YT - 0.3, ZW + 0.02), (x + 0.1, YT - 1.6 - 0.25 * (k % 3), ZW + 0.5 + 0.1 * (k % 2)), 0.012, sides=5)
            p.box("concrete", (8.3, YT + 0.2, zc), (1.3, 0.4, 0.7), rot=(0, 25, 0), bevel=0.0)
    # ---- pier bents beside the road
    for s in (-1, 1):
        xc = s * 9.6
        for z in (2.0, 6.0, 10.0):
            p.cyl("concrete", (xc, 2.7, z), 0.58, 5.4, "y", sides=16, r2=0.58)
            p.cyl("concrete", (xc, 5.8, z), 0.9, 0.8, "y", sides=16, r2=0.62)                 # flared capital
            p.bx("concrete_dark", (xc - 0.85, xc + 0.85), (0, 0.55), (z - 0.85, z + 0.85), bevel=0.05, sub=1.5)
            for yy in (1.6, 3.2, 4.8):
                p.cyl("concrete_dark", (xc, yy, z), 0.62, 0.06, "y", sides=16)                 # pour joints
        p.bx("concrete", (xc - 1.15, xc + 1.15), (6.1, 6.5), (0.3, ZW - 0.3), bevel=0.05, sub=2.0)       # cap beam
        for z in gz:
            p.bx("rubber", (xc - 0.3, xc + 0.3), (6.46, 6.5), (z - 0.3, z + 0.3))
        # crash barrier along the road side of the bent
        xb0 = s * 8.0
        prof = [(xb0 - s * (-lat), y) for lat, y in JERSEY]
        p.extrude("concrete", [(xb0 + s * lat * -1, y) for lat, y in JERSEY], 0.6, ZW - 0.6, sub=2.0)
        # ---- embankment / abutment at the end spans (quad-only solid so grime has resolution)
        x0, x1, xe = s * 10.6, s * 19.0, s * (HW - 0.5)
        strip_solid(p, "concrete_dark", [(x0, 0.0), (x1, 6.2), (xe, 6.2)], -0.5, 0.0, ZW, sub=2.0)
        ang = math.degrees(math.atan2(6.2, abs(x1 - x0))) * s
        for k in range(1, 6):
            t = k / 6.0
            xx, yy = x0 + (x1 - x0) * t, 6.2 * t
            p.box("concrete", (xx - s * 0.02, yy + 0.03, ZW / 2), (0.16, 0.08, ZW - 0.1), rot=(0, 0, ang), bevel=0.0, sub=3.0)
        p.bx("concrete", (min(s * 18.6, s * HW), max(s * 18.6, s * HW)), (6.0, YT - 0.4), (0.0, ZW), bevel=0.04, sub=2.5)     # backwall / abutment cap
    # ---- lights under the deck
    for x in (-13.0, 0.0, 13.0):
        for z in (3.0, 9.0):
            p.box("metal_dark", (x, YU - 0.12, z), (1.3, 0.12, 0.3), bevel=0.02)
            p.box("light_head", (x, YU - 0.19, z), (1.15, 0.03, 0.2))
    # ---- collision
    p.cbx((-HW, HW), (YU, YT), (0, ZW))
    for s in (-1, 1):
        xc = s * 9.6
        for z in (2.0, 6.0, 10.0):
            p.cbx((xc - 0.6, xc + 0.6), (0, 6.2), (z - 0.6, z + 0.6))
        p.chull([(s * 10.6, 0, 0), (s * 19.0, 6.2, 0), (s * HW, 6.2, 0), (s * HW, 0, 0), (s * 10.6, 0, ZW), (s * 19.0, 6.2, ZW), (s * HW, 6.2, ZW), (s * HW, 0, ZW)])
        p.cbx((min(s * 7.6, s * 8.4), max(s * 7.6, s * 8.4)), (0, 0.9), (0.6, ZW - 0.6))
    p.cbx((-HW, HW), (YT, YT + 0.9), (0.3, 0.95))
    p.cbx((-HW, 4.0), (YT, YT + 0.9), (ZW - 0.95, ZW - 0.3))
    p.cbx((12.0, HW), (YT, YT + 0.9), (ZW - 0.95, ZW - 0.3))
    p.socket("deck_top", (0, YT, ZW / 2))
    return p


if __name__ == "__main__":
    overpass().build()
