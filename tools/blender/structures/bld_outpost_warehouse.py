"""warehouse (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *
from bld_outpost_diner import dune


def warehouse():
    p = Piece("warehouse", seed=71, ground_y=0.0, dirt_h=1.6, dirt_amt=0.55, ao_dist=4.0, noise_amt=0.35)
    rj = random.Random(11)
    p.notes = dict(desc="Steel-frame corrugated warehouse 30 x 18 m, eaves 6.5 m / ridge 8.3 m. Front (3 roll-up doors + pedestrian door) faces +Z; ruined: torn front-left corner, missing roof sheets, collapsed door. Cladding = `paint` (tintable), roof = metal_bare, rust patches. Yard clutter around.",
                   footprint=[34, 24], front="+Z", eave=6.5, ridge=8.3)
    W, D, E, R = 15.0, 9.0, 6.5, 8.3
    # yard slab
    p.bx("concrete_dark", (-W - 3, W + 3), (0, 0.1), (-D - 2, D + 6.5), sub=4.0)
    for (x, z, w, d) in ((-7, 12, 4.0, 2.2), (1, 13.5, 3.0, 1.6), (10, 11.5, 2.4, 3.0)):
        p.quad("asphalt", (x - w / 2, 0.106, z - d / 2), (x - w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z + d / 2), (x + w / 2, 0.106, z - d / 2), tint=0.55)
    # plinth
    p.bx("concrete", (-W - 0.15, W + 0.15), (0.1, 1.2), (-D - 0.15, D + 0.15), sub=3.5, skip=("ny",))
    # interior floor + dark
    p.bx("concrete_dark", (-W, W), (1.15, 1.22), (-D, D), sub=5.0)
    # ---- portal frames (steel) : columns + rafters
    fx = [-W + 0.4 + i * (2 * W - 0.8) / 5 for i in range(6)]
    for x in fx:
        for s in (-1, 1):
            p.bx("steel_beam", (x - 0.16, x + 0.16), (1.2, E), (s * D - 0.16 if s < 0 else s * D - 0.3, s * D + 0.3 if s > 0 else s * D + 0.16))
        p.beam("steel_beam", (x, E, -D), (x, R, 0), 0.22, 0.4, up=(1, 0, 0))
        p.beam("steel_beam", (x, R, 0), (x, E, D), 0.22, 0.4, up=(1, 0, 0))
        p.beam("steel_beam", (x, E - 0.7, -D + 0.3), (x, R - 0.6, 0), 0.12, 0.12, up=(1, 0, 0))
    # purlins
    for s in (-1, 1):
        for zi in (0.0, 3.0, 6.0, 9.0):
            y = R - (R - E) * zi / D - 0.1
            p.bx("steel_beam", (-W - 0.2, W + 0.2), (y - 0.08, y + 0.08), (s * zi - 0.05, s * zi + 0.05))
    # ---- cladding: back wall, end walls, front wall pieces
    cl = "paint"
    corr_wall_z(p, cl, -D - 0.02, -1, 1.2, E, -W, W, pitch=0.5, depth=0.075, shape="tri")
    for s in (-1, 1):
        sx = s * (W + 0.02)
        if s < 0:
            # torn left end wall: only part remains
            corr_wall_x(p, cl, sx, -1, 1.2, E, -D, 2.0, pitch=0.5, depth=0.075, shape="tri")
            corr_wall_x(p, cl, sx, -1, 4.6, E, 2.0, D, pitch=0.5, depth=0.075, shape="tri")
            corr_wall_x(p, cl, sx, -1, 1.2, 3.0, 5.0, D, pitch=0.5, depth=0.075, shape="tri")
        else:
            corr_wall_x(p, cl, sx, 1, 1.2, E, -D, D, pitch=0.5, depth=0.075, shape="tri")
        # gable triangle
        tri = [(-D, E), (D, E), (0, R)]
        p.extrude_x(cl, orient_ccw(tri), sx - (0.05 if s > 0 else 0.05), sx + (0.05 if s > 0 else 0.05), flat=True)
    door_spans = [(-10.2, -5.8), (-3.2, 1.2), (3.8, 8.2)]
    ped = (10.8, 11.8)
    zf = D + 0.02
    cuts = [(-W, -10.2), (-5.8, -3.2), (1.2, 3.8), (8.2, 10.8), (11.8, W)]
    for (a, b) in cuts:
        if a < -13:
            # torn corner: broken cladding, only the lower/upper part left
            corr_wall_z(p, cl, zf, 1, 1.2, 2.6, -13.2, b, pitch=0.5, depth=0.075, shape="tri")
            corr_wall_z(p, cl, zf, 1, 5.0, E, -W, b, pitch=0.5, depth=0.075, shape="tri")
            corr_wall_z(p, cl, zf, 1, 2.6, E, -12.0, b, pitch=0.5, depth=0.075, shape="tri") if False else None
        else:
            corr_wall_z(p, cl, zf, 1, 1.2, E, a, b, pitch=0.5, depth=0.075, shape="tri")
    for (a, b) in door_spans:
        corr_wall_z(p, cl, zf, 1, 4.7, E, a, b, pitch=0.5, depth=0.075, shape="tri")
    corr_wall_z(p, cl, zf, 1, 2.6, E, ped[0], ped[1], pitch=0.5, depth=0.075, shape="tri")
    # torn edge sheet hanging from the corner
    p.box("paint", (-13.9, 3.7, zf + 0.9), (2.4, 0.06, 3.0), rot=(-32, 0, 0), tint=0.85)
    p.box("paint", (-12.2, 3.2, zf + 0.6), (1.5, 0.06, 2.4), rot=(-20, 0, 8), tint=0.8)
    # roll-up doors: slats (vertex-colour stripes), one open with coil, one crushed
    for k, (a, b) in enumerate(door_spans):
        h = 4.6
        top = 1.2 + h
        if k == 1:
            # half-open
            striped(p, "metal_dark", "z", a, b, 1.2 + 2.3, top, zf - 0.25, 6, vertical=False)
            p.bx("metal_dark", (a, b), (1.2, top), (zf - 0.65, zf - 0.6), skip=("pz",), tint=0.4)     # dark interior curtain
            p.cyl("metal_dark", ((a + b) / 2, top + 0.1, zf - 0.3), 0.32, b - a, "x", sides=8)
        elif k == 2:
            striped(p, "metal_dark", "z", a, b, 1.2, top, zf - 0.25, 12, vertical=False)
            p.box("metal_dark", ((a + b) / 2, 1.2 + 1.3, zf + 0.35), (b - a - 0.3, 0.12, 2.6), rot=(-14, 0, 0), tint=0.8) if False else None
        else:
            striped(p, "metal_dark", "z", a, b, 1.2, top, zf - 0.25, 12, vertical=False)
        for xx in (a, b):
            p.bx("metal_dark", (xx - 0.12, xx + 0.12), (1.2, top + 0.2), (zf - 0.3, zf + 0.12))
        p.bx("metal_dark", (a - 0.12, b + 0.12), (top, top + 0.25), (zf - 0.3, zf + 0.12))
        p.bx("concrete", (a - 0.2, b + 0.2), (0.1, 1.2), (zf, zf + 0.9), sub=3.0)
    # pedestrian door
    p.bx("paint2", (ped[0] + 0.05, ped[1] - 0.05), (1.2, 3.5), (zf - 0.18, zf - 0.12), tint=0.9)
    p.bx("metal_dark", (ped[0], ped[0] + 0.08), (1.2, 3.6), (zf - 0.2, zf + 0.1))
    p.bx("metal_dark", (ped[1] - 0.08, ped[1]), (1.2, 3.6), (zf - 0.2, zf + 0.1))
    p.bx("metal_dark", (ped[0], ped[1]), (3.5, 3.6), (zf - 0.2, zf + 0.1))
    p.bx("concrete", (ped[0] - 0.4, ped[1] + 0.4), (0.1, 1.2), (zf, zf + 1.4), sub=3.0)
    # high windows on the back and sides (grimy, some gone)
    for i in range(7):
        x = -12.5 + i * 4.0
        p.quad("glass", (x - 0.7, 4.7, -D - 0.06), (x + 0.7, 4.7, -D - 0.06), (x + 0.7, 5.8, -D - 0.06), (x - 0.7, 5.8, -D - 0.06)) if i not in (2, 5) else None
        p.bx("metal_dark", (x - 0.75, x + 0.75), (4.65, 4.72), (-D - 0.1, -D - 0.02))
        p.bx("metal_dark", (x - 0.75, x + 0.75), (5.8, 5.87), (-D - 0.1, -D - 0.02))
    # rust patches on cladding
    for _ in range(9):
        x = rj.uniform(-14, 14)
        w, h = rj.uniform(0.8, 2.4), rj.uniform(0.5, 1.6)
        if any(a - 0.5 < x < b + 0.5 for a, b in door_spans):
            continue
        y = rj.uniform(1.4, E - 1.0)
        p.bx("rust", (x - w / 2, x + w / 2), (y, y + h), (zf + 0.075, zf + 0.085), tint=rj.uniform(0.8, 1.0))
    # ---- roof panels (3 m grid) with holes
    holes = {(1, 2, 0), (1, 3, 0), (1, 3, 1), (1, 4, 0), (-1, 7, 1), (-1, 8, 1), (-1, 8, 0)}
    n_cols = 10
    theta = math.degrees(math.atan((R - E) / D))
    rowlen = math.hypot(D, R - E) / 3.0
    for s in (-1, 1):
        for row in range(3):
            zc = (row + 0.5) * 3.0
            y = R - (R - E) * zc / D + 0.03
            for c in range(n_cols):
                if (s, c, row) in holes:
                    continue
                x = -W + (c + 0.5) * (2 * W / n_cols)
                extra = 0.6 if row == 2 else 0.0
                tint = rj.uniform(0.75, 1.0)
                if (s, c + 1, row) in holes or (s, c - 1, row) in holes:
                    rot = (s * theta + rj.uniform(-6, 6), 0, rj.uniform(-3, 3))     # curled damaged neighbours
                else:
                    rot = (s * theta, 0, 0)
                p.box("metal_bare", (x, y, s * (zc + extra / 2)), (2 * W / n_cols - 0.04, 0.07, rowlen + extra), rot=rot, tint=tint, skip=("ny",), sub=3.0)
    # ridge cap
    p.bx("metal_bare", (-W - 0.3, W + 0.3), (R - 0.02, R + 0.16), (-0.4, 0.4), skip=("ny",), sub=6.0)
    # fallen roof sheets in the yard
    p.box("metal_bare", (-5.5, 0.65, D + 4.6), (2.9, 0.07, 3.0), rot=(-18, 20, 6), tint=0.7)
    p.box("metal_bare", (-3.3, 0.14, D + 3.2), (2.9, 0.07, 3.0), rot=(0, -12, 3), tint=0.6)
    # ---- interior racks visible through the torn corner
    for x in (-13.0, -11.0):
        for lvl in range(3):
            p.bx("metal_dark", (x - 0.9, x + 0.9), (1.4 + lvl * 1.4, 1.5 + lvl * 1.4), (2.0, 5.0)) if x > -100 else None
        for zz in (2.0, 5.0):
            p.bx("metal_dark", (x - 0.9, x - 0.85), (1.2, 5.6), (zz - 0.05, zz + 0.05))
            p.bx("metal_dark", (x + 0.85, x + 0.9), (1.2, 5.6), (zz - 0.05, zz + 0.05))
    # ---- yard clutter: pallets, crates, drums, tank, tyres, loading platform, generator
    p.bx("concrete", (W - 0.2, W + 3.0), (0.1, 1.25), (-4.0, 3.0), sub=2.5)
    p.bx("metal_dark", (W - 0.2, W + 0.1), (1.25, 1.5), (-4.0, 3.0))
    for k in range(4):
        p.bx("wood", (-2.0 + k * 1.3 - 0.55, -2.0 + k * 1.3 + 0.55), (0.1, 0.24), (D + 3.3 - 0.55, D + 3.3 + 0.55), rot=None, tint=rj.uniform(0.7, 1.0)) if False else None
    for i in range(3):
        for j in range(2):
            p.bx("wood", (4 + i * 1.3, 4 + i * 1.3 + 1.2), (0.1 + j * 0.16, 0.24 + j * 0.16), (D + 2.5, D + 3.7), tint=rj.uniform(0.7, 1.0))
    crate(p, 8.5, D + 3.5, 0.1, 1.0, rot=12)
    crate(p, 9.7, D + 3.2, 0.1, 0.8, rot=-8)
    crate(p, 9.0, D + 3.4, 1.1, 0.7, rot=30)
    for (x, z) in ((-9, D + 2.5), (-8.3, D + 2.8), (-8.7, D + 3.5), (13.0, D + 1.5)):
        barrel(p, x, z, 0.1, mat="rust" if x > -8.5 else "metal_dark")
    p.cyl("metal_bare", (-W - 2.3, 2.0, -3.0), 1.6, 3.6, "y", sides=12)        # storage tank
    p.cyl("metal_dark", (-W - 2.3, 3.85, -3.0), 1.65, 0.1, "y", sides=12)
    for a in (-1, 1):
        p.tube("metal_dark", (-W - 2.3 + a * 1.2, 0.1, -3.0 + a * 0.8), (-W - 2.3 + a * 1.2, 0.5, -3.0 + a * 0.8), 0.08, sides=4, smooth=False)
    p.tube("metal_dark", (-W - 0.7, 0.9, -3.0), (-W - 1.5, 0.9, -3.0), 0.1, sides=6)
    p.bx("metal_dark", (-W - 2.6, -W - 1.4), (0.1, 1.0), (D - 1.5, D + 0.2), sub=2.0)     # generator box
    tyre_stack(p, -W - 1.2, D + 2.0, 4, 0.1, seed=12)
    tyre_stack(p, -W - 0.6, D + 2.7, 3, 0.1, seed=13)
    # pole lamp at the front
    p.tube("metal_dark", (12.5, 0.1, D + 4.0), (12.5, 8.0, D + 4.0), 0.1, sides=6, r2=0.07)
    p.bx("metal_dark", (11.7, 12.5), (8.0, 8.1), (D + 3.85, D + 4.15))
    p.bx("light_head", (11.75, 12.4), (7.95, 7.985), (D + 3.9, D + 4.1))
    p.socket("yard_lamp", (12.1, 7.9, D + 4.0))
    dune(p, W - 4, W + 3, -D - 2.5, -D + 1.5, 1.1)
    dune(p, -W - 4, -W + 3, D + 0.5, D + 4.5, 0.8)
    # ---- collision
    p.cbx((-W - 0.3, W + 0.3), (0, R + 0.2), (-D - 0.3, D + 0.3))
    p.cbx((W - 0.2, W + 3.0), (0, 1.5), (-4.0, 3.0))
    p.chull([(-W - 3.9, 0, -4.6), (-W - 0.7, 0, -4.6), (-W - 3.9, 3.9, -4.6), (-W - 0.7, 3.9, -4.6), (-W - 3.9, 0, -1.4), (-W - 0.7, 0, -1.4), (-W - 3.9, 3.9, -1.4), (-W - 0.7, 3.9, -1.4)])
    return p
