"""Roadside outposts (fork B1): gas_station, shipping_container(+stack3), diner, motel, warehouse, watchtower, shanty_hut, raider_camp_tent."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *


# =================================================================================================== GAS STATION
def gas_station():
    p = Piece("gas_station", seed=31, ground_y=0.0, dirt_h=1.4, dirt_amt=0.5, ao_dist=3.5)
    rj = random.Random(4)
    p.notes = dict(desc="Roadside gas station: convenience shop + garage bay (back, x<0), pump canopy (front, z>0) with 2 islands x 2 double-sided pumps, price sign pole. Front faces +Z; footprint 26 x 22 m; canopy underside y=5.0.",
                   footprint=[26, 22], front="+Z", canopy_clearance=5.0)
    # ---- apron slab
    p.bx("concrete_dark", (-13, 13), (0, 0.12), (-7.5, 14.5), sub=4.0)
    # oil stains + cracks (flat patches)
    for (x, z, w, d) in ((0.5, 7.5, 1.6, 2.4), (4.5, 6.0, 2.0, 1.4), (-8, 3.5, 2.6, 1.6), (2, 11.5, 1.2, 1.8)):
        p.quad("asphalt", (x - w / 2, 0.126, z - d / 2), (x - w / 2, 0.126, z + d / 2), (x + w / 2, 0.126, z + d / 2), (x + w / 2, 0.126, z - d / 2), tint=0.6)
    for (x0, z0, x1, z1) in ((-5, 2, 3, 13), (6, 4, 11, 13.5), (-11, 1, -6, -3)):
        p.beam("asphalt", (x0, 0.127, z0), (x1, 0.127, z1), 0.04, 0.004, tint=0.5)
    # ---- shop building (x -12..-0.5, z -6.5..0.5)
    sx0, sx1, sz0, sz1, sh = -12.0, -0.5, -6.5, 0.5, 3.9
    p.bx("concrete_dark", (sx0 - 0.1, sx1 + 0.1), (0.12, 0.55), (sz0 - 0.1, sz1 + 0.1), sub=3)   # plinth
    # front wall with openings (storefront window + door + garage bay)
    front_open = [(-11.0, -5.6, 0.8, 3.0), (-4.75, -3.55, 0.55, 2.75), (-2.9, -0.9, 0.55, 3.1)]
    wall_with_openings(p, "concrete", "z", sz1 - 0.15, 0.3, sx0, sx1, 0.55, sh, front_open, sub=3.0)
    wall_with_openings(p, "concrete", "z", sz0 + 0.15, 0.3, sx0, sx1, 0.55, sh, [], sub=3.2)
    wall_with_openings(p, "concrete", "x", sx0 + 0.15, 0.3, sz0, sz1, 0.55, sh, [(-4.0, -2.4, 1.0, 2.6)], sub=3.2)
    wall_with_openings(p, "concrete", "x", sx1 - 0.15, 0.3, sz0, sz1, 0.55, sh, [], sub=3.2)
    # interior floor + roof slab + parapet
    p.bx("concrete_dark", (sx0, sx1), (0.5, 0.58), (sz0, sz1), sub=3)
    p.bx("concrete", (sx0 - 0.15, sx1 + 0.15), (sh, sh + 0.28), (sz0 - 0.15, sz1 + 0.3), sub=2.5)
    for (a, b, c, d) in ((sx0 - 0.15, sx1 + 0.15, sz1 + 0.3 - 0.2, sz1 + 0.3), (sx0 - 0.15, sx1 + 0.15, sz0 - 0.15, sz0 + 0.05)):
        p.bx("paint2", (a, b), (sh + 0.28, sh + 0.85), (c, d), sub=3.0)
    for (a, b, c, d) in ((sx0 - 0.15, sx0 + 0.05, sz0 - 0.15, sz1 + 0.3), (sx1 - 0.05, sx1 + 0.15, sz0 - 0.15, sz1 + 0.3)):
        p.bx("paint2", (a, b), (sh + 0.28, sh + 0.85), (c, d), sub=3.0)
    # fascia stripe on the front
    p.bx("paint", (sx0 - 0.15, sx1 + 0.15), (sh - 0.55, sh - 0.05), (sz1 + 0.0, sz1 + 0.12), sub=2.5)
    # storefront glass + frame (a few panes smashed)
    slat_glass(p, -11.0, -5.6, 0.8, 3.0, sz1 - 0.15, n=5, broken=(1, 3), glass_z_off=-0.02)
    p.bx("concrete_dark", (-11.1, -5.5), (0.55, 0.8), (sz1 - 0.05, sz1 + 0.08))   # sill
    for (x, y, ang) in ((-8.6, 1.9, 8), (-6.4, 2.3, -14), (-10.2, 1.3, 20)):
        p.box("wood", (x, y, sz1 + 0.05), (2.3, 0.22, 0.05), rot=(0, 0, ang))
    # door (glass, ajar), frame
    p.bx("metal_dark", (-4.75, -3.55), (2.7, 2.78), (sz1 - 0.28, sz1 - 0.02))
    for xx in (-4.75, -3.55):
        p.bx("metal_dark", (xx - 0.05, xx + 0.05), (0.55, 2.78), (sz1 - 0.28, sz1 - 0.02))
    p.box("metal_dark", (-4.5, 1.6, sz1 + 0.35), (1.0, 2.1, 0.05), rot=(0, -62, 0))
    p.box("glass", (-4.5, 1.7, sz1 + 0.35), (0.86, 1.6, 0.03), rot=(0, -62, 0))
    # garage bay: roll-up door half open + dark interior
    p.bx("metal_dark", (-2.95, -0.85), (0.55, 3.15), (sz1 - 0.3, sz1 - 0.05), sub=2)
    for k in range(7):
        y0 = 0.55 + k * 0.17
        p.bx("metal_bare", (-2.9, -0.9), (y0 + 0.02, y0 + 0.155), (sz1 - 0.25, sz1 - 0.17), tint=0.85 - 0.05 * (k % 2))
    p.bx("metal_dark", (-3.0, -0.8), (3.1, 3.3), (sz1 - 0.35, sz1 + 0.15))
    p.bx("metal_dark", (-3.02, -2.9), (0.55, 3.15), (sz1 - 0.3, sz1 + 0.1))
    p.bx("metal_dark", (-0.9, -0.78), (0.55, 3.15), (sz1 - 0.3, sz1 + 0.1))
    # interior props visible through the openings: counter, shelves, chips racks
    p.bx("wood", (-10.6, -6.0), (0.58, 1.15), (-1.8, -1.2))
    for r in range(3):
        p.bx("metal_dark", (-10.8, -6.5), (0.6 + r * 0.55, 0.66 + r * 0.55), (-5.9, -5.4))
        p.bx("metal_dark", (-10.8, -10.7), (0.6, 2.2), (-5.9, -5.4))
        p.bx("metal_dark", (-6.5, -6.4), (0.6, 2.2), (-5.9, -5.4))
    for xx in (-9.0, -7.5):
        p.bx("metal_bare", (xx - 0.35, xx + 0.35), (0.58, 1.9), (-3.4, -2.9))
    # rooftop kit
    ac_unit(p, -9.5, sh + 0.28, -2.5, 1.5, 1.2, 0.85, 4)
    ac_unit(p, -6.8, sh + 0.28, -3.5, 1.2, 1.0, 0.7)
    p.cyl("metal_bare", (-3.6, sh + 1.1, -4.4), 0.9, 1.5, "y", sides=10)     # water tank
    p.cyl("metal_dark", (-3.6, sh + 1.95, -4.4), 0.95, 0.12, "y", sides=10)
    for a in (-0.6, 0.6):
        for b in (-0.6, 0.6):
            p.tube("metal_dark", (-3.6 + a, sh + 0.28, -4.4 + b), (-3.6 + a, sh + 0.4, -4.4 + b), 0.05, sides=4, smooth=False)
    p.tube("metal_dark", (-1.6, sh + 0.28, -5.0), (-1.6, sh + 3.4, -5.0), 0.03, sides=5)
    p.tube("metal_dark", (-1.6, sh + 2.2, -5.0), (-2.6, sh + 2.9, -5.0), 0.02, sides=4)
    p.tube("metal_dark", (-11.0, sh + 0.28, -3.0), (-11.0, sh + 1.3, -3.0), 0.12, sides=8)
    p.cyl("metal_dark", (-11.0, sh + 1.35, -3.0), 0.2, 0.1, "y", sides=8)
    # shop sign board on the fascia (dead neon)
    letters(p, "GAS", -8.3, sh + 0.02, sz1 + 0.13, 0.7, "metal_bare", "pz", depth=0.05)
    # side / rear extras: dumpster, propane cage, pallets, barrels, tyres
    p.bx("metal_dark", (-12.4, -9.9), (0.12, 1.3), (-5.6, -4.4))
    p.bx("rust", (-12.5, -9.8), (1.3, 1.38), (-5.7, -4.3), rot=None) if False else None
    p.box("metal_dark", (-11.15, 1.4, -5.0), (2.7, 0.08, 1.3), rot=(0, 0, -14))
    for (bx_, bz_) in ((-3.0, -7.0), (-2.3, -7.1), (-2.6, -6.6)):
        barrel(p, bx_, bz_, 0.12, mat=("rust" if bz_ < -6.9 else "metal_dark"))
    tyre_stack(p, 0.7, -6.6, 3, 0.12, seed=2)
    tyre_stack(p, 1.5, -6.9, 2, 0.12, seed=3)
    for k in range(3):
        p.bx("wood", (-1.0 + 0.0, 0.5 + 0.0), (0.12 + k * 0.14, 0.24 + k * 0.14), (-7.2, -6.0), rot=None) if False else None
    for (x, z) in ((3.0, -6.3), (4.3, -6.6)):
        crate(p, x, z, 0.12, 0.8, rot=rj.uniform(0, 40))
    p.bx("metal_bare", (0.9, 1.1), (0.12, 1.6), (-0.4, 0.4))        # propane cage posts
    p.bx("metal_dark", (0.9, 2.5), (0.12, 1.6), (-0.4, 0.4), skip=("py",)) if False else None
    for xx in (1.3, 1.9, 2.5):
        p.cyl("metal_bare", (xx, 0.55, 0.05 + sz1 - 0.05), 0.2, 0.9, "y", sides=8)
    # ---- canopy
    cy = 5.0
    cx0, cx1, cz0, cz1 = -6.0, 10.0, 3.0, 12.0
    cols = [(-3.5, 5.0), (7.5, 5.0), (-3.5, 10.0), (7.5, 10.0)]
    # roof structure: L-shaped deck (missing the far corner: x 6..10, z 9..12)
    p.bx("concrete_dark", (cx0, cx1), (cy, cy + 0.45), (cz0, 9.0), sub=3.0, skip=("ny",))
    p.bx("concrete_dark", (cx0, 6.0), (cy, cy + 0.45), (9.0, cz1), sub=3.0, skip=("ny",))
    p.bx("metal_dark", (cx0, cx1), (cy - 0.06, cy), (cz0, 9.0), sub=3.0, skip=("py", "px", "nx", "pz", "nz"))
    p.bx("metal_dark", (cx0, 6.0), (cy - 0.06, cy), (9.0, cz1), sub=3.0, skip=("py", "px", "nx", "pz", "nz"))
    # hanging torn corner panel + exposed steel
    p.box("metal_dark", (7.9, cy + 0.1, 10.5), (3.7, 0.3, 3.0), rot=(0, 0, 0), skip=()) if False else None
    p.box("metal_dark", (8.0, cy - 0.35, 10.6), (4.0, 0.12, 3.0), rot=(0, 0, 24), tint=0.9)
    for (a, b) in ((6.0, 9.0), (6.0, 12.0)):
        pass
    p.beam("steel_beam", (6.0, cy + 0.2, 9.0), (10.0, cy + 0.2, 9.0), 0.26, 0.3)
    p.beam("steel_beam", (6.0, cy + 0.2, 9.0), (6.0, cy + 0.2, 12.0), 0.26, 0.3)
    for k in range(9):
        z = 9.15 + k * 0.32
        if z < 12.0:
            p.tube("rebar", (6.0, cy + 0.05, z), (5.9 - 0.1 * (k % 3), cy - 0.35 - 0.1 * (k % 2), z), 0.015, sides=5)
    # fascia band (paint2) around the deck; top edge cap
    for (a, b, c, d) in ((cx0, cx1, cz1, cz1 + 0.14), (cx0 - 0.14, cx0, cz0, cz1 + 0.14)):
        if (a, b, c, d) == (cx0, cx1, cz1, cz1 + 0.14):
            p.bx("paint2", (cx0, 6.0), (cy - 0.62, cy + 0.72), (cz1, cz1 + 0.14), sub=2.0)
        else:
            p.bx("paint2", (a, b), (cy - 0.62, cy + 0.72), (c, d), sub=2.0)
    p.bx("paint2", (cx0, cx1), (cy - 0.62, cy + 0.72), (cz0 - 0.14, cz0), sub=2.0)
    p.bx("paint2", (cx1, cx1 + 0.14), (cy - 0.62, cy + 0.72), (cz0 - 0.14, 9.0), sub=2.0)
    p.bx("paint", (cx0, cx1), (cy - 0.4, cy - 0.15), (cz0 - 0.15, cz0 - 0.13), tint=1.0)
    # underside beams + light strips
    for x in (-5.0, -1.5, 2.0, 5.5, 9.0):
        p.beam("steel_beam", (x, cy - 0.28, cz0), (x, cy - 0.28, min(cz1, 12.0) if x < 6 else 9.0), 0.22, 0.28)
    for z in (5.0, 8.0, 11.0):
        p.beam("steel_beam", (cx0, cy - 0.18, z), (cx1 if z < 9 else 6.0, cy - 0.18, z), 0.16, 0.18)
    for (x, z) in ((0.5, 5.6), (0.5, 8.4), (4.5, 5.6), (4.5, 8.4), (-2.5, 10.5), (2.0, 11.0)):
        p.bx("metal_dark", (x - 0.7, x + 0.7), (cy - 0.38, cy - 0.28), (z - 0.16, z + 0.16))
        if (x, z) not in ((4.5, 8.4), (0.5, 8.4)):
            p.bx("light_head", (x - 0.62, x + 0.62), (cy - 0.39, cy - 0.375), (z - 0.1, z + 0.1))
    # columns (concrete with paint stripes + base guard)
    for (x, z) in cols:
        p.bx("concrete", (x - 0.28, x + 0.28), (0.12, cy), (z - 0.28, z + 0.28), sub=1.5)
        p.bx("paint2", (x - 0.3, x + 0.3), (0.12, 1.0), (z - 0.3, z + 0.3), sub=1.0)
        p.bx("paint", (x - 0.3, x + 0.3), (1.0, 1.15), (z - 0.3, z + 0.3))
        p.bx("concrete_dark", (x - 0.55, x + 0.55), (0.12, 0.3), (z - 0.55, z + 0.55))
        p.bx("metal_dark", (x - 0.35, x + 0.35), (cy - 0.6, cy), (z - 0.35, z + 0.35))
        # gusset brackets
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p.beam("steel_beam", (x + dx * 0.28, cy - 0.7, z + dz * 0.28), (x + dx * 0.9, cy - 0.28, z + dz * 0.9), 0.1, 0.05, up=(dz, 0, dx)) if False else None
    # ---- pump islands + pumps
    for xi in (0.5, 4.5):
        p.bx("concrete", (xi - 0.6, xi + 0.6), (0.12, 0.33), (5.0, 10.0), sub=2.0)
        p.bx("paint", (xi - 0.6, xi + 0.6), (0.33, 0.345), (4.99, 10.01), tint=0.9) if False else None
        for zz in (5.0, 10.0):
            p.tube("paint2", (xi, 0.33, zz), (xi, 1.15, zz), 0.11, sides=8)
            p.cyl("paint2", (xi, 1.17, zz), 0.13, 0.05, "y", sides=8)
    intact = {(0.5, 6.6): 1, (0.5, 8.6): 1, (4.5, 6.6): 1, (4.5, 8.6): 0}
    for (xi, zz), ok in intact.items():
        p.bx("metal_dark", (xi - 0.3, xi + 0.3), (0.33, 0.42), (zz - 0.52, zz + 0.52))
        p.bx("paint", (xi - 0.24, xi + 0.24), (0.42, 1.55), (zz - 0.45, zz + 0.45), sub=1.2)
        p.bx("paint2", (xi - 0.27, xi + 0.27), (1.55, 2.02), (zz - 0.48, zz + 0.48))
        p.bx("metal_dark", (xi - 0.29, xi + 0.29), (1.5, 1.56), (zz - 0.5, zz + 0.5))
        for s_ in (-1, 1):
            xf_ = xi + s_ * 0.28
            p.bx("metal_dark", (xf_ - 0.02, xf_ + 0.02), (1.25, 1.42), (zz - 0.3, zz + 0.3), tint=0.9) if False else None
            p.box("glass", (xi + s_ * 0.275, 1.72, zz), (0.02, 0.2, 0.6))
            p.box("light_amber" if ok else "metal_dark", (xi + s_ * 0.285, 1.72, zz), (0.012, 0.14, 0.5))
            # nozzle boot + nozzle
            p.bx("metal_dark", (xi + s_ * 0.24 - (0.0 if s_ > 0 else 0.1), xi + s_ * 0.24 + (0.1 if s_ > 0 else 0.0)), (1.1, 1.3), (zz + 0.36, zz + 0.44))
            if ok:
                p.tube("rubber", (xi + s_ * 0.3, 1.25, zz + 0.4), (xi + s_ * 0.42, 1.05, zz + 0.4), 0.02, sides=5)
                p.tube("rubber", (xi + s_ * 0.42, 1.05, zz + 0.4), (xi + s_ * 0.45, 0.7, zz + 0.32), 0.02, sides=5)
                p.tube("rubber", (xi + s_ * 0.45, 0.7, zz + 0.32), (xi + s_ * 0.36, 0.5, zz + 0.2), 0.02, sides=5)
            else:
                p.tube("rubber", (xi + s_ * 0.3, 1.25, zz + 0.4), (xi + s_ * 0.6, 0.6, zz + 0.9), 0.02, sides=5)
                p.tube("rubber", (xi + s_ * 0.6, 0.15, zz + 0.9), (xi + s_ * 0.9, 0.14, zz + 1.6), 0.02, sides=5)
    # bollards
    for (x, z) in ((-2.3, 3.6), (-0.6, 3.6), (1.6, 3.6), (3.4, 3.6), (5.6, 3.6), (0.5, 10.9), (4.5, 10.9), (9.0, 6.5)):
        p.tube("paint2", (x, 0.12, z), (x, 1.0, z), 0.09, sides=6)
    # ---- price sign pole (x=11.6, z=13.2)
    sxp, szp = 11.6, 13.3
    p.cyl("concrete_dark", (sxp, 0.35, szp), 0.5, 0.5, "y", sides=8)
    p.tube("metal_dark", (sxp, 0.6, szp), (sxp, 8.6, szp), 0.2, sides=8, r2=0.16)
    p.bx("paint2", (sxp - 1.7, sxp + 1.7), (7.0, 10.1), (szp - 0.22, szp + 0.22), sub=1.5)
    p.bx("metal_dark", (sxp - 1.78, sxp + 1.78), (6.94, 7.06), (szp - 0.27, szp + 0.27))
    p.bx("metal_dark", (sxp - 1.78, sxp + 1.78), (10.04, 10.16), (szp - 0.27, szp + 0.27))
    p.bx("paint", (sxp - 1.45, sxp + 1.45), (8.75, 9.85), (szp + 0.22, szp + 0.24), sub=1.5)
    p.bx("paint", (sxp - 1.45, sxp + 1.45), (8.75, 9.85), (szp - 0.24, szp - 0.22), sub=1.5)
    for face in ("pz", "nz"):
        letters(p, "GAS", sxp, 8.9, szp + (0.24 if face == "pz" else -0.24), 0.8, "light_amber", face, depth=0.06)
        for r, price in enumerate(("3.49", "4.09") if face == "pz" else ()):
            y = 7.15 + (2 - r * 2) * 0.5
            p.bx("metal_dark", (sxp - 1.4, sxp + 1.4), (y - 0.02, y + 0.42), (szp + 0.22, szp + 0.235) if face == "pz" else (szp - 0.235, szp - 0.22))
            letters(p, price, sxp + 0.6, y + 0.04, szp + (0.235 if face == "pz" else -0.235), 0.33, "light_amber" if r != 1 else "metal_dark", face, depth=0.03, gap=0.7)
    p.socket("sign_light", (sxp, 9.0, szp))
    # ---- collision
    p.cbx((sx0, sx1), (0, sh + 0.85), (sz0, sz1))
    for (x, z) in cols:
        p.cbx((x - 0.32, x + 0.32), (0, cy), (z - 0.32, z + 0.32))
    p.cbx((cx0, cx1), (cy - 0.6, cy + 0.72), (cz0, cz1))
    for xi in (0.5, 4.5):
        p.cbx((xi - 0.6, xi + 0.6), (0, 2.05), (5.0, 10.0))
    p.cbx((sxp - 0.25, sxp + 0.25), (0, 10.1), (szp - 0.25, szp + 0.25))
    p.cbx((sxp - 1.7, sxp + 1.7), (7.0, 10.1), (szp - 0.25, szp + 0.25))
    p.cbx((-12.4, -9.9), (0, 1.4), (-5.6, -4.4))
    p.socket("pump_0", (0.5, 0.33, 6.6))
    p.socket("pump_1", (0.5, 0.33, 8.6))
    p.socket("pump_2", (4.5, 0.33, 6.6))
    p.socket("pump_3", (4.5, 0.33, 8.6))
    return p


import bld_outpost_containers as _ctn
import bld_outpost_diner as _dn
import bld_outpost_motel as _mt
import bld_outpost_warehouse as _wh
import bld_outpost_raider as _rd
import bld_outpost_barn as _bn
BUILDERS = {"barn_ruin": _bn.barn_ruin, "watchtower": _rd.watchtower, "shanty_hut": _rd.shanty_hut, "raider_camp_tent": _rd.raider_camp_tent, "warehouse": _wh.warehouse, "motel": _mt.motel, "diner": _dn.diner, "gas_station": gas_station, "shipping_container": _ctn.shipping_container, "shipping_container_stack3": _ctn.shipping_container_stack3}

if __name__ == "__main__":
    only = os.environ.get("ONLY", "")
    for k, f in BUILDERS.items():
        if only in ("", k):
            pp = f()
            pp.build()
