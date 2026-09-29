"""motel + warehouse (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *
from bld_outpost_diner import dune


def _wing(p, widths, depth=6.0, h=3.0, damage=(), open_doors=(), broken=(), seed=1, roof_hole=None):
    """Motel wing in local frame: rooms along +X starting at x=0, front (doors) faces +Z at z=0, back wall at z=-depth.
    Walkway slab + canopy z in [0, 1.7]."""
    rr = random.Random(seed)
    L = sum(widths)
    xs = [0.0]
    for w in widths:
        xs.append(xs[-1] + w)
    # plinth + walkway slab
    p.bx("concrete_dark", (-0.3, L + 0.3), (0, 0.3), (-depth - 0.3, 1.9), sub=9.0, skip=("ny",))
    # front wall openings
    opens = []
    for i, w in enumerate(widths):
        x0 = xs[i]
        if w > 5:   # office: wide window + door
            opens += [(x0 + 0.6, x0 + 1.6, 0.3, 2.5), (x0 + 2.4, x0 + w - 0.5, 0.95, 2.4)]
        else:
            opens += [(x0 + 0.55, x0 + 1.55, 0.3, 2.5), (x0 + 2.4, x0 + 3.6, 0.95, 2.3)]
    wall_with_openings(p, "concrete", "z", -0.15, 0.3, 0, L, 0.3, h, opens, sub=6.0)
    wall_with_openings(p, "concrete", "z", -depth + 0.15, 0.3, 0, L, 0.3, h, [], sub=9.0)
    for xw in (0.0, L):
        p.bx("concrete", (xw - 0.15, xw + 0.15), (0.3, h), (-depth, 0), sub=6.0)
    # partitions
    for x in xs[1:-1]:
        p.bx("concrete_dark", (x - 0.07, x + 0.07), (0.3, h), (-depth + 0.3, -0.3), sub=6.0)
    p.bx("concrete_dark", (0, L), (0.3, 0.36), (-depth, 0), sub=9.0)          # floor
    # base band + fascia
    p.bx("concrete_dark", (-0.05, L + 0.05), (0.3, 0.85), (-0.02, 0.06), sub=6.0)
    # roof + canopy + fascia
    roof_y = h
    if roof_hole:
        a, b = roof_hole
        p.bx("concrete_dark", (-0.4, a), (roof_y, roof_y + 0.25), (-depth - 0.3, 1.9), sub=6.0, skip=("ny",))
        p.bx("concrete_dark", (b, L + 0.4), (roof_y, roof_y + 0.25), (-depth - 0.3, 1.9), sub=6.0, skip=("ny",))
        p.bx("concrete_dark", (a, b), (roof_y, roof_y + 0.25), (1.0, 1.9), sub=6.0, skip=("ny",))
        p.bx("concrete_dark", (a, b), (roof_y, roof_y + 0.25), (-depth - 0.3, -depth + 1.0), sub=6.0, skip=("ny",))
        for k in range(5):
            x = a + 0.3 + k * (b - a - 0.6) / 4
            p.beam("wood", (x, roof_y - 0.05, -depth), (x, roof_y - 0.05, 0.6), 0.14, 0.22)
        p.box("concrete_dark", ((a + b) / 2, roof_y - 1.0, -1.6), (b - a - 0.4, 0.2, 2.6), rot=(-28, 0, 0))
        for k in range(4):
            zz = -depth + 0.5 + k * 1.2
            p.tube("rebar", (a, roof_y - 0.05, zz), (a - 0.25, roof_y - 0.5, zz), 0.014, sides=5)
    else:
        p.bx("concrete_dark", (-0.4, L + 0.4), (roof_y, roof_y + 0.25), (-depth - 0.3, 1.9), sub=9.0, skip=("ny",))
    p.bx("paint2", (-0.4, L + 0.4), (roof_y - 0.3, roof_y + 0.3), (1.9, 2.0), sub=9.0)
    p.bx("paint2", (-0.4, L + 0.4), (roof_y - 0.05, roof_y + 0.32), (-depth - 0.3, -depth - 0.2), sub=9.0)
    for xw in (-0.4, L + 0.3):
        p.bx("paint2", (xw, xw + 0.1), (roof_y - 0.05, roof_y + 0.32), (-depth - 0.3, 2.0), sub=9.0)
    # canopy posts
    for i in range(len(widths) + 1):
        x = xs[i] if i < len(widths) else L
        x = min(max(x, 0.2), L - 0.2)
        p.tube("metal_dark", (x, 0.3, 1.6), (x, roof_y, 1.6), 0.06, sides=4, smooth=False)
    # doors / windows
    for i, w in enumerate(widths):
        x0 = xs[i]
        dx0, dx1 = (x0 + 0.6, x0 + 1.6) if w > 5 else (x0 + 0.55, x0 + 1.55)
        wa, wb = (x0 + 2.4, x0 + w - 0.5) if w > 5 else (x0 + 2.4, x0 + 3.6)
        # window frame + glass
        slat_glass(p, wa, wb, 0.95, 2.3 if w < 5 else 2.4, -0.15, n=1 if w < 5 else 3, broken=((0,) if (i in broken) else ()) + ((1,) if i in damage else ()), glass_z_off=0.0, mull=0.04)
        p.bx("concrete_dark", (wa - 0.1, wb + 0.1), (0.88, 0.95), (-0.1, 0.18), sub=2.0)
        # door
        if i in open_doors:
            hx = dx0
            p.box("paint", (hx + 0.1, 1.4, 0.55), (0.98, 2.1, 0.05), rot=(0, -72, 0), tint=0.95)
        else:
            p.bx("paint", (dx0 + 0.04, dx1 - 0.04), (0.32, 2.46), (-0.22, -0.16), sub=2.0, tint=0.95)
            p.bx("paint2", (dx0 + 0.3, dx0 + 0.6), (1.85, 2.0), (-0.16, -0.14))   # room number plate
            p.bx("metal_bare", (dx1 - 0.2, dx1 - 0.12), (1.0, 1.06), (-0.16, -0.08))
        p.bx("metal_dark", (dx0 - 0.06, dx0 + 0.04), (0.3, 2.55), (-0.25, -0.05))
        p.bx("metal_dark", (dx1 - 0.04, dx1 + 0.06), (0.3, 2.55), (-0.25, -0.05))
        p.bx("metal_dark", (dx0 - 0.06, dx1 + 0.06), (2.46, 2.56), (-0.25, -0.05))
        # PTAC / wall AC under some windows
        if w < 5 and i % 2 == 0:
            p.bx("metal_bare", (wa + 0.1, wb - 0.1), (0.45, 0.85), (-0.05, 0.3), sub=1.5)

        # interior: bed + bedside
        if w < 5 and i % 2 == 0:
            p.bx("paint2", (x0 + 1.0, x0 + 3.0), (0.36, 0.75), (-4.6, -2.6), sub=1.5, tint=0.8)
    # rooftop kit
    for i in range(0, len(widths), 3):
        ac_unit(p, xs[i] + 2.0, roof_y + 0.25, -depth * 0.45, 1.3, 1.0, 0.8, rot=rr.uniform(-10, 10))
    p.tube("metal_dark", (L * 0.7, roof_y + 0.25, -depth + 1.0), (L * 0.7, roof_y + 1.8, -depth + 1.0), 0.09, sides=6)
    return xs


def _pool(p, x0, x1, z0, z1, depth=1.6):
    """Empty-ish pool with murky water pool at the deep end, coping and a chain-link-ish fence."""
    w = 0.6
    # coping (4 slabs around the pit)
    p.bx("concrete", (x0 - w, x1 + w), (0, 0.14), (z0 - w, z0), sub=6.0)
    p.bx("concrete", (x0 - w, x1 + w), (0, 0.14), (z1, z1 + w), sub=6.0)
    p.bx("concrete", (x0 - w, x0), (0, 0.14), (z0, z1), sub=6.0)
    p.bx("concrete", (x1, x1 + w), (0, 0.14), (z0, z1), sub=6.0)
    # pit walls (inner faces) + sloping floor
    p.bx("concrete_dark", (x0, x1), (-depth, 0), (z0 - 0.01, z0 + 0.01), skip=("py", "ny"))
    for (a, b) in ((z0, z0 + 0.05), (z1 - 0.05, z1)):
        p.bx("paint2", (x0, x1), (-depth, 0.0), (a, b), tint=0.7, sub=6.0)
    for (a, b) in ((x0, x0 + 0.05), (x1 - 0.05, x1)):
        p.bx("paint2", (a, b), (-depth, 0.0), (z0, z1), tint=0.7, sub=6.0)
    prof = [(z0, -0.9), (z1, -depth), (z1, -depth - 0.3), (z0, -1.2)]
    p.extrude_x("concrete_dark", orient_ccw([(z0, -0.9), (z0 + (z1 - z0) * 0.45, -0.95), (z1, -depth), (z1, -depth - 0.2), (z0, -1.1)]), x0, x1, sub=2.0)
    # murky water in the deep end
    p.quad("water_dark", (x0 + 0.05, -1.25, z0 + (z1 - z0) * 0.55), (x1 - 0.05, -1.25, z0 + (z1 - z0) * 0.55), (x1 - 0.05, -1.25, z1 - 0.05), (x0 + 0.05, -1.25, z1 - 0.05))
    # ladder
    for s in (-1, 1):
        p.tube("metal_bare", (x0 + 1.0 + s * 0.22, 0.6, z1 - 0.15), (x0 + 1.0 + s * 0.22, -0.5, z1 - 0.15), 0.025, sides=5, smooth=False)
    # fence
    fx0, fx1, fz0, fz1 = x0 - w - 0.6, x1 + w + 0.6, z0 - w - 0.6, z1 + w + 0.6
    posts = []
    n = 5
    for i in range(n + 1):
        x = fx0 + (fx1 - fx0) * i / n
        posts += [(x, fz0), (x, fz1)]
    for i in range(1, 4):
        z = fz0 + (fz1 - fz0) * i / 4
        posts += [(fx0, z), (fx1, z)]
    for (x, z) in posts:
        p.tube("metal_dark", (x, 0.0, z), (x, 1.4, z), 0.03, sides=4, smooth=False)
    for y in (0.35, 1.38):
        for (a, b) in (((fx0, fz0), (fx1, fz0)), ((fx0, fz1), (fx1, fz1)), ((fx0, fz0), (fx0, fz1)), ((fx1, fz0), (fx1, fz1))):
            if y == 0.35 and False:
                continue
            p.tube("metal_dark", (a[0], y, a[1]), (b[0], y, b[1]), 0.02, sides=4, smooth=False)
    # loungers
    for k in range(2):
        p.box("metal_bare", (x0 + 1.5 + k * 1.3, 0.32, z1 + w + 0.3), (0.6, 0.06, 1.7), rot=(0, 0, 0))
        p.box("paint2", (x0 + 1.5 + k * 1.3, 0.34, z1 + w + 0.3), (0.55, 0.05, 1.6), rot=(12 if k == 1 else 0, 0, 0), tint=0.8)
    p.cbx((fx0, fx1), (0, 0.5), (fz0, fz1)) if False else None


def motel():
    p = Piece("motel", seed=61, ground_y=0.0, dirt_h=1.3, dirt_amt=0.5, ao_dist=3.0)
    p.notes = dict(desc="L-shaped single-storey motel: wing A (rooms, doors face +Z into the courtyard) + wing B (office + rooms, doors face -X), walkway canopies, empty pool with fence, pole sign MOTEL/VACANCY. Wing B has a collapsed roof section. Front faces +Z, courtyard opens toward +Z/-X. Footprint ~31 x 23 m. paint = doors (tint), paint2 = fascia/trim (tint).",
                   footprint=[31, 23], front="+Z")
    # apron
    p.bx("concrete_dark", (-15, 17), (0, 0.1), (-9, 16), sub=4.0)
    for (x, z, w, d) in ((-4, 10, 2.4, 1.8), (-11, 8, 3.0, 2.0), (4, 12, 2.0, 1.4)):
        p.quad("asphalt", (x - w / 2, 0.106, z - d / 2), (x - w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z - d / 2), tint=0.55)
    # wing A (x -14..10), z -8..-2 : local x = game x + 14, local z = game z + 2
    xform_block(p, Matrix.Translation((-14, 0, -2)), lambda: _wing(p, [4, 4, 4, 4, 4, 4], depth=6.0, damage={2}, open_doors={3}, broken={0, 5}, seed=1))
    # wing B along +Z at x=10..16 (doors face -X)
    M = Matrix.Translation((10, 0, -8)) @ xf((0, 0, 0), (0, -90, 0))
    xform_block(p, M, lambda: _wing(p, [6, 4, 4, 4, 4], depth=6.0, damage={1}, open_doors={2}, broken={4}, seed=2, roof_hole=(8.5, 14.5)))
    # pool in the courtyard
    _pool(p, -8.0, 0.0, 3.5, 7.5)
    # sign pole: MOTEL + VACANCY
    sx_, sz_ = -12.0, 13.0
    p.cyl("concrete_dark", (sx_, 0.4, sz_), 0.6, 0.6, "y", sides=8)
    p.tube("metal_dark", (sx_, 0.7, sz_), (sx_, 8.8, sz_), 0.2, sides=8, r2=0.16)
    p.bx("paint", (sx_ - 2.6, sx_ + 2.6), (6.3, 9.5), (sz_ - 0.2, sz_ + 0.2), sub=1.5)
    p.bx("metal_dark", (sx_ - 2.7, sx_ + 2.7), (9.45, 9.6), (sz_ - 0.25, sz_ + 0.25))
    p.bx("metal_dark", (sx_ - 2.7, sx_ + 2.7), (6.2, 6.35), (sz_ - 0.25, sz_ + 0.25))
    for face in ("pz", "nz"):
        zf = sz_ + (0.2 if face == "pz" else -0.2)
        letters(p, "MOTEL", sx_, 8.0, zf, 1.2, "light_tail", face, depth=0.12, gap=0.9)
        letters(p, "VACANCY", sx_, 6.55, zf, 0.9, "light_green" if face == "pz" else "metal_dark", face, depth=0.08, gap=0.7)
    p.socket("sign_neon", (sx_, 8.6, sz_))
    # dunes + junk
    dune(p, -15, -9, -9.2, -7.0, 0.9)
    dune(p, 10, 17, 14, 17, 0.6)
    tyre_stack(p, 6.0, 9.5, 3, 0.1, seed=4)
    crate(p, 1.6, 12.0, 0.1, 0.6, rot=20)
    barrel(p, 8.2, 13.0, 0.1)
    # collision
    p.cbx((-14.3, 10.3), (0, 3.4), (-8.3, -0.2))
    p.cbx((9.7, 16.3), (0, 3.4), (-8.3, 14.3))
    p.cbx((sx_ - 0.3, sx_ + 0.3), (0, 9.6), (sz_ - 0.3, sz_ + 0.3))
    p.cbx((sx_ - 2.7, sx_ + 2.7), (6.2, 9.6), (sz_ - 0.25, sz_ + 0.25))
    return p
