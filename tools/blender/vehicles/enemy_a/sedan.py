"""e_sedan "Bandit" - rusted 1980s land-yacht sedan, roof chopped behind the front seats, gunner stands on the rear seat.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/sedan.py -- [--nobake] [--res 2048 --orm 1024 --samples 16]
Look: slatted armour shutter over the windscreen, cow-skull + spiked push bar, quad sealed-beam lamps (one taped, one smashed),
caged spots on the roll hoop, junk-piled trunk (spare tyre, jerry cans, crate, bedroll), riveted/welded door plates, rust + primer patches.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *
from veh_kit import *

AX_F, AX_R = 1.62, -1.42            # axle positions (f)
HUB_Z = 0.39                        # tyre radius
TRACK = 0.79                        # |x| of wheel centre plane
GAP = 0.004

STYLE = dict(seed=5, rust=1.0, dirt=0.85, wear=0.85, scratch=0.6, dust=0.8, wheels=[(AX_F, HUB_Z, 0.39), (AX_R, HUB_Z, 0.39)])
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
    m = stamp(ctx, XMARK, (-0.97, -2.10, 0.68), (0, 1, 0), (0, 0, 1), (0.40, 0.40), thick=0.06, n=(-1, 0, 0))   # right quarter panel
    col = g.mixc(g.mul(m, 0.9), col, dark)
    m = stamp(ctx, TALLY, (0.975, -1.98, 0.70), (0, -1, 0), (0, 0, 1), (0.44, 0.34), thick=0.06, n=(1, 0, 0))   # left quarter: kill tally
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


STYLE["hooks"] = {"paint": hook_paint}


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

    g = GAP
    c, s = box_fz(-0.80, 0.80, 0.70 + g, 2.44 - g, 0.90, 1.10)
    extract("hood", c, s, "panel_hood", "paint")
    c, s = box_fz(-0.80, 0.80, -2.44 + g, -1.365 - g, 0.90, 1.10)
    extract("trunk", c, s, "panel_trunk", "paint")
    doors = [("door_L", 1, -0.30, 0.66, "paint2", "panel_door_L"), ("door_R", -1, -0.30, 0.66, "paint", "panel_door_R"),
             ("door_L2", 1, -0.99, -0.32, "paint", "panel_door_L2"), ("door_R2", -1, -0.99, -0.32, "paint2", "panel_door_R2")]
    for nm, sd, f0, f1, pm, grp in doors:
        x0, x1 = (0.845 + g, 1.10) if sd > 0 else (-1.10, -0.845 - g)
        c, s = box_fz(x0, x1, f0 + g, f1 - g, 0.30 + g, 1.10)
        extract(nm, c, s, grp, pm, mat=pm)

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
    pocket(-0.62, 0.62, 0.95, 2.30, -0.05, 0.52)
    pocket(-0.62, 0.62, -2.30, -1.25, -0.05, 0.52)
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
        build_wheel2(V, "wheel_" + nm, (x, f, HUB_Z), 1 if x > 0 else -1, R, W, RR, tire="at", rim_style="steel", spokes=6, lugs=5, key="sedan")
        caliper("caliper", (x, f, HUB_Z), 1 if x > 0 else -1, RR, W, front=f > 0)


# ------------------------------------------------------------------------------------------- greenhouse / roof
def build_greenhouse():
    quad_slab("windshield", [(0.80, 0.68, 1.03), (-0.80, 0.68, 1.03), (-0.75, 0.17, 1.395), (0.75, 0.17, 1.395)], 0.010, "glass", out=(0, 1, 1), g="body")
    for sd in (1, -1):
        beam("apillar", (sd * 0.81, 0.70, 0.99), (sd * 0.765, 0.135, 1.41), 0.05, 0.075, "paint", u=(0, 1, 0.6), g="body", bevel=0.006)
    beam("wsh_bottom", (0.80, 0.685, 1.03), (-0.80, 0.685, 1.03), 0.03, 0.03, "interior", u=(0, 1, 0), g="body")
    # chopped roof cap with a torch-cut ragged rear edge + drip rails
    rear = jag_poly((-0.80, -0.42), (0.80, -0.42), 14, 0.02, seed=3)
    poly = [(0.80, 0.12), (-0.80, 0.12)] + rear
    prism("roof", poly, "xf", 1.392, 1.442, "paint", bevel=0.006, seg=1, g="body")
    beam("cutedge", (0.80, -0.418, 1.395), (-0.80, -0.418, 1.395), 0.012, 0.045, "rust", u=(0, 0, 1), g="body")
    for sd in (1, -1):
        beam("drip", (sd * 0.805, 0.12, 1.44), (sd * 0.805, -0.40, 1.44), 0.018, 0.022, "paint", u=(1, 0, 0), g="body", bevel=0.004)
        prism("sawn", jag_poly((-0.34, 1.0), (-0.34, 1.16), 3, 0.012, 4) + [(-0.40, 1.16), (-0.40, 1.0)], "fz", sd * 0.83, sd * 0.89, "rust", g="body")
    # --- slatted armour shutter over the windscreen (4 slats, vision slits between), welded to two upright straps + pillar brackets
    b0, t0 = Vector((0.0, 0.68, 1.03)), Vector((0.0, 0.17, 1.395))
    up = (t0 - b0)
    L = up.length
    upn = up / L
    nrm = Vector((0.0, 0.582, 0.813))
    for i in range(4):
        ta, tb = 0.02 + i * 0.148, 0.02 + i * 0.148 + 0.112
        pa, pb = b0 + upn * ta + nrm * 0.05, b0 + upn * tb + nrm * 0.05
        wa, wb = 0.79 - 0.05 * ta / L, 0.79 - 0.05 * tb / L
        q = [(wa, pa.y, pa.z), (-wa, pa.y, pa.z), (-wb, pb.y, pb.z), (wb, pb.y, pb.z)]
        plate("slat%d" % i, q, 0.008, "armor", g="body", out=tuple(nrm), rivets=0, bevel=0.003)
    for sx in (0.46, -0.46):
        p0 = b0 + upn * 0.0 + nrm * 0.062
        p1 = b0 + upn * 0.58 + nrm * 0.062
        beam("slat_strap", (sx, p0.y, p0.z), (sx, p1.y, p1.z), 0.05, 0.010, "armor", u=(1, 0, 0), g="body", bevel=0.003)
        bolts("slat_bolts", [((sx, (b0 + upn * (0.076 + i * 0.148) + nrm * 0.068).y, (b0 + upn * (0.076 + i * 0.148) + nrm * 0.068).z), tuple(nrm)) for i in range(4)],
              0.011, 0.008, "metal_bare", g="body")
    for sd in (1, -1):
        for t in (0.10, 0.50):
            p = b0 + upn * t
            beam("slat_brk", (sd * 0.79, p.y + nrm.y * 0.05, p.z + nrm.z * 0.05), (sd * 0.80, p.y - 0.02, p.z - 0.01), 0.04, 0.012, "armor", u=(0, 0, 1), g="body")
    # --- caged spot lamps on top of the roll hoop
    for sx in (0.40, -0.40):
        lamp("spot", (sx, -0.40, 1.735), 0.075, d=(0, 1, -0.05), depth=0.10, housing="metal_dark", bowl="chrome", g="body", cage=True, sides=14)
        beam("spot_brk", (sx, -0.47, 1.64), (sx, -0.46, 1.72), 0.03, 0.012, "metal_dark", u=(1, 0, 0), g="body")


def door_extras(sd, grp, dmat, front, f0, f1):
    """Glass, frame, handle, moulding, mirror, trim card for a door (x side sd, f range f0..f1)."""
    if front:
        top = 1.385
        q = [(sd * 0.868, 0.60, 1.0), (sd * 0.868, 0.15, top), (sd * 0.868, -0.24, top), (sd * 0.868, -0.24, 1.0)]
        gl = quad_slab("dglass", q, 0.008, "glass", out=(sd, 0, 0), g=grp)
        deform_verts(gl, lambda v: Vector((v.x - sd * 0.14 * max(v.z - 1.0, 0), v.y, v.z)))
        beam("rail", (sd * 0.822, 0.13, top + 0.012), (sd * 0.822, -0.27, top + 0.012), 0.04, 0.03, dmat, u=(1, 0, 0), g=grp)
        beam("post", (sd * 0.875, -0.265, 0.99), (sd * 0.822, -0.265, top + 0.01), 0.05, 0.035, dmat, u=(0, 1, 0), g=grp, bevel=0.004)
        beam("sash", (sd * 0.878, 0.62, 0.99), (sd * 0.822, 0.12, top + 0.01), 0.03, 0.04, dmat, u=(1, 0, 0), g=grp)
        if sd > 0:
            # driver: welded window guard + big truck mirror on two stays
            grille("winguard", [(0.893, 0.50, 1.02), (0.893, -0.22, 1.02), (0.846, -0.22, 1.35), (0.846, 0.20, 1.35)], 6, 4, bar=0.008, frame=0.018, m="metal_dark", g=grp)
            tube("mir_stay1", [(0.90, 0.58, 1.02), (1.05, 0.56, 1.10)], 0.008, "metal_dark", g=grp)
            tube("mir_stay2", [(0.88, 0.56, 1.20), (1.05, 0.56, 1.16)], 0.008, "metal_dark", g=grp)
            bx("mir_head", (1.075, 0.56, 1.13), (0.035, 0.13, 0.19), "metal_dark", bevel=0.01, seg=1, g=grp)
            bx("mir_glass", (1.075, 0.542, 1.13), (0.028, 0.004, 0.17), "chrome", g=grp)
        else:
            # passenger mirror snapped off: bare arm stub
            bx("mir_base", (sd * 0.925, 0.55, 1.03), (0.05, 0.08, 0.05), "metal_dark", bevel=0.006, seg=1, g=grp)
            tube("mir_stub", [(sd * 0.95, 0.55, 1.04), (sd * 1.01, 0.54, 1.07)], 0.009, "metal_bare", g=grp)
        fh = f1 - 0.16
    else:
        fh = f1 - 0.17
    bx("handle", (sd * (side_x(0.90) + 0.006), fh, 0.90), (0.022, 0.15, 0.022), "chrome", bevel=0.005, seg=1, g=grp)
    bx("handle_base", (sd * (side_x(0.90) + 0.003), fh, 0.90), (0.014, 0.19, 0.045), "metal_dark", bevel=0.004, seg=1, g=grp)
    beam("rub", (sd * (side_x(0.62) + 0.004), f0 + 0.05, 0.62), (sd * (side_x(0.62) + 0.004), f1 - 0.05, 0.62), 0.018, 0.045, "plastic", u=(1, 0, 0), g=grp)
    door_card("dcard", sd, 0.845, f0 + 0.03, f1 - 0.03, 0.40, 0.98, grp)


# ------------------------------------------------------------------------------------------- nose / tail
def build_nose_tail():
    poly = [(-0.80, 2.58), (0.80, 2.58), (0.93, 2.55), (1.00, 2.47), (1.005, 2.36), (0.90, 2.36), (0.86, 2.47), (0.80, 2.53),
            (-0.80, 2.53), (-0.86, 2.47), (-0.90, 2.36), (-1.005, 2.36), (-1.00, 2.47), (-0.93, 2.55)]
    prism("bumper_F", poly, "xf", 0.33, 0.60, "armor", bevel=0.012, seg=2, g="panel_bumper_F")
    bx("bF_strip", (0, 2.586, 0.47), (1.5, 0.014, 0.06), "plastic", g="panel_bumper_F")
    poly = [(-0.80, -2.58), (0.80, -2.58), (0.93, -2.55), (1.00, -2.47), (1.005, -2.36), (0.90, -2.36), (0.86, -2.47), (0.80, -2.53),
            (-0.80, -2.53), (-0.86, -2.47), (-0.90, -2.36), (-1.005, -2.36), (-1.00, -2.47), (-0.93, -2.55)]
    prism("bumper_R", poly[::-1], "xf", 0.33, 0.60, "metal_dark", bevel=0.012, seg=2, g="panel_bumper_R")
    bx("bR_strip", (0, -2.586, 0.47), (1.5, 0.014, 0.06), "chrome", g="panel_bumper_R")
    # tow hitch + a dragging chain loop
    bx("hitch", (0.0, -2.64, 0.40), (0.07, 0.16, 0.07), "metal_dark", bevel=0.006, seg=1, g="panel_bumper_R")
    cyl("hitch_ball", (0.0, -2.70, 0.46), 0.03, 0.05, "z", "metal_bare", sides=10, g="panel_bumper_R")
    chain("chainR", [(0.03, -2.70, 0.43), (0.10, -2.69, 0.30), (0.26, -2.62, 0.26), (0.36, -2.59, 0.35)], link=0.065, g="panel_bumper_R")
    # quad sealed-beam headlamps: outer-left taped, inner-right smashed
    for sd in (1, -1):
        for cx in (0.735, 0.535):
            x = sd * cx
            nm = "hl_%s_%d" % ("L" if sd > 0 else "R", int(cx * 1000))
            lamp(nm, (x, 2.502, 0.79), 0.064, d=(0, 1, 0), depth=0.07, housing="metal_dark", bowl="chrome", g="body", sides=16,
                 tape="cloth_tan" if (sd > 0 and cx > 0.6) else None, broken=(sd < 0 and cx < 0.6))
            for dx, dz, sx, sz in ((0, 0.07, 0.19, 0.016), (0, -0.07, 0.19, 0.016), (-0.09, 0, 0.016, 0.14), (0.09, 0, 0.016, 0.14)):
                bx("hl_bezel", (x + dx, 2.505, 0.79 + dz), (sx, 0.022, sz), "chrome", g="body")
    # grille: dark painted egg-crate
    bx("grille_bk", (0, 2.46, 0.73), (0.70, 0.02, 0.29), "metal_dark", g="body")
    for i in range(6):
        bx("grille_bar", (0, 2.50, 0.60 + i * 0.05), (0.70, 0.016, 0.014), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("grille_vbar", (i * 0.1, 2.50, 0.73), (0.012, 0.016, 0.28), "metal_dark", g="body")
    bx("grille_frame_t", (0, 2.51, 0.885), (0.76, 0.02, 0.03), "chrome", g="body")
    bx("grille_frame_b", (0, 2.51, 0.575), (0.76, 0.02, 0.03), "chrome", g="body")
    for sd in (1, -1):
        bx("grille_frame_s", (sd * 0.37, 2.51, 0.73), (0.03, 0.02, 0.34), "chrome", g="body")
    # tail lamp clusters (left one cracked + taped)
    for sd in (1, -1):
        tail_lamp("tl_%s" % ("L" if sd > 0 else "R"), (sd * 0.56, -2.492, 0.81), 0.54, 0.12, d=(0, -1, 0), depth=0.06, g="body",
                  housing="metal_dark", bezel="chrome", ribs=4, reverse=0.2, rev_side=(1 if sd > 0 else -1),
                  broken=(sd > 0), taped=("cloth_tan" if sd > 0 else None))
    bx("plate", (0, -2.535, 0.66), (0.40, 0.012, 0.20), "armor", bevel=0.004, seg=1, roll=3, g="panel_trunk")
    bolts("plate_b", [((sx, -2.543, 0.66 + sz), (0, -1, 0)) for sx in (-0.17, 0.17) for sz in (-0.08, 0.08)], 0.009, 0.008, "metal_bare", g="panel_trunk")
    for sd in (1, -1):
        tube("tip", [(sd * 0.50, -2.46, 0.27), (sd * 0.50, -2.62, 0.265), (sd * 0.50, -2.68, 0.24)], 0.042, "rust", fillet=0.04, g="body")


# ------------------------------------------------------------------------------------------- interior
def build_interior():
    bx("floor", (0, -0.30, 0.345), (1.52, 1.75, 0.02), "fabric", g="body")
    bench_seat("fbench", -0.72, 0.72, -0.02, 0.38, depth=0.58, m="fabric", g="body", recline=12, h=0.62, pleats=8, headrests=(0.40, -0.40))
    bench_seat("rbench", -0.64, 0.64, -0.86, 0.38, depth=0.60, m="fabric", g="body", recline=8, h=0.58, pleats=7)
    for sx in (0.40, -0.40):
        tube("hr_post", [(sx - 0.06, -0.415, 1.02), (sx - 0.06, -0.44, 1.12)], 0.006, "chrome", g="body")
        tube("hr_post", [(sx + 0.06, -0.415, 1.02), (sx + 0.06, -0.44, 1.12)], 0.006, "chrome", g="body")
    bx("dash", (0, 0.55, 0.83), (1.56, 0.30, 0.19), "interior", bevel=0.02, seg=2, g="body")
    bx("dash_top", (0, 0.58, 0.945), (1.56, 0.26, 0.04), "leather", bevel=0.012, seg=1, pitch=-4, g="body")
    bx("binnacle", (0.40, 0.56, 0.99), (0.42, 0.16, 0.08), "interior", bevel=0.015, seg=1, g="body")
    bx("binnacle_hood", (0.40, 0.515, 1.035), (0.44, 0.10, 0.02), "leather", bevel=0.008, seg=1, pitch=-8, g="body")
    gauge_cluster("gauges", (0.40, 0.476, 0.985), n=3, r=0.036, g="body", d=(0, -1, 0.12))
    bx("radio", (0, 0.44, 0.83), (0.30, 0.03, 0.09), "metal_dark", g="body")
    for k in range(4):
        bx("radio_btn", (-0.10 + k * 0.06, 0.425, 0.81), (0.03, 0.012, 0.018), "chrome", g="body")
    bx("glovebox", (-0.42, 0.42, 0.79), (0.36, 0.03, 0.14), "interior", g="body")
    for sx in (-0.62, 0.66):
        bx("vent", (sx, 0.42, 0.90), (0.12, 0.02, 0.05), "metal_dark", g="body")
    steering_wheel((0.40, 0.46, 0.925), 24, R=0.19, g="steer", rim_m="leather", spokes=3, hub_m="metal_dark")
    tube("column", [(0.40, 0.49, 0.912), (0.40, 0.68, 0.78)], 0.03, "interior", g="body")
    tube("col_shift", [(0.35, 0.52, 0.89), (0.25, 0.50, 0.86)], 0.007, "chrome", g="body")
    cyl("col_knob", (0.245, 0.50, 0.86), 0.014, 0.03, "x", "plastic", sides=8, g="body")
    bx("tunnel", (0, -0.1, 0.41), (0.30, 1.45, 0.10), "fabric", bevel=0.03, seg=1, g="body")
    for x in (0.32, 0.46):
        bx("pedal", (x, 0.72, 0.46), (0.06, 0.02, 0.09), "metal_dark", pitch=-35, g="body")
    # junk on the rear floor: ammo box + bottle
    ammo_box("ammo_floor", (-0.42, -0.50, 0.355), yaw=12, g="body")
    cyl("bottle", (0.46, -0.52, 0.40), 0.035, 0.10, "z", "glass", sides=8, g="body")


# ------------------------------------------------------------------------------------------- roll bar, gunner rail, plates
def build_cage():
    r = 0.028
    hoop = [(0.75, -0.47, 0.42), (0.75, -0.47, 1.64), (-0.75, -0.47, 1.64), (-0.75, -0.47, 0.42)]
    tube("hoop", hoop, r, "metal_dark", fillet=0.20, fn=5, res=1, g="body")
    for sd in (1, -1):
        tube("brace", [(sd * 0.75, -0.47, 1.52), (sd * 0.84, -1.22, 1.02)], 0.022, "metal_dark", g="body")
        bx("hoop_plate", (sd * 0.75, -0.47, 0.99), (0.13, 0.13, 0.014), "armor", bevel=0.004, seg=1, g="body")
        bolts("hoop_bolts", [((sd * 0.75 + dx, -0.47 + df, 0.997), (0, 0, 1)) for dx in (-0.045, 0.045) for df in (-0.045, 0.045)], 0.011, 0.01, "metal_bare", g="body")
        prism("gusset", [(-0.47, 1.5), (-0.47, 1.36), (-0.62, 1.5)], "fz", sd * 0.72, sd * 0.78, "armor", g="body")
        weld("hoop_weld", [(sd * 0.75, -0.43, 1.0), (sd * 0.79, -0.47, 1.0), (sd * 0.75, -0.51, 1.0)], g="body", m="metal_dark", seed=sd + 3)
    rail = [(0.86, -1.10, 1.0), (0.86, -1.22, 1.38), (-0.86, -1.22, 1.38), (-0.86, -1.10, 1.0)]
    tube("rail", rail, 0.024, "metal_bare", fillet=0.12, fn=5, g="body")
    for sd in (1, -1):
        tube("rail_tie", [(sd * 0.86, -1.22, 1.38), (sd * 0.80, -0.78, 1.34), (sd * 0.75, -0.47, 1.32)], 0.02, "metal_bare", fillet=0.08, g="body")
    # rag wrapped round the rail as a hand grip
    tube("rail_rag", [(0.20, -1.22, 1.38), (-0.10, -1.22, 1.38)], 0.034, "cloth_tan", g="body")


def plate_side(sd, f, z, wf, hz, grp, seed, t=0.014, m="armor"):
    x = side_x(z)
    c = (sd * (x + t / 2 - 0.002), f, z)
    bx("plate", c, (t, wf, hz), m, bevel=0.004, seg=1, g=grp, roll=sd * (1.5 - seed % 3))
    bolts("rivets", rect_rivets((sd * (x + t - 0.002), f, z), "x", wf, hz, 0.022, 0.09, sign=sd), 0.0085, 0.008, m, g=grp, cap_dome=True)
    xw = sd * (x + t + 0.001)
    for (f0, z0, f1, z1) in ((f - wf / 2, z + hz / 2, f + wf / 2, z + hz / 2), (f - wf / 2, z - hz / 2, f + wf / 2, z - hz / 2)):
        weld("weld", [(xw, f0, z0), (xw, f1, z1)], g=grp, m=m, seed=seed * 5 + int(z0 * 100))


def build_plates():
    plate_side(-1, 0.16, 0.66, 0.56, 0.36, "panel_door_R", 1)
    plate_side(1, -0.66, 0.60, 0.34, 0.26, "panel_door_L2", 2)
    plate_side(-1, -0.60, 0.72, 0.28, 0.20, "panel_door_R2", 3)
    plate_side(1, 1.95, 0.62, 0.40, 0.22, "body", 4, m="metal_bare")                  # patched front fender (left)
    fz = hood_z(1.55) - 0.001
    bx("hplate", (0.55, 1.62, fz + 0.007), (0.40, 0.42, 0.014), "armor", bevel=0.004, seg=1, g="panel_hood")
    bolts("hrivets", rect_rivets((0.55, 1.62, fz + 0.014), "z", 0.40, 0.42, 0.024, 0.09), 0.0085, 0.008, "armor", g="panel_hood", cap_dome=True)
    for sx in (0.55, -0.55):
        cyl("hoodpin", (sx, 2.30, hood_z(2.30) + 0.012), 0.014, 0.03, "z", "metal_bare", sides=8, g="panel_hood")
        tube("hoodpin_clip", [(sx - 0.02, 2.30, hood_z(2.30) + 0.03), (sx + 0.03, 2.33, hood_z(2.33) + 0.012)], 0.004, "metal_bare", g="panel_hood")
    # push bar (bull bar) with spikes and the cow skull
    r = 0.034
    tube("pushbar", [(0.74, 2.46, 0.36), (0.74, 2.64, 0.40), (0.74, 2.66, 0.78), (-0.74, 2.66, 0.78), (-0.74, 2.64, 0.40), (-0.74, 2.46, 0.36)], r, "armor", fillet=0.09, g="panel_bumper_F")
    tube("pushbar_mid", [(0.0, 2.64, 0.40), (0.0, 2.66, 0.55)], 0.028, "armor", g="panel_bumper_F")
    tube("pushbar_cross", [(0.74, 2.655, 0.59), (-0.74, 2.655, 0.59)], 0.028, "armor", g="panel_bumper_F")
    items = []
    for x in (-0.55, -0.28, 0.28, 0.55):
        items.append(((x, 2.680, 0.78), (0.0, 1.0, 0.10), 0.026, 0.11))
    for x in (-0.62, -0.36, 0.36, 0.62):
        items.append(((x, 2.675, 0.59), (0.0, 1.0, 0.0), 0.022, 0.09))
    for sd in (1, -1):
        items.append(((sd * 0.76, 2.66, 0.78), (sd * 0.6, 0.6, 0.45), 0.024, 0.11))
    spikes("pb_spikes", items, g="panel_bumper_F", collar=False)
    for x, z in [(x, 0.78) for x in (-0.55, -0.28, 0.28, 0.55)] + [(x, 0.59) for x in (-0.62, -0.36, 0.36, 0.62)]:
        weld("spk_weld", [(x - 0.03, 2.668, z + 0.02), (x + 0.03, 2.668, z + 0.02)], r=0.006, g="panel_bumper_F", m="metal_dark", seed=int(x * 100))
    skull_orn("cowskull", (0.0, 2.72, 0.74), d=(0, 1, 0), s=0.8, g="panel_bumper_F", m="canvas")
    tube("skull_wire", [(-0.05, 2.70, 0.78), (0.0, 2.72, 0.80), (0.05, 2.70, 0.78)], 0.004, "metal_bare", g="panel_bumper_F")
    # antenna with a tattered war flag, fuel filler with a rag
    base = (0.80, -2.05, 0.995)
    tube("ant_mast", [base, (0.80, -2.06, 1.55), (0.78, -2.08, 2.00)], 0.006, "metal_dark", g="body")
    strip_wave("flag", (0.78, -2.085, 1.98), 0.46, 0.24, 0.06, 2.5, "cloth_red", direction=(0, -1, 0), nseg=10, droop=0.06, g="body")
    strip_wave("flag_t1", (0.78, -2.085, 1.76), 0.34, 0.05, 0.05, 3.0, "cloth_red", direction=(0, -1, -0.15), nseg=6, droop=0.06, g="body")
    bx("ant_base", (0.80, -2.05, 1.0), (0.06, 0.06, 0.04), "metal_dark", bevel=0.006, seg=1, g="body")
    cyl("fuelcap", (0.982, -2.05, 0.80), 0.048, 0.02, "x", "metal_bare", sides=12, g="body")
    bx("fuelflap", (0.978, -2.05, 0.80), (0.012, 0.13, 0.13), "armor", bevel=0.004, seg=1, g="body")
    strip_wave("fuelrag", (0.99, -2.05, 0.81), 0.16, 0.05, 0.015, 2.0, "cloth_tan", direction=(0.2, -0.3, -1.0), up=(0, 1, 0), nseg=5, droop=0.0, g="body")


# ------------------------------------------------------------------------------------------- trunk junk (rides on the trunk lid panel)
def build_trunk_junk():
    zt = deck_z(-1.95)
    spare_tyre("jk_tyre", (-0.36, -1.98, zt + 0.115), (0, 0, 1), R=0.34, W=0.22, rim_r=0.2, g="panel_trunk", sides=22)
    jerry_can("jk_can1", (0.34, -1.64, zt + 0.0), yaw=90, m="paint2", g="panel_trunk")                         # standing
    jerry_can("jk_can2", (0.40, -1.98, zt - 0.004), yaw=4, m="rust", g="panel_trunk", lie=True)               # lying flat
    crate("jk_crate", (0.42, -2.26, deck_z(-2.26) - 0.004), (0.40, 0.28, 0.22), yaw=-6, g="panel_trunk")
    tarp_roll("jk_roll", (-0.30, -1.55, zt + 0.085), (1, 0, 0), 0.62, 0.085, m="canvas", g="panel_trunk", seed=2)
    strap("jk_strap1", [(0.52, -1.66, zt), (0.51, -1.66, zt + 0.40), (0.34, -1.66, zt + 0.48), (0.17, -1.66, zt + 0.40), (0.16, -1.66, zt)],
          w=0.035, m="cloth_dark", g="panel_trunk", normal=(0, -1, 0))
    strap("jk_strap2", [(-0.36, -1.62, zt), (-0.36, -1.66, zt + 0.23), (-0.36, -1.98, zt + 0.235), (-0.36, -2.30, zt + 0.23), (-0.36, -2.34, zt)],
          w=0.04, m="cloth_dark", g="panel_trunk", normal=(1, 0, 0))


# ------------------------------------------------------------------------------------------- engine + underbody
def build_engine():
    bx("block", (0, 1.50, 0.58), (0.44, 0.66, 0.34), "metal_dark", bevel=0.015, seg=1, g="body")
    for sd in (1, -1):
        bx("head", (sd * 0.24, 1.50, 0.64), (0.16, 0.60, 0.20), "metal_dark", bevel=0.012, seg=1, roll=sd * -12, g="body")
        bx("valvecover", (sd * 0.27, 1.50, 0.75), (0.13, 0.55, 0.05), "metal_bare", bevel=0.01, seg=1, roll=sd * -12, g="body")
        tube("manifold", [(sd * 0.34, 1.32, 0.60), (sd * 0.38, 1.20, 0.50), (sd * 0.36, 1.05, 0.40)], 0.035, "rust", g="body", fillet=0.05)
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
    tube("axle_r", [(0.79, AX_R, HUB_Z), (-0.79, AX_R, HUB_Z)], 0.055, "metal_dark", g="body")
    ellipsoid("diff", (0, AX_R - 0.04, HUB_Z), (0.17, 0.20, 0.17), "metal_dark", seg=12, rings=8, g="body")
    for sd in (1, -1):
        beam("leaf", (sd * 0.58, AX_R + 0.95, 0.32), (sd * 0.58, AX_R - 0.55, 0.32), 0.07, 0.03, "metal_dark", u=(1, 0, 0), g="body")
        beam("leaf2", (sd * 0.58, AX_R + 0.75, 0.29), (sd * 0.58, AX_R - 0.45, 0.29), 0.065, 0.025, "metal_dark", u=(1, 0, 0), g="body")
        cyl("rshock", (sd * 0.66, AX_R - 0.14, 0.44), 0.024, 0.36, "z", "metal_dark", sides=8, roll=sd * 8, g="body")
    tube("exh_L", [(0.35, 1.28, 0.20), (0.30, 0.6, 0.16), (0.30, -0.9, 0.15), (0.32, -1.5, 0.15)], 0.038, "rust", fillet=0.12, g="body")
    tube("exh_R", [(-0.35, 1.28, 0.20), (-0.30, 0.6, 0.16), (-0.30, -0.9, 0.15), (-0.32, -1.5, 0.15)], 0.038, "rust", fillet=0.12, g="body")
    for sd in (1, -1):
        cyl("muffler", (sd * 0.32, -1.98, 0.17), 0.085, 0.80, "f", "rust", sides=12, g="body")
        tube("tailpipe", [(sd * 0.32, -2.38, 0.17), (sd * 0.50, -2.44, 0.26), (sd * 0.50, -2.47, 0.27)], 0.034, "rust", fillet=0.06, g="body")
    bx("fueltank", (0.0, -1.62, 0.32), (0.90, 0.50, 0.14), "metal_dark", bevel=0.02, seg=1, g="body")
    for f in (-1.45, -1.80):
        beam("strap", (0.5, f, 0.24), (-0.5, f, 0.24), 0.03, 0.01, "metal_bare", u=(0, 1, 0), g="body")


def build_rust(tub, panels):
    """Fixed-colour rust (and dark primer = paint2) patches projected on the body and panels, plus rocker / arch rot."""
    for sd in (1, -1):
        beam("sill_rust", (sd * (side_x(0.29) + 0.0), 0.66, 0.285), (sd * (side_x(0.29) + 0.0), -0.99, 0.285), 0.022, 0.05, "rust", u=(1, 0, 0), g="body")
        for AX in (AX_F, AX_R):
            pts = []
            for a in range(8, 173, 20):
                th = a * D2R
                z = HUB_Z + 0.487 * math.sin(th)
                pts.append((sd * (side_x(z) + 0.002), AX + 0.487 * math.cos(th), z))
            tube("arch_lip", pts, 0.013, "rust", res=0, g="body")
    ray = raycast_targets([tub])
    rnd = random.Random(11)
    k = 0
    for sd in (1, -1):
        for _ in range(5):
            patch("rust_p", ray, (sd * 1.05, rnd.uniform(1.05, 2.3), rnd.uniform(0.36, 0.72)), (-sd, 0, 0), rnd.uniform(0.05, 0.12), "rust", seed=k, g="body"); k += 1
        for _ in range(4):
            patch("rust_p", ray, (sd * 1.05, rnd.uniform(-2.35, -1.88), rnd.uniform(0.36, 0.75)), (-sd, 0, 0), rnd.uniform(0.05, 0.12), "rust", seed=k, g="body"); k += 1
    # rust eating the rear deck edge / tail panel
    for x in (-0.55, 0.15, 0.62):
        patch("rust_t", ray, (x, -2.8, 0.66), (0, 1, 0), rnd.uniform(0.05, 0.09), "rust", seed=k, g="body"); k += 1
    # dark primer repairs (paint2 = charcoal in game)
    patch("primer", ray, (1.05, 2.05, 0.60), (-1, 0, 0), 0.20, "paint2", seed=91, g="body", stretch=(1.6, 1.0), irregular=0.25)
    patch("primer", ray, (-1.05, -1.72, 0.58), (1, 0, 0), 0.15, "paint2", seed=92, g="body", stretch=(1.4, 1.0), irregular=0.25)
    # hood / trunk panel rot
    rp = raycast_targets([panels["panel_hood"]])
    for i, (x, f) in enumerate(((-0.62, 2.30), (0.10, 2.36), (0.66, 0.95))):
        patch("rust_h", rp, (x, f, 1.6), (0, 0, -1), rnd.uniform(0.05, 0.09), "rust", seed=200 + i, g="panel_hood")
    patch("primer_h", rp, (-0.45, 1.05, 1.6), (0, 0, -1), 0.17, "paint2", seed=210, g="panel_hood", stretch=(1.3, 1.0), irregular=0.3)
    rt = raycast_targets([panels["panel_trunk"]])
    for i, (x, f) in enumerate(((0.70, -2.38), (-0.10, -2.40))):
        patch("rust_tr", rt, (x, f, 1.6), (0, 0, -1), rnd.uniform(0.05, 0.08), "rust", seed=220 + i, g="panel_trunk")
    # a burst of bullet holes stitched across the right doors
    for grp, fr in (("panel_door_R", (0.12, -0.25)), ("panel_door_R2", (-0.40, -0.85))):
        pts = []
        for i in range(5):
            t = i / 4
            pts.append((-1.0, fr[0] + (fr[1] - fr[0]) * t + rnd.uniform(-0.03, 0.03), 0.82 - 0.10 * t + rnd.uniform(-0.05, 0.05)))
        bullet_holes("bholes", raycast_targets([panels[grp]]), pts, (1, 0, 0), g=grp)


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
    sock("fuel_cap", 0.985, -2.05, 0.80, yaw=90)
    sock("roof_top", 0.0, -0.10, 1.46)
    sock("camera_hood", 0.0, 1.35, 1.02)


tub = build_shell()
panel_objs = {gname: REG[gname][0] for gname in ("panel_hood", "panel_trunk", "panel_door_L", "panel_door_R", "panel_door_L2", "panel_door_R2")}
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
build_trunk_junk()
build_engine()
build_underbody()
build_rust(tub, panel_objs)
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
