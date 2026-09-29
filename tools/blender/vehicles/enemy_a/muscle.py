"""e_muscle "Rammer" - blacked-out 1970 Charger-style muscle coupe with a spiked wedge ram plate and a blown V8 poking through the hood.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/muscle.py -- [--nobake] [--res 2048 --orm 1024 --samples 16]
Driver only (no gunner).  Coordinates: x = left(+), f = forward(+), z = up.
Look: wedge ram with gussets + spikes, chained to the fenders; roots blower + bug catcher; louvered steel shutter over the fastback glass;
riveted bolt-on arch flares; chariot spike spinners on all four hubs; side pipes with heat shields; window net + plated passenger window;
caged sealed-beam lamps in the hidden-headlight slot; full roll cage + race buckets with harnesses.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *
from muscle_parts import *
from veh_kit import *

AX_F, AX_R = 1.30, -1.62          # axle positions (f)
HZ_F, HZ_R = 0.355, 0.375           # hub heights = tyre radii
TRK_F, TRK_R = 0.80, 0.79
ARCH_F, ARCH_R = 0.44, 0.465
GAP = 0.004
BELT = 0.955

STYLE = dict(seed=11, rust=0.85, dirt=0.8, wear=0.8, scratch=0.7, dust=0.8, wheels=[(AX_F, HZ_F, 0.355), (AX_R, HZ_R, 0.375)])
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
    m = stamp(ctx, TALLY, (0.93, -0.08, 0.70), (0, -1, 0), (0, 0, 1), (0.46, 0.40), thick=0.07, n=(1, 0, 0))   # left door
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
        col = g.mixc(g.mul(st, 0.55), col, (0.75, 0.75, 0.75))
    m = stamp(ctx, TALLY, (0.10, -2.16, 0.985), (1, 0, 0), (0, 1, 0), (0.42, 0.42), thick=0.08)
    col = g.mixc(g.mul(m, 0.9), col, dark)
    return col


STYLE["hooks"] = {"paint": hook_paint, "paint2": hook_paint2}


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


def hood_z_at(f):
    """Approximate hood surface height at |x| ~ 0.3 for station f."""
    return _interp([(0.85, 1.005), (1.30, 0.995), (1.75, 0.985), (2.15, 0.965), (2.27, 0.945)], f) - 0.008


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
    c, s = box_fz(-0.80, 0.80, 0.70 + g, 2.26 - g, 0.90, 1.10)
    hole = box_fz(-0.285, 0.285, 1.10, 1.80, 0.80, 1.30)
    extract("hood", c, s, "panel_hood", "paint2", mat="paint2", holes=[hole])
    for sd in (1, -1):
        beam("hole_trim", (sd * 0.30, 1.09, hood_z_at(1.09) + 0.006), (sd * 0.30, 1.81, hood_z_at(1.81) + 0.006), 0.035, 0.018, "armor", u=(1, 0, 0), g="panel_hood")
        weld("hole_weld", [(sd * 0.318, 1.09, hood_z_at(1.09) + 0.004), (sd * 0.318, 1.81, hood_z_at(1.81) + 0.004)], g="panel_hood", m="armor", seed=sd + 7)
    for f in (1.085, 1.815):
        beam("hole_trim", (0.32, f, hood_z_at(f) + 0.006), (-0.32, f, hood_z_at(f) + 0.006), 0.035, 0.018, "armor", u=(0, 1, 0), g="panel_hood")
    c, s = box_fz(-0.80, 0.80, -2.30 + g, -1.96 - g, 0.90, 1.10)
    extract("trunk", c, s, "panel_trunk", "paint2", mat="paint2")
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
    fs = [-0.66, -0.78, -0.90, -1.05, -1.20, -1.35, -1.50, -1.65, -1.80, -1.94]
    fb = loft_f("fastback", [(f, fb_ring(f)) for f in fs], "paint", cap=True, subdiv=0, bevel=0.006, seg=1, g="body")
    set_faces_material(fb, "interior", lambda c, n: abs(c.x) < 0.41 and n.z > 0.35 and (-c.y) < -1.0 and c.z > 0.9)
    gst = []
    for f in (-1.10, -1.25, -1.40, -1.55, -1.70, -1.82, -1.90):
        z = _interp(FB_TOP, f) - _interp(FB_DIP, f) + 0.004
        gst.append((f, [(-0.395, z), (0.395, z), (0.395, z + 0.008), (-0.395, z + 0.008)]))
    loft_f("rear_glass", gst, "glass", cap=True, g="body")
    # louvered steel shutter over the rear glass (70s louvres, welded to two rails)
    for i in range(8):
        f = -1.14 - i * 0.095
        z = _interp(FB_TOP, f) - _interp(FB_DIP, f) + 0.045
        slope = (_interp(FB_TOP, f - 0.05) - _interp(FB_TOP, f + 0.05)) / 0.1
        beam("louver", (0.40, f, z), (-0.40, f, z), 0.085, 0.008, "armor", u=(0, 1.0, 0.9 + slope), g="body", bevel=0.002)
    for sx in (0.37, -0.37):
        pts = []
        for f in (-1.10, -1.30, -1.50, -1.70, -1.86):
            pts.append((sx, f, _interp(FB_TOP, f) - _interp(FB_DIP, f) + 0.03))
        tube("louver_rail", pts, 0.012, "armor", fillet=0.05, g="body")
    # roof slab + armour plate bolted on top
    rs = []
    for f, zt, hw in ((0.14, 1.290, 0.655), (-0.10, 1.308, 0.68), (-0.40, 1.318, 0.69), (-0.66, 1.318, 0.69)):
        rs.append((f, rrect(2 * hw, 0.05, 0.018, 2, 0.0, zt - 0.025)))
    loft_f("roof", rs, "paint", cap=True, bevel=0.005, seg=1, g="body")
    plate("roofplate", [(0.40, 0.02, 1.316), (-0.40, 0.02, 1.316), (-0.42, -0.58, 1.333), (0.42, -0.58, 1.333)], 0.010, "armor", g="body", out=(0, 0, 1), rivets=0.16, weld_edges=(0,))
    beam("header", (0.66, 0.15, 1.262), (-0.66, 0.15, 1.262), 0.05, 0.04, "paint", u=(0, 1, 0), g="body", bevel=0.004)
    quad_slab("windshield", [(0.80, 0.70, 0.985), (-0.80, 0.70, 0.985), (-0.655, 0.16, 1.285), (0.655, 0.16, 1.285)], 0.010, "glass", out=(0, 1, 1), g="body")
    for sd in (1, -1):
        beam("apillar", (sd * 0.835, 0.72, 0.95), (sd * 0.685, 0.125, 1.29), 0.05, 0.07, "paint", u=(0, 1, 0.6), g="body", bevel=0.005)
    beam("wsh_seal", (0.80, 0.705, 0.99), (-0.80, 0.705, 0.99), 0.03, 0.03, "interior", u=(0, 1, 0), g="body")
    # windscreen: welded guard bars over the passenger half + cracked-glass tape
    for k in range(4):
        x = -0.12 - k * 0.15
        tube("ws_bar", [(x, 0.735, 0.99), (x * 0.85, 0.19, 1.30)], 0.009, "metal_dark", g="body")
    for sd in (1, -1):
        for i in range(2):
            beam("wiper", (sd * (0.12 + 0.34 * i), 0.78, 1.0), (sd * (0.55 + 0.34 * i), 0.66, 1.012), 0.014, 0.008, "metal_dark", u=(0, 0, 1), g="body")


def door_extras(sd, grp):
    top = 1.28
    q = [(sd * 0.845, 0.60, BELT), (sd * 0.845, 0.16, top), (sd * 0.845, -0.60, top), (sd * 0.845, -0.62, BELT)]
    xt = 0.845 - 0.40 * (top - BELT) - 0.005
    if sd > 0:
        # driver: glass wound down, a black window net in the frame
        grille("winnet", [(0.86, 0.50, 0.97), (0.86, -0.58, 0.97), (xt + 0.02, -0.58, 1.26), (xt + 0.02, 0.16, 1.26)], 7, 4, bar=0.012, frame=0.02,
               m="cloth_dark", g=grp, diag=True, depth=0.006)
    else:
        gl = quad_slab("dglass", q, 0.008, "glass", out=(sd, 0, 0), g=grp)
        deform_verts(gl, lambda v: Vector((v.x - sd * 0.40 * max(v.z - BELT, 0), v.y, v.z)))
        # passenger: armour plate over the rear half of the window, with a firing slit
        plate("winplate", [(sd * 0.868, -0.05, 0.965), (sd * 0.868, -0.60, 0.965), (sd * (xt + 0.03), -0.60, 1.265), (sd * (xt + 0.03), -0.05, 1.265)],
              0.008, "armor", g=grp, out=(sd, 0, 0.3), rivets=0.09)
    beam("rail", (sd * xt, 0.14, top + 0.012), (sd * xt, -0.64, top + 0.012), 0.04, 0.03, "metal_dark", u=(1, 0, 0), g=grp)
    beam("post", (sd * (xt + 0.03), -0.63, BELT), (sd * xt, -0.63, top + 0.01), 0.05, 0.03, "paint", u=(0, 1, 0), g=grp, bevel=0.003)
    beam("sash", (sd * 0.89, 0.62, BELT), (sd * xt, 0.12, top + 0.01), 0.03, 0.04, "paint", u=(1, 0, 0), g=grp)
    bx("mir_arm", (sd * 0.95, 0.55, 1.03), (0.10, 0.025, 0.025), "metal_dark", g=grp)
    bx("mir_head", (sd * 1.01, 0.55, 1.05), (0.05, 0.14, 0.09), "metal_dark", bevel=0.012, seg=1, g=grp)
    bx("mir_glass", (sd * 1.012, 0.479, 1.05), (0.04, 0.004, 0.075), "chrome", g=grp)
    bx("handle", (sd * 0.955, -0.62, 0.86), (0.02, 0.13, 0.02), "metal_dark", bevel=0.005, seg=1, g=grp)
    bx("scallop", (sd * 0.946, -0.05, 0.50), (0.014, 1.0, 0.03), "interior", g=grp)
    door_card("dcard", sd, 0.83, -0.76, 0.58, 0.40, 0.95, grp, m="interior", trim="leather", handle="metal_dark")


def build_wheels():
    for nm, x, f, hz, R, W in (("FL", TRK_F, AX_F, HZ_F, 0.355, 0.27), ("FR", -TRK_F, AX_F, HZ_F, 0.355, 0.27),
                               ("RL", TRK_R, AX_R, HZ_R, 0.375, 0.34), ("RR", -TRK_R, AX_R, HZ_R, 0.375, 0.34)):
        build_wheel2(V, "wheel_" + nm, (x, f, hz), 1 if x > 0 else -1, R, W, 0.215, tire="at" if f > 0 else "offroad", rim_style="star",
                     spokes=5, lugs=5, key="muscle%s" % R, hub_spike=0.12 if f < 0 else 0.09)
        caliper("caliper", (x, f, hz), 1 if x > 0 else -1, 0.215, W, front=f > 0, face_w_frac=0.40)
    # riveted bolt-on flares over all four arches (black steel, widen the stance)
    for f, hz, r in ((AX_F, HZ_F, ARCH_F), (AX_R, HZ_R, ARCH_R)):
        for sd in (1, -1):
            K = KB("flare", "body")
            outer = []
            n = 11
            for k in range(n + 1):
                a = (10 + 160 * k / n) * D2R
                ff, zz = f + math.cos(a) * (r + 0.005), hz + math.sin(a) * (r + 0.005)
                x0 = sd * 0.955
                outer.append((ff, zz, math.cos(a), math.sin(a)))
            rows = []
            for ff, zz, ca, sa in outer:
                w = 0.075
                rows.append([K.vert((sd * 0.93, ff, zz)), K.vert((sd * 1.005, ff + ca * 0.01, zz + sa * 0.01)),
                             K.vert((sd * 1.005, ff + ca * w, zz + sa * w)), K.vert((sd * 0.93, ff + ca * (w + 0.02), zz + sa * (w + 0.02)))])
            fs = []
            for i in range(len(rows) - 1):
                A_, B_ = rows[i], rows[i + 1]
                for j in range(4):
                    k2 = (j + 1) % 4
                    fs.append(K.face((A_[j], A_[k2], B_[k2], B_[j]), "armor"))
            fs.append(K.face(rows[0][::-1], "armor"))
            fs.append(K.face(rows[-1], "armor"))
            K.recalc(fs)
            K.done(smooth=True, sharp=35.0, flat=False)
            items = []
            for k in range(1, n, 2):
                ff, zz, ca, sa = outer[k]
                items.append(((sd * 1.006, ff + ca * 0.045, zz + sa * 0.045), (sd, 0, 0)))
            bolts("flare_bolts", items, 0.010, 0.008, "metal_bare", g="body", cap_dome=True)


# ------------------------------------------------------------------------------------------- nose: ram plate + lamps
def face_pt(sd, t, s):
    """Point on the ram plate half `sd`: t = 0 centre .. 1 outer, s = 0 bottom edge .. 1 top edge."""
    x = sd * 0.90 * t
    fb = 2.60 - 0.18 * t
    return (x, fb - 0.20 * s, 0.18 + 0.48 * s)


def build_nose():
    prism("bumperbar", [(-0.90, 2.36), (0.90, 2.36), (0.96, 2.31), (0.98, 2.22), (0.90, 2.22), (0.86, 2.28), (-0.86, 2.28), (-0.90, 2.22), (-0.98, 2.22), (-0.96, 2.31)],
          "xf", 0.26, 0.42, "armor", bevel=0.01, seg=1, g="panel_bumper_F")
    for sd in (1, -1):
        q = [face_pt(sd, 0, 0), face_pt(sd, 1, 0), face_pt(sd, 1, 1), face_pt(sd, 0, 1)]
        quad_slab("ram_half", q, 0.055, "armor", out=(sd * 0.1, 0.43, 0.27), g="panel_bumper_F", bevel=0.006, seg=1)
        beam("ram_lip_b", face_pt(sd, 0, 0), face_pt(sd, 1, 0), 0.05, 0.07, "armor", u=(0, 0.25, 1), g="panel_bumper_F", bevel=0.004)
        beam("ram_lip_t", face_pt(sd, 0, 1), face_pt(sd, 1, 1), 0.05, 0.05, "armor", u=(0, 0.25, 1), g="panel_bumper_F", bevel=0.004)
        beam("ram_lip_o", face_pt(sd, 1, 0), face_pt(sd, 1, 1), 0.05, 0.05, "armor", u=(1, 0, 0), g="panel_bumper_F", bevel=0.004)
        # scrap patch plates welded onto the ram face
        for (t0, t1, s0, s1) in ((0.12, 0.48, 0.22, 0.62), (0.55, 0.86, 0.46, 0.84)):
            a, b, c2, d2 = face_pt(sd, t0, s0), face_pt(sd, t1, s0), face_pt(sd, t1, s1), face_pt(sd, t0, s1)
            off = (sd * 0.1 * 0.035, 0.43 * 0.035, 0.27 * 0.035)
            qq = [tuple(p[i] + off[i] for i in range(3)) for p in (a, b, c2, d2)]
            plate("ram_patch", qq, 0.008, "metal_bare" if t0 < 0.5 else "rust", g="panel_bumper_F", out=(sd * 0.1, 0.43, 0.27), rivets=0, weld_edges=(0, 2), seed=int(t0 * 10) + sd)
        for t in (0.25, 0.6, 0.92):
            x = sd * 0.90 * t
            fbot = 2.60 - 0.18 * t
            prism("gusset", [(fbot - 0.05, 0.20), (fbot - 0.05 - 0.20, 0.62), (fbot - 0.05 - 0.20, 0.24), (fbot - 0.05 - 0.14, 0.20)], "fz", x - 0.015, x + 0.015, "armor", g="panel_bumper_F")
        items = []
        for i in range(9):
            t = 0.06 + i * 0.108
            b = face_pt(sd, t, 0.0)
            items.append(((b[0], b[1] - 0.02, b[2] + 0.055), (sd * 0.12 * (1 if t > 0.05 else 0), 1.0, -0.08), 0.030, 0.13))
        for s in (0.42, 0.80):
            for t in (0.2, 0.45, 0.70, 0.93):
                b = face_pt(sd, t, s)
                items.append((b, (sd * 0.106, 0.432, 0.27), 0.026, 0.13))
        spikes("ram_spikes", items, g="panel_bumper_F", collar=False)
        items = []
        for t in (0.12, 0.35, 0.58, 0.8, 0.96):
            for s in (0.10, 0.90):
                p = face_pt(sd, t, s)
                items.append(((p[0], p[1] + 0.03, p[2] + 0.02), (sd * 0.106, 0.432, 0.27)))
        bolts("ram_bolts", items, 0.014, 0.012, "metal_bare", g="panel_bumper_F", cap_dome=True)
    beam("ram_ridge", face_pt(1, 0, 0), face_pt(1, 0, 1), 0.06, 0.07, "armor", u=(1, 0, 0), g="panel_bumper_F", bevel=0.004)
    spikes("spike_top", [((sd * 0.30, 2.40, 0.66), (0, 0.15, 1.0), 0.03, 0.15) for sd in (1, -1)] + [((0.0, 2.41, 0.66), (0, 0.15, 1.0), 0.03, 0.17)], g="panel_bumper_F")
    # chains from the ram horns back to the fender tie-downs (left side)
    chain("ram_chain", [(0.80, 2.43, 0.64), (0.86, 2.34, 0.60), (0.92, 2.24, 0.66), (0.955, 2.16, 0.78)], link=0.06, g="panel_bumper_F")
    bx("tiedown", (0.96, 2.14, 0.80), (0.03, 0.06, 0.05), "metal_dark", bevel=0.005, seg=1, g="body")
    # hidden-headlight slot: louvres + sealed beams (left caged, right taped)
    bx("slot_bk", (0, 2.25, 0.78), (1.56, 0.02, 0.16), "metal_dark", g="body")
    for i in range(5):
        bx("slot_bar", (0, 2.28, 0.72 + i * 0.03), (1.56, 0.02, 0.012), "metal_dark", g="body")
    bx("slot_mid", (0, 2.29, 0.78), (0.05, 0.03, 0.17), "metal_dark", g="body")
    for sd in (1, -1):
        lamp("hl_%s" % ("L" if sd > 0 else "R"), (sd * 0.56, 2.302, 0.78), 0.072, d=(0, 1, 0), depth=0.07, housing="metal_dark", bowl="chrome",
             bezel="chrome", g="body", sides=16, cage=(sd > 0), tape=("cloth_dark" if sd < 0 else None))
        bx("slot_end", (sd * 0.80, 2.29, 0.78), (0.03, 0.03, 0.17), "metal_dark", g="body")
    bx("slot_top", (0, 2.29, 0.868), (1.62, 0.025, 0.02), "metal_dark", g="body")
    bx("slot_bot", (0, 2.29, 0.692), (1.62, 0.025, 0.02), "metal_dark", g="body")


def build_tail():
    poly = [(-0.90, -2.40), (0.90, -2.40), (0.97, -2.36), (0.99, -2.29), (0.92, -2.29), (0.88, -2.34), (-0.88, -2.34), (-0.92, -2.29), (-0.99, -2.29), (-0.97, -2.36)]
    prism("bumper_R", poly[::-1], "xf", 0.29, 0.47, "metal_dark", bevel=0.010, seg=1, g="panel_bumper_R")
    for sd in (1, -1):
        cyl("overrider", (sd * 0.62, -2.43, 0.38), 0.038, 0.10, "f", "metal_dark", sides=10, r2=0.03, g="panel_bumper_R")
    # full-width tail lamp bar: two ribbed clusters + dark centre (left one broken)
    for sd in (1, -1):
        tail_lamp("tl_%s" % ("L" if sd > 0 else "R"), (sd * 0.47, -2.292, 0.76), 0.74, 0.085, d=(0, -1, 0), depth=0.05, g="body",
                  housing="metal_dark", bezel="metal_dark", ribs=3, reverse=0.1, rev_side=(1 if sd > 0 else -1), broken=(sd < 0), taped=None)
    bx("tl_centre", (0, -2.29, 0.76), (0.16, 0.02, 0.10), "metal_dark", g="body")
    prism("ducktail", [(-2.18, 0.975), (-2.34, 0.98), (-2.36, 1.055), (-2.30, 1.06), (-2.20, 1.005)], "fz", -0.76, 0.76, "paint2", bevel=0.006, seg=1, g="panel_trunk")
    bx("plate", (0, -2.37, 0.62), (0.36, 0.012, 0.17), "metal_bare", bevel=0.004, seg=1, roll=2, g="panel_trunk")
    for sd in (1, -1):
        cyl("tip", (sd * 0.42, -2.40, 0.30), 0.048, 0.14, "f", "rust", sides=12, g="body")
        cyl("tip_in", (sd * 0.42, -2.475, 0.30), 0.036, 0.02, "f", "metal_dark", sides=12, g="body")


# ------------------------------------------------------------------------------------------- engine, blower
def build_engine():
    bx("block", (0, 1.44, 0.56), (0.46, 0.66, 0.34), "metal_dark", bevel=0.015, seg=1, g="body")
    for sd in (1, -1):
        bx("head", (sd * 0.25, 1.44, 0.64), (0.17, 0.62, 0.22), "metal_dark", bevel=0.012, seg=1, roll=sd * -10, g="body")
        bx("valvecover", (sd * 0.28, 1.44, 0.76), (0.14, 0.56, 0.05), "chrome", bevel=0.01, seg=1, roll=sd * -10, g="body")
        for i in range(4):
            f = 1.22 + i * 0.16
            tube("header", [(sd * 0.36, f, 0.66), (sd * 0.44, f, 0.52), (sd * 0.47, min(f, 1.05) - 0.0, 0.34)], 0.022, "rust", fillet=0.05, fn=2, g="body")
        tube("collector", [(sd * 0.47, 1.08, 0.36), (sd * 0.55, 0.96, 0.27), (sd * 0.90, 0.92, 0.22)], 0.05, "rust", fillet=0.08, g="body")
    bx("adapter", (0, 1.45, 0.80), (0.46, 0.60, 0.04), "metal_dark", bevel=0.006, seg=1, g="body")
    case = rrect(0.40, 0.21, 0.075, n=4)
    loft_f("blower", [(1.20, [(u, 0.925 + v) for u, v in rrect(0.36, 0.17, 0.06, n=4)]),
                      (1.23, [(u, 0.925 + v) for u, v in case]),
                      (1.67, [(u, 0.925 + v) for u, v in case]),
                      (1.70, [(u, 0.925 + v) for u, v in rrect(0.36, 0.17, 0.06, n=4)])], "metal_bare", g="body", smooth=True)
    for sd in (1, -1):
        for k in range(4):
            bx("blower_fin", (sd * 0.207, 1.45, 0.87 + k * 0.035), (0.016, 0.42, 0.010), "metal_bare", g="body")
        cyl("snout", (sd * 0.0, 1.17, 0.925), 0.055, 0.06, "f", "metal_bare", sides=12, g="body")
    bolts("blower_bolts", [((sx * 0.215, f, 0.822), (0, 0, 1)) for sx in (1, -1) for f in (1.22, 1.36, 1.50, 1.64)], 0.011, 0.012, "chrome", g="body")
    prism("scoop", [(1.28, 1.03), (1.28, 1.10), (1.66, 1.22), (1.70, 1.21), (1.70, 1.03)], "fz", -0.15, 0.15, "metal_dark", bevel=0.01, seg=1, g="body")
    bx("scoop_base", (0, 1.49, 1.035), (0.32, 0.44, 0.02), "chrome", bevel=0.004, seg=1, g="body")
    bx("scoop_mouth", (0, 1.702, 1.12), (0.25, 0.012, 0.15), "interior", g="body")
    for k in range(4):
        bx("butterfly", (0, 1.708, 1.06 + k * 0.035), (0.25, 0.01, 0.008), "chrome", g="body")
    for sd in (1, -1):
        bx("mouth_rim", (sd * 0.14, 1.705, 1.12), (0.02, 0.02, 0.18), "chrome", g="body")
    bx("mouth_rim_t", (0, 1.705, 1.205), (0.30, 0.02, 0.02), "chrome", g="body")
    grille("scoop_mesh", [(0.13, 1.712, 1.045), (-0.13, 1.712, 1.045), (-0.13, 1.712, 1.195), (0.13, 1.712, 1.195)], 5, 3, bar=0.006, frame=0.01, m="metal_dark", g="body")
    beam("strap", (0.21, 1.45, 0.985), (-0.21, 1.45, 0.985), 0.025, 0.012, "chrome", u=(0, 1, 0), g="body")
    cyl("pulley_b", (0, 1.16, 0.855), 0.075, 0.03, "f", "chrome", sides=16, g="body")
    cyl("pulley_c", (0, 1.16, 0.46), 0.07, 0.04, "f", "metal_bare", sides=16, g="body")
    beam("belt1", (0.06, 1.155, 0.855), (0.055, 1.155, 0.46), 0.012, 0.03, "interior", u=(0, 1, 0), g="body")
    beam("belt2", (-0.06, 1.155, 0.855), (-0.055, 1.155, 0.46), 0.012, 0.03, "interior", u=(0, 1, 0), g="body")
    bx("radiator", (0, 2.09, 0.60), (0.66, 0.08, 0.44), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("rad_fin", (i * 0.09, 2.13, 0.60), (0.008, 0.02, 0.42), "metal_bare", g="body")
    bx("shroud", (0, 1.99, 0.60), (0.60, 0.12, 0.40), "interior", bevel=0.01, seg=1, g="body")
    cyl("fan", (0, 1.88, 0.60), 0.18, 0.03, "f", "metal_bare", sides=12, g="body")
    bx("battery", (-0.50, 1.88, 0.52), (0.22, 0.17, 0.19), "interior", bevel=0.01, seg=1, g="body")
    tube("hose_up", [(0.22, 2.05, 0.78), (0.22, 1.85, 0.80), (0.14, 1.70, 0.74)], 0.026, "interior", fillet=0.07, g="body")
    tube("hose_lo", [(-0.22, 2.05, 0.46), (-0.24, 1.8, 0.44), (-0.14, 1.65, 0.50)], 0.026, "interior", fillet=0.07, g="body")
    bx("firewall", (0, 0.76, 0.62), (1.30, 0.02, 0.50), "metal_dark", g="body")
    bx("trunk_floor", (0, -2.08, 0.44), (1.3, 0.24, 0.02), "metal_dark", g="body")
    cyl("nitro_bottle", (0.30, -2.08, 0.55), 0.09, 0.42, "x", "chrome", sides=14, g="body")
    bx("nitro_strap", (0.30, -2.08, 0.55), (0.04, 0.02, 0.2), "metal_bare", g="body")


# ------------------------------------------------------------------------------------------- interior + roll cage
def build_interior():
    bx("floor", (0, -0.05, 0.345), (1.5, 1.2, 0.02), "fabric", g="body")
    for sd in (1, -1):
        bucket_seat("bucket", sd * 0.42, -0.08, 0.41, w=0.48, m="leather" if sd > 0 else "fabric", recline=13, g="body", belt="cloth_red" if sd > 0 else None, h=0.66)
    bx("dash", (0, 0.47, 0.80), (1.56, 0.28, 0.20), "interior", bevel=0.02, seg=2, g="body")
    bx("dash_top", (0, 0.49, 0.915), (1.56, 0.24, 0.035), "leather", bevel=0.012, seg=1, pitch=-4, g="body")
    bx("binnacle", (0.42, 0.46, 0.965), (0.40, 0.14, 0.08), "interior", bevel=0.015, seg=1, g="body")
    gauge_cluster("gauges", (0.42, 0.388, 0.962), n=3, r=0.034, g="body", d=(0, -1, 0.12))
    gauge_cluster("gauges2", (0.0, 0.335, 0.86), n=3, r=0.022, g="body", d=(0, -1, 0.3))
    bx("tacho", (0.26, 0.40, 1.00), (0.10, 0.09, 0.10), "metal_dark", bevel=0.01, seg=1, g="body")
    steering_wheel((0.42, 0.30, 0.895), 22, R=0.175, g="steer", rim_m="leather", spokes=3, hub_m="metal_dark")
    tube("column", [(0.42, 0.33, 0.883), (0.42, 0.55, 0.76)], 0.028, "interior", g="body")
    bx("tunnel", (0, -0.1, 0.42), (0.28, 1.2, 0.12), "interior", bevel=0.03, seg=1, g="body")
    tube("shifter", [(0.0, 0.08, 0.46), (0.0, 0.14, 0.70)], 0.012, "metal_bare", g="body")
    cyl("shift_knob", (0.0, 0.145, 0.72), 0.026, 0.05, "z", "chrome", sides=10, g="body")
    tube("nitro_line", [(0.08, 0.10, 0.48), (0.12, 0.25, 0.60), (0.30, 0.36, 0.74)], 0.006, "cloth_red", g="body")
    bx("nitro_btn", (0.08, 0.12, 0.49), (0.04, 0.05, 0.03), "metal_dark", g="body")
    cyl("nitro_btn_r", (0.08, 0.12, 0.51), 0.012, 0.02, "z", "cloth_red", sides=8, g="body")
    for x in (0.34, 0.47):
        bx("pedal", (x, 0.62, 0.46), (0.06, 0.02, 0.09), "metal_dark", pitch=-35, g="body")


def build_cage():
    r = 0.022
    tube("hoop", [(0.72, -0.62, 0.36), (0.72, -0.62, 1.235), (-0.72, -0.62, 1.235), (-0.72, -0.62, 0.36)], r, "metal_dark", fillet=0.15, fn=5, g="body")
    tube("hoop_x1", [(0.72, -0.62, 0.42), (-0.72, -0.62, 1.20)], 0.018, "metal_dark", g="body")
    tube("hoop_h", [(0.72, -0.62, 0.98), (-0.72, -0.62, 0.98)], 0.02, "metal_dark", g="body")
    for sd in (1, -1):
        tube("apillar_bar", [(sd * 0.72, 0.60, 0.62), (sd * 0.72, 0.56, 0.96), (sd * 0.64, 0.16, 1.235)], r, "metal_dark", fillet=0.1, fn=5, g="body")
        tube("roof_rail", [(sd * 0.64, 0.16, 1.235), (sd * 0.66, -0.20, 1.24), (sd * 0.72, -0.62, 1.235)], r, "metal_dark", fillet=0.05, g="body")
        tube("door_x1", [(sd * 0.735, 0.50, 0.975), (sd * 0.71, -0.56, 1.225)], 0.018, "metal_dark", g="body")
        tube("door_bar", [(sd * 0.745, 0.55, 0.86), (sd * 0.745, -0.62, 0.86)], 0.02, "metal_dark", g="body")
        tube("stay", [(sd * 0.72, -0.62, 1.20), (sd * 0.70, -1.10, 1.06)], 0.02, "metal_dark", g="body")
        bx("hoop_plate", (sd * 0.72, -0.62, 0.345), (0.12, 0.12, 0.014), "armor", bevel=0.004, seg=1, g="body")
    tube("header_bar", [(0.64, 0.16, 1.235), (-0.64, 0.16, 1.235)], r, "metal_dark", g="body")
    tube("dash_bar", [(0.72, 0.52, 0.84), (-0.72, 0.52, 0.84)], 0.02, "metal_dark", g="body")
    cyl("extinguisher", (-0.20, -0.52, 0.55), 0.045, 0.30, "z", "cloth_red", sides=10, g="body")


# ------------------------------------------------------------------------------------------- side pipes, underbody
def build_sidepipes():
    for sd in (1, -1):
        x = sd * 0.945
        cyl("sidepipe", (x, 0.02, 0.235), 0.052, 1.85, "f", "chrome", sides=14, g="body")
        cyl("sidepipe_tip", (x, -0.95, 0.235), 0.058, 0.10, "f", "chrome", sides=14, r2=0.068, g="body")
        cyl("sidepipe_in", (x, -1.005, 0.235), 0.05, 0.012, "f", "metal_dark", sides=14, g="body")
        # perforated heat shield with welded tabs
        bx("shield", (x + sd * 0.012, 0.02, 0.29), (0.09, 1.55, 0.03), "metal_bare", bevel=0.006, seg=1, g="body")
        for f in (-0.55, -0.1, 0.35, 0.8):
            beam("bracket", (sd * 0.78, f, 0.24), (sd * 0.93, f, 0.235), 0.03, 0.03, "metal_dark", u=(0, 1, 0), g="body")
        tube("side_pipe_front", [(x, 0.95, 0.235), (sd * 0.80, 1.02, 0.24), (sd * 0.55, 1.05, 0.30)], 0.048, "rust", fillet=0.06, g="body")


def build_underbody():
    for sd in (1, -1):
        beam("rail", (sd * 0.60, 2.22, 0.19), (sd * 0.60, -2.15, 0.19), 0.08, 0.14, "metal_dark", u=(1, 0, 0), g="body", bevel=0.006, seg=1)
    for f in (1.88, 1.15, -0.95, -1.15):
        beam("xmem", (0.60, f, 0.22), (-0.60, f, 0.22), 0.10, 0.09, "metal_dark", u=(0, 1, 0), g="body", bevel=0.005, seg=1)
    for sd in (1, -1):
        hub = (sd * (TRK_F - 0.10), AX_F, HZ_F)
        tube("arm_lo", [(sd * 0.58, AX_F - 0.28, 0.25), (sd * 0.62, AX_F, 0.23), (sd * 0.58, AX_F + 0.28, 0.25)], 0.022, "metal_dark", g="body")
        tube("arm_lo2", [(sd * 0.62, AX_F, 0.23), hub], 0.03, "metal_dark", g="body")
        tube("arm_up", [(sd * 0.54, AX_F - 0.15, 0.50), (sd * 0.64, AX_F - 0.05, 0.53), hub], 0.02, "metal_dark", g="body")
        cyl("coil", (sd * 0.55, AX_F, 0.42), 0.06, 0.26, "z", "metal_bare", sides=10, g="body")
        bx("knuckle", (sd * (TRK_F - 0.12), AX_F, HZ_F), (0.08, 0.10, 0.20), "metal_dark", bevel=0.01, seg=1, g="body")
    tube("sway", [(0.60, AX_F - 0.32, 0.27), (0.30, AX_F - 0.42, 0.25), (-0.30, AX_F - 0.42, 0.25), (-0.60, AX_F - 0.32, 0.27)], 0.015, "metal_bare", fillet=0.05, g="body")
    tube("tierod", [(0.63, AX_F + 0.16, 0.29), (0.10, AX_F + 0.24, 0.27), (-0.10, AX_F + 0.24, 0.27), (-0.63, AX_F + 0.16, 0.29)], 0.014, "metal_dark", g="body")
    bx("oilpan", (0, 1.40, 0.30), (0.34, 0.50, 0.12), "metal_dark", bevel=0.012, seg=1, g="body")
    bx("trans", (0, 0.92, 0.42), (0.30, 0.55, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    tube("driveshaft", [(0.0, 0.70, 0.30), (0.0, AX_R + 0.05, 0.38)], 0.038, "metal_bare", g="body")
    tube("axle_r", [(0.80, AX_R, HZ_R), (-0.80, AX_R, HZ_R)], 0.055, "metal_dark", g="body")
    ellipsoid("diff", (0, AX_R - 0.04, HZ_R), (0.17, 0.20, 0.17), "metal_dark", seg=12, rings=8, g="body")
    for sd in (1, -1):
        beam("leaf", (sd * 0.55, AX_R + 0.95, 0.31), (sd * 0.55, AX_R - 0.55, 0.31), 0.07, 0.03, "metal_dark", u=(1, 0, 0), g="body")
        beam("leaf2", (sd * 0.55, AX_R + 0.75, 0.28), (sd * 0.55, AX_R - 0.45, 0.28), 0.065, 0.025, "metal_dark", u=(1, 0, 0), g="body")
        cyl("rshock", (sd * 0.66, AX_R - 0.16, 0.44), 0.024, 0.36, "z", "metal_dark", sides=8, roll=sd * 8, g="body")
    for sd in (1, -1):
        tube("exh", [(sd * 0.45, -0.90, 0.20), (sd * 0.42, -1.35, 0.17), (sd * 0.42, -2.22, 0.24), (sd * 0.42, -2.40, 0.30)], 0.034, "rust", fillet=0.1, g="body")
        cyl("muffler", (sd * 0.42, -1.95, 0.20), 0.08, 0.60, "f", "rust", sides=12, g="body")
    bx("fueltank", (0.0, -1.88, 0.30), (0.90, 0.40, 0.12), "metal_dark", bevel=0.02, seg=1, g="body")


def build_details(tub, panels):
    for sx in (0.52, -0.52):
        for f in (0.95, 2.14):
            cyl("hoodpin", (sx, f, 1.0 if f < 1.5 else 0.955), 0.012, 0.045, "z", "chrome", sides=8, g="panel_hood")
    for sd, f, z, w, h in ((1, -0.30, 0.55, 0.42, 0.30), (-1, 0.22, 0.60, 0.38, 0.26)):
        x = 0.945
        grp = "panel_door_L" if sd > 0 else "panel_door_R"
        bx("plate", (sd * (x + 0.007), f, z), (0.014, w, h), "armor", bevel=0.004, seg=1, g=grp, roll=sd * 1.5)
        bolts("rivets", rect_rivets((sd * (x + 0.014), f, z), "x", w, h, 0.022, 0.09, sign=sd), 0.0085, 0.008, "armor", g=grp, cap_dome=True)
        for zz in (z - h / 2, z + h / 2):
            weld("pweld", [(sd * (x + 0.012), f - w / 2, zz), (sd * (x + 0.012), f + w / 2, zz)], g=grp, m="armor", seed=int(zz * 100))
    # racing fuel filler (flip cap) on the left quarter + antenna with a black pennant on the right
    cyl("fuel_ring", (0.968, -1.95, 0.80), 0.062, 0.016, "x", "metal_dark", sides=14, g="body")
    cyl("fuel_cap_c", (0.978, -1.95, 0.80), 0.048, 0.02, "x", "chrome", sides=14, g="body")
    bx("fuel_latch", (0.99, -1.90, 0.80), (0.01, 0.03, 0.04), "chrome", g="body")
    tube("ant_mast", [(-0.86, -1.78, 0.95), (-0.86, -1.80, 1.35), (-0.85, -1.84, 1.62)], 0.005, "metal_bare", g="body")
    strip_wave("flag", (-0.85, -1.84, 1.60), 0.36, 0.16, 0.05, 2.6, "cloth_dark", direction=(0, -1, 0), nseg=8, droop=0.05, g="body")
    bx("ant_base", (-0.86, -1.78, 0.955), (0.05, 0.05, 0.03), "metal_dark", bevel=0.006, seg=1, g="body")
    # rot + primer + bullet holes
    ray = raycast_targets([tub])
    rnd = random.Random(17)
    k = 0
    for sd in (1, -1):
        for f0, f1 in ((1.55, 2.2), (-2.25, -1.95), (0.75, 0.95)):
            for _ in range(2):
                patch("rust_p", ray, (sd * 1.05, rnd.uniform(f0, f1), rnd.uniform(0.34, 0.70)), (-sd, 0, 0), rnd.uniform(0.05, 0.10), "rust", seed=k, g="body"); k += 1
    patch("primer", ray, (-1.05, -1.55, 0.62), (1, 0, 0), 0.18, "paint2", seed=91, g="body", stretch=(1.7, 1.0), irregular=0.25)
    patch("primer", ray, (1.05, 1.95, 0.64), (-1, 0, 0), 0.15, "paint2", seed=93, g="body", stretch=(1.4, 1.0), irregular=0.3)
    for x in (-0.60, 0.55):
        patch("rust_t", ray, (x, -2.8, 0.60), (0, 1, 0), 0.07, "rust", seed=k, g="body"); k += 1
    pts = [(1.2, -0.10 + i * 0.09 + rnd.uniform(-0.02, 0.02), 0.62 + i * 0.04 + rnd.uniform(-0.03, 0.03)) for i in range(5)]
    bullet_holes("bholes", raycast_targets([panels["panel_door_L"]]), pts, (-1, 0, 0), g="panel_door_L")


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
panel_objs = {gname: REG[gname][0] for gname in ("panel_hood", "panel_trunk", "panel_door_L", "panel_door_R")}
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
build_details(tub, panel_objs)
build_sockets()

V.pivot("panel_hood", 0, 0.70, 0.985)
V.pivot("panel_trunk", 0, -1.96, 0.975)
V.pivot("panel_bumper_F", 0, 2.35, 0.40)
V.pivot("panel_bumper_R", 0, -2.35, 0.38)
V.pivot("panel_door_L", 0.92, 0.62, 0.65)
V.pivot("panel_door_R", -0.92, 0.62, 0.65)
finish_wheel_shading()
V.finish(bake=True)
