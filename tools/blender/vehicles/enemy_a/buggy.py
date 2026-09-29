"""e_buggy "Skirmisher" - tube-frame raider dune buggy, exposed rear flat-four, gunner stands on a rear platform inside the cage.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/buggy.py -- [--nobake] [--res 2048 --orm 1024 --samples 16]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *
from buggy_parts import *

STYLE = dict(seed=11, rust=0.75, dirt=0.95, wear=0.75, scratch=0.7)
V = Vehicle("e_buggy", style=STYLE)
M = V.M
XMARK = make_image("xmark", xmark_alpha(512))
TALLY = make_image("tally", tally_alpha(512))
SKULL = make_image("skull", skull_alpha(512))

# ------------------------------------------------------------------------------------------ dimensions
AX_F, AX_R = 1.20, -1.10
R_F, W_F, RIM_F, TRK_F = 0.37, 0.26, 0.215, 0.78
R_R, W_R, RIM_R, TRK_R = 0.46, 0.42, 0.27, 0.79
PLAT_Z = 0.70             # top of the gunner platform (feet height)


def T(name, pts, r=0.022, m="metal_dark", fillet=0.08, g="body", **kw):
    return tube(name, pts, r, m, fillet=fillet, g=g, fn=3, **kw)


def both(name, pts, r=0.022, m="metal_dark", fillet=0.08, g="body", **kw):
    for sd in (1, -1):
        T(name, [(sd * x, f, z) for x, f, z in pts], r, m, fillet, g, **kw)


def xtube(name, f, z, x0, x1, r=0.02, m="metal_dark", g="body"):
    return tube(name, [(x0, f, z), (x1, f, z)], r, m, g=g)


def gusset(f0, z0, f1, z1, f2, z2, x0, x1, m="armor", g="body"):
    return prism("gusset", [(f0, z0), (f1, z1), (f2, z2)], "fz", x0, x1, m, g=g)


# ------------------------------------------------------------------------------------------ wheels
def build_wheels():
    for nm, x, f in (("FL", TRK_F, AX_F), ("FR", -TRK_F, AX_F)):
        build_buggy_wheel(V, "wheel_" + nm, (x, f, R_F), 1 if x > 0 else -1, R_F, W_F, RIM_F, kind="offroad", spokes=6, key="front")
    for nm, x, f in (("RL", TRK_R, AX_R), ("RR", -TRK_R, AX_R)):
        build_buggy_wheel(V, "wheel_" + nm, (x, f, R_R), 1 if x > 0 else -1, R_R, W_R, RIM_R, kind="paddle", spokes=6, key="rear")


# ------------------------------------------------------------------------------------------ chassis
def build_chassis():
    # lower rails (per side)
    both("rail_lo", [(0.34, 1.50, 0.34), (0.42, 1.15, 0.30), (0.44, 0.10, 0.28), (0.44, -0.55, 0.30), (0.40, -1.20, 0.36), (0.32, -1.64, 0.42)], 0.024, fillet=0.10)
    # sill / upper rails
    both("rail_up", [(0.46, 0.95, 0.62), (0.48, -0.20, 0.62), (0.50, -0.98, 0.66)], 0.022, fillet=0.06)
    # nose frame
    both("nose_up", [(0.34, 1.50, 0.34), (0.32, 1.47, 0.74), (0.42, 1.10, 0.80), (0.46, 0.92, 0.78), (0.46, 0.95, 0.62)], 0.020, fillet=0.06)
    xtube("nose_x1", 1.48, 0.74, 0.32, -0.32)
    xtube("nose_x2", 1.50, 0.34, 0.34, -0.34)
    xtube("nose_x3", 1.10, 0.80, 0.42, -0.42)
    xtube("nose_x4", 0.92, 0.78, 0.46, -0.46)
    # vertical pillars between rails
    for f, z1 in ((0.95, 0.62), (0.10, 0.62), (-0.45, 0.63), (-0.98, 0.66)):
        both("pillar", [(0.45, f, 0.30), (0.46, f, z1)], 0.018)
    # cross members
    for f, z in ((1.15, 0.30), (0.55, 0.28), (0.10, 0.28), (-0.45, 0.30), (-0.98, 0.34), (-1.45, 0.40)):
        xtube("xmem", f, z, 0.43, -0.43, 0.02)
    for f, z in ((0.95, 0.62), (0.10, 0.62), (-0.45, 0.63), (-0.98, 0.66)):
        xtube("xmem_up", f, z, 0.47, -0.47, 0.018)
    # diagonal braces (cabin sides)
    both("diag", [(0.45, 0.95, 0.31), (0.47, 0.10, 0.62)], 0.016)
    both("diag2", [(0.45, 0.10, 0.31), (0.47, -0.45, 0.62)], 0.016)
    # floor pan + toe board + firewall
    bx("floor", (0, 0.42, 0.315), (0.86, 1.16, 0.02), "metal_dark", bevel=0.004, seg=1, g="body")
    bx("floor_seat", (0, -0.05, 0.325), (0.86, 0.5, 0.02), "metal_dark", g="body")
    bx("firewall", (0, 0.98, 0.58), (0.92, 0.02, 0.56), "armor", bevel=0.005, seg=1, g="body")
    bolts("fw_bolts", rect_rivets((0, 0.99, 0.58), "f", 0.92, 0.56, 0.03, 0.14, sign=1), 0.009, 0.007, "armor", g="body", cap_dome=True)
    # gunner platform (diamond plate) on a tube grid + fuel cell underneath
    bx("plat", (0, -0.68, PLAT_Z - 0.015), (0.98, 0.64, 0.03), "armor", bevel=0.005, seg=1, g="body")
    bx("plat_lip", (0, -0.995, PLAT_Z + 0.02), (0.98, 0.02, 0.06), "armor", bevel=0.003, seg=1, g="body")
    for sd in (1, -1):
        bx("plat_lipS", (sd * 0.49, -0.68, PLAT_Z + 0.02), (0.02, 0.64, 0.06), "armor", bevel=0.003, seg=1, g="body")
    for i in range(6):
        for j in range(4):
            x = -0.36 + i * 0.145 + (0.07 if j % 2 else 0)
            f = -0.44 - j * 0.16
            bx("dia", (x, f, PLAT_Z + 0.004), (0.11, 0.012, 0.008), "armor", yaw=45 if (i + j) % 2 else -45, g="body")
    T("plat_sup1", [(0.44, -0.40, 0.40), (0.44, -0.40, PLAT_Z - 0.03), (-0.44, -0.40, PLAT_Z - 0.03), (-0.44, -0.40, 0.40)], 0.018, fillet=0.05)
    T("plat_sup2", [(0.44, -0.95, 0.40), (0.44, -0.95, PLAT_Z - 0.03), (-0.44, -0.95, PLAT_Z - 0.03), (-0.44, -0.95, 0.40)], 0.018, fillet=0.05)
    bx("fuelcell", (0, -0.68, 0.46), (0.62, 0.56, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    bx("fuelcell_band", (0, -0.55, 0.46), (0.64, 0.03, 0.32), "metal_bare", g="body")
    bx("fuelcell_band2", (0, -0.82, 0.46), (0.64, 0.03, 0.32), "metal_bare", g="body")
    cyl("fuelcap", (0.335, -0.55, 0.50), 0.038, 0.05, "x", "metal_bare", sides=10, g="body")
    # rear engine cage (bumper hoop + top ring)
    T("eng_hoop", [(0.34, -1.64, 0.42), (0.36, -1.64, 1.00), (-0.36, -1.64, 1.00), (-0.34, -1.64, 0.42)], 0.022, fillet=0.14)
    both("eng_top", [(0.50, -0.98, 0.66), (0.44, -1.20, 1.00), (0.36, -1.64, 1.00)], 0.02, fillet=0.08)
    both("eng_lo", [(0.40, -1.20, 0.36), (0.44, -1.20, 1.00)], 0.018)
    xtube("eng_x", -1.20, 1.00, 0.44, -0.44, 0.018)
    # gusset plates at the main joints
    for sd in (1, -1):
        gusset(0.95, 0.62, 0.95, 0.82, 0.80, 0.62, sd * 0.44, sd * 0.46)
        gusset(-0.98, 0.66, -0.98, 0.90, -1.10, 0.66, sd * 0.49, sd * 0.51)


# ------------------------------------------------------------------------------------------ cage (paint2 tubes)
def build_cage():
    r = 0.025
    cg = dict(m="paint2", fillet=0.16)
    # front hoop (A pillars raked back)
    T("hoopF", [(0.49, 0.95, 0.62), (0.45, 0.62, 1.56), (-0.45, 0.62, 1.56), (-0.49, 0.95, 0.62)], r, **cg)
    # main hoop behind the seats
    T("hoopM", [(0.50, -0.12, 0.56), (0.47, -0.20, 1.72), (-0.47, -0.20, 1.72), (-0.50, -0.12, 0.56)], r, **cg)
    # roof side bars + cross bars
    both("roof_side", [(0.45, 0.62, 1.56), (0.47, 0.20, 1.70), (0.47, -0.20, 1.72)], r, **cg)
    xtube("roof_x", 0.22, 1.69, 0.47, -0.47, 0.022, "paint2")
    both("roof_diag", [(0.45, 0.62, 1.56), (0.0, 0.22, 1.69)], 0.018, **cg)
    # door bars
    both("door_hi", [(0.485, 0.90, 1.05), (0.49, 0.30, 1.08), (0.50, -0.12, 1.04)], 0.02, **cg)
    both("door_lo", [(0.48, 0.93, 0.84), (0.49, 0.30, 0.86), (0.50, -0.12, 0.82)], 0.02, **cg)
    both("door_x", [(0.485, 0.90, 1.05), (0.50, -0.12, 0.82)], 0.016, **cg)
    # rear cage for the gunner: rear hoop + rails
    T("hoopR", [(0.52, -0.98, 0.66), (0.50, -1.00, 1.60), (-0.50, -1.00, 1.60), (-0.52, -0.98, 0.66)], r, **cg)
    both("rail_hi", [(0.47, -0.20, 1.72), (0.52, -0.60, 1.66), (0.50, -1.00, 1.60)], r, **cg)
    both("rail_mid", [(0.50, -0.12, 1.06), (0.53, -0.55, 1.14), (0.52, -0.98, 1.10)], 0.02, **cg)
    both("rail_lo2", [(0.50, -0.14, 0.86), (0.53, -0.55, 0.90), (0.52, -0.98, 0.90)], 0.018, **cg)
    both("rear_brace", [(0.50, -1.00, 1.55), (0.42, -1.30, 1.00), (0.36, -1.64, 1.00)], 0.02, **cg)
    both("rear_brace2", [(0.50, -1.00, 1.10), (0.40, -1.22, 0.70), (0.34, -1.64, 0.42)], 0.016, **cg)
    xtube("rearx1", -1.00, 1.16, 0.52, -0.52, 0.02, "paint2")
    # gun mount post + cradle
    T("gunpost", [(0.0, -0.22, 1.72), (0.0, -0.24, 1.94)], 0.03, "metal_dark", fillet=0.0)
    for sd in (1, -1):
        T("gunbrace", [(sd * 0.32, -0.20, 1.72), (sd * 0.05, -0.26, 1.90)], 0.018, "metal_dark", fillet=0.0)
    bx("gunplate", (0, -0.24, 1.965), (0.16, 0.16, 0.025), "armor", bevel=0.004, seg=1, g="body")
    cyl("gunpivot", (0, -0.24, 1.995), 0.035, 0.03, "z", "metal_bare", sides=12, g="body")
    # headache-rack armour plate behind the seats + gunner front shield
    bx("headache", (0, -0.235, 1.02), (0.90, 0.02, 0.36), "armor", bevel=0.004, seg=1, g="body")
    bolts("headache_r", rect_rivets((0, -0.245, 1.02), "f", 0.90, 0.36, 0.028, 0.12, sign=-1), 0.009, 0.007, "armor", g="body", cap_dome=True)
    # weld gussets on hoops
    for sd in (1, -1):
        gusset(-0.12, 0.56, -0.12, 0.78, -0.30, 0.56, sd * 0.49, sd * 0.51)
        gusset(0.95, 0.62, 0.72, 1.12, 0.95, 1.12, sd * 0.47, sd * 0.49, m="paint2")
    # windscreen deflector (small flat perspex look)
    quad_slab("wshield", [(0.42, 0.72, 1.20), (-0.42, 0.72, 1.20), (-0.44, 0.64, 1.50), (0.44, 0.64, 1.50)], 0.008, "glass", out=(0, 1, 1), g="body")


# ------------------------------------------------------------------------------------------ suspension
def build_susp():
    for sd in (1, -1):
        # front double wishbones
        hubx = sd * (TRK_F - 0.13)
        tube("fa_lo1", [(sd * 0.40, 1.40, 0.31), (sd * 0.64, 1.22, 0.27)], 0.02, "metal_dark", g="body")
        tube("fa_lo2", [(sd * 0.40, 1.00, 0.31), (sd * 0.64, 1.18, 0.27)], 0.02, "metal_dark", g="body")
        tube("fa_up1", [(sd * 0.36, 1.32, 0.66), (sd * 0.62, 1.22, 0.60)], 0.018, "metal_dark", g="body")
        tube("fa_up2", [(sd * 0.36, 1.06, 0.66), (sd * 0.62, 1.18, 0.60)], 0.018, "metal_dark", g="body")
        bx("knuckle", (sd * 0.655, AX_F, 0.44), (0.07, 0.10, 0.36), "metal_dark", bevel=0.01, seg=1, g="body", yaw=0)
        cyl("hub", (sd * 0.68, AX_F, R_F), 0.06, 0.05, "x", "metal_bare", sides=10, g="body")
        tube("tierod", [(sd * 0.36, 0.90, 0.42), (sd * 0.66, 1.06, 0.44)], 0.012, "metal_bare", g="body")
        # coilover
        lo, hi = (sd * 0.585, 1.20, 0.34), (sd * 0.36, 1.19, 0.90)
        tube("shock_b", [lo, ((lo[0] * 0.45 + hi[0] * 0.55), 1.195, lo[2] * 0.45 + hi[2] * 0.55)], 0.03, "metal_dark", g="body")
        tube("shock_s", [((lo[0] * 0.45 + hi[0] * 0.55), 1.195, lo[2] * 0.45 + hi[2] * 0.55), hi], 0.014, "metal_bare", g="body")
        coil_spring("spring", (lo[0] * 0.8 + hi[0] * 0.2, 1.199, lo[2] * 0.8 + hi[2] * 0.2), (lo[0] * 0.2 + hi[0] * 0.8, 1.192, lo[2] * 0.2 + hi[2] * 0.8), 0.052, 5, 0.0085, "metal_bare")
        tube("shock_res", [(sd * 0.60, 1.10, 0.62), (sd * 0.60, 1.10, 0.86)], 0.024, "metal_dark", g="body")
        # rear trailing arms + half shafts + coilovers
        hub = (sd * (TRK_R - 0.14), AX_R, R_R)
        tube("ta_lo", [(sd * 0.38, -0.55, 0.30), (sd * 0.66, AX_R + 0.06, 0.36)], 0.028, "metal_dark", g="body")
        tube("ta_up", [(sd * 0.38, -0.60, 0.52), (sd * 0.66, AX_R + 0.02, 0.56)], 0.022, "metal_dark", g="body")
        bx("rcarrier", (sd * 0.655, AX_R, 0.46), (0.07, 0.16, 0.40), "metal_dark", bevel=0.01, seg=1, g="body")
        tube("halfshaft", [(sd * 0.17, AX_R, R_R), (sd * 0.62, AX_R, R_R)], 0.026, "metal_bare", g="body")
        cyl("cvboot", (sd * 0.24, AX_R, R_R), 0.05, 0.10, "x", "interior", sides=10, r2=0.036, g="body")
        cyl("cvboot2", (sd * 0.57, AX_R, R_R), 0.045, 0.08, "x", "interior", sides=10, r2=0.034, g="body")
        rlo, rhi = (sd * 0.56, AX_R + 0.02, 0.42), (sd * 0.44, -0.86, 1.02)
        tube("rshock_b", [rlo, (rlo[0] * 0.45 + rhi[0] * 0.55, -1.0, rlo[2] * 0.45 + rhi[2] * 0.55)], 0.032, "metal_dark", g="body")
        tube("rshock_s", [(rlo[0] * 0.45 + rhi[0] * 0.55, -1.0, rlo[2] * 0.45 + rhi[2] * 0.55), rhi], 0.015, "metal_bare", g="body")
        coil_spring("rspring", (rlo[0] * 0.75 + rhi[0] * 0.25, -1.02, rlo[2] * 0.75 + rhi[2] * 0.25), (rlo[0] * 0.2 + rhi[0] * 0.8, -0.9, rlo[2] * 0.2 + rhi[2] * 0.8), 0.058, 5, 0.0095, "metal_bare")
        tube("rres", [(sd * 0.60, -0.90, 0.80), (sd * 0.60, -0.90, 1.04)], 0.026, "metal_bare", g="body")
        gusset(-0.86, 1.02, -0.86, 1.14, -0.98, 1.10, sd * 0.42, sd * 0.46)


# ------------------------------------------------------------------------------------------ rear flat-four engine
def build_engine():
    ex, ef, ez = 0.0, -1.36, 0.58
    bx("crankcase", (ex, ef, ez), (0.40, 0.46, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    bx("sump", (ex, ef, ez - 0.19), (0.30, 0.34, 0.08), "metal_bare", bevel=0.01, seg=1, g="body")
    bx("transaxle", (ex, AX_R, R_R), (0.34, 0.34, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    for i in range(3):
        bx("tx_rib", (ex, AX_R + (i - 1) * 0.10, R_R + 0.16), (0.30, 0.02, 0.04), "metal_dark", g="body")
    for sd in (1, -1):
        for f in (-1.22, -1.50):
            cyl("barrel", (sd * 0.33, f, ez + 0.02), 0.068, 0.24, "x", "metal_dark", sides=12, g="body")
            for k in range(4):
                cyl("fin", (sd * (0.27 + k * 0.045), f, ez + 0.02), 0.098, 0.009, "x", "metal_dark", sides=12, g="body")
            bx("head", (sd * 0.50, f, ez + 0.03), (0.10, 0.17, 0.19), "metal_dark", bevel=0.01, seg=1, g="body")
            bx("vcover", (sd * 0.565, f, ez + 0.03), (0.04, 0.17, 0.17), "metal_bare", bevel=0.008, seg=1, g="body")
            tube("pushrod", [(sd * 0.27, f + 0.08, ez + 0.11), (sd * 0.50, f + 0.08, ez + 0.16)], 0.009, "metal_bare", g="body")
        # headers -> collector
        tube("header", [(sd * 0.50, -1.22, ez - 0.06), (sd * 0.56, -1.36, ez - 0.16), (sd * 0.42, -1.60, ez - 0.20), (sd * 0.24, -1.68, ez - 0.22), (sd * 0.24, -1.72, ez - 0.22)], 0.026, "rust", fillet=0.09, g="body")
        tube("header2", [(sd * 0.50, -1.50, ez - 0.06), (sd * 0.55, -1.56, ez - 0.16), (sd * 0.40, -1.63, ez - 0.20)], 0.024, "rust", fillet=0.07, g="body")
        cyl("tip", (sd * 0.24, -1.76, ez - 0.20), 0.036, 0.14, "f", "metal_bare", sides=10, g="body")
    # fan shroud + carbs + air filters + belt
    bx("shroud", (ex, ef + 0.02, ez + 0.20), (0.34, 0.34, 0.10), "metal_dark", bevel=0.02, seg=1, g="body")
    cyl("fan", (ex, ef + 0.02, ez + 0.26), 0.13, 0.03, "z", "metal_bare", sides=14, g="body")
    for sd in (1, -1):
        cyl("carb", (sd * 0.16, ef - 0.06, ez + 0.20), 0.045, 0.16, "z", "metal_dark", sides=10, g="body")
        cyl("stack", (sd * 0.16, ef - 0.06, ez + 0.31), 0.06, 0.10, "z", "metal_bare", sides=12, r2=0.075, g="body")
        cyl("filter", (sd * 0.16, ef - 0.06, ez + 0.39), 0.088, 0.075, "z", "metal_bare", sides=14, g="body")
        cyl("filter_cap", (sd * 0.16, ef - 0.06, ez + 0.43), 0.08, 0.012, "z", "metal_dark", sides=14, g="body")
    cyl("pulley", (ex, ef + 0.25, ez + 0.02), 0.075, 0.05, "f", "metal_bare", sides=14, g="body")
    bx("alt", (0.16, ef + 0.02, ez + 0.13), (0.10, 0.12, 0.10), "metal_bare", bevel=0.01, seg=1, g="body")
    bx("oilcooler", (-0.14, -1.14, ez + 0.14), (0.26, 0.04, 0.20), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("oc_fin", (-0.14 + i * 0.035, -1.16, ez + 0.14), (0.006, 0.02, 0.19), "metal_bare", g="body")
    tube("hose1", [(-0.14, -1.14, ez + 0.06), (-0.10, -1.20, ez - 0.02), (-0.05, -1.30, ez - 0.05)], 0.014, "interior", fillet=0.05, g="body")
    tube("hose2", [(-0.20, -1.14, ez + 0.22), (-0.17, -1.20, ez + 0.28), (-0.08, -1.30, ez + 0.24)], 0.014, "interior", fillet=0.05, g="body")
    tube("plugwire", [(0.30, -1.22, ez + 0.14), (0.20, -1.30, ez + 0.24), (0.10, -1.36, ez + 0.20)], 0.006, "interior", g="body")
    # muffler + tail pipe
    cyl("muffler", (0.0, -1.66, ez - 0.20), 0.07, 0.30, "f", "rust", sides=12, g="body")
    # engine mount plates
    for sd in (1, -1):
        bx("mount", (sd * 0.30, ef, ez - 0.24), (0.06, 0.30, 0.06), "metal_dark", g="body")
    # rear light housings on the engine hoop
    for sd in (1, -1):
        bx("tl_house", (sd * 0.36, -1.685, 0.86), (0.13, 0.05, 0.10), "metal_dark", bevel=0.008, seg=1, g="body")
        bx("tl_lens", (sd * 0.36, -1.712, 0.86), (0.11, 0.012, 0.08), "light_tail", g="body")
        bx("tl_brake", (sd * 0.36, -1.712, 0.76), (0.11, 0.012, 0.03), "light_amber" if "light_amber" in M else "light_tail", g="body")


# ------------------------------------------------------------------------------------------ bodywork (fibreglass)
def hood_ring(w, zb, zt):
    half = [(0.0, zb), (w * 0.88, zb), (w, zb + 0.05), (w * 0.985, zt - 0.05), (w * 0.72, zt - 0.008), (0.0, zt + 0.012)]
    return sym_ring(half)


def build_body():
    # nose cowl (hood)
    st = [(0.85, hood_ring(0.40, 0.62, 0.90)), (1.10, hood_ring(0.385, 0.58, 0.85)), (1.35, hood_ring(0.335, 0.53, 0.77)), (1.54, hood_ring(0.285, 0.50, 0.68))]
    loft_f("hood", st, "paint", cap=True, subdiv=1, bevel=0.008, seg=1, g="panel_hood")
    # hood pins + scoop
    for sd in (1, -1):
        bolts("hoodpin", [((sd * 0.30, 1.30, 0.80), (0, 0, 1)), ((sd * 0.30, 0.95, 0.885), (0, 0, 1))], 0.014, 0.012, "metal_bare", g="panel_hood", cap_dome=True)
    prism("scoop", [(0.90, 0.905), (1.16, 0.905), (1.08, 0.97), (0.92, 0.97)], "fz", -0.11, 0.11, "paint", bevel=0.006, seg=1, g="panel_hood")
    # front fenders (wings over the front wheels)
    for sd in (1, -1):
        stations = []
        for k in range(13):
            f = 0.66 + k * (1.10 / 12)
            dfz = f - AX_F
            hgt = R_F + math.sqrt(max(0.47 ** 2 - dfz ** 2, 0.0)) if abs(dfz) < 0.47 else R_F + 0.0
            h = max(hgt, R_F + 0.03) + 0.02 * 0
            ring = [(sd * 0.58, h), (sd * 0.58, h + 0.024), (sd * 0.87, h + 0.03), (sd * 0.955, h - 0.05), (sd * 0.96, h - 0.09), (sd * 0.93, h - 0.09), (sd * 0.87, h - 0.005)]
            if sd < 0:
                ring = ring[::-1]
            stations.append((f, ring))
        loft_f("fender", stations, "paint", cap=True, bevel=0.005, seg=1, g="panel_fender_L" if sd > 0 else "panel_fender_R")
    # side pods (paint2) wrapped around the seat sides
    for sd in (1, -1):
        stn = []
        for f, w, h, zc in ((0.98, 0.09, 0.20, 0.42), (0.85, 0.20, 0.32, 0.46), (0.25, 0.22, 0.34, 0.47), (-0.30, 0.22, 0.34, 0.47), (-0.42, 0.14, 0.24, 0.42)):
            stn.append((f, [(x, z) for x, z in rrect(w, h, 0.05, 3, sd * 0.56, zc)]))
        if sd < 0:
            stn = [(f, ring[::-1]) for f, ring in stn]
        loft_f("pod", stn, "paint2", cap=True, bevel=0.006, seg=1, g="body")
    # rear engine cover (louvered plate over the fan shroud) with holes for the air filters
    cov = bx("cover", (0, -1.34, 0.985), (0.42, 0.44, 0.03), "paint2", bevel=0.006, seg=1, g="panel_trunk")
    for sd in (1, -1):
        cut = cyl("_cut", (sd * 0.16, -1.42, 0.985), 0.10, 0.2, "z", "paint2", sides=16)
        bool_op(cov, cut)
    for i in range(6):
        bx("louver", (0, -1.14 - i * 0.045, 1.0), (0.30, 0.012, 0.006), "paint2", g="panel_trunk")
    bx("cover_lip", (0, -1.585, 0.965), (0.42, 0.03, 0.06), "paint2", bevel=0.004, seg=1, g="panel_trunk")
    bolts("cover_bolts", [((sd * 0.19, -1.14, 1.001), (0, 0, 1)) for sd in (1, -1)], 0.012, 0.01, "metal_bare", g="panel_trunk", cap_dome=True)
    # front bumper: tube loop + skid plate
    tube("bumperF", [(0.50, 1.44, 0.30), (0.56, 1.62, 0.32), (0.55, 1.77, 0.36), (0.30, 1.82, 0.38), (-0.30, 1.82, 0.38), (-0.55, 1.77, 0.36), (-0.56, 1.62, 0.32), (-0.50, 1.44, 0.30)], 0.03, "armor", fillet=0.10, g="panel_bumper_F")
    tube("bumperF_hoop", [(0.30, 1.82, 0.38), (0.28, 1.79, 0.70), (-0.28, 1.79, 0.70), (-0.30, 1.82, 0.38)], 0.026, "armor", fillet=0.09, g="panel_bumper_F")
    tube("bumperF_x", [(0.52, 1.72, 0.54), (-0.52, 1.72, 0.54)], 0.022, "armor", g="panel_bumper_F")
    bx("skidF", (0, 1.62, 0.255), (0.66, 0.50, 0.018), "armor", bevel=0.004, seg=1, pitch=8, g="panel_bumper_F")
    bolts("skidF_r", rect_rivets((0, 1.62, 0.268), "z", 0.66, 0.50, 0.03, 0.16), 0.009, 0.007, "armor", g="panel_bumper_F", cap_dome=True)
    for sd in (1, -1):
        cyl("spikeF", (sd * 0.42, 1.84, 0.38), 0.03, 0.10, "f", "spike", sides=8, r2=0.0, g="panel_bumper_F")
    # rear bumper
    tube("bumperR", [(0.46, -1.52, 0.38), (0.50, -1.75, 0.40), (0.30, -1.80, 0.42), (-0.30, -1.80, 0.42), (-0.50, -1.75, 0.40), (-0.46, -1.52, 0.38)], 0.03, "armor", fillet=0.10, g="panel_bumper_R")
    bx("plateR", (0, -1.77, 0.56), (0.50, 0.02, 0.22), "armor", bevel=0.004, seg=1, g="panel_bumper_R")
    bolts("plateR_r", rect_rivets((0, -1.781, 0.56), "f", 0.50, 0.22, 0.03, 0.1, sign=-1), 0.009, 0.007, "armor", g="panel_bumper_R", cap_dome=True)
    tube("towhook", [(0.0, -1.80, 0.42), (0.0, -1.86, 0.40), (0.05, -1.88, 0.35), (0.0, -1.85, 0.31)], 0.014, "metal_bare", fillet=0.03, g="panel_bumper_R")


# ------------------------------------------------------------------------------------------ interior
def bucket_seat(x, f, z):
    bx("seat_pan", (x, f, z), (0.40, 0.44, 0.09), "fabric", bevel=0.03, seg=2, g="body")
    bx("seat_back", (x, f - 0.20, z + 0.33), (0.40, 0.10, 0.60), "fabric", bevel=0.035, seg=2, pitch=10, g="body")
    for sd in (1, -1):
        bx("bolster", (x + sd * 0.185, f - 0.14, z + 0.22), (0.05, 0.16, 0.36), "fabric", bevel=0.02, seg=1, pitch=10, g="body")
        bx("bolster2", (x + sd * 0.18, f + 0.03, z + 0.06), (0.05, 0.30, 0.10), "fabric", bevel=0.02, seg=1, g="body")
    bx("headrest", (x, f - 0.26, z + 0.72), (0.24, 0.07, 0.16), "fabric", bevel=0.03, seg=1, pitch=10, g="body")
    bx("seat_rail", (x, f, z - 0.075), (0.30, 0.46, 0.04), "metal_dark", g="body")
    # harness
    for sd in (1, -1):
        bx("belt", (x + sd * 0.12, f - 0.19, z + 0.36), (0.05, 0.012, 0.62), "cloth_dark", pitch=10, g="body")
    bx("lapbelt", (x, f + 0.10, z + 0.055), (0.42, 0.04, 0.012), "cloth_dark", g="body")
    bx("buckle", (x, f + 0.10, z + 0.07), (0.05, 0.02, 0.03), "metal_bare", g="body")


def build_interior():
    bucket_seat(0.36, 0.14, 0.40)
    bucket_seat(-0.36, 0.14, 0.40)
    # dash + steering
    bx("dash", (0, 0.88, 0.84), (0.90, 0.05, 0.26), "interior", bevel=0.01, seg=1, pitch=-8, g="body")
    for i, x in enumerate((0.50, 0.36, 0.22)):
        cyl("gauge", (x, 0.845, 0.87), 0.036, 0.02, "f", "metal_bare", sides=12, g="body")
    for i in range(4):
        bx("switch", (-0.10 - i * 0.07, 0.845, 0.80), (0.03, 0.02, 0.03), "metal_bare", g="body")
    wc = (0.36, 0.60, 0.88)
    ang = 26
    nrm = (0, math.cos(ang * D2R), -math.sin(ang * D2R))
    tube("swheel", ring_pts(wc, nrm, 0.145, 16), 0.013, "interior", closed=True, g="body")
    tube("swspoke", [(wc[0] - 0.145, wc[1], wc[2]), (wc[0] + 0.145, wc[1], wc[2])], 0.011, "interior", g="body")
    tube("column", [(wc[0], wc[1] + 0.03, wc[2] - 0.015), (wc[0], 0.88, 0.70)], 0.024, "metal_dark", g="body")
    cyl("swhub", (wc[0], wc[1] + 0.01, wc[2] - 0.004), 0.035, 0.04, "f", "metal_bare", sides=10, pitch=-ang, g="body")
    # shifter, pedals, hand brake
    tube("shifter", [(0.0, 0.10, 0.34), (0.0, 0.18, 0.66)], 0.011, "metal_dark", g="body")
    cyl("shiftknob", (0.0, 0.185, 0.68), 0.024, 0.05, "z", "interior", sides=8, g="body")
    tube("handbrake", [(0.10, -0.06, 0.34), (0.10, 0.02, 0.62)], 0.012, "metal_dark", g="body")
    for x in (0.30, 0.42):
        bx("pedal", (x, 0.86, 0.40), (0.06, 0.03, 0.10), "metal_dark", pitch=-30, g="body")
    # extinguisher
    cyl("extinguisher", (-0.36, -0.13, 0.62), 0.04, 0.28, "z", "paint2", sides=10, g="body")


# ------------------------------------------------------------------------------------------ lights, antennas, gear
def build_details():
    # round headlights on the nose frame + guard hoops
    for sd in (1, -1):
        cyl("hl_bucket", (sd * 0.30, 1.585, 0.72), 0.085, 0.10, "f", "metal_dark", sides=16, g="body")
        cyl("hl_refl", (sd * 0.30, 1.628, 0.72), 0.078, 0.02, "f", "metal_bare", sides=16, g="body")
        cyl("hl_lens", (sd * 0.30, 1.642, 0.72), 0.070, 0.012, "f", "light_head", sides=16, g="body")
        cyl("hl_rim", (sd * 0.30, 1.640, 0.72), 0.092, 0.014, "f", "metal_bare", sides=16, g="body")
    # roof light bar
    bx("lightbar", (0, 0.64, 1.60), (0.70, 0.06, 0.08), "metal_dark", bevel=0.008, seg=1, g="body")
    bx("lightbar_lens", (0, 0.672, 1.60), (0.64, 0.008, 0.055), "light_head", g="body")
    for i in range(-3, 4):
        bx("lb_div", (i * 0.09, 0.676, 1.60), (0.008, 0.008, 0.058), "metal_dark", g="body")
    # spare tyre on the right cage side + strap, jerry can on the platform
    cyl("spare", (-0.66, -0.50, 0.99), 0.36, 0.25, "x", "rubber_tire", sides=28, g="body")
    cyl("spare_rim", (-0.795, -0.50, 0.99), 0.22, 0.02, "x", "rim", sides=16, g="body")
    cyl("spare_hub", (-0.81, -0.50, 0.99), 0.06, 0.02, "x", "metal_bare", sides=10, g="body")
    tube("spare_strap", [(-0.54, -0.50, 1.36), (-0.79, -0.50, 1.36), (-0.79, -0.50, 0.62), (-0.54, -0.50, 0.62)], 0.008, "cloth_dark", g="body")
    bx("jerry", (0.34, -0.90, PLAT_Z + 0.20), (0.32, 0.17, 0.38), "armor", bevel=0.015, seg=1, g="body")
    bx("jerry_cap", (0.34, -0.90, PLAT_Z + 0.42), (0.06, 0.06, 0.04), "metal_bare", g="body")
    tube("jerry_handle", [(0.20, -0.90, PLAT_Z + 0.36), (0.20, -0.90, PLAT_Z + 0.44), (0.48, -0.90, PLAT_Z + 0.44), (0.48, -0.90, PLAT_Z + 0.36)], 0.011, "armor", fillet=0.03, g="body")
    # whip antennas + flags
    for sd, col in ((1, "cloth_red"), (-1, "cloth_tan")):
        base = (sd * 0.55, -1.00, 1.60)
        tube("ant", [base, (sd * 0.56, -1.04, 2.05), (sd * 0.58, -1.10, 2.55)], 0.0045, "metal_bare", g="body")
        strip_wave("flag", (sd * 0.58, -1.10, 2.52), 0.50, 0.17, 0.07, 3.0, col, direction=(0, -1, 0), nseg=9, droop=0.04, g="body")
    # tow strap / chain hung on the rear hoop
    tube("chain", [(0.35, -1.001, 1.55), (0.20, -1.01, 1.36), (0.0, -1.01, 1.32), (-0.20, -1.01, 1.36), (-0.35, -1.001, 1.55)], 0.009, "metal_bare", fillet=0.05, g="body")
    # skid plate under the engine, mud flaps
    bx("skidR", (0, -1.30, 0.235), (0.60, 0.70, 0.016), "armor", bevel=0.004, seg=1, g="body")
    # frame number plate
    bx("numplate", (0, 1.53, 0.88), (0.24, 0.02, 0.15), "metal_bare", bevel=0.004, seg=1, g="panel_hood")
    # hood vent slots
    for i in range(4):
        bx("vent", (-0.22 + i * 0.03, 1.02, 0.882), (0.012, 0.16, 0.004), "metal_dark", g="panel_hood")


def build_sockets():
    sock("seat_driver", 0.36, 0.14, 0.50)
    sock("steering_wheel", 0.36, 0.60, 0.88, pitch=-26)
    sock("seat_gunner", 0.0, -0.68, PLAT_Z)
    sock("gun_mount", 0.0, -0.24, 1.995)
    sock("light_head_L", 0.30, 1.645, 0.72)
    sock("light_head_R", -0.30, 1.645, 0.72)
    sock("light_tail_L", 0.36, -1.72, 0.86, yaw=180)
    sock("light_tail_R", -0.36, -1.72, 0.86, yaw=180)
    sock("exhaust_L", 0.24, -1.84, 0.38, yaw=180)
    sock("exhaust_R", -0.24, -1.84, 0.38, yaw=180)
    sock("nitro_L", 0.14, -1.84, 0.52, yaw=180)
    sock("nitro_R", -0.14, -1.84, 0.52, yaw=180)
    sock("smoke_engine", 0.0, -1.36, 0.90)
    sock("fuel_cap", 0.36, -0.55, 0.50, yaw=90)
    sock("roof_top", 0.0, 0.22, 1.72)
    sock("camera_hood", 0.0, 1.22, 0.96)


# ------------------------------------------------------------------------------------------ paint hooks (flames + graffiti)
def hook_paint(ctx, col):
    """paint = the fibreglass nose + wings: black base with flames licking back from the front edge."""
    g = ctx["g"]
    py, px, pz = ctx["py"], ctx["px"], ctx["pz"]
    s = g.add(py, 1.62)                                      # distance behind the nose (py = -f)
    u = g.add(g.mul(px, 5.5), g.mul(pz, 4.0))
    n1 = ctx["nz"](2.6, 3.0, 0.5)
    w = g.math("FRACT", g.add(g.mul(u, 1.0 / 0.62), g.mul(g.sub(n1, 0.5), 1.6)))
    tooth = g.sub(1.0, g.math("ABSOLUTE", g.sub(g.mul(w, 2.0), 1.0)))
    L = g.add(0.26, g.mul(g.math("POWER", tooth, 0.75), 0.62))
    outer = g.new_map_range(g.sub(L, s), -0.015, 0.02)
    L2 = g.mul(L, 0.52)
    inner = g.new_map_range(g.sub(L2, s), -0.015, 0.02)
    base = g.mixc(1.0, col, (0.075, 0.075, 0.075), "MULTIPLY")
    mid = g.mixc(1.0, col, (0.62, 0.62, 0.62), "MULTIPLY")
    res = g.mixc(outer, base, mid)
    res = g.mixc(inner, res, col)
    return res


def hook_paint2(ctx, col):
    g = ctx["g"]
    dark = (0.02, 0.02, 0.02)
    m = stamp(ctx, XMARK, (0.56, 0.30, 0.66), (0, -1, 0), (0, 0, 1), (0.30, 0.30), thick=0.10, n=(1, 0, 0))
    col = g.mixc(g.mul(m, 0.9), col, dark)
    m = stamp(ctx, TALLY, (-0.56, 0.30, 0.66), (0, 1, 0), (0, 0, 1), (0.36, 0.36), thick=0.10, n=(-1, 0, 0))
    col = g.mixc(g.mul(m, 0.9), col, dark)
    m = stamp(ctx, SKULL, (0.0, -1.34, 1.0), (1, 0, 0), (0, 1, 0), (0.34, 0.34), thick=0.05)
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


STYLE["hooks"] = {"paint": hook_paint, "paint2": hook_paint2}

build_wheels()
build_chassis()
build_cage()
build_susp()
build_engine()
build_body()
build_interior()
build_details()
build_sockets()

V.pivot("panel_hood", 0, 0.86, 0.88)
V.pivot("panel_trunk", 0, -1.14, 0.98)
V.pivot("panel_bumper_F", 0, 1.76, 0.40)
V.pivot("panel_bumper_R", 0, -1.76, 0.42)
V.pivot("panel_fender_L", 0.78, AX_F, 0.85)
V.pivot("panel_fender_R", -0.78, AX_F, 0.85)
V.finish(bake=True)
