"""e_sedan "Bandit" - rusted 1980s land-yacht sedan, roof chopped behind the front seats, gunner stands on the rear seat.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/sedan.py -- [--nobake]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *

STYLE = dict(seed=5, rust=1.1, dirt=0.85, wear=0.85, scratch=0.6)
V = Vehicle("e_sedan", style=STYLE)
M = V.M
reset_wheel_cache()
SKULL = make_image("skull", skull_alpha(512))
TALLY = make_image("tally", tally_alpha(512))
XMARK = make_image("xmark", xmark_alpha(512))


def hook_paint(ctx, col):
    g = ctx["g"]
    dark = (0.02, 0.02, 0.02)
    m = stamp(ctx, SKULL, (-0.26, 1.50, 1.0), (1, 0, 0), (0, -1, 0), (0.86, 0.86), thick=0.09)     # hood skull (reads from the front)
    col = g.mixc(g.mul(m, 0.93), col, dark)
    m = stamp(ctx, TALLY, (0.28, -1.90, 1.0), (1, 0, 0), (0, 1, 0), (0.56, 0.56), thick=0.09)      # trunk tally marks (read from the rear)
    col = g.mixc(g.mul(m, 0.9), col, dark)
    m = stamp(ctx, XMARK, (-0.97, -2.12, 0.66), (0, 1, 0), (0, 0, 1), (0.42, 0.42), thick=0.06, n=(-1, 0, 0))   # right quarter panel
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


STYLE["hooks"] = {"paint": hook_paint}

# --------------------------------------------------------------------------------------------- key dimensions
AX_F, AX_R = 1.62, -1.42            # axle positions (f)
HUB_Z = 0.39                        # tyre radius
TRACK = 0.79                        # |x| of wheel centre plane
GAP = 0.004


def body_ring(hw, zb, belt, zt):
    half = [(0.0, zb), (hw * 0.78, zb), (hw * 0.93, zb + 0.05), (hw * 0.995, zb + 0.17), (hw, (zb + belt) * 0.5 + 0.02),
            (hw * 0.985, belt - 0.11), (hw * 0.958, belt - 0.025), (hw * 0.925, belt), (hw * 0.55, (belt + zt) * 0.5 + 0.003), (0.0, zt)]
    return sym_ring(half)


def make_tub():
    S = [
        (2.52, (0.86, 0.44, 0.90, 0.90)), (2.49, (0.92, 0.41, 0.925, 0.935)), (2.40, (0.965, 0.33, 0.945, 0.962)),
        (2.20, (0.982, 0.26, 0.955, 0.972)), (1.60, (0.985, 0.24, 0.968, 0.987)), (0.90, (0.985, 0.24, 0.98, 1.004)),
        (0.72, (0.985, 0.24, 0.99, 1.02)), (0.60, (0.985, 0.24, 0.99, 0.99)), (-1.25, (0.985, 0.24, 0.99, 0.99)),
        (-1.36, (0.985, 0.24, 0.99, 1.0)), (-2.0, (0.985, 0.24, 0.985, 0.995)), (-2.40, (0.965, 0.30, 0.955, 0.966)),
        (-2.49, (0.92, 0.38, 0.93, 0.945)), (-2.52, (0.86, 0.44, 0.92, 0.92)),
    ]
    st = [(f, body_ring(*p)) for f, p in S]
    return loft_f("tub", st, "paint", cap=True)


def cutter(c, s, m="metal_dark", **kw):
    return bx("_cut", c, s, m, **kw)


def build_shell():
    tub = make_tub()
    for f in (AX_F, AX_R):
        for sx in (1, -1):
            cut = cyl("_arch", (sx * 0.93, f, HUB_Z), 0.47, 0.5, "x", "metal_dark", sides=40)
            bool_op(tub, cut)

    def extract(name, c, s, grp, inner="metal_dark", mat=None):
        cp = duplicate(tub, name)
        cu = cutter(c, s, inner)
        bool_op(cp, cu, "INTERSECT")
        for sl in cp.material_slots:
            if sl.material and sl.material.name == "paint" and mat:
                sl.material = M[mat]
            elif sl.material and sl.material.name in ("metal_dark", "interior"):
                sl.material = M[mat or "paint"]
        add_bevel(cp, 0.007, 1, 30)
        apply_modifiers(cp)
        return reg(cp, grp)

    def box_fz(x0, x1, f0, f1, z0, z1):
        return ((x0 + x1) / 2, (f0 + f1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(f1 - f0), abs(z1 - z0))

    # ---- panels (extracted, slightly smaller than their pockets)
    g = GAP
    # hood
    c, s = box_fz(-0.80, 0.80, 0.70 + g, 2.44 - g, 0.90, 1.10)
    extract("hood", c, s, "panel_hood", "paint")
    # trunk lid
    c, s = box_fz(-0.80, 0.80, -2.44 + g, -1.365 - g, 0.90, 1.10)
    extract("trunk", c, s, "panel_trunk", "paint")
    # doors: (name, side, f0, f1, paint material)
    doors = [("door_L", 1, -0.30, 0.66, "paint2", "panel_door_L"), ("door_R", -1, -0.30, 0.66, "paint", "panel_door_R"),
             ("door_L2", 1, -0.99, -0.32, "paint", "panel_door_L2"), ("door_R2", -1, -0.99, -0.32, "paint2", "panel_door_R2")]
    for nm, sd, f0, f1, pm, grp in doors:
        x0, x1 = (0.845 + g, 1.10) if sd > 0 else (-1.10, -0.845 - g)
        c, s = box_fz(x0, x1, f0 + g, f1 - g, 0.30 + g, 1.10)
        extract(nm, c, s, grp, pm, mat=pm)
    # ---- pockets in the tub
    def pocket(x0, x1, f0, f1, z0, z1, m="metal_dark"):
        c, s = box_fz(x0, x1, f0, f1, z0, z1)
        bool_op(tub, cutter(c, s, m))
    pocket(-0.815, 0.815, 0.685, 2.455, 0.86, 1.2)          # hood opening
    pocket(-0.66, 0.66, 0.85, 2.30, 0.34, 0.90)             # engine bay
    pocket(-0.815, 0.815, -2.455, -1.35, 0.86, 1.2)         # trunk opening
    pocket(-0.66, 0.66, -2.30, -1.50, 0.34, 0.90)           # trunk cavity
    for sd in (1, -1):
        for f0, f1 in ((-0.30, 0.66), (-0.99, -0.32)):
            x0, x1 = (0.845, 1.12) if sd > 0 else (-1.12, -0.845)
            pocket(x0, x1, f0 - 1.5 * g, f1 + 1.5 * g, 0.29, 1.2)
    pocket(-0.79, 0.79, -0.80, 0.60, 0.34, 1.2, "interior")  # cabin pit (front)
    pocket(-0.66, 0.66, -1.20, -0.79, 0.34, 1.2, "interior")  # cabin pit (rear seat)
    # underbody recesses (axles / exhaust / engine underside visible from below)
    pocket(-0.62, 0.62, 0.95, 2.30, -0.05, 0.52)
    pocket(-0.62, 0.62, -2.30, -1.25, -0.05, 0.52)
    # lamp + grille pockets in the nose / tail
    for sd in (1, -1):
        for cx in (0.735, 0.535):
            pocket(sd * cx - 0.095, sd * cx + 0.095, 2.44, 2.62, 0.72, 0.86)
        pocket(sd * 0.56 - 0.29, sd * 0.56 + 0.29, -2.62, -2.44, 0.74, 0.88)
    pocket(-0.36, 0.36, 2.43, 2.62, 0.58, 0.88)
    add_bevel(tub, 0.008, 1, 30)
    apply_modifiers(tub)
    reg(tub, "body")
    return tub




def _interp(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for i in range(len(pts) - 1):
        if pts[i][0] <= x <= pts[i + 1][0]:
            t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
            return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    return pts[-1][1]


def side_x(z):
    return _interp([(0.24, 0.768), (0.29, 0.916), (0.41, 0.980), (0.635, 0.985), (0.88, 0.970), (0.965, 0.944), (0.99, 0.911)], z)


def hood_z(f):
    return _interp([(0.72, 1.02), (0.90, 1.004), (1.6, 0.987), (2.2, 0.972), (2.4, 0.962), (2.5, 0.95)], f)


def deck_z(f):
    return _interp([(-2.5, 0.945), (-2.0, 0.995), (-1.36, 1.0)], f)


def build_wheels():
    W, R, RR = 0.285, 0.39, 0.215
    for nm, x, f in (("FL", TRACK, AX_F), ("FR", -TRACK, AX_F), ("RL", TRACK, AX_R), ("RR", -TRACK, AX_R)):
        build_wheel(V, "wheel_" + nm, (x, f, HUB_Z), 1 if x > 0 else -1, R, W, RR, tire="offroad", spokes=8, lugs=5, key="sedan")


# ------------------------------------------------------------------------------------------- greenhouse / roof
def build_greenhouse():
    # windshield glass + frame
    quad_slab("windshield", [(0.80, 0.68, 1.03), (-0.80, 0.68, 1.03), (-0.75, 0.17, 1.395), (0.75, 0.17, 1.395)], 0.010, "glass", out=(0, 1, 1), g="body")
    for sd in (1, -1):
        beam("apillar", (sd * 0.81, 0.70, 0.99), (sd * 0.765, 0.135, 1.41), 0.05, 0.075, "paint", u=(0, 1, 0.6), g="body", bevel=0.006)
    beam("wsh_bottom", (0.80, 0.685, 1.03), (-0.80, 0.685, 1.03), 0.03, 0.03, "interior", u=(0, 1, 0), g="body")
    # chopped roof cap with a torch-cut ragged rear edge
    rear = jag_poly((-0.80, -0.42), (0.80, -0.42), 14, 0.02, seed=3)
    poly = [(0.80, 0.12), (-0.80, 0.12)] + rear
    roof = prism("roof", poly, "xf", 1.392, 1.442, "paint", bevel=0.006, seg=1, g="body")
    beam("cutedge", (0.80, -0.418, 1.395), (-0.80, -0.418, 1.395), 0.012, 0.045, "metal_bare", u=(0, 0, 1), g="body")
    # rear window frame remnants (sawn-off pillars on the rear doors)
    for sd in (1, -1):
        prism("sawn", jag_poly((-0.34, 1.0), (-0.34, 1.16), 3, 0.012, 4) + [(-0.40, 1.16), (-0.40, 1.0)], "fz", sd * 0.83, sd * 0.89, "metal_bare", g="body")


def door_extras(sd, grp, dmat, front, f0, f1):
    """Glass, frame, handle, moulding, mirror for a door (x side sd, f range f0..f1)."""
    if front:
        top = 1.385
        q = [(sd * 0.868, 0.60, 1.0), (sd * 0.868, 0.15, top), (sd * 0.868, -0.24, top), (sd * 0.868, -0.24, 1.0)]
        gl = quad_slab("dglass", q, 0.008, "glass", out=(sd, 0, 0), g=grp)
        deform_verts(gl, lambda v: Vector((v.x - sd * 0.14 * max(v.z - 1.0, 0), v.y, v.z)))
        beam("rail", (sd * 0.822, 0.13, top + 0.012), (sd * 0.822, -0.27, top + 0.012), 0.04, 0.03, "chrome", u=(1, 0, 0), g=grp)
        beam("post", (sd * 0.875, -0.265, 0.99), (sd * 0.822, -0.265, top + 0.01), 0.05, 0.035, dmat, u=(0, 1, 0), g=grp, bevel=0.004)
        beam("sash", (sd * 0.878, 0.62, 0.99), (sd * 0.822, 0.12, top + 0.01), 0.03, 0.04, dmat, u=(1, 0, 0), g=grp)
        bx("mir_arm", (sd * 1.00, 0.55, 1.06), (0.10, 0.025, 0.025), "chrome", g=grp)
        bx("mir_head", (sd * 1.06, 0.55, 1.08), (0.05, 0.16, 0.11), "interior", bevel=0.012, seg=1, g=grp)
        bx("mir_glass", (sd * 1.058, 0.55, 1.08), (0.058, 0.14, 0.09), "chrome", g=grp)
        fh = f1 - 0.16
    else:
        fh = f1 - 0.17
    bx("handle", (sd * (side_x(0.90) + 0.006), fh, 0.90), (0.022, 0.15, 0.022), "chrome", bevel=0.005, seg=1, g=grp)
    bx("handle_base", (sd * (side_x(0.90) + 0.003), fh, 0.90), (0.014, 0.19, 0.045), "chrome", bevel=0.004, seg=1, g=grp)
    beam("rub", (sd * (side_x(0.62) + 0.004), f0 + 0.05, 0.62), (sd * (side_x(0.62) + 0.004), f1 - 0.05, 0.62), 0.018, 0.055, "chrome", u=(1, 0, 0), g=grp)


# ------------------------------------------------------------------------------------------- nose / tail
def build_nose_tail():
    poly = [(-0.80, 2.58), (0.80, 2.58), (0.93, 2.55), (1.00, 2.47), (1.005, 2.36), (0.90, 2.36), (0.86, 2.47), (0.80, 2.53),
            (-0.80, 2.53), (-0.86, 2.47), (-0.90, 2.36), (-1.005, 2.36), (-1.00, 2.47), (-0.93, 2.55)]
    prism("bumper_F", poly, "xf", 0.33, 0.60, "chrome", bevel=0.012, seg=2, g="panel_bumper_F")
    bx("bF_strip", (0, 2.586, 0.47), (1.5, 0.014, 0.06), "armor", g="panel_bumper_F")
    for sd in (1, -1):
        cyl("overrider", (sd * 0.50, 2.62, 0.47), 0.045, 0.16, "f", "chrome", sides=10, r2=0.035, g="panel_bumper_F")
    poly = [(-0.80, -2.58), (0.80, -2.58), (0.93, -2.55), (1.00, -2.47), (1.005, -2.36), (0.90, -2.36), (0.86, -2.47), (0.80, -2.53),
            (-0.80, -2.53), (-0.86, -2.47), (-0.90, -2.36), (-1.005, -2.36), (-1.00, -2.47), (-0.93, -2.55)]
    prism("bumper_R", poly[::-1], "xf", 0.33, 0.60, "chrome", bevel=0.012, seg=2, g="panel_bumper_R")
    bx("bR_strip", (0, -2.586, 0.47), (1.5, 0.014, 0.06), "chrome", g="panel_bumper_R")
    for sd in (1, -1):
        cyl("overrider", (sd * 0.62, -2.62, 0.47), 0.045, 0.16, "f", "chrome", sides=10, r2=0.035, g="panel_bumper_R")
    for sd in (1, -1):
        for cx in (0.735, 0.535):
            x = sd * cx
            bx("hl_lens", (x, 2.492, 0.79), (0.165, 0.018, 0.115), "light_head", g="body")
            bx("hl_refl", (x, 2.475, 0.79), (0.18, 0.015, 0.125), "chrome", g="body")
            for dx, dz, sx, sz in ((0, 0.07, 0.19, 0.016), (0, -0.07, 0.19, 0.016), (-0.09, 0, 0.016, 0.14), (0.09, 0, 0.016, 0.14)):
                bx("hl_bezel", (x + dx, 2.505, 0.79 + dz), (sx, 0.022, sz), "chrome", g="body")
    bx("grille_bk", (0, 2.46, 0.73), (0.70, 0.02, 0.29), "metal_dark", g="body")
    for i in range(6):
        bx("grille_bar", (0, 2.50, 0.60 + i * 0.05), (0.70, 0.016, 0.014), "chrome", g="body")
    for i in range(-3, 4):
        bx("grille_vbar", (i * 0.1, 2.50, 0.73), (0.012, 0.016, 0.28), "chrome", g="body")
    bx("grille_frame_t", (0, 2.51, 0.885), (0.76, 0.02, 0.03), "chrome", g="body")
    bx("grille_frame_b", (0, 2.51, 0.575), (0.76, 0.02, 0.03), "chrome", g="body")
    for sd in (1, -1):
        bx("grille_frame_s", (sd * 0.37, 2.51, 0.73), (0.03, 0.02, 0.34), "chrome", g="body")
    for sd in (1, -1):
        x = sd * 0.56
        bx("tl_lens", (x, -2.482, 0.81), (0.53, 0.018, 0.115), "light_tail", g="body")
        bx("tl_refl", (x, -2.465, 0.81), (0.55, 0.015, 0.13), "chrome", g="body")
        for dx, dz, sx, sz in ((0, 0.07, 0.56, 0.016), (0, -0.07, 0.56, 0.016), (-0.275, 0, 0.016, 0.14), (0.275, 0, 0.016, 0.14)):
            bx("tl_bezel", (x + dx, -2.505, 0.81 + dz), (sx, 0.022, sz), "chrome", g="body")
        bx("rev_lens", (sd * 0.30, -2.50, 0.81), (0.06, 0.02, 0.085), "light_head", g="body")
    bx("plate", (0, -2.535, 0.66), (0.40, 0.012, 0.20), "armor", bevel=0.004, seg=1, roll=3, g="panel_trunk")
    for sd in (1, -1):
        cyl("tip", (sd * 0.50, -2.56, 0.27), 0.045, 0.22, "f", "chrome", sides=12, g="body")


# ------------------------------------------------------------------------------------------- interior
def build_interior():
    bx("fseat_base", (0, -0.02, 0.38), (1.42, 0.60, 0.08), "interior", g="body")
    bx("fseat_cush", (0, -0.02, 0.46), (1.44, 0.60, 0.13), "fabric", bevel=0.03, seg=2, g="body")
    bx("fseat_back", (0, -0.36, 0.80), (1.44, 0.15, 0.62), "fabric", bevel=0.04, seg=2, pitch=12, g="body")
    bx("fseat_backframe", (0, -0.44, 0.80), (1.40, 0.02, 0.58), "interior", pitch=12, g="body")
    for sx in (0.40, -0.40):
        bx("headrest", (sx, -0.42, 1.18), (0.26, 0.09, 0.15), "fabric", bevel=0.03, seg=2, g="body")
    bx("rseat_base", (0, -0.86, 0.38), (1.26, 0.62, 0.08), "interior", g="body")
    bx("rseat_cush", (0, -0.86, 0.47), (1.28, 0.62, 0.16), "fabric", bevel=0.03, seg=2, g="body")
    bx("rseat_back", (0, -1.17, 0.80), (1.28, 0.14, 0.60), "fabric", bevel=0.04, seg=2, pitch=8, g="body")
    bx("dash", (0, 0.55, 0.83), (1.56, 0.30, 0.19), "interior", bevel=0.02, seg=2, g="body")
    bx("dash_top", (0, 0.58, 0.945), (1.56, 0.26, 0.04), "interior", bevel=0.012, seg=1, pitch=-4, g="body")
    bx("binnacle", (0.40, 0.56, 0.99), (0.42, 0.16, 0.08), "interior", bevel=0.015, seg=1, g="body")
    bx("gauge", (0.40, 0.475, 0.985), (0.34, 0.012, 0.045), "metal_bare", g="body")
    bx("radio", (0, 0.44, 0.83), (0.30, 0.03, 0.09), "metal_dark", g="body")
    bx("glovebox", (-0.42, 0.42, 0.79), (0.36, 0.03, 0.14), "interior", g="body")
    wc = (0.40, 0.46, 0.925)
    ang = 24
    nrm = (0, math.cos(ang * D2R), -math.sin(ang * D2R))
    tube("swheel", ring_pts(wc, nrm, 0.19, 18), 0.0135, "interior", closed=True, g="body")
    tube("swspoke1", [(wc[0] - 0.19, wc[1], wc[2]), (wc[0] + 0.19, wc[1], wc[2])], 0.011, "interior", g="body")
    s, c = math.sin(ang * D2R), math.cos(ang * D2R)
    beam("swspoke2", (wc[0], wc[1] - 0.19 * s * 0.0 + 0.19 * s, wc[2] + 0.19 * c), (wc[0], wc[1] - 0.19 * s, wc[2] - 0.19 * c), 0.02, 0.02, "interior", g="body")
    cyl("swhub", (wc[0], wc[1] + 0.012, wc[2] - 0.005), 0.045, 0.05, "f", "chrome", sides=10, pitch=-ang, g="body")
    tube("column", [(wc[0], wc[1] + 0.03, wc[2] - 0.012), (wc[0], 0.68, 0.78)], 0.03, "interior", g="body")
    bx("tunnel", (0, -0.1, 0.41), (0.30, 1.45, 0.10), "interior", bevel=0.03, seg=1, g="body")
    tube("shifter", [(0.0, 0.10, 0.44), (0.0, 0.15, 0.68)], 0.012, "metal_dark", g="body")
    for sd in (1, -1):
        bx("armrest", (sd * 0.765, 0.14, 0.78), (0.055, 0.50, 0.055), "interior", bevel=0.012, seg=1, g="body")
        bx("armrest2", (sd * 0.765, -0.66, 0.78), (0.055, 0.45, 0.055), "interior", bevel=0.012, seg=1, g="body")


# ------------------------------------------------------------------------------------------- roll bar, gunner rail, plates
def build_cage():
    r = 0.028
    hoop = [(0.75, -0.47, 0.42), (0.75, -0.47, 1.64), (-0.75, -0.47, 1.64), (-0.75, -0.47, 0.42)]
    tube("hoop", hoop, r, "metal_bare", fillet=0.20, fn=5, res=1, g="body")
    for sd in (1, -1):
        tube("brace", [(sd * 0.75, -0.47, 1.52), (sd * 0.84, -1.22, 1.02)], 0.022, "metal_bare", g="body")
        bx("hoop_plate", (sd * 0.75, -0.47, 0.99), (0.13, 0.13, 0.014), "armor", bevel=0.004, seg=1, g="body")
        bolts("hoop_bolts", [((sd * 0.75 + dx, -0.47 + df, 0.997), (0, 0, 1)) for dx in (-0.045, 0.045) for df in (-0.045, 0.045)], 0.011, 0.01, "metal_bare", g="body")
        prism("gusset", [(-0.47, 1.5), (-0.47, 1.36), (-0.62, 1.5)], "fz", sd * 0.72, sd * 0.78, "armor", g="body")
    rail = [(0.86, -1.10, 1.0), (0.86, -1.22, 1.38), (-0.86, -1.22, 1.38), (-0.86, -1.10, 1.0)]
    tube("rail", rail, 0.024, "metal_bare", fillet=0.12, fn=5, g="body")
    for sd in (1, -1):
        tube("rail_tie", [(sd * 0.86, -1.22, 1.38), (sd * 0.80, -0.78, 1.34), (sd * 0.75, -0.47, 1.32)], 0.02, "metal_bare", fillet=0.08, g="body")


def plate_side(sd, f, z, wf, hz, grp, seed, t=0.014):
    x = side_x(z)
    c = (sd * (x + t / 2 - 0.002), f, z)
    bx("plate", c, (t, wf, hz), "armor", bevel=0.004, seg=1, g=grp)
    bolts("rivets", rect_rivets((sd * (x + t - 0.002), f, z), "x", wf, hz, 0.022, 0.09, sign=sd), 0.0085, 0.008, "armor", g=grp, cap_dome=True)
    xw = sd * (x + t + 0.001)
    for (f0, z0, f1, z1) in ((f - wf / 2, z + hz / 2, f + wf / 2, z + hz / 2), (f - wf / 2, z - hz / 2, f + wf / 2, z - hz / 2)):
        weld_line("weld", (xw, f0, z0), (xw, f1, z1), seed=seed * 5 + int(z0 * 100), m="armor", g=grp)


def build_plates():
    plate_side(-1, 0.16, 0.66, 0.56, 0.36, "panel_door_R", 1)
    plate_side(1, -0.66, 0.60, 0.34, 0.26, "panel_door_L2", 2)
    plate_side(-1, -0.60, 0.72, 0.28, 0.20, "panel_door_R2", 3)
    fz = hood_z(1.55) - 0.001
    bx("hplate", (0.55, 1.62, fz + 0.007), (0.40, 0.42, 0.014), "armor", bevel=0.004, seg=1, g="panel_hood")
    bolts("hrivets", rect_rivets((0.55, 1.62, fz + 0.014), "z", 0.40, 0.42, 0.024, 0.09), 0.0085, 0.008, "armor", g="panel_hood", cap_dome=True)
    fz = deck_z(-1.85)
    bx("tplate", (-0.42, -1.85, fz + 0.007), (0.44, 0.38, 0.014), "armor", bevel=0.004, seg=1, g="panel_trunk")
    bolts("trivets", rect_rivets((-0.42, -1.85, fz + 0.014), "z", 0.44, 0.38, 0.024, 0.09), 0.0085, 0.008, "armor", g="panel_trunk", cap_dome=True)
    r = 0.034
    tube("pushbar", [(0.74, 2.46, 0.36), (0.74, 2.64, 0.40), (0.74, 2.66, 0.78), (-0.74, 2.66, 0.78), (-0.74, 2.64, 0.40), (-0.74, 2.46, 0.36)], r, "armor", fillet=0.09, g="panel_bumper_F")
    tube("pushbar_mid", [(0.0, 2.64, 0.40), (0.0, 2.66, 0.78)], 0.028, "armor", g="panel_bumper_F")
    tube("pushbar_cross", [(0.74, 2.655, 0.59), (-0.74, 2.655, 0.59)], 0.028, "armor", g="panel_bumper_F")
    base = (0.80, -2.05, 0.995)
    tube("ant_mast", [base, (0.80, -2.06, 1.45), (0.78, -2.08, 1.80)], 0.005, "metal_bare", g="body")
    tube("ant_hanger", [(0.78, -2.08, 1.80), (0.78, -2.08, 1.86), (0.71, -2.08, 1.86), (0.71, -2.08, 1.91), (0.78, -2.08, 2.02), (0.85, -2.08, 1.91), (0.85, -2.08, 1.86), (0.78, -2.08, 1.86)],
         0.004, "metal_bare", g="body")
    strip_wave("flag", (0.78, -2.085, 2.00), 0.42, 0.16, 0.06, 3.0, "cloth_red", direction=(0, -1, 0), nseg=9, droop=0.05, g="body")
    bx("ant_base", (0.80, -2.05, 1.0), (0.05, 0.05, 0.03), "metal_dark", bevel=0.006, seg=1, g="body")
    cyl("fuelcap", (0.982, -2.05, 0.80), 0.048, 0.02, "x", "chrome", sides=12, g="body")
    bx("fuelflap", (0.978, -2.05, 0.80), (0.012, 0.13, 0.13), "armor", bevel=0.004, seg=1, g="body")


# ------------------------------------------------------------------------------------------- engine + underbody
def build_engine():
    bx("block", (0, 1.50, 0.58), (0.44, 0.66, 0.34), "metal_dark", bevel=0.015, seg=1, g="body")
    for sd in (1, -1):
        bx("head", (sd * 0.24, 1.50, 0.64), (0.16, 0.60, 0.20), "metal_dark", bevel=0.012, seg=1, roll=sd * -12, g="body")
        bx("valvecover", (sd * 0.27, 1.50, 0.75), (0.13, 0.55, 0.05), "metal_bare", bevel=0.01, seg=1, roll=sd * -12, g="body")
        tube("manifold", [(sd * 0.34, 1.32, 0.60), (sd * 0.38, 1.20, 0.50), (sd * 0.36, 1.05, 0.40)], 0.035, "metal_dark", g="body", fillet=0.05)
    cyl("aircleaner", (0, 1.50, 0.85), 0.20, 0.07, "z", "metal_dark", sides=20, g="body")
    cyl("aircleaner_lid", (0, 1.50, 0.895), 0.185, 0.02, "z", "metal_bare", sides=20, g="body")
    bx("intake", (0, 1.50, 0.75), (0.14, 0.42, 0.10), "metal_dark", bevel=0.01, seg=1, g="body")
    bx("radiator", (0, 2.30, 0.62), (0.64, 0.08, 0.46), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("rad_fin", (i * 0.09, 2.34, 0.62), (0.008, 0.02, 0.44), "metal_bare", g="body")
    bx("shroud", (0, 2.20, 0.62), (0.60, 0.12, 0.42), "interior", bevel=0.01, seg=1, g="body")
    cyl("fan", (0, 2.06, 0.62), 0.19, 0.03, "f", "metal_bare", sides=12, g="body")
    bx("battery", (-0.50, 2.05, 0.50), (0.24, 0.18, 0.20), "interior", bevel=0.01, seg=1, g="body")
    bx("battery_top", (-0.50, 2.05, 0.61), (0.20, 0.14, 0.03), "metal_bare", g="body")
    tube("hose_up", [(0.24, 2.28, 0.78), (0.24, 2.0, 0.80), (0.10, 1.75, 0.72)], 0.028, "interior", fillet=0.07, g="body")
    tube("hose_lo", [(-0.22, 2.28, 0.45), (-0.24, 1.9, 0.44), (-0.12, 1.72, 0.50)], 0.028, "interior", fillet=0.07, g="body")
    bx("alternator", (0.27, 1.85, 0.52), (0.12, 0.14, 0.12), "metal_bare", bevel=0.01, seg=1, g="body")
    bx("brake_res", (0.45, 0.95, 0.56), (0.12, 0.07, 0.10), "metal_dark", g="body")
    bx("firewall", (0, 0.78, 0.62), (1.30, 0.02, 0.50), "metal_dark", g="body")
    for jx, jf in ((0.30, -2.05), (-0.30, -1.85)):
        bx("jerry", (jx, jf, 0.53), (0.34, 0.16, 0.36), "armor", bevel=0.012, seg=1, g="body")
        bx("jerry_cap", (jx + 0.08, jf, 0.735), (0.07, 0.07, 0.05), "metal_bare", g="body")
        tube("jerry_handle", [(jx - 0.1, jf, 0.71), (jx - 0.1, jf, 0.76), (jx + 0.0, jf, 0.77)], 0.012, "metal_bare", g="body")
    bx("toolbox", (-0.30, -2.20, 0.46), (0.4, 0.22, 0.20), "armor", bevel=0.01, seg=1, g="body")
    bx("trunk_floor", (0, -1.9, 0.44), (1.3, 0.85, 0.02), "metal_dark", g="body")


def build_underbody():
    for sd in (1, -1):
        beam("rail", (sd * 0.60, 2.35, 0.19), (sd * 0.60, -2.35, 0.19), 0.07, 0.09, "metal_dark", u=(1, 0, 0), g="body", bevel=0.006, seg=1)
    for f in (2.0, 1.2, -0.95, -1.85):
        beam("xmem", (0.62, f, 0.24), (-0.62, f, 0.24), 0.10, 0.09, "metal_dark", u=(0, 1, 0), g="body", bevel=0.005, seg=1)
    for sd in (1, -1):
        hub = (sd * (TRACK - 0.10), AX_F, HUB_Z)
        tube("arm_lo", [(sd * 0.60, AX_F - 0.30, 0.26), (sd * 0.64, AX_F, 0.24), (sd * 0.60, AX_F + 0.30, 0.26)], 0.022, "metal_dark", g="body")
        tube("arm_lo2", [(sd * 0.64, AX_F, 0.24), hub], 0.03, "metal_dark", g="body")
        tube("arm_up", [(sd * 0.55, AX_F - 0.15, 0.52), (sd * 0.66, AX_F - 0.05, 0.56), hub], 0.02, "metal_dark", g="body")
        cyl("coil", (sd * 0.56, AX_F, 0.44), 0.062, 0.28, "z", "metal_bare", sides=10, g="body")
        cyl("shock", (sd * 0.66, AX_F - 0.10, 0.43), 0.024, 0.34, "z", "metal_dark", sides=8, g="body")
        bx("knuckle", (sd * (TRACK - 0.12), AX_F, HUB_Z), (0.08, 0.10, 0.20), "metal_dark", bevel=0.01, seg=1, g="body")
    tube("sway", [(0.62, AX_F - 0.32, 0.28), (0.30, AX_F - 0.42, 0.26), (-0.30, AX_F - 0.42, 0.26), (-0.62, AX_F - 0.32, 0.28)], 0.015, "metal_bare", fillet=0.05, g="body")
    tube("tierod", [(0.65, AX_F + 0.16, 0.30), (0.10, AX_F + 0.24, 0.28), (-0.10, AX_F + 0.24, 0.28), (-0.65, AX_F + 0.16, 0.30)], 0.014, "metal_dark", g="body")
    bx("oilpan", (0, 1.45, 0.30), (0.34, 0.50, 0.12), "metal_dark", bevel=0.012, seg=1, g="body")
    bx("trans", (0, 0.92, 0.42), (0.30, 0.55, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    tube("driveshaft", [(0.0, 0.70, 0.30), (0.0, AX_R + 0.05, 0.40)], 0.038, "metal_bare", g="body")
    bx("ujoint", (0, 0.62, 0.30), (0.06, 0.08, 0.06), "metal_dark", g="body")
    tube("axle_r", [(0.79, AX_R, HUB_Z), (-0.79, AX_R, HUB_Z)], 0.055, "metal_dark", g="body")
    ellipsoid("diff", (0, AX_R - 0.04, HUB_Z), (0.17, 0.20, 0.17), "metal_dark", seg=12, rings=8, g="body")
    for sd in (1, -1):
        cyl("drum", (sd * 0.68, AX_R, HUB_Z), 0.17, 0.10, "x", "metal_dark", sides=16, g="body")
        beam("leaf", (sd * 0.58, AX_R + 0.95, 0.32), (sd * 0.58, AX_R - 0.55, 0.32), 0.07, 0.03, "metal_dark", u=(1, 0, 0), g="body")
        beam("leaf2", (sd * 0.58, AX_R + 0.75, 0.29), (sd * 0.58, AX_R - 0.45, 0.29), 0.065, 0.025, "metal_dark", u=(1, 0, 0), g="body")
        cyl("rshock", (sd * 0.66, AX_R - 0.14, 0.44), 0.024, 0.36, "z", "metal_dark", sides=8, roll=sd * 8, g="body")
    tube("exh_L", [(0.35, 1.28, 0.20), (0.30, 0.6, 0.16), (0.30, -0.9, 0.15), (0.32, -1.5, 0.15)], 0.038, "metal_dark", fillet=0.12, g="body")
    tube("exh_R", [(-0.35, 1.28, 0.20), (-0.30, 0.6, 0.16), (-0.30, -0.9, 0.15), (-0.32, -1.5, 0.15)], 0.038, "metal_dark", fillet=0.12, g="body")
    for sd in (1, -1):
        cyl("muffler", (sd * 0.32, -1.98, 0.17), 0.085, 0.80, "f", "metal_dark", sides=12, g="body")
        tube("tailpipe", [(sd * 0.32, -2.38, 0.17), (sd * 0.50, -2.48, 0.24), (sd * 0.50, -2.55, 0.27)], 0.032, "metal_dark", fillet=0.06, g="body")
    bx("fueltank", (0.0, -1.62, 0.32), (0.90, 0.50, 0.14), "metal_dark", bevel=0.02, seg=1, g="body")
    for f in (-1.45, -1.80):
        beam("strap", (0.5, f, 0.24), (-0.5, f, 0.24), 0.03, 0.01, "metal_bare", u=(0, 1, 0), g="body")


def build_rust(tub):
    """Fixed-colour rust: rocker bands, wheel-arch lips and organic blobs on the static body (independent of the paint tint)."""
    for sd in (1, -1):
        beam("sill_rust", (sd * (side_x(0.29) + 0.0), 0.66, 0.285), (sd * (side_x(0.29) + 0.0), -0.99, 0.285), 0.022, 0.05, "rust", u=(1, 0, 0), g="body")
        for AX in (AX_F, AX_R):
            pts = []
            for a in range(8, 173, 11):
                th = a * D2R
                z = HUB_Z + 0.487 * math.sin(th)
                pts.append((sd * (side_x(z) + 0.002), AX + 0.487 * math.cos(th), z))
            tube("arch_lip", pts, 0.013, "rust", res=0, g="body")
    ray = raycast_targets([tub])
    rnd = random.Random(11)
    spots = []
    for sd in (1, -1):
        for _ in range(7):
            spots.append((sd, rnd.uniform(1.05, 2.3), rnd.uniform(0.36, 0.80)))
        for _ in range(6):
            spots.append((sd, rnd.uniform(-2.35, -1.88), rnd.uniform(0.36, 0.82)))
    for i, (sd, f, z) in enumerate(spots):
        decal_blob("rustblob", ray, (sd * 1.05, f, z), (-sd, 0, 0), rnd.uniform(0.04, 0.13), "rust", seed=i * 7 + 3, n=16, offset=0.004, irregular=0.6, g="body")


def build_sockets():
    sock("seat_driver", 0.40, 0.03, 0.56)
    sock("steering_wheel", 0.40, 0.46, 0.925, pitch=-24)
    sock("seat_gunner", 0.0, -0.86, 0.555)
    sock("light_head_L", 0.64, 2.50, 0.79)
    sock("light_head_R", -0.64, 2.50, 0.79)
    sock("light_tail_L", 0.56, -2.50, 0.81, yaw=180)
    sock("light_tail_R", -0.56, -2.50, 0.81, yaw=180)
    sock("exhaust_L", 0.50, -2.68, 0.27, yaw=180)
    sock("exhaust_R", -0.50, -2.68, 0.27, yaw=180)
    sock("smoke_engine", 0.0, 1.85, 0.86)
    sock("fuel_cap", 0.985, -2.05, 0.80, yaw=-90)
    sock("roof_top", 0.0, -0.10, 1.46)
    sock("camera_hood", 0.0, 1.35, 1.02)


tub = build_shell()
build_wheels()
build_greenhouse()
door_extras(1, "panel_door_L", "paint2", True, -0.30, 0.66)
door_extras(-1, "panel_door_R", "paint", True, -0.30, 0.66)
door_extras(1, "panel_door_L2", "paint", False, -0.99, -0.32)
door_extras(-1, "panel_door_R2", "paint2", False, -0.99, -0.32)
build_nose_tail()
build_interior()
build_cage()
build_plates()
build_engine()
build_underbody()
build_rust(tub)
build_sockets()

V.pivot("panel_hood", 0, 0.72, 0.99)
V.pivot("panel_trunk", 0, -1.365, 0.99)
V.pivot("panel_bumper_F", 0, 2.55, 0.47)
V.pivot("panel_bumper_R", 0, -2.55, 0.47)
V.pivot("panel_door_L", 0.90, 0.66, 0.65)
V.pivot("panel_door_R", -0.90, 0.66, 0.65)
V.pivot("panel_door_L2", 0.90, -0.32, 0.65)
V.pivot("panel_door_R2", -0.90, -0.32, 0.65)
finish_wheel_shading()
V.finish(bake=True)
