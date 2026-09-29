"""barn_ruin (fork B1)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bld_outpost_common import *
from bld_outpost_diner import dune


def barn_ruin():
    p = Piece("barn_ruin", seed=111, ground_y=0.0, dirt_h=1.6, dirt_amt=0.5, ao_dist=3.5, noise_amt=0.35)
    rj = random.Random(51)
    p.notes = dict(desc="Weathered timber barn 15 x 10 m, eaves 5 m / ridge 8.5 m, half collapsed (rear-left roof and walls gone), tin roof with holes, hanging sliding door, hay bales, broken fence. Front (big door) faces +Z. Footprint ~20 x 16 m.",
                   footprint=[20, 16], front="+Z", eave=5.0, ridge=8.5)
    W, D, E, R = 7.5, 5.0, 5.0, 8.5
    wood_t = lambda: rj.uniform(0.75, 1.05)
    # ground / foundation
    blob_pad(p, "dirt_red", 0.0, 0.5, 12.5, 10.5, 0.0, 0.06, n=22, seed=3)
    p.bx("concrete_dark", (-W - 0.2, W + 0.2), (0.06, 0.4), (-D - 0.2, D + 0.2), sub=3.0, skip=("ny",))
    p.bx("wood", (-W, W), (0.38, 0.44), (-D, D), sub=3.0)     # floor boards
    # posts (some leaning / broken) + eave beams
    zs = [-5.0, -2.5, 0.0, 2.5, 5.0]
    for x in (-W, W):
        for k, z in enumerate(zs):
            broken = (x < 0 and z < 0.5)
            h = E - (rj.uniform(1.0, 2.6) if broken else 0.0)
            lean = rj.uniform(-0.25, 0.25) if broken else 0.0
            p.beam("wood", (x, 0.4, z), (x + lean, h, z), 0.3, 0.3, tint=wood_t())
        if x > 0:
            p.beam("wood", (x, E, -D), (x, E, D), 0.25, 0.3, tint=0.9)
    p.beam("wood", (-W, E, 0.5), (-W, E, D), 0.25, 0.3, tint=0.9)
    p.beam("wood", (-W, E - 1.4, -D), (-W + 0.2, E - 2.0, 0.4), 0.25, 0.3, tint=0.85) if False else None
    # interior posts + loft floor (partial)
    for x in (-2.5, 2.5):
        for z in (-2.5, 2.5):
            if x < 0 and z < 0:
                continue
            p.beam("wood", (x, 0.4, z), (x, 3.3, z), 0.26, 0.26, tint=wood_t())
    p.bx("wood", (-W + 0.3, W - 0.3), (3.2, 3.32), (0.6, D - 0.3), sub=2.5, tint=0.9)
    p.bx("wood", (2.2, W - 0.3), (3.2, 3.32), (-D + 0.4, 0.6), sub=2.5, tint=0.85)
    for z in (0.5, 2.5, 4.4):
        p.beam("wood", (-W + 0.3, 3.1, z), (W - 0.3, 3.1, z), 0.2, 0.22, tint=0.9)
    # roof frame: rafters per bay + ridge
    for k, z in enumerate(zs):
        for s in (-1, 1):
            x_e = s * (W + 0.5)
            collapsed = (x_e < 0 and z < 1)
            if collapsed and k < 2:
                # broken rafter stubs and one fallen rafter
                p.beam("wood", (x_e, E - 0.15, z), (x_e * 0.93, E + 0.75, z), 0.16, 0.22, tint=0.8)
                continue
            p.beam("wood", (x_e, E - 0.15, z), (0, R, z), 0.16, 0.24, tint=wood_t())
    p.beam("wood", (-W * 0.4, R + 0.02, -D), (W + 0.6, R + 0.02, -D), 0.16, 0.2, tint=0.9) if False else None
    p.beam("wood", (2.0, R + 0.05, -D), (W + 0.6, R + 0.05, 0.6), 0.16, 0.2, tint=0.9) if False else None
    p.beam("wood", (-W + 0.5, R + 0.05, 0.6), (W + 0.6, R + 0.05, 0.6), 0.16, 0.2, tint=0.9) if False else None
    p.beam("wood", (0, R, -D), (0, R, D), 0.2, 0.2, tint=0.9)
    p.beam("wood", (0, R - 0.05, -D), (0.0, R - 0.05, 0.6), 0.2, 0.2, tint=0.9) if False else None
    # purlins
    theta = math.degrees(math.atan((R - E) / (W + 0.5)))
    for s in (-1, 1):
        for f in (0.25, 0.5, 0.75):
            x = s * (W + 0.5) * (1 - f)
            y = R - (R - E) * (1 - f) * 1.0 - 0.0
            p.bx("wood", (x - 0.06, x + 0.06), (y - 0.12, y + 0.02), (-D - 0.3 if not (s < 0) else 0.7, D + 0.3), tint=0.8)
    # ---- wall boards (panels with vertical batten lines)
    def wall_z(zc, sgn, x0, x1, y0, y1, tilt=0.0, t=None):
        p.bx("wood", (x0, x1), (y0, y1), (zc - 0.06, zc + 0.06), sub=1.6, tint=t if t is not None else wood_t())
        n = max(1, int((x1 - x0) / 1.15))
        for i in range(n + 1):
            x = x0 + (x1 - x0) * i / n
            p.bx("wood", (x - 0.05, x + 0.05), (y0, y1), (zc + sgn * 0.06, zc + sgn * 0.09), tint=0.75)
    def wall_x(xc, sgn, z0, z1, y0, y1, t=None):
        p.bx("wood", (xc - 0.06, xc + 0.06), (y0, y1), (z0, z1), sub=1.6, tint=t if t is not None else wood_t())
        n = max(1, int((z1 - z0) / 1.15))
        for i in range(n + 1):
            z = z0 + (z1 - z0) * i / n
            p.bx("wood", (xc + sgn * 0.06, xc + sgn * 0.09), (y0, y1), (z - 0.05, z + 0.05), tint=0.75)
    # front (z=+D): left/right of the door + header + gable
    wall_z(D, 1, -W, -2.3, 0.44, E)
    wall_z(D, 1, 2.3, W, 0.44, E)
    wall_z(D, 1, -2.3, 2.3, 4.4, E)
    tri = [(-W - 0.3, E), (W + 0.3, E), (0, R + 0.1)]
    p.extrude("wood", orient_ccw(tri), D - 0.05, D + 0.07, flat=True, tint=0.9)
    p.quad("metal_dark", (-0.9, 5.7, D + 0.09), (0.9, 5.7, D + 0.09), (0.9, 7.1, D + 0.09), (-0.9, 7.1, D + 0.09), tint=0.5)   # hayloft opening
    p.bx("wood", (-1.0, 1.0), (5.62, 5.72), (D + 0.08, D + 0.16))
    p.bx("wood", (-1.0, 1.0), (7.1, 7.2), (D + 0.08, D + 0.16))
    for s in (-1, 1):
        p.bx("wood", (s * 0.95 - 0.05, s * 0.95 + 0.05), (5.62, 7.2), (D + 0.08, D + 0.16))
    p.bx("wood", (-0.35, 0.35), (7.2, 8.3), (D + 0.08, D + 0.14), tint=0.9) if False else None
    # sliding doors: left one hanging crooked, right one on the ground
    p.box("wood", (-1.15, 2.2, D + 0.28), (2.3, 4.0, 0.12), rot=(0, 0, 4), tint=0.95)
    p.box("wood", (-1.15, 2.2, D + 0.36), (0.16, 4.0, 0.06), rot=(0, 0, 4), tint=0.7)
    p.box("wood", (-1.15, 0.8, D + 0.36), (2.3, 0.14, 0.06), rot=(0, 0, 4), tint=0.7)
    p.box("wood", (-1.15, 3.6, D + 0.36), (2.3, 0.14, 0.06), rot=(0, 0, 4), tint=0.7)
    p.box("wood", (3.4, 1.0, D + 1.6), (2.3, 3.6, 0.12), rot=(-58, 12, 0), tint=0.9)
    p.tube("metal_dark", (-2.6, 4.75, D + 0.35), (2.6, 4.75, D + 0.35), 0.05, sides=6)     # rail
    for x in (-2.3, -0.4, 1.5):
        p.bx("metal_dark", (x - 0.04, x + 0.04), (4.4, 4.75), (D + 0.3, D + 0.36))
    # right wall (x=+W), three segments with gaps
    wall_x(W, 1, -D, -2.6, 0.44, E)
    wall_x(W, 1, -2.0, 0.6, 0.44, E - 0.8)
    wall_x(W, 1, 1.0, D, 0.44, E)
    # left wall: only the front part remains, leaning outward
    xform_block(p, xf((-W, 0.44, 3.2), (0, 0, 0)) @ Matrix.Rotation(math.radians(7), 4, "Z"), lambda: wall_x(0.0, -1, -1.9, 1.9, 0.0, E - 0.5, t=0.9))
    # back wall (z=-D): only the right part remains + fallen board wall lying
    wall_z(-D, -1, 1.5, W, 0.44, E)
    p.box("wood", (-3.2, 0.7, -D - 2.2), (5.2, 0.12, 3.0), rot=(0, 15, 5), tint=0.85)
    for i in range(5):
        p.bx("wood", (-5.6 + i * 1.1, -5.4 + i * 1.1 + 0.9), (0.06, 0.16), (-D - 3.8, -D - 3.0), tint=wood_t())
    # ---- roof tin (grid) with holes
    holes = {(1, 0, 0), (1, 1, 1), (1, 3, 1), (-1, 0, 0), (-1, 0, 1), (-1, 1, 0), (-1, 1, 1), (-1, 2, 1), (-1, 3, 1), (-1, 4, 1), (-1, 0, 2), (-1, 1, 2), (-1, 2, 2)}
    cols = 5
    rowlen = math.hypot(W + 0.5, R - E) / 3.0
    for s in (-1, 1):
        for row in range(3):
            xc = s * (W + 0.5) * ((row + 0.5) / 3.0)
            y = R - (R - E) * (row + 0.5) / 3.0 + 0.04
            for c in range(cols):
                if (s, c, row) in holes:
                    continue
                zc = -D - 0.3 + (c + 0.5) * (2 * D + 0.6) / cols
                if s < 0 and zc < 0.5 and False:
                    continue
                extra = 0.5 if row == 2 else 0.0
                rot = (0, 0, -s * theta + (rj.uniform(-6, 6) if (s, c + 1, row) in holes or (s, c - 1, row) in holes else 0))
                p.box("rust", (xc + s * extra / 2, y, zc), (rowlen + extra, 0.06, (2 * D + 0.6) / cols - 0.04), rot=rot, tint=rj.uniform(0.7, 1.0), sub=2.5, skip=("ny",))
    p.bx("rust", (-0.15, 0.15), (R + 0.05, R + 0.2), (-D, D), tint=0.7, skip=("ny",)) if False else None
    # fallen sheets + debris pile in the collapsed corner
    p.box("rust", (-4.5, 1.5, -1.5), (3.0, 0.06, 2.8), rot=(0, 0, 32), tint=0.8)
    p.box("rust", (-3.0, 0.6, -3.8), (2.9, 0.06, 2.8), rot=(8, 25, -14), tint=0.7)
    for i in range(6):
        a = rj.uniform(0, 6.28)
        p.beam("wood", (-4.5 + math.cos(a) * 1.2, 0.5 + rj.uniform(0, 0.6), -2.5 + math.sin(a) * 1.5), (-4.5 - math.cos(a) * 1.2, 0.2 + rj.uniform(0, 0.5), -2.5 - math.sin(a) * 1.5), 0.14, 0.2, tint=0.8)
    # ---- hay bales, junk
    for (x, z, y, ry) in ((3.5, -2.8, 0.44, 0), (4.5, -2.8, 0.44, 4), (3.9, -2.8, 0.9, 2), (5.6, 1.6, 0.44, 30), (5.6, 2.6, 0.44, 10), (-5.3, 4.1, 0.44, -5), (4.2, 3.6, 3.32, 10), (5.1, 3.7, 3.32, -8)):
        p.box("sand", (x, y + 0.23, z), (0.95, 0.46, 0.5), rot=(0, ry, 0), tint=(1.05, 0.9, 0.42), bevel=0.04)
    tyre_stack(p, 9.4, 3.0, 3, 0.0, seed=14)
    barrel(p, 9.0, 1.4, 0.0, mat="rust")
    barrel(p, 8.4, 1.0, 0.0)
    p.bx("metal_dark", (8.2, 10.2), (0.0, 0.5), (-2.0, -0.6))               # trough
    p.bx("water_dark", (8.3, 10.1), (0.42, 0.44), (-1.9, -0.7)) if False else None
    # weathervane + cupola
    p.bx("wood", (-0.5, 0.5), (R, R + 0.9), (-0.5, 0.5), tint=0.9, bevel=0.03) if False else None
    p.tube("metal_dark", (0, R + 0.1, 3.2), (0, R + 1.6, 3.2), 0.03, sides=4, smooth=False)
    p.box("metal_dark", (0, R + 1.4, 3.2), (0.9, 0.3, 0.02), rot=(0, 40, 0))
    p.box("metal_dark", (0.35, R + 1.42, 3.2 - 0.0), (0.3, 0.3, 0.02), rot=(0, 40, 0)) if False else None
    # broken fence
    for i in range(7):
        x = -10.0 + i * 3.0
        z = 8.0
        lean = rj.uniform(-0.15, 0.15) if i not in (2, 3) else 0.5
        p.beam("wood", (x, 0.0, z), (x + lean, 1.3, z), 0.12, 0.12, tint=wood_t())
        if i not in (2,):
            p.beam("wood", (x + lean, 1.15, z), (x + 3.0 - (0.5 if i == 3 else 0.0), 1.15 - (0.7 if i == 3 else 0.0), z), 0.06, 0.16, tint=wood_t())
        if i not in (1, 4):
            p.beam("wood", (x + lean, 0.65, z), (x + 3.0, 0.65, z), 0.06, 0.16, tint=wood_t())
    dune(p, -W - 3, -W + 6, -D - 4.5, -D + 1.0, 1.2)
    dune(p, W - 3, W + 4, D + 2.0, D + 6.0, 0.7)
    # collision
    p.cbx((-W - 0.4, W + 0.4), (0, E), (-D - 0.3, D + 0.3))
    p.cbx((-W + 2.0, W + 0.4), (E, R + 0.2), (-D, D)) if False else None
    p.cbx((8.2, 10.2), (0, 0.5), (-2.0, -0.6))
    return p
