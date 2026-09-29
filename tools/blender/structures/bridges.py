"""bridge_span_20m, bridge_pier, bridge_arch."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slib import *


def rrect(cx, cz, hx, hz, c):
    """Chamfered rectangle ring points (x, z) - 8 points."""
    return [(cx - hx + c, cz - hz), (cx + hx - c, cz - hz), (cx + hx, cz - hz + c), (cx + hx, cz + hz - c),
            (cx + hx - c, cz + hz), (cx - hx + c, cz + hz), (cx - hx, cz + hz - c), (cx - hx, cz - hz + c)]


def joint_fingers(p, z0, z1, hw=7.0):
    p.bx("metal_bare", (-hw, hw), (-0.01, 0.014), (z0, z1), bevel=0.004)
    n = int(2 * hw / 0.5)
    for i in range(n):
        x = -hw + 0.12 + i * 0.5
        p.bx("metal_dark", (x, x + 0.22), (0.0, 0.018), (z0 + 0.03, z1 - 0.03))


def girder_deck(p, L, y_top=-0.42, depth=1.5, gx=(-6, -3, 0, 3, 6), stiff=2.5, braces=(2.5, 7.5, 12.5, 17.5)):
    yb = y_top - depth
    for x in gx:
        p.bx("steel_beam", (x - 0.022, x + 0.022), (yb + 0.08, y_top - 0.02), (0, L))
        p.bx("steel_beam", (x - 0.28, x + 0.28), (y_top - 0.07, y_top - 0.01), (0, L), bevel=0.008)
        p.bx("steel_beam", (x - 0.34, x + 0.34), (yb, yb + 0.09), (0, L), bevel=0.012)
        n = int(L / stiff)
        for k in range(n + 1):
            z = min(max(k * stiff + 0.1, 0.1), L - 0.1) if k < n else L - 0.1
            for s in (-1, 1):
                p.bx("steel_beam", (x + s * 0.022, x + s * 0.062), (yb + 0.09, y_top - 0.07), (z - 0.07, z + 0.07))
    for zb in braces:
        for a, b in zip(gx[:-1], gx[1:]):
            p.beam("steel_beam", (a + 0.03, yb + 0.15, zb), (b - 0.03, y_top - 0.2, zb), 0.1, 0.1)
            p.beam("steel_beam", (a + 0.03, y_top - 0.2, zb), (b - 0.03, yb + 0.15, zb), 0.1, 0.1)
            p.bx("steel_beam", (a + 0.03, b - 0.03), (y_top - 0.3, y_top - 0.2), (zb - 0.05, zb + 0.05))
            p.bx("steel_beam", (a + 0.03, b - 0.03), (yb + 0.09, yb + 0.16), (zb - 0.05, zb + 0.05))


def bridge_span(damaged=False):
    L = 20.0
    p = Piece("bridge_span_20m_damaged" if damaged else "bridge_span_20m", seed=17 if damaged else 11, ground_y=-40, dirt_amt=0.0, ao_dist=2.5, under_amt=0.35, streak_amt=0.3, noise_amt=0.28)
    p.notes = dict(desc="Steel plate-girder + concrete deck bridge span, road along +Z from z=0 to z=20. Chain spans end to end.",
                   road_width=14, deck_underside_y=-1.92, deck_width=15.9, pier_sockets="pier at z=0 (start joint), pier_end at z=20",
                   lamps="lamp_0 (+X side, z=5), lamp_1 (-X side, z=15) sockets at the light heads")
    # road surface (asphalt) - game swaps material + collision
    xs = [-7 + 14 * i / 14 for i in range(15)]
    zs = [L * i / 10 for i in range(11)]
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: 0.0)
    # slab + kerbs + end diaphragms + fascia drip lips
    p.bx("concrete", (-7.95, 7.95), (-0.42, -0.02), (0, L), bevel=0.03, sub=2.0)
    for s in (-1, 1):
        a, b = (6.95, 7.4) if s > 0 else (-7.4, -6.95)
        p.bx("concrete_dark", (a, b), (-0.02, 0.2), (0, L), bevel=0.02, sub=2.5)
        a, b = (7.83, 7.95) if s > 0 else (-7.95, -7.83)
        p.bx("concrete", (a, b), (-0.62, -0.42), (0, L), bevel=0.02, sub=2.5)
    for z0, z1 in ((0, 0.5), (L - 0.5, L)):
        p.bx("concrete_dark", (-7.95, 7.95), (-1.92, -0.42), (z0, z1), bevel=0.03, sub=2.5)
    girder_deck(p, L)
    # parapets: 4 panels each side + cap + posts + rails
    rj = random.Random(7)
    for s in (-1, 1):
        xa, xb = (7.4, 7.95) if s > 0 else (-7.95, -7.4)
        for k in range(4):
            z0, z1 = k * 5.0 + 0.02, (k + 1) * 5.0 - 0.02
            if damaged and s > 0 and k == 1:
                # collapsed panel: a stub + tilted broken slab lying on the kerb
                p.bx("concrete", (xa, xb), (0.2, 0.55), (z0, z0 + 1.6), bevel=0.02, sub=1.7)
                p.box("concrete", (7.75, 0.35, z0 + 3.4), (0.55, 0.5, 1.3), rot=(0, 20, 12), bevel=0.02)
                continue
            p.bx("concrete", (xa, xb), (0.2, 1.02), (z0, z1), bevel=0.035, sub=1.7, tint=rj.uniform(0.86, 1.02))
        ca, cb = (7.34, 8.0) if s > 0 else (-8.0, -7.34)
        p.bx("concrete_dark", (ca, cb), (1.02, 1.13), (0, L), bevel=0.03, sub=3.0)
        xr = s * 7.67
        for k in range(9):
            z = 0.3 + k * 2.425
            if damaged and s > 0 and 5.2 < z < 10.4:
                continue
            p.bx("metal_dark", (xr - 0.05, xr + 0.05), (1.13, 1.7), (z - 0.05, z + 0.05), bevel=0.01)
            p.bx("metal_dark", (xr - 0.09, xr + 0.09), (1.13, 1.16), (z - 0.09, z + 0.09))
        if damaged and s > 0:
            for yy in (1.34, 1.64):
                p.tube("metal_dark", (xr, yy, 0.0), (xr, yy, 5.1), 0.036, sides=6)
                p.tube("metal_dark", (xr, yy, 5.1), (xr + 0.35, yy - 0.9 - (yy - 1.34), 7.4), 0.036, sides=6)
                p.tube("metal_dark", (xr, yy, 10.6), (xr, yy, L), 0.036, sides=6)
                p.tube("metal_dark", (xr + 0.1, 0.4 + (yy - 1.34), 8.4), (xr, yy, 10.6), 0.036, sides=6)
            for k in range(8):
                zz = 5.2 + k * 0.28
                p.tube("rebar", (7.7, 0.55, zz), (7.75 + 0.05 * (k % 3), 0.95 + 0.12 * (k % 4), zz + 0.05), 0.013, sides=4)
        else:
            p.tube("metal_dark", (xr, 1.34, 0.0), (xr, 1.34, L), 0.036, sides=6)
            p.tube("metal_dark", (xr, 1.64, 0.0), (xr, 1.64, L), 0.036, sides=6)
        # inner-face reflectors
        for k in range(8):
            z = 1.3 + k * 2.425
            p.bx("light_amber", (s * 7.36 - 0.01, s * 7.36 + 0.01), (0.7, 0.8), (z, z + 0.14))
    # lamps
    lamp_post(p, 7.67, 5.0, side=1, h=7.4, arm=2.7, y0=1.13)
    lamp_post(p, -7.67, 15.0, side=-1, h=7.4, arm=2.7, y0=1.13)
    p.socket("lamp_0", (7.67 - 2.7, 1.13 + 7.4 + 0.1, 5.0))
    p.socket("lamp_1", (-7.67 + 2.7, 1.13 + 7.4 + 0.1, 15.0))
    # expansion joints (half at each end so chained spans get a full joint)
    joint_fingers(p, 0.0, 0.24)
    joint_fingers(p, L - 0.24, L)
    # utility conduit under the overhang
    for s in (-1, 1):
        x = s * 7.1
        p.tube("metal_dark", (x, -0.75, 0.6), (x, -0.75, L - 0.6), 0.075, sides=8)
        for k in range(5):
            z = 1.5 + k * 4.25
            p.bx("metal_dark", (x - 0.02, x + 0.02), (-0.75, -0.42), (z - 0.03, z + 0.03))
            p.bx("metal_dark", (x - 0.1, x + 0.1), (-0.83, -0.67), (z - 0.03, z + 0.03))
    if damaged:
        dr = random.Random(9)
        for k in range(9):
            sc = dr.uniform(0.25, 0.7)
            p.box("concrete", (dr.uniform(3.5, 6.8), sc * 0.3, dr.uniform(6.0, 11.5)), (sc * 1.2, sc * 0.6, sc), rot=(dr.uniform(-10, 10), dr.uniform(0, 90), dr.uniform(-10, 10)), bevel=0.02, tint=dr.uniform(0.75, 1.0))
        p.notes["desc"] += " DAMAGED variant: parapet panel missing on the +X side at z 5-10 with hanging rails/rebar and debris on the deck."
    p.socket("pier", (0, -1.92, 0))
    p.socket("pier_end", (0, -1.92, L))
    # collision
    for s in (-1, 1):
        a, b = (6.95, 8.0) if s > 0 else (-8.0, -6.95)
        p.cbx((a, b), (-0.02, 1.7), (0, L))
        p.cbx((s * 7.67 - 0.1, s * 7.67 + 0.1), (1.13, 8.6), ((5.0 if s > 0 else 15.0) - 0.1, (5.0 if s > 0 else 15.0) + 0.1))
    p.cbx((-7.95, 7.95), (-1.95, -0.02), (0, L))
    return p


def bridge_pier():
    H = 12.0
    p = Piece("bridge_pier", seed=12, ground_y=0.0, dirt_h=3.0, dirt_amt=0.6, under_amt=0.3, ao_dist=3.5, streak_amt=0.3, noise_amt=0.3)
    p.notes = dict(desc="Hammerhead concrete pier, origin = base centre (y=0 at footing bottom). Top of bearing pads at y=12 = deck underside: align `deck_socket` to the deck underside (bridge_span_20m socket `pier`). Sink the footing into terrain as needed.",
                   height=12.0, cap_width=16.8, footing=[6.8, 1.4, 4.8], repeat="place one at each span joint (every 20 m) under x=0")
    p.bx("concrete_dark", (-3.4, 3.4), (0, 1.4), (-2.4, 2.4), bevel=0.1, bsegs=2, sub=2.0)
    # column: 3 pours, slightly tapered, chamfered corners
    y0s = [1.4, 4.55, 7.65]
    y1s = [4.5, 7.6, 10.6]

    def half(y):
        t = (y - 1.4) / (10.6 - 1.4)
        return 1.45 - 0.3 * t, 1.12 - 0.22 * t
    for a, b in zip(y0s, y1s):
        ha, hb = half(a), half(b)
        rings = [[(x, a, z) for x, z in rrect(0, 0, ha[0] * 0.985, ha[1] * 0.985, 0.3)],
                 [(x, (a + b) / 2, z) for x, z in rrect(0, 0, (ha[0] + hb[0]) / 2 * 1.0, (ha[1] + hb[1]) / 2 * 1.0, 0.3)],
                 [(x, b, z) for x, z in rrect(0, 0, hb[0] * 0.985, hb[1] * 0.985, 0.3)]]
        p.loft("concrete", rings, sub=1.5)
    # hammerhead cap beam
    prof = [(-8.4, 11.85), (8.4, 11.85), (8.4, 11.15), (1.3, 10.55), (-1.3, 10.55), (-8.4, 11.15)]
    p.extrude("concrete", prof, -1.65, 1.65, bevel=0.06, sub=2.0)
    for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
        p.bx("concrete_dark", (x - 0.45, x + 0.45), (11.85, 11.95), (-0.5, 0.5), bevel=0.015)
        p.bx("rubber", (x - 0.28, x + 0.28), (11.95, 12.0), (-0.3, 0.3))
    # exposed rebar at the cap ends
    for s in (-1, 1):
        for k in range(6):
            zz = -1.2 + k * 0.48
            p.tube("rebar", (s * 8.3, 11.85, zz), (s * 8.3 + s * 0.05 * (k % 3 - 1), 12.3 + 0.12 * (k % 2), zz), 0.014, sides=5)
    # inspection ladder on the narrow (-Z) face, follows the taper
    zf = lambda y: -half(y)[1] - 0.05
    for k in range(20):
        y = 1.9 + k * 0.44
        p.tube("metal_dark", (-0.3, y, zf(y) - 0.12), (0.3, y, zf(y) - 0.12), 0.016, sides=5)
    for s_ in (-1, 1):
        p.tube("metal_dark", (s_ * 0.3, 1.8, zf(1.8) - 0.12), (s_ * 0.3, 10.3, zf(10.3) - 0.12), 0.022, sides=6)
    for y in (2.4, 5.0, 7.6, 10.0):
        for s_ in (-1, 1):
            p.bx("metal_dark", (s_ * 0.3 - 0.02, s_ * 0.3 + 0.02), (y - 0.03, y + 0.03), (zf(y) - 0.12, zf(y) + 0.02))
    p.socket("deck_socket", (0, H, 0))
    p.cbx((-3.4, 3.4), (0, 1.4), (-2.4, 2.4))
    p.chull([(-1.45, 1.4, -1.12), (1.45, 1.4, -1.12), (-1.45, 1.4, 1.12), (1.45, 1.4, 1.12),
             (-1.15, 10.6, -0.9), (1.15, 10.6, -0.9), (-1.15, 10.6, 0.9), (1.15, 10.6, 0.9)])
    p.cbx((-8.4, 8.4), (10.55, 12.0), (-1.65, 1.65))
    return p



def bridge_arch():
    L = 40.0
    p = Piece("bridge_arch", seed=21, ground_y=-40, dirt_amt=0.0, ao_dist=3.0, under_amt=0.35, streak_amt=0.35, noise_amt=0.3)
    ST = (0.92, 0.2, 0.075)        # faded international-orange paint on the truss
    _raw = p.raw

    def raw2(mat, verts, faces, M=None, node=None, sg=0, tint=None, **kw):
        if mat == "steel_beam" and node is None:
            mat, tint = "paint", (tint or ST)
        return _raw(mat, verts, faces, M, node, sg=sg, tint=tint, **kw)
    p.raw = raw2
    p.notes = dict(desc="Steel through-arch bridge, 40 m, road along +Z (z=0..40). Twin truss arch ribs at x=+-8.3, crown y=17.6 at z=20, bracing above y=7.5 (clear of vehicles).",
                   clearance_under_bracing=7.5, deck_underside_y=-1.3, beacon="light_tail red beacons on the crown; crown socket `arch_crown`")
    # ---- deck
    xs = [-7 + 14 * i / 14 for i in range(15)]
    zs = [L * i / 20 for i in range(21)]
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: 0.0)
    p.bx("concrete", (-7.6, 7.6), (-0.45, -0.02), (0, L), bevel=0.03, sub=2.5)
    for s in (-1, 1):
        a, b_ = (7.6, 9.0) if s > 0 else (-9.0, -7.6)
        p.bx("steel_beam", (a, b_), (-1.4, 0.35), (0, L), sub=2.5)          # edge (tie) girders
        a, b_ = (7.0, 7.6) if s > 0 else (-7.6, -7.0)
        # low concrete crash barrier (F-shape approximated with chamfered box) on the deck edge
        p.bx("concrete", (a, b_), (-0.02, 0.9), (0, L), bevel=0.06, sub=2.0)
        for k in range(int(L / 2.5)):
            z = k * 2.5 + 1.25
            p.bx("light_amber", (s * 7.0 - 0.012 if False else (s * 7.0 - 0.01), s * 7.0 + 0.01), (0.55, 0.66), (z - 0.1, z + 0.1)) if k % 2 == 0 else None
    # floor beams + stringers under the slab
    for k in range(int(L / 2.5) + 1):
        z = min(k * 2.5, L - 0.09) if k else 0.09
        p.bx("steel_beam", (-7.6, 7.6), (-1.05, -0.45), (z - 0.09, z + 0.09))
        p.bx("steel_beam", (-7.6, 7.6), (-1.05, -0.97), (z - 0.22, z + 0.22))
    for x in (-5.25, -1.75, 1.75, 5.25):
        p.bx("steel_beam", (x - 0.14, x + 0.14), (-0.95, -0.45), (0, L), bevel=0.01, sub=4.0)
    joint_fingers(p, 0.0, 0.24)
    joint_fingers(p, L - 0.24, L)
    # ---- arch ribs (truss)
    f, y0 = 14.5, 1.9

    def yc(z):
        u = (z - L / 2) / (L / 2)
        return y0 + f * (1 - u * u)

    def hd(z):
        u = (z - L / 2) / (L / 2)
        return 1.2 + 0.7 * u * u
    N = 16
    zk = [L * k / N for k in range(N + 1)]
    for s in (-1, 1):
        x = s * 8.3
        T = [(x, yc(z) + hd(z), z) for z in zk]
        B = [(x, yc(z) - hd(z), z) for z in zk]
        for k in range(N):
            # chords (box, 0.55 wide x 0.55 out-of-plane)
            p.beam("steel_beam", T[k], T[k + 1], 0.5, 0.6, up=(1, 0, 0))
            p.beam("steel_beam", B[k], B[k + 1], 0.5, 0.6, up=(1, 0, 0))
            if k < N // 2:
                p.beam("steel_beam", B[k], T[k + 1], 0.24, 0.4, up=(1, 0, 0))
            else:
                p.beam("steel_beam", T[k], B[k + 1], 0.24, 0.4, up=(1, 0, 0))
        for k in range(N + 1):
            p.beam("steel_beam", B[k], T[k], 0.3, 0.42, up=(1, 0, 0))
            # gusset plates both sides at the nodes
            for nodes in (T, B):
                px, py, pz = nodes[k]
                for sx in (-1, 1):
                    p.box("steel_beam", (px + sx * 0.29, py, pz), (0.03, 0.85, 0.85))
        # hangers from the lower chord to the tie girder
        for k in range(2, N - 1, 2):
            bx_, by_, bz_ = B[k]
            p.tube("metal_dark", (bx_, by_ - 0.28, bz_), (bx_, 0.35, bz_), 0.045, sides=8)
            p.box("metal_dark", (bx_, by_ - 0.3, bz_), (0.34, 0.16, 0.34))
            p.box("metal_dark", (bx_, 0.4, bz_), (0.36, 0.14, 0.36))
        # skewback shoes + abutment blocks
        for z0, z1 in ((-1.6, 3.0), (L - 3.0, L + 1.6)):
            a, b_ = (7.4, 9.3) if s > 0 else (-9.3, -7.4)
            p.bx("concrete_dark", (a, b_), (-3.2, 0.0), (z0, z1), bevel=0.06, sub=2.0)
        for z in (0.0, L):
            p.box("metal_dark", (x, 0.15, z), (1.1, 0.3, 1.5), bevel=0.03)
        # collision (rib segments)
        for k in range(N):
            p.cbeam(B[k], T[k + 1], 0.7, 0.6, up=(1, 0, 0)) if False else None
        for k in range(N):
            c0 = tuple((B[k][i] + T[k][i]) / 2 for i in range(3))
            c1 = tuple((B[k + 1][i] + T[k + 1][i]) / 2 for i in range(3))
            p.cbeam(c0, c1, 0.7, 2.6, up=(1, 0, 0))
    # ---- lateral bracing between the ribs (above 7.5 m)
    for k in range(3, N - 2):
        zt = zk[k]
        yt = yc(zt) + hd(zt)
        yb = yc(zt) - hd(zt)
        p.beam("steel_beam", (-8.3, yt, zt), (8.3, yt, zt), 0.42, 0.42, up=(0, 1, 0))
        p.beam("steel_beam", (-8.3, yb, zt), (8.3, yb, zt), 0.36, 0.4, up=(0, 1, 0))
        # K braces to the top strut
        p.beam("steel_beam", (-8.3, yb, zt), (0, yt, zt), 0.2, 0.2, up=(0, 0, 1))
        p.beam("steel_beam", (8.3, yb, zt), (0, yt, zt), 0.2, 0.2, up=(0, 0, 1))
        if k < N - 3:
            z2 = zk[k + 1]
            y2 = yc(z2) + hd(z2)
            p.beam("steel_beam", (-8.3, yt, zt), (8.3, y2, z2), 0.18, 0.18, up=(0, 1, 0))
            p.beam("steel_beam", (8.3, yt, zt), (-8.3, y2, z2), 0.18, 0.18, up=(0, 1, 0))
    for k in (5, 8, 11):
        z = zk[k]
        y = yc(z) + hd(z)
        for x in (-4.0, 4.0):
            p.tube("metal_dark", (x, y, z), (x, y - 0.9, z), 0.03, sides=6)
            p.box("metal_dark", (x, y - 1.0, z), (0.7, 0.16, 0.5))
            p.box("light_head", (x, y - 1.09, z), (0.56, 0.03, 0.38))
    p.tube("metal_dark", (0, yc(20) + hd(20), 20), (0, yc(20) + hd(20) + 1.0, 20), 0.05, sides=6)
    for s in (-1, 1):
        p.tube("metal_dark", (s * 8.3, yc(20) + hd(20) + 0.3, 20), (s * 8.3, yc(20) + hd(20) + 1.3, 20), 0.05, sides=6)
        p.cyl("light_tail", (s * 8.3, yc(20) + hd(20) + 1.4, 20), 0.16, 0.2, "y", sides=8)
    p.cyl("light_tail", (0, yc(20) + hd(20) + 1.1, 20), 0.16, 0.2, "y", sides=8)
    p.socket("arch_crown", (0, yc(20) + hd(20), 20))
    # collision: barriers, girders, deck edge, abutments, struts near crown region
    for s in (-1, 1):
        a, b_ = (7.0, 9.0) if s > 0 else (-9.0, -7.0)
        p.cbx((a, b_), (-1.4, 0.9), (0, L))
        a, b_ = (7.4, 9.3) if s > 0 else (-9.3, -7.4)
        p.cbx((a, b_), (-3.2, 0.3), (-1.6, 3.0))
        p.cbx((a, b_), (-3.2, 0.3), (L - 3.0, L + 1.6))
    p.cbx((-7.6, 7.6), (-1.4, -0.02), (0, L))
    return p


if __name__ == "__main__":
    which = os.environ.get("ONLY", "")
    if which in ("", "bridge_span_20m"):
        bridge_span().build()
    if which in ("", "bridge_span_20m_damaged"):
        bridge_span(damaged=True).build()
    if which in ("", "bridge_pier"):
        bridge_pier().build()
    if which in ("", "bridge_arch"):
        bridge_arch().build()
