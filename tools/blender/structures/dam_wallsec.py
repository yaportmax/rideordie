"""dam_wall - compact 60 m hero section of the dam crest: road on top (road_surface y=0, along +Z), gravity-dam body dropping 45 m on the
downstream (+X) side, reservoir on -X, one spillway bay (z 22..38) with a radial gate and a stepped chute."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dam_common import *
from dam_set import crest_module
from dam_gate import darken

ONLY = os.environ.get("ONLY", "")
YB = -45.0     # base of the section
XD0, XD1 = 9.0, 42.0      # downstream face: x at y=-0.6 and y=YB
XU0, XU1 = -9.0, -10.5    # upstream face


def xdown(y):
    return XD0 + (XD1 - XD0) * (-0.6 - y) / (-0.6 - YB)


def xup(y):
    return XU0 + (XU1 - XU0) * (-0.6 - y) / (-0.6 - YB)


def build():
    p = Piece("dam_wall", seed=101, ground_y=YB, dirt_h=6.0, dirt_amt=0.45, noise_scale=0.08, noise_amt=0.28, streak_amt=0.15, ao_dist=6, ao_amt=0.6, ao_rays=10)
    p.notes = dict(desc="60 m hero section of the dam crest. Road along +Z (z 0..60) at y=0 (road_surface, x -7..7), balustrades, lamps, expansion joints; reservoir on -X (water_dark at y=-4), "
                        "gravity-dam body drops 45 m on the downstream +X side (sloped face, base at y=-45), one spillway bay (z 22..38, 16 m) with a steel radial gate and a stepped chute; road crosses the bay on a girder deck over the piers (z 18..22, 38..42). "
                        "Chain more `dam_road_10m` beyond z=0 / z=60 (same crest width). No terrain included: place terrain at y=-45 on the +X side.",
                   crest_width=18.0, base_y=YB)
    # ---- crest / road (solid parts + bay deck)
    crest_module(p, 0.0, 22.0, lamp_z=[(1, 6.0), (-1, 16.0)], body_depth=4.0, lite=True, lamp_prefix="lampA_")
    crest_module(p, 22.0, 38.0, lamp_z=[(1, 30.0)], body_depth=0.6, lite=True, lamp_prefix="lampB_")
    crest_module(p, 38.0, 60.0, lamp_z=[(1, 44.0), (-1, 54.0)], body_depth=4.0, lite=True, lamp_prefix="lampC_")
    # girders under the bay deck
    for x in (-5.5, 0.0, 5.5):
        p.bx("steel_beam", (x - 0.3, x + 0.3), (-2.5, -0.6), (22.0, 38.0), sub=4.0, tint=0.8)
    p.bx("steel_beam", (-8.6, 8.6), (-2.3, -1.9), (29.5, 30.5), tint=0.8)
    # ---- dam body (solid parts incl. piers) : profile in XY extruded along Z
    prof = [(XU1, YB), (XD1, YB), (XD0, -0.6), (XU0, -0.6)]
    for z0, z1 in ((0.0, 22.0), (38.0, 60.0)):
        p.extrude("concrete", prof, z0, z1, sub=9.0, tint=0.5)
    # bay body below the ogee sill (y=-14)
    ys = -14.0
    p.extrude("concrete", [(XU1, YB), (XD1, YB), (xdown(ys), ys), (xup(ys), ys)], 22.0, 38.0, sub=9.0, tint=0.5)
    # stepped chute along the downstream face
    n = 12
    for i in range(n):
        yh = ys - i * (YB - ys) / -n * -1 if False else ys - i * (abs(YB - ys) / n)
        yl = yh - abs(YB - ys) / n
        xf_h = xdown(yh)
        xf_l = xdown(yl)
        prot = 0.3 + 1.2 * (i / n)
        p.bx("concrete", (xf_h - 0.3, xf_l + prot), (yl, yh), (22.0, 38.0), skip=("pz", "nz", "ny", "nx"), tint=0.45 + 0.1 * (i / n))
    # ---- lift lines + contraction joints on the downstream face (thin dark strips)
    def facestrip(y0, y1, z0, z1, t=0.5):
        a, b, c, d = (xdown(y0) + 0.04, y0, z0), (xdown(y0) + 0.04, y0, z1), (xdown(y1) + 0.04, y1, z1), (xdown(y1) + 0.04, y1, z0)
        p.quad("concrete_dark", a, d, c, b, tint=t)
    for z0, z1 in ((0.0, 22.0), (38.0, 60.0)):
        for k in range(1, 9):
            y = -0.6 - k * 5.0
            facestrip(y - 0.12, y + 0.12, z0 + 0.1, z1 - 0.1, 0.25)
    for zj in (11.0, 49.0):
        facestrip(YB, -0.6, zj - 0.15, zj + 0.15, 0.25)
    # ---- radial gate in the bay: skin (upstream), girders + arms (downstream side) to trunnion hubs on the piers
    gx = -5.6
    p.bx("steel_beam", (gx - 0.18, gx + 0.18), (ys + 0.5, -1.4), (22.1, 37.9), tint=0.5)
    for yy in (-12.2, -9.2, -6.2, -3.2):
        p.bx("steel_beam", (gx + 0.18, gx + 0.75), (yy - 0.28, yy + 0.28), (22.1, 37.9), tint=0.55)
    for zz in (23.4, 36.6):
        for ya in (-2.4, -12.4):
            p.beam("steel_beam", (gx + 0.5, ya, zz), (6.5, -7.3, zz), 0.5, 0.42, up=(0, 0, 1), tint=0.55)
        p.beam("steel_beam", (gx + 0.5, -7.3, zz), (6.5, -7.3, zz), 0.4, 0.4, up=(0, 0, 1), tint=0.55)
    for zz, sgn in ((22.0, 1), (38.0, -1)):
        p.cyl("metal_dark", (6.5, -7.3, zz + sgn * 0.5), 0.9, 1.0, "z", sides=10, tint=0.7)
    # ---- water (reservoir side) + a few details
    p.surface("water_dark", "water_dark", [-75, xup(-4.0) - 0.05], [-25, 30, 85], lambda x, z: -4.0)
    p.socket("crest_start", (0, 0, 0), 0)
    p.socket("crest_end", (0, 0, 60), 0)
    p.socket("spillway_center", (0, -14, 30))
    # ---- collision
    p.cbx((-10.5, 42.0), (YB, -0.6), (0, 22.0))
    p.cbx((-10.5, 42.0), (YB, -0.6), (38.0, 60.0))
    p.cbx((-10.5, 19.0), (YB, -14.0), (22.0, 38.0))
    p.cbx((-7.0, 0.0), (-14.0, -1.4), (22.0, 38.0))
    darken(p, ("concrete", "concrete_dark"), 0.45, (1.05, 1.0, 0.93))
    return p


if __name__ == "__main__" and ONLY in ("", "dam_wall"):
    build().build()
