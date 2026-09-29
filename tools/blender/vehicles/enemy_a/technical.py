"""e_technical "Technical" - beat-up 1980s Toyota-style single-cab pickup with a pedestal heavy MG in the bed.
   blender -b --factory-startup -P tools/blender/vehicles/enemy_a/technical.py -- [--nobake] [--res 2048 --orm 1024 --samples 16]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from veh_pipeline import *
from veh_parts import *
from veh_decals import *
import veh_decals as vd
import veh_pipeline as vp

# gun steel gets the baked wear too (shared list is extended in place, this script only)
if "gun_metal" not in vp.TEXTURED:
    vp.TEXTURED.append("gun_metal")
vp.RECIPES["gun_metal"] = dict(a=(0.06, 0.06, 0.065), dust=(0.16, 0.13, 0.10), rustc=(0.22, 0.09, 0.035), edgec=(0.45, 0.45, 0.47), rough=0.45, metal=0.9, rusty=0.6, dirty=0.9, mottle=0.4)

STYLE = dict(seed=11, rust=1.05, dirt=0.9, wear=0.9, scratch=0.7)
V = Vehicle("e_technical", style=STYLE)
M = V.M
reset_wheel_cache()

# ---------------------------------------------------------------------------------------------- decal masks
XMARK = make_image("xmark", xmark_alpha(512))
TALLY = make_image("tally", tally_alpha(512))
SKULL = make_image("skull", skull_alpha(512))


def patch_alpha(n=256, seed=1, w=0.9, h=0.7):
    """rough primer patch: wobbly rounded rectangle with roller streaks."""
    rng = np.random.RandomState(seed)
    x, y = vd._grid(n)
    wob = 0.0
    for k in range(6):
        fx, fy = rng.uniform(2, 9, 2)
        wob = wob + np.sin(x * fx + rng.uniform(0, 6.28)) * np.cos(y * fy + rng.uniform(0, 6.28)) * (0.05 / (k * 0.5 + 1))
    d = vd._sd_box(x, y, 0, 0, w, h, 0.08) + wob
    a = vd._soft(d, 0.03)
    streak = 0.85 + 0.15 * np.sin(y * 70 + rng.uniform(0, 6)) * rng.rand(n, n)
    return np.clip(a * streak, 0, 1)


PATCH_A = make_image("patch_a", patch_alpha(256, 1))
PATCH_B = make_image("patch_b", patch_alpha(256, 7, 0.75, 0.85))
PRIMER = (0.33, 0.28, 0.24)
DARK = (0.02, 0.02, 0.02)


def hook_paint(ctx, col):
    """cab colour: roof recognition mark, tailgate tally, primer patches"""
    g = ctx["g"]
    m = stamp(ctx, XMARK, (0.0, -0.30, 1.66), (1, 0, 0), (0, 1, 0), (0.80, 0.80), thick=0.05)
    col = g.mixc(g.mul(m, 0.9), col, DARK)
    m = stamp(ctx, TALLY, (0.0, -2.42, 1.05), (-1, 0, 0), (0, 0, 1), (0.66, 0.30), thick=0.06, n=(0, -1, 0))
    col = g.mixc(g.mul(m, 0.9), col, DARK)
    m = stamp(ctx, PATCH_A, (0.905, 0.10, 0.70), (0, -1, 0), (0, 0, 1), (0.60, 0.42), thick=0.05, n=(1, 0, 0))   # cab side (rear quarter)
    col = g.mixc(g.mul(m, 0.95), col, PRIMER)
    return col


def hook_paint2(ctx, col):
    """hood / doors / bed: primer patches, kill tally, skull"""
    g = ctx["g"]
    m = stamp(ctx, PATCH_B, (-0.28, 1.55, 1.0), (1, 0, 0), (0, -1, 0), (0.70, 0.75), thick=0.10)          # hood
    col = g.mixc(g.mul(m, 0.95), col, PRIMER)
    m = stamp(ctx, PATCH_A, (-0.905, 0.25, 0.62), (0, 1, 0), (0, 0, 1), (0.66, 0.42), thick=0.06, n=(-1, 0, 0))   # right door lower
    col = g.mixc(g.mul(m, 0.95), col, PRIMER)
    m = stamp(ctx, TALLY, (0.92, -1.25, 0.82), (0, -1, 0), (0, 0, 1), (0.70, 0.42), thick=0.06, n=(1, 0, 0))     # bed left side tally
    col = g.mixc(g.mul(m, 0.9), col, DARK)
    m = stamp(ctx, SKULL, (-0.92, -1.55, 0.80), (0, 1, 0), (0, 0, 1), (0.50, 0.50), thick=0.06, n=(-1, 0, 0))    # bed right side skull
    col = g.mixc(g.mul(m, 0.9), col, DARK)
    return col


STYLE["hooks"] = {"paint": hook_paint, "paint2": hook_paint2}

# ---------------------------------------------------------------------------------------------- key dimensions
AX_F, AX_R = 1.48, -1.33
R_T, W_T, RIM_R = 0.40, 0.285, 0.215
HUB_Z = R_T
TRACK = 0.79
GAP = 0.004
BELT = 1.06           # cab belt / door top skin
BED_TOP = 1.16        # bed side top
BED_FLOOR = 0.92
CAB_FLOOR = 0.40
PIV = (0.0, -0.92, 2.14)      # MG pivot (x,f,z)


def _interp(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for i in range(len(pts) - 1):
        if pts[i][0] <= x <= pts[i + 1][0]:
            t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
            return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
    return pts[-1][1]


def side_x(z, hw=0.905, zb=0.30, belt=BELT):
    return _interp([(zb, hw * 0.78), (zb + 0.05, hw * 0.93), (zb + 0.17, hw * 0.995), ((zb + belt) * 0.5 + 0.02, hw), (belt - 0.11, hw * 0.985),
                    (belt - 0.025, hw * 0.958), (belt, hw * 0.925)], z)


def hood_z(f):
    return _interp([(0.95, 1.075), (1.20, 1.05), (1.95, 1.005), (2.20, 0.985), (2.27, 0.94)], f)


def body_ring(hw, zb, belt, zt):
    half = [(0.0, zb), (hw * 0.80, zb), (hw * 0.94, zb + 0.05), (hw * 0.995, zb + 0.16), (hw, (zb + belt) * 0.5 + 0.02),
            (hw * 0.985, belt - 0.11), (hw * 0.958, belt - 0.025), (hw * 0.93, belt), (hw * 0.55, (belt + zt) * 0.5 + 0.003), (0.0, zt)]
    return sym_ring(half)


def make_tub():
    S = [
        (2.32, (0.84, 0.46, 0.80, 0.80)), (2.28, (0.885, 0.42, 0.92, 0.93)), (2.20, (0.905, 0.36, 0.97, 0.985)),
        (1.95, (0.905, 0.32, 0.99, 1.005)), (1.20, (0.905, 0.30, 1.03, 1.05)), (0.95, (0.905, 0.30, 1.05, 1.08)),
        (0.90, (0.905, 0.30, BELT, BELT)), (-0.58, (0.905, 0.30, BELT, BELT)), (-0.62, (0.915, 0.30, BED_TOP, BED_TOP)),
        (-2.34, (0.915, 0.30, BED_TOP, BED_TOP)), (-2.40, (0.90, 0.36, 1.14, 1.14)), (-2.43, (0.86, 0.42, 1.10, 1.10)),
    ]
    return loft_f("tub", [(f, body_ring(*p)) for f, p in S], "paint", cap=True)


def cutter(c, s, m="metal_dark", **kw):
    return bx("_cut", c, s, m, **kw)


def box_fz(x0, x1, f0, f1, z0, z1):
    return ((x0 + x1) / 2, (f0 + f1) / 2, (z0 + z1) / 2), (abs(x1 - x0), abs(f1 - f0), abs(z1 - z0))


def build_shell():
    tub = make_tub()
    for f in (AX_F, AX_R):
        for sx in (1, -1):
            bool_op(tub, cyl("_arch", (sx * 0.93, f, HUB_Z), 0.48, 0.5, "x", "metal_dark", sides=40))

    def extract(name, c, s, grp, inner, mat=None):
        cp = duplicate(tub, name)
        bool_op(cp, cutter(c, s, inner), "INTERSECT")
        if mat:
            for sl in cp.material_slots:
                if sl.material and sl.material.name == "paint":
                    sl.material = M[mat]
        add_bevel(cp, 0.007, 1, 30)
        apply_modifiers(cp)
        return reg(cp, grp)

    g = GAP
    c, s = box_fz(-0.80, 0.80, 0.94 + g, 2.27 - g, 0.90, 1.20)
    extract("hood", c, s, "panel_hood", "paint2", mat="paint2")
    c, s = box_fz(-0.80 + g, 0.80 - g, -2.50, -2.365 - g, 0.93, 1.30)
    extract("tailgate", c, s, "panel_tailgate", "paint")
    for nm, sd, grp in (("door_L", 1, "panel_door_L"), ("door_R", -1, "panel_door_R")):
        x0, x1 = (0.845 + g, 1.12) if sd > 0 else (-1.12, -0.845 - g)
        c, s = box_fz(x0, x1, -0.44 + g, 0.86 - g, 0.36 + g, 1.20)
        extract(nm, c, s, grp, "paint2", mat="paint2")

    def pocket(x0, x1, f0, f1, z0, z1, m="metal_dark"):
        c, s = box_fz(x0, x1, f0, f1, z0, z1)
        bool_op(tub, cutter(c, s, m))
    pocket(-0.815, 0.815, 0.925, 2.285, 0.88, 1.25)                # hood opening
    pocket(-0.62, 0.62, 1.10, 2.15, 0.34, 0.90)                    # engine bay
    pocket(-0.80, 0.80, -2.355, -0.68, BED_FLOOR, 1.40, "wood")    # bed
    pocket(-0.815, 0.815, -2.52, -2.355, 0.90, 1.30)               # tailgate opening
    for sd in (1, -1):
        x0, x1 = (0.845, 1.12) if sd > 0 else (-1.12, -0.845)
        pocket(x0, x1, -0.44 - 1.5 * g, 0.86 + 1.5 * g, 0.35, 1.30)
    pocket(-0.79, 0.79, -0.52, 0.80, CAB_FLOOR, 1.40, "interior")  # cab
    pocket(-0.55, 0.55, 1.05, 2.22, -0.05, 0.56)                   # underbody recess front
    pocket(-0.55, 0.55, -2.28, -1.05, -0.05, 0.56)                 # underbody recess rear
    for sd in (1, -1):                                             # head-lamp pockets
        pocket(sd * 0.66 - 0.14, sd * 0.66 + 0.14, 2.20, 2.42, 0.72, 0.88)
        pocket(sd * 0.78 - 0.065, sd * 0.78 + 0.065, -2.52, -2.40, 0.56, 0.88)   # tail lamps
    pocket(-0.34, 0.34, 2.19, 2.42, 0.60, 0.88)                    # grille
    add_bevel(tub, 0.008, 1, 30)
    apply_modifiers(tub)
    # colour blocking: the bed skin is paint2 (cab / roof / tailgate stay paint)
    bm = bmesh.new()
    bm.from_mesh(tub.data)
    slot = {s.material.name: i for i, s in enumerate(tub.material_slots) if s.material}
    if "paint2" not in slot:
        tub.data.materials.append(M["paint2"])
        slot["paint2"] = len(tub.material_slots) - 1
    for f in bm.faces:
        if f.material_index == slot["paint"] and f.calc_center_median().y > 0.66:      # Blender +y = rear
            f.material_index = slot["paint2"]
    bm.to_mesh(tub.data)
    bm.free()
    reg(tub, "body")
    return tub


def build_wheels():
    for nm, x, f in (("FL", TRACK, AX_F), ("FR", -TRACK, AX_F), ("RL", TRACK, AX_R), ("RR", -TRACK, AX_R)):
        build_wheel(V, "wheel_" + nm, (x, f, HUB_Z), 1 if x > 0 else -1, R_T, W_T, RIM_R, tire="mud", spokes=6, lugs=6, rim_style="deep", key="tech")
    # welded fender flares (rusty flat bar following the arch)
    for f in (AX_F, AX_R):
        for sd in (1, -1):
            pts = []
            for k in range(13):
                a = (14 + 152 * k / 12) * D2R
                ff = f + math.cos(a) * 0.50
                zz = HUB_Z + math.sin(a) * 0.50
                pts.append((sd * (side_x(zz, 0.905 if f > 0 else 0.915, 0.30, BELT if f > 0 else BED_TOP) + 0.004), ff, zz))
            tube("flare", pts, 0.017, "metal_bare", g="body", res=0)


# ---------------------------------------------------------------------------------------------- cab
def build_cab():
    quad_slab("windshield", [(0.80, 0.93, 1.09), (-0.80, 0.93, 1.09), (-0.755, 0.30, 1.585), (0.755, 0.30, 1.585)], 0.010, "glass", out=(0, 1, 1), g="body")
    for sd in (1, -1):
        beam("apillar", (sd * 0.825, 0.955, 1.05), (sd * 0.785, 0.26, 1.63), 0.05, 0.08, "paint", u=(0, 1, 0.6), g="body", bevel=0.006)
        beam("cpillar", (sd * 0.715, -0.595, 1.14), (sd * 0.715, -0.595, 1.62), 0.22, 0.07, "paint", u=(1, 0, 0), g="body", bevel=0.005)
    beam("wsh_seal", (0.80, 0.935, 1.085), (-0.80, 0.935, 1.085), 0.03, 0.03, "interior", u=(0, 1, 0), g="body")
    # wipers
    for sx in (0.42, -0.10):
        tube("wiper", [(sx, 0.88, 1.12), (sx + 0.06, 0.55, 1.42)], 0.007, "interior", g="body")
    # roof + rain rails
    prism("roof", rrect(1.66, 0.76, 0.05, 4, cx=0.0, cy=-0.30), "xf", 1.598, 1.66, "paint", bevel=0.009, seg=1, g="body")
    # back wall of the cab with a small rear window
    bx("bw_low", (0, -0.595, 1.215), (1.66, 0.07, 0.11), "paint", bevel=0.004, seg=1, g="body")
    bx("bw_high", (0, -0.595, 1.585), (1.66, 0.07, 0.07), "paint", bevel=0.004, seg=1, g="body")
    quad_slab("rearglass", [(0.53, -0.585, 1.27), (-0.53, -0.585, 1.27), (-0.53, -0.585, 1.55), (0.53, -0.585, 1.55)], 0.008, "glass", out=(0, -1, 0), g="body")
    for sx in (0.55, -0.55):
        bx("rg_side", (sx, -0.595, 1.41), (0.03, 0.05, 0.30), "interior", g="body")
    # guard bars over the rear window (welded, cheap)
    for k in (-0.3, 0.0, 0.3):
        tube("rg_bar", [(k, -0.625, 1.24), (k, -0.625, 1.58)], 0.011, "metal_bare", g="body")
    # roof rack with spotlights and gear
    ry = 1.775
    rack = [(0.74, 0.02, ry), (0.74, -0.62, ry), (-0.74, -0.62, ry), (-0.74, 0.02, ry)]
    tube("rack", rack, 0.014, "metal_bare", fillet=0.05, closed=True, g="body")
    for (x, f) in ((0.74, 0.02), (0.74, -0.62), (-0.74, 0.02), (-0.74, -0.62)):
        tube("rack_leg", [(x, f, 1.66), (x, f, ry)], 0.012, "metal_bare", g="body")
    for f in (-0.20, -0.42):
        tube("rack_bar", [(0.74, f, ry), (-0.74, f, ry)], 0.011, "metal_bare", g="body")
    for sx in (0.42, -0.42):
        cyl("spot", (sx, 0.045, ry + 0.09), 0.062, 0.11, "f", "armor", sides=12, g="body")
        cyl("spot_lens", (sx, 0.105, ry + 0.09), 0.050, 0.012, "f", "light_head", sides=12, g="body")
        tube("spot_arm", [(sx, 0.02, ry), (sx, 0.045, ry + 0.09)], 0.012, "metal_bare", g="body")
    cyl("bundle", (0.0, -0.32, ry + 0.115), 0.10, 1.10, "x", "canvas", sides=10, g="body")
    for sx in (0.28, -0.28):
        tube("bundle_rope", ring_pts((sx, -0.32, ry + 0.115), (1, 0, 0), 0.104, 12), 0.008, "interior", closed=True, g="body")
    bx("crate", (0.44, -0.44, ry + 0.11), (0.34, 0.26, 0.18), "armor", bevel=0.006, seg=1, g="body")


def door_extras(sd, grp, dmat):
    top = 1.585
    q = [(sd * 0.868, 0.82, 1.06), (sd * 0.868, 0.34, top), (sd * 0.868, -0.40, top), (sd * 0.868, -0.40, 1.06)]
    gl = quad_slab("dglass", q, 0.008, "glass", out=(sd, 0, 0), g=grp)
    deform_verts(gl, lambda v: Vector((v.x - sd * 0.10 * max(v.z - 1.06, 0), v.y, v.z)))
    beam("rail", (sd * 0.818, 0.32, top + 0.02), (sd * 0.818, -0.42, top + 0.02), 0.05, 0.04, dmat, u=(1, 0, 0), g=grp)
    beam("sash", (sd * 0.877, 0.85, 1.05), (sd * 0.818, 0.30, top + 0.01), 0.03, 0.05, dmat, u=(1, 0, 0), g=grp)
    beam("post", (sd * 0.877, -0.42, 1.05), (sd * 0.818, -0.42, top + 0.01), 0.05, 0.04, dmat, u=(0, 1, 0), g=grp)
    # wing mirror on brackets
    tube("mir_arm1", [(sd * 0.90, 0.80, 1.20), (sd * 1.07, 0.76, 1.30)], 0.009, "chrome", g=grp)
    tube("mir_arm2", [(sd * 0.90, 0.80, 1.34), (sd * 1.07, 0.76, 1.34)], 0.009, "chrome", g=grp)
    bx("mir_body", (sd * 1.10, 0.75, 1.30), (0.04, 0.11, 0.20), "chrome", bevel=0.01, seg=1, g=grp)
    # handle + lock
    hx = side_x(0.94) + 0.006
    bx("handle", (sd * hx, -0.30, 0.94), (0.024, 0.15, 0.03), "chrome", bevel=0.005, seg=1, g=grp)
    bx("lock", (sd * (hx - 0.002), -0.15, 0.94), (0.016, 0.03, 0.03), "chrome", g=grp)
    # door mouldings / crease
    beam("crease", (sd * (side_x(0.66) + 0.003), -0.38, 0.66), (sd * (side_x(0.66) + 0.003), 0.80, 0.66), 0.014, 0.03, dmat, u=(1, 0, 0), g=grp)


def plate_side(sd, f, z, wf, hz, grp, hw=0.905, belt=BELT, zb=0.30, t=0.014):
    x = side_x(z, hw, zb, belt)
    bx("plate", (sd * (x + t / 2 - 0.002), f, z), (t, wf, hz), "armor", bevel=0.004, seg=1, g=grp)
    bolts("rivets", rect_rivets((sd * (x + t - 0.002), f, z), "x", wf, hz, 0.022, 0.09, sign=sd), 0.0085, 0.008, "armor", g=grp, cap_dome=True)


def build_details():
    # door plates / patch armor
    plate_side(-1, 0.30, 0.58, 0.60, 0.34, "panel_door_R")
    plate_side(1, -0.10, 0.52, 0.36, 0.26, "panel_door_L")
    # hood plate
    fz = hood_z(1.55) - 0.001
    bx("hplate", (0.42, 1.60, fz + 0.007), (0.40, 0.44, 0.014), "armor", bevel=0.004, seg=1, g="panel_hood")
    bolts("hrivets", rect_rivets((0.42, 1.60, fz + 0.014), "z", 0.40, 0.44, 0.024, 0.09), 0.0085, 0.008, "armor", g="panel_hood", cap_dome=True)
    for sx in (0.55, -0.55):        # hood latches
        bx("hpin", (sx, 2.20, hood_z(2.2) + 0.006), (0.05, 0.03, 0.012), "metal_bare", g="panel_hood")
    # tailgate plate + strap chains
    bx("tgplate", (-0.35, -2.44, 1.03), (0.42, 0.014, 0.14), "armor", bevel=0.004, seg=1, g="panel_tailgate")
    bolts("tgrivets", rect_rivets((-0.35, -2.447, 1.03), "f", 0.42, 0.14, 0.02, 0.08, sign=-1), 0.008, 0.007, "armor", g="panel_tailgate", cap_dome=True)
    bx("tg_handle", (0.0, -2.446, 1.10), (0.20, 0.02, 0.03), "metal_bare", bevel=0.005, seg=1, g="panel_tailgate")
    # bed side: welded plate (left) + bolted planks (right)
    plate_side(1, -1.60, 0.80, 0.80, 0.40, "body", hw=0.915, belt=BED_TOP)
    for k in range(3):
        bx("plank", (-(0.915 + 0.012), -1.52 - 0.02 * k, 0.60 + 0.115 * k), (0.022, 0.85 + 0.03 * k, 0.10), "wood", bevel=0.004, seg=1, g="body", roll=0, yaw=0)
    bolts("plank_bolts", [((-0.929, f, z), (-1, 0, 0)) for f in (-1.16, -1.92) for z in (0.60, 0.715, 0.83)], 0.011, 0.008, "armor", g="body", cap_dome=True)
    # fuel filler on the left side of the bed
    cyl("fuelflap", (0.921, -2.02, 0.98), 0.055, 0.014, "x", "metal_bare", sides=14, g="body")
    cyl("fuelcap", (0.928, -2.02, 0.98), 0.028, 0.012, "x", "chrome", sides=10, g="body")
    # spare tyre bracketed to the right side of the bed
    cyl("spare", (-1.03, -2.04, 1.02), 0.33, 0.22, "x", "rubber_tire", sides=30, g="body")
    cyl("spare_rim", (-1.145, -2.04, 1.02), 0.20, 0.03, "x", "metal_bare", sides=14, g="body")
    cyl("spare_hub", (-1.165, -2.04, 1.02), 0.06, 0.03, "x", "metal_bare", sides=10, g="body")
    for z in (0.74, 1.30):
        beam("spare_bracket", (-0.915, -2.04, z), (-1.14, -2.04, z), 0.04, 0.02, "metal_bare", u=(0, 1, 0), g="body")
    # bed rear rail (welded pipe) - waist-high behind the gunner
    rail = [(0.87, -2.22, BED_TOP), (0.87, -2.24, 1.82), (-0.87, -2.24, 1.82), (-0.87, -2.22, BED_TOP)]
    tube("rail", rail, 0.024, "metal_bare", fillet=0.10, fn=4, g="body")
    for sd in (1, -1):
        tube("rail_side", [(sd * 0.87, -2.24, 1.82), (sd * 0.87, -1.70, 1.82)], 0.021, "metal_bare", g="body")
        tube("rail_post", [(sd * 0.87, -1.70, 1.82), (sd * 0.87, -1.70, BED_TOP)], 0.021, "metal_bare", g="body")
        tube("rail_brace", [(sd * 0.87, -2.24, 1.5), (sd * 0.87, -1.70, 1.5)], 0.016, "metal_bare", g="body")
    # chains on the tailgate
    for sd in (1, -1):
        pts = [(sd * 0.83, -2.40, 1.13)]
        for k in range(1, 8):
            t = k / 8
            pts.append((sd * (0.83 - 0.13 * t), -2.40 - 0.10 * t, 1.13 - 0.05 * math.sin(t * math.pi) - 0.10 * t))
        tube("chain", pts, 0.011, "metal_bare", g="body")
    # jerry cans in the front corners of the bed
    for sd, f in ((1, -0.80), (-1, -0.80)):
        bx("jerry", (sd * 0.60, f, BED_FLOOR + 0.20), (0.17, 0.36, 0.40), "armor", bevel=0.012, seg=1, g="body")
        bx("jerry_top", (sd * 0.60, f, BED_FLOOR + 0.42), (0.10, 0.20, 0.04), "armor", g="body")
        cyl("jerry_cap", (sd * 0.60, f + 0.10, BED_FLOOR + 0.455), 0.028, 0.03, "z", "metal_bare", sides=8, g="body")
        tube("jerry_handle", [(sd * 0.60, f - 0.12, BED_FLOOR + 0.42), (sd * 0.60, f - 0.12, BED_FLOOR + 0.48), (sd * 0.60, f, BED_FLOOR + 0.50)], 0.011, "armor", g="body")
    bx("ammo_a", (0.36, -2.16, BED_FLOOR + 0.10), (0.36, 0.20, 0.20), "armor", bevel=0.008, seg=1, g="body")
    bx("ammo_b", (-0.30, -2.18, BED_FLOOR + 0.09), (0.30, 0.22, 0.18), "armor", bevel=0.008, seg=1, g="body")
    # wood runners on the bed floor
    for f in (-1.25, -1.6, -1.95, -2.3):
        bx("runner", (0, f, BED_FLOOR + 0.012), (1.56, 0.07, 0.024), "wood", bevel=0.004, seg=1, g="body")
    # sandbags stacked along the inside of both bed walls
    rnd = random.Random(4)
    for sd in (1, -1):
        for layer, n in ((0, 4), (1, 4), (2, 3)):
            for i in range(n):
                f = -1.22 - i * 0.30 - (0.15 if layer == 1 else 0.0) - (0.0 if layer != 2 else 0.30)
                if f < -2.27:
                    continue
                z = BED_FLOOR + 0.065 + layer * 0.115
                ellipsoid("sandbag", (sd * (0.70 + rnd.uniform(-0.01, 0.01)), f + rnd.uniform(-0.01, 0.01), z), (0.108, 0.16, 0.062), "canvas", seg=8, rings=4, yaw=rnd.uniform(-5, 5), g="body")


def build_nose_tail():
    # front bumper + bull bar (welded pipes, aux lights, tow hook)
    poly = [(-0.90, 2.44), (0.90, 2.44), (0.98, 2.40), (1.00, 2.33), (0.94, 2.30), (0.88, 2.32), (-0.88, 2.32), (-0.94, 2.30), (-1.00, 2.33), (-0.98, 2.40)]
    prism("bumper_F", poly, "xf", 0.36, 0.56, "metal_bare", bevel=0.01, seg=1, g="panel_bumper_F")
    r = 0.030
    tube("bull_a", [(0.66, 2.40, 0.50), (0.66, 2.55, 0.56), (0.66, 2.57, 0.96), (-0.66, 2.57, 0.96), (-0.66, 2.55, 0.56), (-0.66, 2.40, 0.50)], r, "metal_bare", fillet=0.09, g="panel_bumper_F")
    tube("bull_b", [(0.66, 2.56, 0.74), (-0.66, 2.56, 0.74)], 0.026, "metal_bare", g="panel_bumper_F")
    tube("bull_mid", [(0.0, 2.55, 0.56), (0.0, 2.57, 0.96)], 0.026, "metal_bare", g="panel_bumper_F")
    for sd in (1, -1):
        tube("bull_wing", [(sd * 0.90, 2.38, 0.52), (sd * 0.82, 2.52, 0.62), (sd * 0.66, 2.57, 0.80)], 0.024, "metal_bare", fillet=0.06, g="panel_bumper_F")
        tube("bull_stay", [(sd * 0.66, 2.57, 0.94), (sd * 0.62, 2.28, 1.02)], 0.020, "metal_bare", g="panel_bumper_F")
        cyl("auxlamp", (sd * 0.38, 2.60, 0.86), 0.075, 0.10, "f", "metal_bare", sides=12, g="panel_bumper_F")
        cyl("auxlens", (sd * 0.38, 2.655, 0.86), 0.06, 0.012, "f", "light_head", sides=12, g="panel_bumper_F")
    bx("tow_hook", (0.30, 2.47, 0.42), (0.05, 0.10, 0.06), "metal_bare", g="panel_bumper_F")
    bx("skid", (0, 2.545, 0.50), (0.60, 0.014, 0.14), "metal_bare", bevel=0.004, seg=1, g="panel_bumper_F")
    bolts("skid_rivets", rect_rivets((0, 2.552, 0.50), "f", 0.60, 0.14, 0.02, 0.08, sign=1), 0.008, 0.007, "metal_bare", g="panel_bumper_F", cap_dome=True)
    # rear step bumper
    poly = [(-0.86, -2.53), (0.86, -2.53), (0.93, -2.49), (0.95, -2.40), (0.86, -2.40), (-0.86, -2.40), (-0.95, -2.40), (-0.93, -2.49)]
    prism("bumper_R", poly, "xf", 0.38, 0.52, "metal_bare", bevel=0.01, seg=1, g="panel_bumper_R")
    bx("step", (0.55, -2.46, 0.535), (0.42, 0.18, 0.03), "metal_bare", bevel=0.004, seg=1, g="panel_bumper_R")
    bx("step2", (-0.55, -2.46, 0.535), (0.42, 0.18, 0.03), "metal_bare", bevel=0.004, seg=1, g="panel_bumper_R")
    cyl("hitch_shank", (0.0, -2.58, 0.47), 0.028, 0.14, "f", "metal_bare", sides=8, g="panel_bumper_R")
    ellipsoid("hitch_ball", (0.0, -2.63, 0.50), (0.032, 0.032, 0.032), "metal_bare", seg=8, rings=5, g="panel_bumper_R")
    bx("plate", (0.0, -2.545, 0.63), (0.40, 0.012, 0.16), "metal_bare", bevel=0.004, seg=1, roll=-4, g="panel_bumper_R")
    # head lamps (square) + bezels, grille
    for sd in (1, -1):
        x = sd * 0.66
        bx("hl_lens", (x, 2.245, 0.80), (0.235, 0.016, 0.115), "light_head", g="body")
        bx("hl_refl", (x, 2.23, 0.80), (0.26, 0.014, 0.14), "chrome", g="body")
        for dx, dz, sx, sz in ((0, 0.075, 0.27, 0.018), (0, -0.075, 0.27, 0.018), (-0.125, 0, 0.018, 0.15), (0.125, 0, 0.018, 0.15)):
            bx("hl_bezel", (x + dx, 2.262, 0.80 + dz), (sx, 0.024, sz), "chrome", g="body")
        # indicator + tail lamp
        bx("ind", (sd * 0.87, 2.26, 0.70), (0.06, 0.014, 0.08), "light_head", g="body")
        bx("tl_lens", (sd * 0.78, -2.418, 0.72), (0.10, 0.014, 0.30), "light_tail", g="body")
        bx("tl_bezel", (sd * 0.78, -2.43, 0.72), (0.125, 0.012, 0.335), "chrome", g="body")
    bx("grille_bk", (0, 2.24, 0.74), (0.66, 0.02, 0.27), "metal_dark", g="body")
    for i in range(6):
        bx("grille_slat", (0, 2.275, 0.63 + i * 0.045), (0.66, 0.016, 0.02), "metal_bare", g="body")
    for sd in (1, -1):
        bx("grille_side", (sd * 0.335, 2.28, 0.74), (0.03, 0.02, 0.31), "chrome", g="body")
    bx("grille_top", (0, 2.28, 0.885), (0.70, 0.02, 0.03), "chrome", g="body")
    bx("grille_bot", (0, 2.28, 0.595), (0.70, 0.02, 0.03), "chrome", g="body")
    bx("badge", (0, 2.29, 0.74), (0.10, 0.008, 0.035), "chrome", g="body")


# ---------------------------------------------------------------------------------------------- interior
def build_interior():
    bx("seat_base", (0, -0.06, 0.48), (1.40, 0.56, 0.10), "interior", g="body")
    bx("seat_cush", (0, -0.06, 0.545), (1.42, 0.56, 0.11), "fabric", bevel=0.03, seg=2, g="body")
    bx("seat_back", (0, -0.37, 0.90), (1.42, 0.14, 0.60), "fabric", bevel=0.04, seg=2, pitch=9, g="body")
    bx("seat_backframe", (0, -0.45, 0.90), (1.38, 0.02, 0.56), "interior", pitch=9, g="body")
    bx("dash", (0, 0.62, 0.88), (1.56, 0.30, 0.22), "interior", bevel=0.02, seg=2, g="body")
    bx("dash_top", (0, 0.64, 1.005), (1.56, 0.26, 0.04), "interior", bevel=0.012, seg=1, pitch=-4, g="body")
    bx("binnacle", (0.38, 0.62, 1.055), (0.44, 0.15, 0.09), "interior", bevel=0.015, seg=1, g="body")
    bx("gauge", (0.38, 0.542, 1.05), (0.36, 0.012, 0.05), "metal_bare", g="body")
    bx("radio", (0.0, 0.48, 0.90), (0.26, 0.03, 0.09), "metal_dark", g="body")
    bx("glovebox", (-0.42, 0.48, 0.86), (0.36, 0.03, 0.14), "interior", g="body")
    wc = (0.38, 0.44, 1.10)
    ang = 28
    nrm = (0, math.cos(ang * D2R), -math.sin(ang * D2R))
    tube("swheel", ring_pts(wc, nrm, 0.20, 18), 0.014, "interior", closed=True, g="body")
    tube("swspoke1", [(wc[0] - 0.20, wc[1], wc[2]), (wc[0] + 0.20, wc[1], wc[2])], 0.011, "interior", g="body")
    s, c = math.sin(ang * D2R), math.cos(ang * D2R)
    beam("swspoke2", (wc[0], wc[1] + 0.20 * s, wc[2] + 0.20 * c), (wc[0], wc[1] - 0.20 * s, wc[2] - 0.20 * c), 0.02, 0.02, "interior", g="body")
    cyl("swhub", (wc[0], wc[1] + 0.012, wc[2] - 0.005), 0.045, 0.05, "f", "metal_bare", sides=10, pitch=-ang, g="body")
    tube("column", [(wc[0], wc[1] + 0.03, wc[2] - 0.012), (wc[0], 0.70, 0.86)], 0.03, "interior", g="body")
    bx("tunnel", (0, -0.05, 0.47), (0.32, 1.2, 0.14), "interior", bevel=0.03, seg=1, g="body")
    tube("shifter", [(0.0, 0.10, 0.52), (0.0, 0.14, 0.78)], 0.012, "metal_dark", g="body")
    tube("transfer", [(-0.08, 0.02, 0.52), (-0.10, 0.06, 0.72)], 0.011, "metal_dark", g="body")
    for sd in (1, -1):
        bx("armrest", (sd * 0.765, 0.12, 0.88), (0.055, 0.50, 0.055), "interior", bevel=0.012, seg=1, g="body")
    # rifle rack behind the seat (two bars)
    tube("rack_a", [(0.55, -0.50, 1.22), (-0.55, -0.50, 1.22)], 0.012, "metal_bare", g="body")
    tube("rack_b", [(0.55, -0.50, 1.42), (-0.55, -0.50, 1.42)], 0.012, "metal_bare", g="body")


# ---------------------------------------------------------------------------------------------- engine + underbody
def build_engine():
    bx("block", (0, 1.56, 0.62), (0.40, 0.58, 0.34), "metal_dark", bevel=0.015, seg=1, g="body")
    bx("head", (0, 1.56, 0.83), (0.30, 0.56, 0.12), "metal_dark", bevel=0.012, seg=1, g="body")
    bx("valvecover", (0, 1.56, 0.90), (0.24, 0.50, 0.05), "metal_bare", bevel=0.01, seg=1, g="body")
    bx("intake", (-0.22, 1.56, 0.80), (0.10, 0.44, 0.10), "metal_dark", bevel=0.01, seg=1, g="body")
    tube("manifold", [(0.22, 1.72, 0.72), (0.28, 1.56, 0.66), (0.30, 1.30, 0.52), (0.30, 1.05, 0.40)], 0.036, "metal_dark", g="body", fillet=0.05)
    cyl("aircleaner", (-0.30, 1.98, 0.80), 0.13, 0.20, "z", "metal_dark", sides=16, g="body")
    cyl("aircleaner_lid", (-0.30, 1.98, 0.915), 0.12, 0.03, "z", "metal_bare", sides=16, g="body")
    bx("radiator", (0, 2.13, 0.64), (0.66, 0.08, 0.46), "metal_dark", g="body")
    for i in range(-3, 4):
        bx("rad_fin", (i * 0.09, 2.17, 0.64), (0.008, 0.02, 0.44), "metal_bare", g="body")
    bx("shroud", (0, 2.03, 0.64), (0.60, 0.10, 0.42), "interior", bevel=0.01, seg=1, g="body")
    cyl("fan", (0, 1.92, 0.64), 0.19, 0.03, "f", "metal_bare", sides=12, g="body")
    bx("battery", (-0.50, 1.90, 0.52), (0.24, 0.20, 0.22), "interior", bevel=0.01, seg=1, g="body")
    bx("battery_top", (-0.50, 1.90, 0.64), (0.20, 0.16, 0.03), "metal_bare", g="body")
    tube("hose_up", [(0.24, 2.10, 0.78), (0.24, 1.85, 0.80), (0.10, 1.62, 0.76)], 0.028, "interior", fillet=0.07, g="body")
    tube("hose_lo", [(-0.22, 2.10, 0.48), (-0.24, 1.82, 0.46), (-0.12, 1.62, 0.52)], 0.028, "interior", fillet=0.07, g="body")
    bx("alternator", (0.27, 1.85, 0.54), (0.12, 0.14, 0.12), "metal_bare", bevel=0.01, seg=1, g="body")
    bx("firewall", (0, 0.98, 0.66), (1.30, 0.02, 0.52), "metal_dark", g="body")


def build_underbody():
    for sd in (1, -1):
        beam("frame", (sd * 0.44, 2.25, 0.22), (sd * 0.44, -2.30, 0.22), 0.09, 0.15, "metal_dark", u=(1, 0, 0), g="body", bevel=0.006, seg=1)
    for f in (2.05, 1.05, 0.2, -1.0, -2.0):
        beam("xmem", (0.44, f, 0.26), (-0.44, f, 0.26), 0.10, 0.08, "metal_dark", u=(0, 1, 0), g="body", bevel=0.005, seg=1)
    # solid axles with pumpkins, leaf springs, shocks, hubs
    for ax, hubx in ((AX_F, 0.0), (AX_R, 0.0)):
        tube("axle", [(0.80, ax, HUB_Z), (-0.80, ax, HUB_Z)], 0.06, "metal_dark", g="body")
        ellipsoid("diff", (0.12 if ax > 0 else 0.0, ax + (0.0), HUB_Z), (0.17, 0.19, 0.16), "metal_dark", seg=12, rings=8, g="body")
        for sd in (1, -1):
            beam("leaf", (sd * 0.58, ax + 0.60, 0.315), (sd * 0.58, ax - 0.60, 0.315), 0.07, 0.03, "metal_dark", u=(1, 0, 0), g="body")
            beam("leaf2", (sd * 0.58, ax + 0.48, 0.285), (sd * 0.58, ax - 0.48, 0.285), 0.065, 0.025, "metal_dark", u=(1, 0, 0), g="body")
            beam("leaf3", (sd * 0.58, ax + 0.36, 0.26), (sd * 0.58, ax - 0.36, 0.26), 0.06, 0.022, "metal_dark", u=(1, 0, 0), g="body")
            cyl("ubolt", (sd * 0.58, ax, 0.42), 0.02, 0.22, "z", "metal_bare", sides=6, g="body")
            cyl("shock", (sd * 0.66, ax - 0.16, 0.45), 0.024, 0.34, "z", "metal_dark", sides=8, roll=sd * 6, g="body")
            cyl("hubcap", (sd * 0.68, ax, HUB_Z), 0.11, 0.10, "x", "metal_dark", sides=12, g="body")
    tube("dragl", [(0.66, AX_F + 0.18, 0.32), (-0.20, AX_F + 0.22, 0.30), (-0.66, AX_F + 0.18, 0.32)], 0.014, "metal_dark", g="body")
    tube("steer_arm", [(-0.20, AX_F + 0.22, 0.30), (-0.20, AX_F + 0.02, 0.52)], 0.016, "metal_dark", g="body")
    bx("tcase", (0, 0.35, 0.32), (0.32, 0.36, 0.26), "metal_dark", bevel=0.02, seg=1, g="body")
    bx("trans", (0, 0.78, 0.44), (0.30, 0.55, 0.30), "metal_dark", bevel=0.02, seg=1, g="body")
    bx("oilpan", (0, 1.58, 0.36), (0.32, 0.46, 0.12), "metal_dark", bevel=0.012, seg=1, g="body")
    tube("shaft_r", [(0.0, 0.18, 0.28), (0.0, AX_R + 0.05, 0.40)], 0.038, "metal_bare", g="body")
    tube("shaft_f", [(0.0, 0.50, 0.28), (0.12, AX_F - 0.05, 0.40)], 0.034, "metal_bare", g="body")
    tube("exhaust", [(0.30, 1.05, 0.34), (0.40, 0.2, 0.19), (0.42, -1.4, 0.18), (0.42, -1.8, 0.18)], 0.038, "metal_dark", fillet=0.12, g="body")
    cyl("muffler", (0.42, -2.05, 0.19), 0.085, 0.70, "f", "metal_dark", sides=12, g="body")
    tube("tailpipe", [(0.42, -2.38, 0.19), (0.58, -2.52, 0.25), (0.62, -2.60, 0.24)], 0.030, "metal_dark", fillet=0.06, g="body")
    bx("fueltank", (-0.10, -1.72, 0.36), (0.85, 0.60, 0.20), "metal_dark", bevel=0.02, seg=1, g="body")
    for f in (-1.50, -1.94):
        beam("strap", (0.5, f, 0.26), (-0.5, f, 0.26), 0.03, 0.01, "metal_bare", u=(0, 1, 0), g="body")


# ---------------------------------------------------------------------------------------------- pedestal MG
def L(x, f, z):
    return (PIV[0] + x, PIV[1] + f, PIV[2] + z)


def build_pedestal():
    bx("ped_base", (PIV[0], PIV[1], BED_FLOOR + 0.02), (0.44, 0.44, 0.04), "armor", bevel=0.005, seg=1, g="body")
    bolts("ped_bolts", [((PIV[0] + dx, PIV[1] + df, BED_FLOOR + 0.042), (0, 0, 1)) for dx in (-0.17, 0.17) for df in (-0.17, 0.17)], 0.014, 0.012, "metal_bare", g="body")
    cyl("ped_post", (PIV[0], PIV[1], 1.47), 0.05, 1.08, "z", "armor", sides=12, g="body")
    cyl("ped_collar", (PIV[0], PIV[1], 1.30), 0.075, 0.06, "z", "armor", sides=12, g="body")
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        tube("ped_brace", [(PIV[0] + math.cos(a) * 0.17, PIV[1] + math.sin(a) * 0.17, BED_FLOOR + 0.04), (PIV[0], PIV[1], 1.34)], 0.016, "armor", g="body")
    cyl("ped_ring", (PIV[0], PIV[1], PIV[2] - 0.19), 0.095, 0.05, "z", "armor", sides=16, g="body")


def build_mg():
    G = "_mg"

    def part(fn, *a, **k):
        k["g"] = G
        return fn(*a, **k)
    part(bx, "receiver", L(0, 0.0, 0.0), (0.125, 0.50, 0.16), "gun_metal", bevel=0.008, seg=1)
    part(bx, "cover", L(0, 0.02, 0.095), (0.10, 0.32, 0.03), "gun_metal", bevel=0.005, seg=1)
    part(bx, "backplate", L(0, -0.27, 0.0), (0.17, 0.03, 0.14), "gun_metal", bevel=0.005, seg=1)
    part(cyl, "jacket", L(0, 0.55, 0.015), 0.034, 0.62, "f", "gun_metal", sides=12)
    for f in (0.42, 0.55, 0.68, 0.80):
        part(cyl, "jacket_fin", L(0, f, 0.015), 0.039, 0.02, "f", "gun_metal", sides=12)
    part(cyl, "barrel", L(0, 1.06, 0.015), 0.016, 0.40, "f", "gun_metal", sides=8)
    part(cyl, "muzzle", L(0, 1.31, 0.015), 0.030, 0.12, "f", "gun_metal", sides=10, r2=0.024)
    part(tube, "carry", [L(0, 0.32, 0.07), L(0, 0.32, 0.15), L(0, 0.52, 0.15), L(0, 0.52, 0.07)], 0.009, "gun_metal", fillet=0.03)
    for sd in (1, -1):
        part(tube, "grip", [L(sd * 0.05, -0.29, 0.03), L(sd * 0.11, -0.42, 0.06)], 0.010, "gun_metal")
        part(cyl, "grip_h", L(sd * 0.115, -0.43, 0.06), 0.017, 0.10, "f", "armor", sides=8)
        part(bx, "fork", L(sd * 0.085, 0.0, -0.10), (0.03, 0.16, 0.14), "gun_metal", bevel=0.004, seg=1)
    part(cyl, "cradle", L(0, 0.0, -0.045), 0.045, 0.24, "x", "gun_metal", sides=10)
    part(tube, "trigger", [L(0, -0.24, -0.02), L(0, -0.28, -0.08)], 0.008, "gun_metal")
    # ammo can + belt
    part(bx, "ammo", L(0.185, 0.0, -0.04), (0.19, 0.30, 0.20), "armor", bevel=0.008, seg=1)
    part(bx, "ammo_lid", L(0.185, 0.0, 0.07), (0.20, 0.31, 0.03), "armor", bevel=0.005, seg=1)
    part(tube, "belt", [L(0.16, 0.0, 0.08), L(0.12, 0.02, 0.10), L(0.07, 0.03, 0.07)], 0.014, "gun_metal", fillet=0.02)
    # shield: four plates leave a window round the barrel
    part(bx, "sh_l", L(-0.145, 0.37, 0.07), (0.20, 0.02, 0.36), "armor", bevel=0.004, seg=1)
    part(bx, "sh_r", L(0.145, 0.37, 0.07), (0.20, 0.02, 0.36), "armor", bevel=0.004, seg=1)
    part(bx, "sh_t", L(0, 0.37, 0.17), (0.09, 0.02, 0.16), "armor", bevel=0.004, seg=1)
    part(bx, "sh_b", L(0, 0.37, -0.06), (0.09, 0.02, 0.10), "armor", bevel=0.004, seg=1)
    for sd in (1, -1):
        part(bx, "sh_wing", L(sd * 0.265, 0.30, 0.07), (0.02, 0.16, 0.34), "armor", bevel=0.004, seg=1, yaw=sd * -14)
    part(bolts, "sh_rivets", [(L(sd * dx, 0.382, z), (0, 1, 0)) for sd in (1, -1) for dx in (0.10, 0.22) for z in (-0.08, 0.05, 0.18)], 0.011, 0.008, "metal_bare", cap_dome=True)
    part(tube, "sh_brace", [L(0.0, 0.05, -0.12), L(0.0, 0.36, -0.10)], 0.012, "armor")
    parts = REG.pop(G)
    for o in parts:
        bake_transform(o)
    mg = join(parts, "gun_mg")
    set_origin(mg, P(*PIV))
    smooth_by_angle(mg, 40)
    return mg


def build_sockets():
    sock("seat_driver", 0.38, -0.06, 0.665)
    sock("steering_wheel", 0.38, 0.44, 1.10, pitch=-28)
    sock("seat_gunner", 0.0, -1.42, BED_FLOOR + 0.024)
    gm = sock("gun_mount", PIV[0], PIV[1], PIV[2])
    sock("light_head_L", 0.66, 2.26, 0.80)
    sock("light_head_R", -0.66, 2.26, 0.80)
    sock("light_tail_L", 0.78, -2.42, 0.72, yaw=180)
    sock("light_tail_R", -0.78, -2.42, 0.72, yaw=180)
    sock("exhaust", 0.62, -2.62, 0.24, yaw=180)
    sock("smoke_engine", 0.0, 1.95, 0.88)
    sock("fuel_cap", 0.935, -2.02, 0.98, yaw=-90)
    sock("roof_top", 0.0, -0.30, 1.98)
    sock("camera_hood", 0.0, 1.35, 1.10)
    return gm


tub = build_shell()
build_wheels()
build_cab()
door_extras(1, "panel_door_L", "paint2")
door_extras(-1, "panel_door_R", "paint2")
build_nose_tail()
build_interior()
build_details()
build_engine()
build_underbody()
build_pedestal()
mg = build_mg()
gm = build_sockets()
mg.parent = gm
mg.location = (0, 0, 0)
mg.rotation_euler = (0, 0, 0)

V.pivot("panel_hood", 0, 0.94, 1.06)
V.pivot("panel_tailgate", 0, -2.40, 0.93)
V.pivot("panel_bumper_F", 0, 2.44, 0.47)
V.pivot("panel_bumper_R", 0, -2.53, 0.47)
V.pivot("panel_door_L", 0.90, 0.86, 0.70)
V.pivot("panel_door_R", -0.90, 0.86, 0.70)
finish_wheel_shading()
V.finish(bake=True)
