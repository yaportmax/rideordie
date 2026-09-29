"""floodlight_tower (single) + boss_arena_lights (4 towers at the corners of a 40 x 60 m rectangle centred on the origin)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *
from dam_gate import darken

ONLY = os.environ.get("ONLY", "")

TOWER_H = 26.0


def floodlight(p, cx, cz, yaw, idx=0, h=TOWER_H):
    """One floodlight tower centred at (cx, cz); the lamp bank faces local +Z rotated by yaw (deg)."""
    hw0, hw1 = 2.1, 0.95
    lat_h = h - 3.5
    levels = lattice_tower(p, "steel_beam", cx, cz, 0.6, lat_h, hw0, hw1, 8, leg=0.13, brace=0.055, stagger=True)
    ytop = 0.6 + lat_h
    # concrete pads + hazard leg feet
    rj = random.Random(idx + 3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.bx("concrete_dark", (cx + sx * hw0 - 0.6, cx + sx * hw0 + 0.6), (0, 0.6), (cz + sz * hw0 - 0.6, cz + sz * hw0 + 0.6), bevel=0.04, tint=0.6)
            for k in range(2):
                y0, y1 = 0.6 + k * 1.2, 0.6 + (k + 1) * 1.2
                f0, f1 = (y0 - 0.6) / lat_h, (y1 - 0.6) / lat_h
                a = (cx + sx * (hw0 + (hw1 - hw0) * f0), y0, cz + sz * (hw0 + (hw1 - hw0) * f0))
                b = (cx + sx * (hw0 + (hw1 - hw0) * f1), y1, cz + sz * (hw0 + (hw1 - hw0) * f1))
                p.tube("hazard", a, b, 0.15, sides=4, smooth=False, tint=yellow(rj) if k == 0 else black(rj))
    # service platform under the lamp bank
    py = ytop
    p.bx("steel_beam", (cx - 1.6, cx + 1.6), (py, py + 0.12), (cz - 1.6, cz + 1.6), tint=0.8)
    for sx in (-1, 1):
        p.tube("metal_dark", (cx + sx * 1.6, py, cz - 1.6), (cx + sx * 1.6, py + 1.05, cz - 1.6), 0.03, sides=4, smooth=False)
        p.tube("metal_dark", (cx + sx * 1.6, py, cz + 1.6), (cx + sx * 1.6, py + 1.05, cz + 1.6), 0.03, sides=4, smooth=False)
    for y in (py + 0.55, py + 1.05):
        for a, b in (((-1.6, -1.6), (1.6, -1.6)), ((1.6, -1.6), (1.6, 1.6)), ((1.6, 1.6), (-1.6, 1.6)), ((-1.6, 1.6), (-1.6, -1.6))):
            p.tube("metal_dark", (cx + a[0], y, cz + a[1]), (cx + b[0], y, cz + b[1]), 0.03, sides=4, smooth=False)
    # mast up to the lamp bank
    ybank = py + 3.0
    p.tube("steel_beam", (cx, py, cz), (cx, ybank + 1.2, cz), 0.17, sides=8)
    p.tube("metal_dark", (cx, ybank + 1.2, cz), (cx, ybank + 3.2, cz), 0.06, sides=5)
    p.cyl("light_tail", (cx, ybank + 3.35, cz), 0.16, 0.2, "y", sides=8)
    # lamp bank (8 lamps) tilted 22 deg down toward the arena
    M0 = xf((cx, ybank, cz), (22, yaw, 0))
    p.box("metal_dark", (0, 0, 0), (6.9, 0.18, 0.22), M=M0 @ Matrix.Translation((0, -0.05, -0.12)))
    p.box("metal_dark", (0, 0, 0), (6.9, 0.18, 0.22), M=M0 @ Matrix.Translation((0, 1.75, -0.12)))
    for sx in (-3.35, 0.0, 3.35):
        p.box("metal_dark", (0, 0, 0), (0.16, 1.95, 0.22), M=M0 @ Matrix.Translation((sx, 0.85, -0.12)))
    for r in range(2):
        for c in range(4):
            lx = -2.55 + c * 1.7
            ly = 0.4 + r * 0.95
            L = M0 @ Matrix.Translation((lx, ly, 0.1))
            p.box("metal_dark", (0, 0, 0), (1.4, 0.78, 0.6), M=L, tint=0.75)
            p.box("light_head", (0, 0, 0), (1.25, 0.62, 0.04), M=L @ Matrix.Translation((0, 0, 0.31)))
            p.box("metal_dark", (0, 0, 0), (1.46, 0.06, 0.3), M=L @ Matrix.Translation((0, 0.42, 0.42)))
    # ladder on the +Z... face (front of tower toward local -Z of world frame)
    fz = -1
    rungs = int(lat_h / 1.1)
    for k in range(rungs):
        f = k / rungs
        hw = hw0 + (hw1 - hw0) * f
        y = 0.9 + k * 1.1
        p.tube("metal_dark", (cx - 0.3, y, cz + fz * (hw + 0.28)), (cx + 0.3, y, cz + fz * (hw + 0.28)), 0.018, sides=4, smooth=False)
    for sx in (-0.3, 0.3):
        p.tube("metal_dark", (cx + sx, 0.9, cz + fz * (hw0 + 0.28)), (cx + sx, 0.9 + rungs * 1.1, cz + fz * (hw1 + 0.28 - 0.0)), 0.025, sides=4, smooth=False)
    # generator box + cables at the base
    p.bx("metal_dark", (cx + hw0 + 1.2, cx + hw0 + 3.2), (0, 1.3), (cz - 0.8, cz + 0.8), bevel=0.03, tint=0.8)
    p.bx("light_amber", (cx + hw0 + 3.2, cx + hw0 + 3.23), (0.9, 1.0), (cz - 0.3, cz + 0.3))
    p.tube("rubber", (cx + hw0 + 1.2, 0.5, cz), (cx + hw0 - 0.3, 0.05, cz + 0.4), 0.05, sides=5, smooth=False)
    # collision + sockets
    p.cbx((cx - hw0 - 0.7, cx + hw0 + 0.7), (0, 2.0), (cz - hw0 - 0.7, cz + hw0 + 0.7))
    p.cbx((cx - 0.5, cx + 0.5), (2.0, py + 0.2), (cz - 0.5, cz + 0.5))
    p.cbx((cx + hw0 + 1.2, cx + hw0 + 3.2), (0, 1.3), (cz - 0.8, cz + 0.8))
    p.socket("lamp_%d" % idx, tuple((M0 @ Vector((0, 0.9, 1.0)))), yaw)
    p.socket("beacon_%d" % idx, (cx, ybank + 3.5, cz))


def single():
    p = Piece("floodlight_tower", seed=71, ground_y=0, dirt_h=2.0, dirt_amt=0.5, ao_dist=2.0, ao_amt=0.6, streak_amt=0.3, ao_rays=10)
    p.notes = dict(desc="26 m lattice floodlight tower, origin at base centre, lamp bank (8 emissive lamps) faces +Z, tilted 22 deg down. Rotate yaw to aim at the arena.",
                   height=TOWER_H + 4.5, base=[4.2, 4.2], sockets="lamp_0 = light source centre (+Z aim), beacon_0 = red aircraft beacon")
    floodlight(p, 0.0, 0.0, 0.0, 0)
    darken(p, ("concrete_dark",), 0.6)
    return p


def arena():
    p = Piece("boss_arena_lights", seed=72, ground_y=0, dirt_h=2.0, dirt_amt=0.5, ao_dist=2.0, ao_amt=0.6, streak_amt=0.3, ao_rays=8)
    p.notes = dict(desc="Four 26 m floodlight towers at the corners of a 40 (X) x 60 (Z) m rectangle centred on the origin, each lamp bank aimed at the centre. "
                        "Same tower as `floodlight_tower`. Origin = arena centre at ground level.",
                   rect=[40, 60], corners="(+-20, +-30)", sockets="lamp_0..3 (spot light sources, aimed at arena_center), beacon_0..3, arena_center")
    k = 0
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * 20.0, sz * 30.0
            yaw = math.degrees(math.atan2(-cx, -cz))
            floodlight(p, cx, cz, yaw, k)
            k += 1
    p.socket("arena_center", (0, 0, 0))
    darken(p, ("concrete_dark",), 0.6)
    return p


if __name__ == "__main__":
    if ONLY in ("", "floodlight_tower"):
        single().build()
    if ONLY in ("", "boss_arena_lights"):
        arena().build()
