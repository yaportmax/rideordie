"""e_muscle "Rammer" - blacked-out 1970 Charger-style muscle coupe with a wedge ram plate and a blown V8 poking through the hood.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/muscle.py -- [--nobake] [--res 2048 --orm 1024 --samples 16]
Driver only (no gunner).  Coordinates: x = left(+), f = forward(+), z = up.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *
from muscle_parts import *

STYLE = dict(seed=11, rust=0.9, dirt=0.8, wear=0.8, scratch=0.7)
V = Vehicle("e_muscle", style=STYLE)
M = V.M
reset_wheel_cache()
SKULL = make_image("skull", skull_alpha(512))
TALLY = make_image("tally", tally_alpha(512))
XMARK = make_image("xmark", xmark_alpha(512))


def hook_paint(ctx, col):
    g = ctx["g"]
    dark = (0.02, 0.02, 0.02)
    m = stamp(ctx, SKULL, (0.0, -0.30, 1.32), (1, 0, 0), (0, -1, 0), (0.55, 0.55), thick=0.10)          # roof skull, reads from the front
    col = g.mixc(g.mul(m, 0.95), col, dark)
    m = stamp(ctx, XMARK, (-0.93, -0.06, 0.66), (0, 1, 0), (0, 0, 1), (0.46, 0.46), thick=0.07, n=(-1, 0, 0))  # right door
    col = g.mixc(g.mul(m, 0.9), col, dark)
    m = stamp(ctx, TALLY, (0.93, -0.08, 0.66), (0, -1, 0), (0, 0, 1), (0.50, 0.50), thick=0.07, n=(1, 0, 0))   # left door
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


def hook_paint2(ctx, col):
    """hood + trunk: twin racing stripes worn through to the primer + tally marks."""
    g = ctx["g"]
    dark = (0.03, 0.03, 0.03)
    for sx in (0.46, -0.46):
        d = g.math("ABSOLUTE", g.sub(ctx["px"], sx))
        st = g.new_map_range(d, 0.05, 0.035)
        st = g.mul(st, ctx["top"])
        col = g.mixc(g.mul(st, 0.55), col, dark)
    m = stamp(ctx, TALLY, (0.10, -2.16, 0.985), (1, 0, 0), (0, 1, 0), (0.42, 0.42), thick=0.08)
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


STYLE["hooks"] = {"paint": hook_paint, "paint2": hook_paint2}

# --------------------------------------------------------------------------------------------- key dimensions
AX_F, AX_R = 1.30, -1.62          # axle positions (f)
HZ_F, HZ_R = 0.355, 0.375           # hub heights = tyre radii
TRK_F, TRK_R = 0.80, 0.79
ARCH_F, ARCH_R = 0.44, 0.465
GAP = 0.004
BELT = 0.955


def _interp(pts, x):
    pts = sorted(pts)
    if x <= pts[0][0]:
        return pts[0][1]
    for i in range(len(pts) - 1):
        if pts[i][0] <= x <= pts[i + 1][0]:
            t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
            return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    return pts[-1][1]


def body_ring(hw, zb, belt, zt):
    half = [(0.0, zb), (hw * 0.78, zb), (hw * 0.93, zb + 0.05), (hw * 0.995, zb + 0.17), (hw, (zb + belt) * 0.5 + 0.02),
            (hw * 0.985, belt - 0.11), (hw * 0.958, belt - 0.025), (hw * 0.925, belt), (hw * 0.55, (belt + zt) * 0.5 + 0.003), (0.0, zt)]
    return sym_ring(half)


def make_tub():
    S = [
        (2.30, (0.90, 0.38, 0.905, 0.915)), (2.27, (0.945, 0.34, 0.925, 0.945)), (2.15, (0.965, 0.26, 0.94, 0.965)),
        (1.75, (0.965, 0.21, 0.945, 0.985)), (1.30, (0.962, 0.20, 0.95, 0.995)), (0.85, (0.955, 0.20, 0.955, 1.005)),
        (0.66, (0.948, 0.20, 0.955, 1.02)), (0.50, (0.94, 0.20, 0.955, 0.955)), (-0.80, (0.94, 0.20, 0.955, 0.955)),
        (-1.15, (0.955, 0.20, 0.955, 0.96)), (-1.60, (0.99, 0.20, 0.965, 0.98)), (-1.96, (0.985, 0.21, 0.968, 0.99)),
        (-2.25, (0.96, 0.26, 0.955, 0.975)), (-2.29, (0.93, 0.32, 0.94, 0.96)), (-2.32, (0.88, 0.38, 0.93, 0.94)),
    ]
    st = [(f, body_ring(*p)) for f, p in S]
    return loft_f("tub", st, "paint", cap=True)


def cutter(c, s, m="metal_dark", **kw):
    return bx("_cut", c, s, m, **kw)


def box_fz(x0, x1, f0, f1, z0, z1):
    return ((x0 + x1) / 2, (f0 + f1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(f1 - f0), abs(z1 - z0))


def build_shell():
    tub = make_tub()
    for f, hz, r in ((AX_F, HZ_F, ARCH_F), (AX_R, HZ_R, ARCH_R)):
        for sx in (1, -1):
            cut = cyl("_arch", (sx * 0.94, f, hz), r, 0.5, "x", "metal_dark", sides=40)
            bool_op(tub, cut)

    def extract(name, c, s, grp, inner, mat=None, holes=()):
        cp = duplicate(tub, name)
        cu = cutter(c, s, inner)
        bool_op(cp, cu, "INTERSECT")
        if mat:
            for sl in cp.material_slots:
                if sl.material and sl.material.name == "paint":
                    sl.material = M[mat]
        for hc, hs in holes:
            bool_op(cp, cutter(hc, hs, mat or inner))
        add_bevel(cp, 0.007, 1, 30)
        apply_modifiers(cp)
        return reg(cp, grp)

    g = GAP
    # hood (paint2) with the blower opening
    c, s = box_fz(-0.80, 0.80, 0.70 + g, 2.26 - g, 0.90, 1.10)
    hole = box_fz(-0.285, 0.285, 1.10, 1.80, 0.80, 1.30)
    extract("hood", c, s, "panel_hood", "paint2", mat="paint2", holes=[hole])
    # trunk lid (paint2)
    c, s = box_fz(-0.80, 0.80, -2.30 + g, -1.96 - g, 0.90, 1.10)
    extract("trunk", c, s, "panel_trunk", "paint2", mat="paint2")
    # doors (big coupe doors)
    for nm, sd, grp in (("door_L", 1, "panel_door_L"), ("door_R", -1, "panel_door_R")):
        x0, x1 = (0.83 + g, 1.10) if sd > 0 else (-1.10, -0.83 - g)
        c, s = box_fz(x0, x1, -0.80 + g, 0.62 - g, 0.30 + g, 1.10)
        extract(nm, c, s, grp, "paint", mat="paint")

    def pocket(x0, x1, f0, f1, z0, z1, m="metal_dark"):
        c, s = box_fz(x0, x1, f0, f1, z0, z1)
        bool_op(tub, cutter(c, s, m))
    pocket(-0.815, 0.815, 0.685, 2.275, 0.86, 1.2)           # hood opening
    pocket(-0.66, 0.66, 0.85, 2.12, 0.34, 0.90)              # engine bay
    pocket(-0.815, 0.815, -2.31, -1.95, 0.86, 1.2)           # trunk opening
    pocket(-0.66, 0.66, -2.20, -1.99, 0.34, 0.90)            # trunk cavity
    for sd in (1, -1):
        x0, x1 = (0.83, 1.12) if sd > 0 else (-1.12, -0.83)
        pocket(x0, x1, -0.80 - 1.5 * g, 0.62 + 1.5 * g, 0.29, 1.2)
    pocket(-0.78, 0.78, -0.66, 0.55, 0.34, 1.2, "interior")  # cabin pit
    pocket(-0.60, 0.60, 0.95, 2.18, -0.05, 0.52)             # front underbody recess
    pocket(-0.60, 0.60, -2.15, -1.10, -0.05, 0.50)           # rear underbody recess
    # nose: full-width hidden-headlight slot, tail: lamp bar slots
    pocket(-0.80, 0.80, 2.24, 2.55, 0.70, 0.86)
    for sd in (1, -1):
        pocket(sd * 0.47 - 0.375, sd * 0.47 + 0.375, -2.55, -2.28, 0.71, 0.81)
    add_bevel(tub, 0.008, 1, 30)
    apply_modifiers(tub)
    reg(tub, "body")
    return tub


def fb_x(f):
    return _interp([(-0.66, 0.868), (-1.15, 0.885), (-1.6, 0.91), (-1.94, 0.905)], f)


FB_TOP = [(-0.66, 1.318), (-0.90, 1.31), (-1.20, 1.255), (-1.50, 1.13), (-1.75, 1.03), (-1.94, 0.985)]
FB_DIP = [(-0.66, 0.003), (-0.95, 0.003), (-1.10, 0.03), (-1.25, 0.065), (-1.6, 0.065), (-1.8, 0.04), (-1.94, 0.008)]


def fb_ring(f):
    zt = _interp(FB_TOP, f)
    dip = _interp(FB_DIP, f)
    zb0 = 0.94
    h = zt - zb0
    k = min(h, 0.36) / 0.36
    xb = fb_x(f)
    xm = xb - 0.11 * k
    xt = xb - 0.25 * k
    half = [(0.0, zb0), (xb, zb0), (xb - 0.005, zb0 + 0.10 * h), (xm, zb0 + 0.45 * h), (xt, zb0 + 0.86 * h), (xt - 0.06, zb0 + 0.98 * h),
            (0.50, zt - 0.004), (0.44, zt - 0.004 - 0.5 * dip), (0.40, zt - dip), (0.0, zt - dip)]
    return sym_ring(half)


def build_greenhouse():
    # ---- fastback (solid sail panels, tunnel rear window channel)
    fs = [-0.66, -0.78, -0.90, -1.05, -1.20, -1.35, -1.50, -1.65, -1.80, -1.94]
    fb = loft_f("fastback", [(f, fb_ring(f)) for f in fs], "paint", cap=True, subdiv=0, bevel=0.006, seg=1, g="body")
    set_faces_material(fb, "interior", lambda c, n: abs(c.x) < 0.41 and n.z > 0.35 and (-c.y) < -1.0 and c.z > 0.9)
    # rear glass lying in the channel (follows the channel floor)
    gst = []
    for f in (-1.10, -1.25, -1.40, -1.55, -1.70, -1.82, -1.90):
        z = _interp(FB_TOP, f) - _interp(FB_DIP, f) + 0.004
        gst.append((f, [(-0.395, z), (0.395, z), (0.395, z + 0.008), (-0.395, z + 0.008)]))
    loft_f("rear_glass", gst, "glass", cap=True, g="body")
    # ---- roof slab (front section)
    rs = []
    for f, zt, hw in ((0.14, 1.290, 0.655), (-0.10, 1.308, 0.68), (-0.40, 1.318, 0.69), (-0.66, 1.318, 0.69)):
        rs.append((f, rrect(2 * hw, 0.05, 0.018, 2, 0.0, zt - 0.025)))
    loft_f("roof", rs, "paint", cap=True, bevel=0.005, seg=1, g="body")
    beam("header", (0.66, 0.15, 1.262), (-0.66, 0.15, 1.262), 0.05, 0.04, "paint", u=(0, 1, 0), g="body", bevel=0.004)
    # ---- windshield + A pillars
    quad_slab("windshield", [(0.80, 0.70, 0.985), (-0.80, 0.70, 0.985), (-0.655, 0.16, 1.285), (0.655, 0.16, 1.285)], 0.010, "glass", out=(0, 1, 1), g="body")
    for sd in (1, -1):
        beam("apillar", (sd * 0.835, 0.72, 0.95), (sd * 0.685, 0.125, 1.29), 0.05, 0.07, "paint", u=(0, 1, 0.6), g="body", bevel=0.005)
    beam("wsh_seal", (0.80, 0.705, 0.99), (-0.80, 0.705, 0.99), 0.03, 0.03, "interior", u=(0, 1, 0), g="body")
    # ---- cowl vents / wipers
    for sd in (1, -1):
        for i in range(2):
            beam("wiper", (sd * (0.12 + 0.34 * i), 0.78, 1.0), (sd * (0.55 + 0.34 * i), 0.66, 1.012), 0.014, 0.008, "metal_dark", u=(0, 0, 1), g="body")


def door_extras(sd, grp):
    top = 1.28
    q = [(sd * 0.845, 0.60, BELT), (sd * 0.845, 0.16, top), (sd * 0.845, -0.60, top), (sd * 0.845, -0.62, BELT)]
    gl = quad_slab("dglass", q, 0.008, "glass", out=(sd, 0, 0), g=grp)
    deform_verts(gl, lambda v: Vector((v.x - sd * 0.40 * max(v.z - BELT, 0), v.y, v.z)))
    xt = 0.845 - 0.40 * (top - BELT) - 0.005
    beam("rail", (sd * xt, 0.14, top + 0.012), (sd * xt, -0.64, top + 0.012), 0.04, 0.03, "chrome", u=(1, 0, 0), g=grp)
    beam("post", (sd * (xt + 0.03), -0.63, BELT), (sd * xt, -0.63, top + 0.01), 0.05, 0.03, "paint", u=(0, 1, 0), g=grp, bevel=0.003)
    beam("sash", (sd * 0.89, 0.62, BELT), (sd * xt, 0.12, top + 0.01), 0.03, 0.04, "paint", u=(1, 0, 0), g=grp)
    bx("mir_arm", (sd * 0.95, 0.55, 1.03), (0.10, 0.025, 0.025), "chrome", g=grp)
    bx("mir_head", (sd * 1.01, 0.55, 1.05), (0.05, 0.14, 0.09), "chrome", bevel=0.012, seg=1, g=grp)
    bx("handle", (sd * 0.955, -0.62, 0.86), (0.02, 0.13, 0.02), "chrome", bevel=0.005, seg=1, g=grp)
    bx("scallop", (sd * 0.946, -0.05, 0.50), (0.014, 1.0, 0.03), "interior", g=grp)


def build_wheels():
    for nm, x, f, hz, R, W in (("FL", TRK_F, AX_F, HZ_F, 0.355, 0.27), ("FR", -TRK_F, AX_F, HZ_F, 0.355, 0.27),
                               ("RL", TRK_R, AX_R, HZ_R, 0.375, 0.34), ("RR", -TRK_R, AX_R, HZ_R, 0.375, 0.34)):
        build_wheel(V, "wheel_" + nm, (x, f, hz), 1 if x > 0 else -1, R, W, 0.215, tire="offroad", spokes=5, lugs=5, rim_style="star", key="muscle%s" % R)


# ------------------------------------------------------------------------------------------- nose: ram plate + grille
def face_pt(sd, t, s):
    """Point on the ram plate half `sd`: t = 0 centre .. 1 outer, s = 0 bottom edge .. 1 top edge."""
    x = sd * 0.90 * t
    fb = 2.60 - 0.18 * t
    return (x, fb - 0.20 * s, 0.18 + 0.48 * s)


def build_nose():
    # main bumper bar behind the plate (part of the same detachable assembly)
    prism("bumperbar", [(-0.90, 2.36), (0.90, 2.36), (0.96, 2.31), (0.98, 2.22), (0.90, 2.22), (0.86, 2.28), (-0.86, 2.28), (-0.90, 2.22), (-0.98, 2.22), (-0.96, 2.31)],
          "xf", 0.26, 0.42, "armor", bevel=0.01, seg=1, g="panel_bumper_F")
    nn = math.sqrt(0.106 ** 2 + 0.432 ** 2 + 0.27 ** 2)
    for sd in (1, -1):
        q = [face_pt(sd, 0, 0), face_pt(sd, 1, 0), face_pt(sd, 1, 1), face_pt(sd, 0, 1)]
        quad_slab("ram_half", q, 0.055, "armor", out=(sd * 0.1, 0.43, 0.27), g="panel_bumper_F", bevel=0.006, seg=1)
        # edge lips (welded angle irons)
        beam("ram_lip_b", face_pt(sd, 0, 0), face_pt(sd, 1, 0), 0.05, 0.07, "armor", u=(0, 0.25, 1), g="panel_bumper_F", bevel=0.004)
        beam("ram_lip_t", face_pt(sd, 0, 1), face_pt(sd, 1, 1), 0.05, 0.05, "armor", u=(0, 0.25, 1), g="panel_bumper_F", bevel=0.004)
        beam("ram_lip_o", face_pt(sd, 1, 0), face_pt(sd, 1, 1), 0.05, 0.05, "armor", u=(1, 0, 0), g="panel_bumper_F", bevel=0.004)
        # gussets behind the plate
        for t in (0.25, 0.6, 0.92):
            x = sd * 0.90 * t
            fbot = 2.60 - 0.18 * t
            prism("gusset", [(fbot - 0.05, 0.20), (fbot - 0.05 - 0.20, 0.62), (fbot - 0.05 - 0.20, 0.24), (fbot - 0.05 - 0.14, 0.20)], "fz", x - 0.015, x + 0.015, "armor", g="panel_bumper_F")
        # spikes: leading edge row
        for i in range(9):
            t = 0.06 + i * 0.108
            b = face_pt(sd, t, 0.0)
            cone_dir("spike", (b[0], b[1] - 0.02, b[2] + 0.055), (sd * 0.12 * (1 if t > 0.05 else 0), 1.0, -0.08), 0.034, 0.14, "spike", sides=6, g="panel_bumper_F")
        # spikes: two rows on the face
        for s in (0.42, 0.80):
            for t in (0.2, 0.45, 0.70, 0.93):
                b = face_pt(sd, t, s)
                cone_dir("spike", b, (sd * 0.106, 0.432, 0.27), 0.028, 0.14, "spike", sides=6, g="panel_bumper_F")
        # bolts on the plate face
        items = []
        for t in (0.12, 0.35, 0.58, 0.8, 0.96):
            for s in (0.10, 0.90):
                p = face_pt(sd, t, s)
                items.append(((p[0] + sd * 0.0, p[1] + 0.03, p[2] + 0.02), (sd * 0.106, 0.432, 0.27)))
        bolts("ram_bolts", items, 0.014, 0.012, "armor", g="panel_bumper_F", cap_dome=True)
    beam("ram_ridge", face_pt(1, 0, 0), face_pt(1, 0, 1), 0.06, 0.07, "armor", u=(1, 0, 0), g="panel_bumper_F", bevel=0.004)
    for sd in (1, -1):
        cone_dir("spike_top", (sd * 0.30, 2.40, 0.66), (0, 0.15, 1.0), 0.03, 0.17, "spike", sides=6, g="panel_bumper_F")
    cone_dir("spike_top", (0.0, 2.41, 0.66), (0, 0.15, 1.0), 0.03, 0.19, "spike", sides=6, g="panel_bumper_F")
    # hidden-headlight slot: dark louvres + two round lamps
    bx("slot_bk", (0, 2.25, 0.78), (1.56, 0.02, 0.16), "metal_dark", g="body")
    for i in range(5):
        bx("slot_bar", (0, 2.28, 0.72 + i * 0.03), (1.56, 0.02, 0.012), "metal_dark", g="body")
    bx("slot_mid", (0, 2.29, 0.78), (0.05, 0.03, 0.17), "chrome", g="body")
    for sd in (1, -1):
        cyl("lamp_ring", (sd * 0.56, 2.29, 0.78), 0.088, 0.03, "f", "chrome", sides=20, g="body")
        cyl("lamp_bk", (sd * 0.56, 2.27, 0.78), 0.075, 0.02, "f", "chrome", sides=16, g="body")
        cyl("lamp_lens", (sd * 0.56, 2.298, 0.78), 0.070, 0.02, "f", "light_head", sides=20, g="body")
        bx("slot_end", (sd * 0.80, 2.29, 0.78), (0.03, 0.03, 0.17), "chrome", g="body")
    bx("slot_top", (0, 2.29, 0.868), (1.62, 0.025, 0.02), "chrome", g="body")
    bx("slot_bot", (0, 2.29, 0.692), (1.62, 0.025, 0.02), "chrome", g="body")


def build_tail():
    # rear bumper: slim blackened bar + overriders
    poly = [(-0.90, -2.40), (0.90, -2.40), (0.97, -2.36), (0.99, -2.29), (0.92, -2.29), (0.88, -2.34), (-0.88, -2.34), (-0.92, -2.29), (-0.99, -2.29), (-0.97, -2.36)]
    prism("bumper_R", poly[::-1], "xf", 0.29, 0.47, "chrome", bevel=0.010, seg=1, g="panel_bumper_R")
    for sd in (1, -1):
        cyl("overrider", (sd * 0.62, -2.43, 0.38), 0.038, 0.10, "f", "chrome", sides=10, r2=0.03, g="panel_bumper_R")
    # tail lamp bar: two lenses + centre dark panel
    for sd in (1, -1):
        x = sd * 0.47
        bx("tl_lens", (x, -2.285, 0.76), (0.72, 0.016, 0.085), "light_tail", g="body")
        bx("tl_refl", (x, -2.27, 0.76), (0.74, 0.014, 0.10), "chrome", g="body")
        for dz, sz in ((0.052, 0.014), (-0.052, 0.014)):
            bx("tl_bezel", (x, -2.30, 0.76 + dz), (0.76, 0.02, sz), "chrome", g="body")
        bx("tl_end", (sd * 0.845, -2.30, 0.76), (0.014, 0.02, 0.12), "chrome", g="body")
        bx("rev", (sd * 0.125, -2.29, 0.76), (0.04, 0.02, 0.07), "light_head", g="body")
    bx("tl_centre", (0, -2.29, 0.76), (0.16, 0.02, 0.10), "metal_dark", g="body")
    # ducktail spoiler + plate on the trunk lid
    prism("ducktail", [(-2.18, 0.975), (-2.34, 0.98), (-2.36, 1.055), (-2.30, 1.06), (-2.20, 1.005)], "fz", -0.76, 0.76, "paint2", bevel=0.006, seg=1, g="panel_trunk")
    bx("plate", (0, -2.37, 0.62), (0.36, 0.012, 0.17), "metal_bare", bevel=0.004, seg=1, roll=2, g="panel_trunk")
    # twin exhaust tips under the bumper
    for sd in (1, -1):
        cyl("tip", (sd * 0.42, -2.40, 0.30), 0.048, 0.14, "f", "chrome", sides=12, g="body")
        cyl("tip_in", (sd * 0.42, -2.475, 0.30), 0.036, 0.02, "f", "metal_dark", sides=12, g="body")


# ------------------------------------------------------------------------------------------- engine, blower
def build_engine():
    bx("block", (0, 1.44, 0.56), (0.46, 0.66, 0.34), "metal_dark", bevel=0.015, seg=1, g="body")
    for sd in (1, -1):
        bx("head", (sd * 0.25, 1.44, 0.64), (0.17, 0.62, 0.22), "metal_dark", bevel=0.012, seg=1, roll=sd * -10, g="body")
        bx("valvecover", (sd * 0.28, 1.44, 0.76), (0.14, 0.56, 0.05), "chrome", bevel=0.01, seg=1, roll=sd * -10, g="body")
        # headers
        for i in range(4):
            f = 1.22 + i * 0.16
            tube("header", [(sd * 0.36, f, 0.66), (sd * 0.44, f, 0.52), (sd * 0.47, min(f, 1.05) - 0.0, 0.34)], 0.022, "rust", fillet=0.05, g="body")
        tube("collector", [(sd * 0.47, 1.08, 0.36), (sd * 0.55, 0.96, 0.27), (sd * 0.90, 0.92, 0.22)], 0.05, "rust", fillet=0.08, g="body")
    # roots blower + scoop
    bx("blower", (0, 1.45, 0.845), (0.42, 0.54, 0.17), "metal_bare", bevel=0.015, seg=1, g="body")
    for i in range(7):
        bx("blower_rib", (0, 1.22 + i * 0.075, 0.935), (0.44, 0.012, 0.03), "metal_bare", g="body")
    bx("blower_lid", (0, 1.45, 0.94), (0.30, 0.42, 0.03), "metal_dark", bevel=0.008, seg=1, g="body")
    bx("scoop", (0, 1.52, 1.075), (0.30, 0.40, 0.23), "metal_dark", bevel=0.012, seg=1, taper=(0.9, 1.0), g="body")
    bx("scoop_mouth", (0, 1.735, 1.09), (0.24, 0.02, 0.16), "metal_bare", g="body")
    bx("scoop_slot", (0, 1.745, 1.09), (0.20, 0.012, 0.12), "interior", g="body")
    bx("scoop_frame", (0, 1.738, 1.09), (0.29, 0.014, 0.21), "chrome", g="body")
    for sd in (1, -1):
        cyl("clamp", (sd * 0.20, 1.45, 1.0), 0.016, 0.02, "z", "chrome", sides=8, g="body")
    beam("strap", (0.22, 1.45, 0.935), (-0.22, 1.45, 0.935), 0.03, 0.012, "chrome", u=(0, 1, 0), g="body")
    # belt drive
    cyl("pulley_b", (0, 1.16, 0.855), 0.075, 0.03, "f", "chrome", sides=16, g="body")
    cyl("pulley_c", (0, 1.16, 0.46), 0.07, 0.04, "f", "metal_bare", sides=16, g="body")
    beam("belt1", (0.06, 1.155, 0.855), (0.055, 1.155, 0.46), 0.012, 0.03, "interior", u=(0, 1, 0), g="body")
    beam("belt2", (-0.06, 1.155, 0.855), (-0.055, 1.155, 0.46), 0.012, 0.03, "interior", u=(0, 1, 0), g="body")
    # radiator + shroud + fan + battery + hoses
    bx("radiator", (0, 2.09, 0.60), (0.66, 0.08, 0.44), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("rad_fin", (i * 0.09, 2.13, 0.60), (0.008, 0.02, 0.42), "metal_bare", g="body")
    bx("shroud", (0, 1.99, 0.60), (0.60, 0.12, 0.40), "interior", bevel=0.01, seg=1, g="body")
    cyl("fan", (0, 1.88, 0.60), 0.18, 0.03, "f", "metal_bare", sides=12, g="body")
    bx("battery", (-0.50, 1.88, 0.52), (0.22, 0.17, 0.19), "interior", bevel=0.01, seg=1, g="body")
    tube("hose_up", [(0.22, 2.05, 0.78), (0.22, 1.85, 0.80), (0.14, 1.70, 0.74)], 0.026, "interior", fillet=0.07, g="body")
    tube("hose_lo", [(-0.22, 2.05, 0.46), (-0.24, 1.8, 0.44), (-0.14, 1.65, 0.50)], 0.026, "interior", fillet=0.07, g="body")
    bx("firewall", (0, 0.76, 0.62), (1.30, 0.02, 0.50), "metal_dark", g="body")
    # trunk cavity: tank shield + junk
    bx("trunk_floor", (0, -2.08, 0.44), (1.3, 0.24, 0.02), "metal_dark", g="body")
    cyl("nitro_bottle", (0.30, -2.08, 0.55), 0.09, 0.42, "x", "chrome", sides=14, g="body")
    bx("nitro_strap", (0.30, -2.08, 0.55), (0.04, 0.02, 0.2), "metal_bare", g="body")


# ------------------------------------------------------------------------------------------- interior + roll cage
def build_interior():
    bx("floor", (0, -0.05, 0.345), (1.5, 1.2, 0.02), "interior", g="body")
    for sd in (1, -1):
        x = sd * 0.42
        bx("seat_base", (x, -0.03, 0.40), (0.46, 0.50, 0.08), "interior", g="body")
        bx("seat_cush", (x, -0.03, 0.46), (0.46, 0.50, 0.10), "fabric", bevel=0.03, seg=2, g="body")
        bx("seat_back", (x, -0.30, 0.76), (0.46, 0.13, 0.58), "fabric", bevel=0.035, seg=2, pitch=12, g="body")
        bx("seat_wing_l", (x + 0.22, -0.28, 0.72), (0.06, 0.18, 0.48), "fabric", bevel=0.02, seg=1, pitch=12, g="body")
        bx("seat_wing_r", (x - 0.22, -0.28, 0.72), (0.06, 0.18, 0.48), "fabric", bevel=0.02, seg=1, pitch=12, g="body")
        bx("headrest", (x, -0.36, 1.07), (0.22, 0.09, 0.15), "fabric", bevel=0.03, seg=2, g="body")
        # harness belts
        for dx in (-0.10, 0.10):
            beam("belt", (x + dx, -0.36, 1.04), (x + dx * 0.5, -0.20, 0.55), 0.045, 0.006, "cloth_dark", u=(1, 0, 0), g="body")
    bx("dash", (0, 0.47, 0.80), (1.56, 0.28, 0.20), "interior", bevel=0.02, seg=2, g="body")
    bx("dash_top", (0, 0.49, 0.915), (1.56, 0.24, 0.035), "interior", bevel=0.012, seg=1, pitch=-4, g="body")
    bx("binnacle", (0.42, 0.46, 0.965), (0.40, 0.14, 0.08), "interior", bevel=0.015, seg=1, g="body")
    bx("gauge", (0.42, 0.385, 0.965), (0.34, 0.012, 0.045), "metal_bare", g="body")
    bx("tacho", (0.0, 0.335, 0.90), (0.10, 0.09, 0.10), "metal_dark", bevel=0.01, seg=1, g="body")
    wc = (0.42, 0.30, 0.895)
    ang = 22
    nrm = (0, math.cos(ang * D2R), -math.sin(ang * D2R))
    tube("swheel", ring_pts(wc, nrm, 0.175, 18), 0.014, "interior", closed=True, g="body")
    tube("swspoke1", [(wc[0] - 0.175, wc[1], wc[2]), (wc[0] + 0.175, wc[1], wc[2])], 0.011, "interior", g="body")
    s, c = math.sin(ang * D2R), math.cos(ang * D2R)
    beam("swspoke2", (wc[0], wc[1] + 0.175 * s, wc[2] + 0.175 * c), (wc[0], wc[1] - 0.175 * s, wc[2] - 0.175 * c), 0.02, 0.02, "interior", g="body")
    cyl("swhub", (wc[0], wc[1] + 0.012, wc[2] - 0.005), 0.042, 0.05, "f", "chrome", sides=10, pitch=-ang, g="body")
    tube("column", [(wc[0], wc[1] + 0.03, wc[2] - 0.012), (wc[0], 0.55, 0.76)], 0.028, "interior", g="body")
    bx("tunnel", (0, -0.1, 0.42), (0.28, 1.2, 0.12), "interior", bevel=0.03, seg=1, g="body")
    tube("shifter", [(0.0, 0.08, 0.46), (0.0, 0.14, 0.70)], 0.012, "metal_bare", g="body")
    cyl("shift_knob", (0.0, 0.145, 0.72), 0.026, 0.05, "z", "chrome", sides=10, g="body")
    for sd in (1, -1):
        bx("armrest", (sd * 0.745, 0.05, 0.78), (0.05, 0.6, 0.05), "interior", bevel=0.012, seg=1, g="body")


def build_cage():
    r = 0.022
    tube("hoop", [(0.72, -0.62, 0.36), (0.72, -0.62, 1.235), (-0.72, -0.62, 1.235), (-0.72, -0.62, 0.36)], r, "metal_bare", fillet=0.15, fn=5, g="body")
    tube("hoop_x1", [(0.72, -0.62, 0.42), (-0.72, -0.62, 1.20)], 0.018, "metal_bare", g="body")
    tube("hoop_x2", [(-0.72, -0.62, 0.42), (0.72, -0.62, 1.20)], 0.018, "metal_bare", g="body")
    tube("hoop_h", [(0.72, -0.62, 0.98), (-0.72, -0.62, 0.98)], 0.02, "metal_bare", g="body")
    for sd in (1, -1):
        tube("apillar_bar", [(sd * 0.72, 0.60, 0.62), (sd * 0.72, 0.56, 0.96), (sd * 0.64, 0.16, 1.235)], r, "metal_bare", fillet=0.1, fn=5, g="body")
        tube("roof_rail", [(sd * 0.64, 0.16, 1.235), (sd * 0.66, -0.20, 1.24), (sd * 0.72, -0.62, 1.235)], r, "metal_bare", fillet=0.05, g="body")
        # door bars: X across the side window
        tube("door_x1", [(sd * 0.735, 0.50, 0.975), (sd * 0.71, -0.56, 1.225)], 0.018, "metal_bare", g="body")
        tube("door_x2", [(sd * 0.735, -0.56, 0.975), (sd * 0.71, 0.24, 1.23)], 0.018, "metal_bare", g="body")
        tube("door_bar", [(sd * 0.745, 0.55, 0.86), (sd * 0.745, -0.62, 0.86)], 0.02, "metal_bare", g="body")
        # rear stay into the fastback + base plate
        tube("stay", [(sd * 0.72, -0.62, 1.20), (sd * 0.70, -1.10, 1.06)], 0.02, "metal_bare", g="body")
        bx("hoop_plate", (sd * 0.72, -0.62, 0.345), (0.12, 0.12, 0.014), "armor", bevel=0.004, seg=1, g="body")
        bolts("hoop_bolts", [((sd * 0.72 + dx, -0.62 + df, 0.352), (0, 0, 1)) for dx in (-0.04, 0.04) for df in (-0.04, 0.04)], 0.010, 0.009, "armor", g="body")
    tube("header_bar", [(0.64, 0.16, 1.235), (-0.64, 0.16, 1.235)], r, "metal_bare", g="body")
    tube("dash_bar", [(0.72, 0.52, 0.84), (-0.72, 0.52, 0.84)], 0.02, "metal_bare", g="body")
    # fire extinguisher on the tunnel
    cyl("extinguisher", (0.0, -0.32, 0.52), 0.045, 0.30, "z", "armor", sides=10, g="body")


# ------------------------------------------------------------------------------------------- side pipes, underbody
def build_sidepipes():
    for sd in (1, -1):
        x = sd * 0.945
        cyl("sidepipe", (x, 0.02, 0.235), 0.052, 1.85, "f", "chrome", sides=14, g="body")
        cyl("sidepipe_tip", (x, -0.95, 0.235), 0.058, 0.10, "f", "chrome", sides=14, r2=0.068, g="body")
        cyl("sidepipe_in", (x, -1.005, 0.235), 0.05, 0.012, "f", "metal_dark", sides=14, g="body")
        # heat shield (perforated cover) + brackets
        bx("shield", (x + sd * 0.012, 0.02, 0.29), (0.09, 1.55, 0.03), "metal_bare", bevel=0.006, seg=1, g="body")
        for f in (-0.55, -0.1, 0.35, 0.8):
            beam("bracket", (sd * 0.78, f, 0.24), (sd * 0.93, f, 0.235), 0.03, 0.03, "metal_dark", u=(0, 1, 0), g="body")
        tube("side_pipe_front", [(x, 0.95, 0.235), (sd * 0.80, 1.02, 0.24), (sd * 0.55, 1.05, 0.30)], 0.048, "rust", fillet=0.06, g="body")


def build_underbody():
    for sd in (1, -1):
        beam("rail", (sd * 0.60, 2.22, 0.19), (sd * 0.60, -2.15, 0.19), 0.08, 0.14, "metal_dark", u=(1, 0, 0), g="body", bevel=0.006, seg=1)
    for f in (1.88, 1.15, -0.95, -1.15):
        beam("xmem", (0.60, f, 0.22), (-0.60, f, 0.22), 0.10, 0.09, "metal_dark", u=(0, 1, 0), g="body", bevel=0.005, seg=1)
    # front suspension
    for sd in (1, -1):
        hub = (sd * (TRK_F - 0.10), AX_F, HZ_F)
        tube("arm_lo", [(sd * 0.58, AX_F - 0.28, 0.25), (sd * 0.62, AX_F, 0.23), (sd * 0.58, AX_F + 0.28, 0.25)], 0.022, "metal_dark", g="body")
        tube("arm_lo2", [(sd * 0.62, AX_F, 0.23), hub], 0.03, "metal_dark", g="body")
        tube("arm_up", [(sd * 0.54, AX_F - 0.15, 0.50), (sd * 0.64, AX_F - 0.05, 0.53), hub], 0.02, "metal_dark", g="body")
        cyl("coil", (sd * 0.55, AX_F, 0.42), 0.06, 0.26, "z", "metal_bare", sides=10, g="body")
        cyl("coil_body", (sd * 0.55, AX_F, 0.34), 0.038, 0.20, "z", "metal_dark", sides=8, g="body")
        bx("knuckle", (sd * (TRK_F - 0.12), AX_F, HZ_F), (0.08, 0.10, 0.20), "metal_dark", bevel=0.01, seg=1, g="body")
    tube("sway", [(0.60, AX_F - 0.32, 0.27), (0.30, AX_F - 0.42, 0.25), (-0.30, AX_F - 0.42, 0.25), (-0.60, AX_F - 0.32, 0.27)], 0.015, "metal_bare", fillet=0.05, g="body")
    tube("tierod", [(0.63, AX_F + 0.16, 0.29), (0.10, AX_F + 0.24, 0.27), (-0.10, AX_F + 0.24, 0.27), (-0.63, AX_F + 0.16, 0.29)], 0.014, "metal_dark", g="body")
    bx("oilpan", (0, 1.40, 0.30), (0.34, 0.50, 0.12), "metal_dark", bevel=0.012, seg=1, g="body")
    bx("trans", (0, 0.92, 0.42), (0.30, 0.55, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    # torque box / driveshaft / live axle on leaf springs
    tube("driveshaft", [(0.0, 0.70, 0.30), (0.0, AX_R + 0.05, 0.38)], 0.038, "metal_bare", g="body")
    bx("ujoint", (0, 0.62, 0.30), (0.06, 0.08, 0.06), "metal_dark", g="body")
    tube("axle_r", [(0.80, AX_R, HZ_R), (-0.80, AX_R, HZ_R)], 0.055, "metal_dark", g="body")
    ellipsoid("diff", (0, AX_R - 0.04, HZ_R), (0.17, 0.20, 0.17), "metal_dark", seg=12, rings=8, g="body")
    for sd in (1, -1):
        cyl("drum", (sd * 0.68, AX_R, HZ_R), 0.17, 0.10, "x", "metal_dark", sides=16, g="body")
        beam("leaf", (sd * 0.55, AX_R + 0.95, 0.31), (sd * 0.55, AX_R - 0.55, 0.31), 0.07, 0.03, "metal_dark", u=(1, 0, 0), g="body")
        beam("leaf2", (sd * 0.55, AX_R + 0.75, 0.28), (sd * 0.55, AX_R - 0.45, 0.28), 0.065, 0.025, "metal_dark", u=(1, 0, 0), g="body")
        cyl("rshock", (sd * 0.66, AX_R - 0.16, 0.44), 0.024, 0.36, "z", "metal_dark", sides=8, roll=sd * 8, g="body")
    # rear exhaust runs (from the side pipe crossover) + fuel tank
    for sd in (1, -1):
        tube("exh", [(sd * 0.45, -0.90, 0.20), (sd * 0.42, -1.35, 0.17), (sd * 0.42, -2.22, 0.24), (sd * 0.42, -2.40, 0.30)], 0.034, "rust", fillet=0.1, g="body")
        cyl("muffler", (sd * 0.42, -1.95, 0.20), 0.08, 0.60, "f", "rust", sides=12, g="body")
    bx("fueltank", (0.0, -1.88, 0.30), (0.90, 0.40, 0.12), "metal_dark", bevel=0.02, seg=1, g="body")
    for f in (-1.72, -2.04):
        beam("strap", (0.5, f, 0.23), (-0.5, f, 0.23), 0.03, 0.01, "metal_bare", u=(0, 1, 0), g="body")


def build_details():
    # hood pins + rusty plates
    for sx in (0.52, -0.52):
        for f in (0.95, 2.14):
            cyl("hoodpin", (sx, f, 1.0 if f < 1.5 else 0.955), 0.012, 0.045, "z", "chrome", sides=8, g="panel_hood")
    # patch plates on the doors and a rear quarter
    for sd, f, z, w, h in ((1, -0.30, 0.55, 0.42, 0.30), (-1, 0.22, 0.60, 0.38, 0.26)):
        x = 0.945
        bx("plate", (sd * (x + 0.007), f, z), (0.014, w, h), "armor", bevel=0.004, seg=1, g="panel_door_L" if sd > 0 else "panel_door_R")
        bolts("rivets", rect_rivets((sd * (x + 0.014), f, z), "x", w, h, 0.022, 0.09, sign=sd), 0.0085, 0.008, "armor", g="panel_door_L" if sd > 0 else "panel_door_R", cap_dome=True)
    # antenna whip with a small pennant on the right rear quarter
    tube("ant_mast", [(-0.86, -1.78, 0.95), (-0.86, -1.80, 1.35), (-0.85, -1.84, 1.62)], 0.005, "metal_bare", g="body")
    strip_wave("flag", (-0.85, -1.84, 1.60), 0.34, 0.14, 0.05, 3.0, "cloth_dark", direction=(0, -1, 0), nseg=8, droop=0.04, g="body")
    bx("ant_base", (-0.86, -1.78, 0.955), (0.05, 0.05, 0.03), "metal_dark", bevel=0.006, seg=1, g="body")


def build_sockets():
    sock("seat_driver", 0.42, -0.04, 0.53)
    sock("steering_wheel", 0.42, 0.30, 0.895, pitch=-22)
    sock("light_head_L", 0.56, 2.30, 0.78)
    sock("light_head_R", -0.56, 2.30, 0.78)
    sock("light_tail_L", 0.47, -2.30, 0.76, yaw=180)
    sock("light_tail_R", -0.47, -2.30, 0.76, yaw=180)
    sock("exhaust_L", 0.42, -2.50, 0.30, yaw=180)
    sock("exhaust_R", -0.42, -2.50, 0.30, yaw=180)
    sock("smoke_engine", 0.0, 1.85, 0.80)
    sock("fuel_cap", 0.972, -1.95, 0.80, yaw=90)
    sock("roof_top", 0.0, -0.25, 1.34)
    sock("camera_hood", 0.0, 0.95, 1.01)


tub = build_shell()
build_wheels()
build_greenhouse()
door_extras(1, "panel_door_L")
door_extras(-1, "panel_door_R")
build_nose()
build_tail()
build_engine()
build_interior()
build_cage()
build_sidepipes()
build_underbody()
build_details()
build_sockets()

V.pivot("panel_hood", 0, 0.70, 0.985)
V.pivot("panel_trunk", 0, -1.96, 0.975)
V.pivot("panel_bumper_F", 0, 2.35, 0.40)
V.pivot("panel_bumper_R", 0, -2.35, 0.38)
V.pivot("panel_door_L", 0.92, 0.62, 0.65)
V.pivot("panel_door_R", -0.92, 0.62, 0.65)
finish_wheel_shading()
V.finish(bake=True)
