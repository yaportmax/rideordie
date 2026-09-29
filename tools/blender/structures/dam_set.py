"""dam_road_10m + crest_module (shared with dam_wallsec.py).  ONLY=<id> env var builds one.
Other dam pieces: dam_backdrop.py, dam_wallsec.py, dam_tower.py, dam_gate.py, dam_lights.py, dam_raider.py."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *

ONLY = os.environ.get("ONLY", "")


def want(i):
    return ONLY in ("", i)


# ==================================================================================================== dam_road_10m
def crest_module(p, z0, z1, lamp_z=None, joints=True, body_depth=4.0, lite=False, lamp_prefix='lamp_'):
    """Crest road module content between z0..z1 (used by dam_road_10m and dam_wall). Reservoir side = -X, downstream drop = +X."""
    L = z1 - z0
    nxs = 2 if lite else 14
    xs = [-7 + 14 * i / nxs for i in range(nxs + 1)]
    nzs = max(1, int(L / (6 if lite else 2)))
    zs = [z0 + L * i / nzs for i in range(nzs + 1)]
    p.surface("road_surface", "asphalt", xs, zs, lambda x, z: 0.0)
    # slab + crest body + corbel courses on the downstream (+X) side
    p.bx("concrete", (-9.0, 9.0), (-0.6, -0.02), (z0, z1), bevel=0.03, sub=5.0 if lite else 2.5)
    if body_depth > 0.61:
        p.bx("concrete_dark", (-9.0, 9.0), (-body_depth, -0.6), (z0, z1), sub=6.0 if lite else 2.5)
    p.bx("concrete", (9.0, 9.45), (-1.3, -0.6), (z0, z1), sub=2.5, bevel=0.03)   # corbel
    p.bx("concrete", (9.0, 9.25), (-1.9, -1.3), (z0, z1), sub=2.5)
    p.bx("concrete", (-9.35, -9.0), (-1.1, -0.6), (z0, z1), sub=2.5, bevel=0.03)   # reservoir side band
    # service walkways (raised kerbs) with cable duct covers
    for s in (-1, 1):
        a, b = (7.0, 8.2) if s > 0 else (-8.2, -7.0)
        p.bx("concrete_dark", (a, b), (-0.02, 0.17), (z0, z1), sub=2.5, bevel=0.02)
        for k in range(int(L / (5.0 if lite else 2.5))):
            z = z0 + 0.4 + k * (5.0 if lite else 2.5)
            p.bx("metal_dark", (a + 0.25, b - 0.25), (0.17, 0.19), (z, z + (4.4 if lite else 1.9)), bevel=0.005 if not lite else 0)
            for m in range(0 if lite else 4):
                p.bx("metal_bare", (a + 0.3, b - 0.3), (0.19, 0.2), (z + 0.15 + m * 0.45, z + 0.19 + m * 0.45))
    # delineator hazard bars on the inner kerb
    rj = random.Random(3)
    for s in (-1, 1):
        xk = s * 7.0
        for k in range(0 if lite else int(L / 1.25)):
            z = z0 + 0.125 + k * 1.25
            col = yellow(rj) if k % 2 == 0 else black(rj)
            q = [(xk - s * 0.03, 0.172, z), (xk - s * 0.03, 0.172, z + 1.2), (xk + s * 0.12, 0.172, z + 1.2), (xk + s * 0.12, 0.172, z)]
            p.quad("hazard", *(q if s > 0 else q[::-1]), tint=col)
    # balustrade: plinth, baluster posts, top rail, steel cable rail
    for s in (-1, 1):
        a, b = (8.2, 8.85) if s > 0 else (-8.85, -8.2)
        xc = (a + b) / 2
        p.bx("concrete", (a, b), (0.17, 0.5), (z0, z1), bevel=0.02, sub=2.5)
        step = 2.5 if lite else 1.25
        n = int(L / step)
        for k in range(n):
            z = z0 + step / 2 + k * step
            p.bx("concrete", (xc - 0.15, xc + 0.15), (0.5, 1.28), (z - 0.14, z + 0.14), tint=rj.uniform(0.9, 1.05))
        p.bx("concrete_dark", (a - 0.03, b + 0.03), (1.28, 1.42), (z0, z1), bevel=0.02, sub=3.0)
        p.tube("metal_dark", (xc, 0.9, z0), (xc, 0.9, z1), 0.03, sides=5, smooth=False)
        p.tube("metal_dark", (xc, 0.7, z0), (xc, 0.7, z1), 0.03, sides=5, smooth=False)
    # expansion joints
    if joints:
        for zz0, zz1 in ((z0, z0 + 0.24), (z1 - 0.24, z1)):
            p.bx("metal_bare", (-7, 7), (-0.01, 0.014), (zz0, zz1), bevel=0.004)
            for i in range(0 if lite else 28):
                x = -7 + 0.12 + i * 0.5
                p.bx("metal_dark", (x, x + 0.22), (0.0, 0.018), (zz0 + 0.03, zz1 - 0.03))
    # downstream drain spouts (rust-stained) + reservoir-side intake grates
    for k in range(0 if lite else 2):
        z = z0 + 2.5 + k * 5.0
        if z < z1 - 0.5:
            p.tube("rust", (9.1, -0.95, z), (9.95, -1.1, z), 0.13, sides=8, r2=0.16)
    if lamp_z:
        for s, z in lamp_z:
            lamp_post(p, s * 8.5, z, side=s, h=8.5, arm=3.4, y0=0.5)
            p.socket(lamp_prefix + str(0 if s > 0 else 1), (s * 8.5 - s * 3.4, 0.5 + 8.5 + 0.1, z))
    # collision
    for s in (-1, 1):
        a, b = (8.1, 8.95) if s > 0 else (-8.95, -8.1)
        p.cbx((a, b), (0, 1.45), (z0, z1))
    p.cbx((-9.4, 9.5), (-body_depth, -0.02), (z0, z1))


def dam_road():
    p = Piece("dam_road_10m", seed=31, ground_y=-60, dirt_amt=0.0, ao_dist=2.5, under_amt=0.35, streak_amt=0.3, noise_amt=0.3)
    p.notes = dict(desc="Modular 10 m crest-road segment for the dam. Origin road centre at z=0, extends +Z, road_surface y=0 (x -7..7). Chains seamlessly every 10 m.",
                   sides="Reservoir side = -X (right of driver), downstream drop = +X (left). Rotate yaw to suit; crest width 18 m (x -9.4..9.5).",
                   body="crest body extends to y=-4 (fill below with dam_wall_backdrop or terrain)", lamps="sockets lamp_0 (+X, z=2.5), lamp_1 (-X, z=7.5)")
    crest_module(p, 0.0, 10.0, lamp_z=[(1, 2.5), (-1, 7.5)])
    return p


if __name__ == "__main__" and want("dam_road_10m"):
    dam_road().build()
