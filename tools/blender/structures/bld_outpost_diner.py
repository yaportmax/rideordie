"""diner + motel (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *


def dune(p, x0, x1, z0, z1, h, mat="sand"):
    zm = (z0 + z1) / 2
    prof = [(z0, -0.05), (z1, -0.05), (z1 - (z1 - z0) * 0.12, h * 0.3), (zm + (z1 - z0) * 0.12, h * 0.85), (zm - (z1 - z0) * 0.2, h), (z0 + (z1 - z0) * 0.15, h * 0.4)]
    p.extrude_x(mat, orient_ccw(prof), x0, x1, flat=True)


def stool(p, x, z, y0=0.5, tip=0.0):
    p.tube("metal_bare", (x, y0, z), (x, y0 + 0.62, z), 0.025, sides=5, smooth=False)
    p.cyl("paint2", (x, y0 + 0.66, z), 0.19, 0.08, "y", sides=8)
    p.cyl("metal_bare", (x, y0 + 0.02, z), 0.15, 0.03, "y", sides=6)


def diner():
    p = Piece("diner", seed=51, ground_y=0.0, dirt_h=1.3, dirt_amt=0.5, ao_dist=3.0)
    rj = random.Random(9)
    p.notes = dict(desc="Roadside railcar-style diner: stainless lower band, glass window strip (some panes gone), barrel roof, entrance vestibule at +X end, rooftop DINER sign + tall pole 'EAT' neon sign. Front faces +Z; footprint ~26 x 20 m (incl. apron). paint2 = red trim band (tintable), paint = sign board.",
                   footprint=[26, 20], front="+Z", sockets="sign_neon (pole sign), roof_sign")
    hx, hz = 8.0, 3.3
    # ---- apron + plinth
    p.bx("concrete_dark", (-13, 13), (0, 0.1), (-6, 13), sub=4.0)
    p.bx("concrete", (-hx - 0.5, hx + 0.5), (0.1, 0.5), (-hz - 0.5, hz + 0.5), sub=3.0, skip=("ny",))
    for (x, z, w, d) in ((-3, 8, 2.4, 1.6), (4, 6.5, 1.8, 2.6), (-9, 10, 3.0, 1.8)):
        p.quad("asphalt", (x - w / 2, 0.106, z - d / 2), (x - w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z - d / 2), tint=0.55)
    # parking stops
    for x in (-10, -7.5, -5, -2.5, 0, 2.5):
        p.bx("concrete", (x - 0.7, x + 0.7), (0.1, 0.28), (10.4, 10.7))
    # ---- shell: back wall, end walls, front lower band + piers + glass, upper band
    p.bx("metal_bare", (-hx, hx), (0.5, 3.3), (-hz, -hz + 0.2), sub=2.5)                    # back wall
    for s in (-1, 1):
        p.bx("metal_bare", ((hx - 0.2, hx) if s > 0 else (-hx, -hx + 0.2)), (0.5, 3.3), (-hz, hz), sub=2.5)
    p.bx("metal_bare", (-hx, hx), (0.5, 1.3), (hz - 0.2, hz), sub=2.5)                       # front lower band
    for k in range(6):
        y = 0.62 + k * 0.11
        p.bx("metal_dark", (-hx, hx), (y, y + 0.025), (hz, hz + 0.02), tint=0.7, sub=4.0)   # flutes
    p.bx("paint2", (-hx - 0.1, hx + 0.1), (2.7, 3.3), (hz - 0.2, hz + 0.15), sub=2.5)         # red upper band
    p.bx("metal_bare", (-hx - 0.1, hx + 0.1), (2.62, 2.7), (hz - 0.2, hz + 0.18))
    p.bx("metal_bare", (-hx - 0.1, hx + 0.1), (1.3, 1.36), (hz - 0.22, hz + 0.05))
    nwin = 10
    ww = 2 * (hx - 0.2) / nwin
    broken = {2, 3, 7}
    for i in range(nwin + 1):
        xm = -(hx - 0.2) + ww * i
        p.bx("metal_bare", (xm - 0.06, xm + 0.06), (1.3, 2.7), (hz - 0.2, hz))
    for i in range(nwin):
        if i in broken and i != 3:
            continue
        a, b = -(hx - 0.2) + ww * i + 0.06, -(hx - 0.2) + ww * (i + 1) - 0.06
        p.quad("glass", (a, 1.36, hz - 0.1), (b, 1.36, hz - 0.1), (b, 2.62, hz - 0.1), (a, 2.62, hz - 0.1))
    # half-shattered pane: remaining shards
    xm = -(hx - 0.2) + ww * 3
    p.poly("glass", [(xm + 0.06, 1.36, hz - 0.1), (xm + 0.9, 1.36, hz - 0.1), (xm + 0.5, 1.9, hz - 0.1)])
    # end windows (small, +/-X)
    for s in (-1, 1):
        xw = s * hx
        p.quad("glass", (xw, 1.5, -1.2), (xw, 1.5, 1.2), (xw, 2.5, 1.2), (xw, 2.5, -1.2))
    # ---- barrel roof
    outer = [(-hz - 0.35 + 2 * (hz + 0.35) * i / 8, 3.3 + 1.15 * (1 - ((-hz - 0.35 + 2 * (hz + 0.35) * i / 8) / (hz + 0.35)) ** 2)) for i in range(9)]
    inner = [(z, y - 0.14) for z, y in reversed(outer)]
    prof = outer + inner
    p.extrude_x("metal_bare", orient_ccw(prof), -hx - 0.25, hx + 0.25, sub=2.5)
    p.bx("paint2", (-hx - 0.25, hx + 0.25), (3.24, 3.36), (hz + 0.15, hz + 0.4))
    p.bx("paint2", (-hx - 0.25, hx + 0.25), (3.24, 3.36), (-hz - 0.4, -hz - 0.15))
    # ---- interior: floor, counter, stools, booths, kitchen
    p.bx("concrete_dark", (-hx + 0.2, hx - 0.2), (0.5, 0.56), (-hz + 0.2, hz - 0.2), sub=3.0)
    p.bx("wood", (-6.4, 3.4), (0.56, 1.0), (-1.3, -0.6), sub=3.0)
    p.bx("metal_bare", (-6.5, 3.5), (1.0, 1.06), (-1.35, -0.5))
    for i in range(12):
        stool(p, -5.9 + i * 0.78, 0.15, tip=0)
    p.bx("metal_dark", (-6.4, 3.4), (0.56, 2.4), (-hz + 0.2, -hz + 0.6), sub=3.0)
    for x in (-5.2, -2.6, 0.2):
        p.bx("metal_bare", (x - 0.7, x + 0.7), (1.2, 1.3), (-hz + 0.6, -hz + 1.0))
    for (xa, xb) in ((-6.6, -4.6), (-3.2, -1.2), (1.2, 3.2), (4.6, 5.0)):
        if xb - xa > 1:
            p.bx("paint2", (xa, xb), (0.56, 1.0), (2.05, 2.75), sub=1.5)
            p.bx("paint2", (xa, xb), (0.9, 1.5), (2.65, 2.75))
            p.bx("wood", ((xa + xb) / 2 - 0.45, (xa + xb) / 2 + 0.45), (0.96, 1.02), (1.35, 2.0))
            p.tube("metal_bare", ((xa + xb) / 2, 0.56, 1.68), ((xa + xb) / 2, 0.96, 1.68), 0.04, sides=5, smooth=False)
    # ---- entrance vestibule at +X end
    vx0, vx1, vz1 = 5.6, 7.6, 5.2
    p.bx("metal_bare", (vx0, vx1), (0.5, 3.1), (hz, hz + 0.02), skip=("pz", "nz"))    # (hidden filler)
    for xw in (vx0, vx1):
        p.bx("metal_bare", (xw - 0.08, xw + 0.08), (0.5, 3.1), (hz, vz1), sub=2.5)
    p.bx("paint2", (vx0 - 0.15, vx1 + 0.15), (3.1, 3.4), (hz, vz1 + 0.25), sub=2.0)
    p.bx("metal_bare", (vx0 - 0.1, vx1 + 0.1), (3.4, 3.46), (hz, vz1 + 0.3))
    p.bx("metal_bare", (vx0, vx1), (2.6, 3.1), (vz1 - 0.1, vz1))
    p.bx("metal_bare", (vx0, vx0 + 0.1), (0.5, 3.1), (vz1 - 0.1, vz1))
    p.bx("metal_bare", (vx1 - 0.1, vx1), (0.5, 3.1), (vz1 - 0.1, vz1))
    p.quad("glass", (vx0 + 0.1, 0.5, vz1 - 0.05), (vx1 - 0.1, 0.5, vz1 - 0.05), (vx1 - 0.1, 2.6, vz1 - 0.05), (vx0 + 0.1, 2.6, vz1 - 0.05)) if False else None
    p.box("metal_bare", (6.6, 1.5, vz1 + 0.5), (1.0, 2.1, 0.06), rot=(0, 58, 0))         # door hanging open
    p.box("glass", (6.6, 1.6, vz1 + 0.5), (0.86, 1.6, 0.03), rot=(0, 58, 0))
    p.bx("concrete", (vx0 - 0.3, vx1 + 0.3), (0.1, 0.5), (vz1 - 0.2, vz1 + 1.1), sub=2.0)  # step
    p.bx("light_head", (vx0 - 0.1, vx1 + 0.1), (3.05, 3.09), (hz + 0.2, vz1 + 0.2)) if False else None
    # neon lines (emissive)
    p.bx("light_tail", (-hx - 0.1, hx + 0.1), (3.36, 3.42), (hz + 0.18, hz + 0.23))
    p.bx("light_boost", (-hx - 0.1, hx + 0.1), (2.55, 2.6), (hz + 0.16, hz + 0.19))
    # ---- back-of-house: vents, ac, dumpster, pipe stack, propane, fuel drum
    p.cyl("metal_dark", (-5.0, 5.0, -hz + 1.0), 0.4, 3.0, "y", sides=10)
    p.tube("metal_dark", (-2.0, 3.3, -hz + 0.8), (-2.0, 4.9, -hz + 0.8), 0.18, sides=8)
    ac_unit(p, 1.0, 3.6, -1.0, 1.6, 1.3, 0.8)
    ac_unit(p, 4.2, 3.8, -1.6, 1.3, 1.1, 0.7, rot=8)
    p.bx("metal_dark", (-hx + 1.0, -hx + 3.6), (0.1, 1.4), (-hz - 2.6, -hz - 1.3), sub=1.5)
    p.box("metal_dark", (-hx + 2.3, 1.45, -hz - 1.95), (2.8, 0.06, 1.5), rot=(0, 0, -18))
    p.bx("metal_dark", (2.0, 3.0), (0.5, 2.5), (-hz - 0.05, -hz + 0.03))
    for (x, z) in ((5.5, -hz - 1.0), (6.1, -hz - 1.2), (5.8, -hz - 0.4)):
        barrel(p, x, z, 0.1, mat="rust" if x > 5.9 else "metal_dark")
    # ---- rooftop DINER sign (letters on a frame, one dead)
    letters(p, "DINER", 0.0, 4.75, hz - 0.5, 1.7, "light_tail", "pz", depth=0.2, gap=1.0)
    lw = (15 + 4) * (1.7 / 5)
    p.bx("paint", (-lw / 2 - 0.4, lw / 2 + 0.4), (4.5, 6.7), (hz - 0.6, hz - 0.5), sub=2.0)
    p.bx("metal_dark", (-lw / 2 - 0.5, lw / 2 + 0.5), (6.7, 6.8), (hz - 0.68, hz - 0.42))
    p.bx("metal_dark", (-lw / 2 - 0.5, lw / 2 + 0.5), (4.45, 4.55), (hz - 0.68, hz - 0.42))
    for x in (-lw / 2 + 0.6, 0.0, lw / 2 - 0.6):
        p.beam("steel_beam", (x, 4.3, hz - 0.55), (x, 4.6, hz - 0.55), 0.14, 0.14)
        p.beam("steel_beam", (x, 4.45, hz - 0.55), (x + 0.5, 4.45, hz - 2.0), 0.06, 0.06, up=(0, 1, 0))
    # ---- tall pole 'EAT' sign (x=-11, z=9)
    sx_, sz_ = -11.0, 9.0
    p.cyl("concrete_dark", (sx_, 0.4, sz_), 0.55, 0.6, "y", sides=8)
    p.tube("metal_dark", (sx_, 0.7, sz_), (sx_, 10.8, sz_), 0.2, sides=8, r2=0.15)
    p.bx("paint", (sx_ - 1.1, sx_ + 1.1), (6.2, 11.2), (sz_ - 0.2, sz_ + 0.2), sub=1.5)
    p.bx("metal_dark", (sx_ - 1.2, sx_ + 1.2), (11.15, 11.3), (sz_ - 0.25, sz_ + 0.25))
    p.bx("metal_dark", (sx_ - 1.2, sx_ + 1.2), (6.1, 6.25), (sz_ - 0.25, sz_ + 0.25))
    for face in ("pz", "nz"):
        zf = sz_ + (0.2 if face == "pz" else -0.2)
        d = 1 if face == "pz" else -1
        for k, ch in enumerate("EAT"):
            if ch == "A" and face == "pz":
                continue
            letters(p, ch, sx_, 9.5 - k * 1.2 + 0.0, zf, 1.0, "light_tail" if ch != "T" else "light_amber", face, depth=0.12)
        # border neon
        for (xa, xb, ya, yb) in ((-1.0, 1.0, 10.98, 11.05), (-1.0, 1.0, 6.4, 6.47)):
            p.bx("light_boost", (sx_ + xa, sx_ + xb), (ya, yb), (zf, zf + d * 0.06) if d > 0 else (zf + d * 0.06, zf))
        for xa in (-1.0, 0.97):
            p.bx("light_boost", (sx_ + xa, sx_ + xa + 0.03), (6.4, 11.05), (zf, zf + d * 0.06) if d > 0 else (zf + d * 0.06, zf))
        # arrow
        p.bx("light_amber", (sx_ - 0.07, sx_ + 0.07), (6.55, 7.35), (zf, zf + d * 0.08) if d > 0 else (zf - 0.08, zf))
        for sg in (-1, 1):
            p.box("light_amber", (sx_ + sg * 0.22, 6.72, zf + d * 0.04), (0.14, 0.5, 0.08), rot=(0, 0, sg * 45))
    p.socket("sign_neon", (sx_, 9.0, sz_))
    p.socket("roof_sign", (0, 5.5, hz - 0.5))
    # ---- sand drifts + junk
    dune(p, -hx - 0.5, -hx + 4.0, -hz - 0.6, -hz + 1.4, 0.9)
    dune(p, 3.0, 9.5, hz + 1.9, hz + 4.6, 0.55)
    dune(p, -13.0, -9.0, 2.0, 6.5, 0.7)
    crate(p, -2.2, 6.3, 0.1, 0.6, rot=17)
    tyre_stack(p, 9.6, -2.0, 3, 0.1, seed=8)
    # ---- collision
    p.cbx((-hx - 0.3, hx + 0.3), (0, 4.45), (-hz - 0.3, hz + 0.3))
    p.cbx((vx0 - 0.3, vx1 + 0.3), (0, 3.5), (hz, vz1 + 0.3))
    p.cbx((sx_ - 0.3, sx_ + 0.3), (0, 11.3), (sz_ - 0.3, sz_ + 0.3))
    p.cbx((sx_ - 1.2, sx_ + 1.2), (6.1, 11.3), (sz_ - 0.25, sz_ + 0.25))
    p.cbx((-hx + 1.0, -hx + 3.6), (0, 1.5), (-hz - 2.6, -hz - 1.3))
    return p
