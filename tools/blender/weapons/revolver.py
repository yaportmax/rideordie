"""RIDE OR DIE - revolver: .357 Magnum double-action, 6" full-lug vent-rib barrel (Colt Python vibes).
Units mm, G frame (+X fwd, +Y left, +Z up).  Origin = grip centre (right palm)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gunlib
from gunlib import *
import gunlook
import numpy as np

G = Gun("revolver")
GA = 22.0                       # grip rake (butt rearward)
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)


def gp(lx, lz, y=0.0):
    """grip-local (lx forward-ish, lz along the grip axis, up) -> gun frame."""
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


def gv(lx, lz, y=0.0):
    return Vector(gp(lx, lz, y))


def hull2(c0, r0, c1, r1, n=10):
    """outline (CCW) of the convex hull of two circles in 2D"""
    (x0, y0), (x1, y1) = c0, c1
    dx, dy = x1 - x0, y1 - y0
    d = math.hypot(dx, dy)
    a = math.atan2(dy, dx)
    phi = math.acos(max(-1, min(1, (r0 - r1) / d)))
    pts = []
    for k in range(n + 1):
        t = a - phi + 2 * phi * k / n
        pts.append((x1 + r1 * math.cos(t), y1 + r1 * math.sin(t)))
    for k in range(n + 1):
        t = a + phi + (2 * math.pi - 2 * phi) * k / n
        pts.append((x0 + r0 * math.cos(t), y0 + r0 * math.sin(t)))
    return pts


# ---------------------------------------------------------------- layout constants (mm)
BORE_Z = 74.0            # bore axis
CYL_Z = 60.0             # cylinder axis (top chamber sits under the bore)
CYL_X0, CYL_X1 = 54.0, 100.0
CYL_R = 20.0
MUZZLE_X = 252.0
FRAME_HW = 12.5          # half width of the frame
HAMMER_PIN = (14.0, 62.0)
TRIG_PIN = (32.0, 40.0)
HINGE = (104.0, 16.0, 33.0)     # crane hinge (pin along the bore, lower left of the frame)


# ================================================================== BODY: frame
body = G.part("body")

fp = [(-19.5, 68), (-18, 76.5), (-12.5, 81), (28, 81), (32.5, 86.5), (36, 91.5), (58, 92), (104.5, 90), (104.5, 36), (100.5, 26), (94, 14), (84, 9), (44, 9), (30, 13), (22, 24),
      (17, 38), (-12, 50), (-19, 60)]
fr = [0, 6.0, 7.0, 4.0, 3.0, 3.0, 1.5, 0.8, 0, 4.0, 6.0, 8.0, 8.0, 6.0, 8.0, 0, 0, 0]
frame_bm = prism_bm(fp, -FRAME_HW, FRAME_HW, fillet=fr, fsegs=6)

cuts = []
# cylinder window: open to both sides, top strap above and floor below
cuts.append(box_bm((104.5 - 54.0, 60, 81.5 - 38.5), c=((54 + 104.5) / 2, 0, (81.5 + 38.5) / 2)))
# trigger-guard opening
cuts.append(prism_bm([(34, 16), (88, 16), (96.0, 25), (99.5, 35.5), (36, 35.5)], -20, 20, fillet=[3.0, 5.0, 0, 0, 3.0], fsegs=4))
# hammer slot
cuts.append(box_bm((62, 11.4, 46), c=(14, 0, 78)))
# trigger slot in the floor
cuts.append(box_bm((14, 8.4, 6), c=(38, 0, 37)))
# crane recess (left side, lower front)
cuts.append(box_bm((6, 14, 22), c=(101.5, 13, 46)))


def _long_side_edge(e):
    a, b = e.verts[0].co, e.verts[1].co
    return abs(a.y) > 12.0 and abs(b.y) > 12.0 and (abs(a.x - b.x) + abs(a.z - b.z)) > 2.5


body.add(frame_bm, "gun_metal", bevel=[(1.5, 3, _long_side_edge), (0.6, 2, None)], cut=cuts)

# sideplate (left) + screws
sp_pts = [(-8, 82), (50, 88), (56, 62), (46, 46), (10, 43), (-8, 60)]
body.prism(sp_pts, FRAME_HW - 0.3, FRAME_HW + 0.55, mat="gun_metal", bevel=0.35, fillet=2.5, fsegs=3)
for (sx, sz) in ((0, 78), (44, 82), (48, 50), (10, 46)):
    body.add(screw_bm((sx, FRAME_HW + 0.55, sz), (0, 1, 0), 2.1, 0.9), "gun_steel", bevel=0.1)
# right side: hammer pin + trigger pin + screw heads
for (sx, sz) in ((HAMMER_PIN[0], HAMMER_PIN[1]), (TRIG_PIN[0], TRIG_PIN[1]), (16, 44)):
    body.add(screw_bm((sx, -FRAME_HW, sz), (0, -1, 0), 2.6, 0.8, slot=False), "gun_steel", bevel=0.1)
body.add(screw_bm((70, -FRAME_HW, 44), (0, -1, 0), 2.0, 0.8), "gun_steel", bevel=0.1)
body.add(screw_bm((94, -FRAME_HW, 30), (0, -1, 0), 2.0, 0.8), "gun_steel", bevel=0.1)

# cylinder release latch (thumbpiece, left of the recoil shield) with grooves
latch = box_bm((10, 4.0, 14), c=(49.5, FRAME_HW + 2.0, 66), rot=(0, 4, 0))
gr = [box_bm((0.9, 5, 14.2), c=(45.5 + k * 2.0, FRAME_HW + 2.6, 66)) for k in range(5)]
body.add(latch, "gun_metal", bevel=0.6, cut=gr)

# recoil shield / frame window details: firing-pin bush
body.cyl((54.6, 0, 76.0), (52.0, 0, 76.0), 2.1, segs=14, mat="gun_steel", bevel=0.1)

# rear sight (adjustable, dovetailed into the top strap) + blade with notch
rs_base = box_bm((17, 13.0, 3.5), c=(43, 0, 93.7))
body.add(rs_base, "gun_black", bevel=0.6)
rs_blade = prism_bm([(34.6, 95.0), (35.0, 100.8), (39.4, 100.8), (39.8, 95.0)], -5.2, 5.2)
body.add(rs_blade, "gun_black", bevel=0.5, cut=[box_bm((6, 3.4, 3.4), c=(37.2, 0, 100.4))])
# elevation + windage screws, leaf spring
body.add(screw_bm((43, 6.7, 93.4), (0, 1, 0), 2.2, 1.1), "gun_steel", bevel=0.1)
body.add(screw_bm((47, 0, 95.4), (0, 0, 1), 2.0, 1.0), "gun_steel", bevel=0.1)
body.box((7, 10, 0.9), c=(50, 0, 95.6), mat="gun_steel", bevel=0.25)

# ================================================================== BODY: barrel + full lug + vent rib
bp = [(104.0, 11.8), (150, 11.5), (200, 10.7), (238, 10.2), (249.5, 10.0), (251.4, 9.4), (252.0, 8.6), (252.0, 4.9), (244.0, 4.9), (244.0, 0.0)]
barrel = lathe_bm(bp, segs=40, c=(0, 0, BORE_Z))
lug_ring = rrect_ring(22.0, 28.0, 8.5, n=3, c=(0, 59.0))
lug = loft_bm([(104.0, lug_ring), (234.0, lug_ring), (238.5, rrect_ring(20.0, 26.0, 8.0, n=3, c=(0, 59.0))), (241.0, rrect_ring(15.0, 21.0, 6.5, n=3, c=(0, 58.0)))])
bl = bool_op(barrel, [lug], "UNION")
body.add(bl, "gun_metal", bevel=[(0.9, 3, lambda e: e.verts[0].co.x > 235 and e.verts[1].co.x > 235), (0.45, 2, None)],
         cut=[cyl_bm((103.0, 0, CYL_Z), (238.0, 0, CYL_Z), 4.0, segs=20)])
# vent rib: strip on posts
rib_z0, rib_z1 = 87.6, 90.0
body.box((249.0 - 104.0, 6.4, rib_z1 - rib_z0), c=((104 + 249) / 2, 0, (rib_z0 + rib_z1) / 2), mat="gun_metal", bevel=0.5)
for k in range(0, 14):
    body.box((4.2, 4.6, rib_z0 - 84.6 + 0.6), c=(107.0 + 10.5 * k, 0, (84.6 + rib_z0) / 2 - 0.3), mat="gun_metal", bevel=0.25)
# front ramp sight + red insert
fs = prism_bm([(228.0, rib_z1 - 0.6), (231.0, 96.8), (243.5, 98.4), (246.6, 98.0), (247.6, rib_z1 - 0.6)], -1.9, 1.9)
body.add(fs, "gun_black", bevel=0.45, cut=[prism_bm([(230.6, 95.4), (232.6, 95.4), (233.5, 92.2), (231.4, 92.2)], -0.9, 0.9)])
body.box((3.2, 2.6, 5.5), c=(233.4, 0, 94.0), mat="gun_steel", bevel=0.2, rot=(0, -28, 0))
# barrel/frame shoulder ring (nut) + front lug rod-end screw + muzzle crown ring
body.lathe([(101.0, 0), (101.0, 12.3), (104.5, 12.3), (104.5, 0)], c=(0, 0, BORE_Z), segs=40, mat="gun_metal", bevel=0.35)
body.cyl((240.9, 0, 58.0), (241.3, 0, 58.0), 2.2, segs=12, mat="gun_steel", bevel=0.0)

# ================================================================== GRIP (wood) + front strap + medallions
def wring(w, d, r, off):
    return rrect_ring(w, d, r, n=3, c=(0, off))


def wring2(w, rear, front=17.5, r=11.0):
    return rrect_ring(w, front - rear, r, n=3, c=(0, (front + rear) / 2))


gsecs = [(0, wring2(26, -30, r=9)), (10, wring2(29, -29, r=10.5)), (28, wring2(32, -27, r=12)), (60, wring2(33, -26, r=12.5)),
         (82, wring2(32.5, -28, r=12.5)), (94, wring2(31, -31, r=12)), (100, wring2(28.5, -33, r=11.5))]
gtop = gv(0, 42)
grip = loft_bm(gsecs, cap=True, xf=Matrix.Translation(gtop) @ Matrix.Rotation((90 + GA) * D2R, 4, "Y"))
body.add(grip, "wood", bevel=[(1.4, 3, None)], angle=24.0)
# steel front strap
fstrap = box_bm((2.4, 15.0, 92.0), c=gp(17.6, -5.0), rot=(0, GA, 0))
body.add(fstrap, "gun_metal", bevel=0.5)
# medallions + grip screw
for sy in (-1, 1):
    body.cyl(gp(-3.0, 20.0, sy * 15.6), gp(-3.0, 20.0, sy * 16.7), 6.4, segs=24, mat="gun_steel", bevel=0.2, angle=20)
    body.cyl(gp(-3.0, -24.0, sy * 16.0), gp(-3.0, -24.0, sy * 17.1), 2.6, segs=12, mat="gun_steel", bevel=0.15, angle=20)
# butt cap/lanyard ring stub
body.box((22, 27, 3.0), c=gp(-6.5, -55.5), rot=(0, GA, 0), mat="gun_metal", bevel=1.0)

# ================================================================== TRIGGER GUARD screws etc.
body.cyl((26.0, -8, 20.0), (26.0, 8, 20.0), 1.6, segs=10, mat="gun_steel", bevel=0.0) if False else None

# ================================================================== HAMMER (moving)
ham = G.part("hammer", pivot=(HAMMER_PIN[0], 0, HAMMER_PIN[1]))
hp = [(51.0, 74.0), (51.5, 68.5), (36.0, 63.5), (22.0, 55.5), (14.0, 53.6), (7.0, 56.5), (0.0, 65.0), (-9.0, 78.0), (-17.0, 88.0),
      (-21.5, 92.0), (-20.5, 96.0), (-13.0, 97.5), (-5.5, 95.0), (6.0, 89.5), (24.0, 82.5), (42.0, 77.5)]
hbody = prism_bm(hp, -5.0, 5.0, fillet=[0.6, 0.8, 1.5, 3.0, 5.0, 4.0, 3.0, 6.0, 5.0, 2.0, 2.0, 2.5, 4.0, 5.0, 5.0, 3.0], fsegs=3)
hs = []
for k in range(7):
    t = k / 6.0
    px = -19.0 + 12.5 * t
    pz = 95.6 - 1.8 * t - 4.2 * t * t
    hs.append(box_bm((0.75, 14.0, 2.0), c=(px, 0, pz + 0.4), rot=(0, 24 + 18 * t, 0)))
ham.add(hbody, "gun_metal", bevel=[(0.5, 2, None)], cut=hs)
ham.box((16, 11.0, 0.8), c=(-13.0, 0, 97.7), mat="gun_steel", bevel=0.2, rot=(0, 20, 0)) if False else None
ham.cyl((HAMMER_PIN[0], -5.0, HAMMER_PIN[1]), (HAMMER_PIN[0], 5.0, HAMMER_PIN[1]), 3.2, segs=14, mat="gun_steel", bevel=0.0)
ham.box((5.5, 2.4, 3.0), c=(49.0, 0, 72.0), mat="gun_steel", bevel=0.3)          # nose face / firing-pin striker

# ================================================================== TRIGGER (moving)
trig = G.part("trigger", pivot=(TRIG_PIN[0], 0, TRIG_PIN[1]))
tpath = [(TRIG_PIN[0], 0, TRIG_PIN[1] - 1.0), (39.0, 0, 33.0), (46.0, 0, 25.5), (48.6, 0, 19.5), (48.0, 0, 15.0)]
trig.sweep(tpath, radius=1.0, profile=[(4.1, 2.9), (-4.1, 2.9), (-4.1, -2.9), (4.1, -2.9)], mat="gun_metal", bevel=0.7, smooth=5)
trig.cyl((TRIG_PIN[0], -6.0, TRIG_PIN[1]), (TRIG_PIN[0], 6.0, TRIG_PIN[1]), 2.4, segs=12, mat="gun_metal", bevel=0.0)
trig.box((12, 3.0, 4.0), c=(28.0, 0, 43.5), mat="gun_metal", bevel=0.5)

# ================================================================== CRANE (swing-out yoke) + CYLINDER
crane = G.part("crane", pivot=HINGE)
# yoke arm: hull of two circles in the y-z plane, thin plate in front of the cylinder
arm = prism_x_bm(hull2((HINGE[1], HINGE[2]), 6.0, (0.0, CYL_Z), 9.6, 12), 100.5, 103.8)
crane.add(arm, "gun_metal", bevel=0.6)
crane.cyl((98.5, HINGE[1], HINGE[2]), (109.5, HINGE[1], HINGE[2]), 5.2, segs=20, mat="gun_metal", bevel=0.4)
crane.cyl((97.8, HINGE[1], HINGE[2]), (98.6, HINGE[1], HINGE[2]), 3.4, segs=14, mat="gun_steel", bevel=0.0)
# yoke barrel (tube around the ejector rod, seen just in front of the cylinder)
crane.lathe([(100.2, 0), (100.2, 6.6), (103.9, 6.6), (103.9, 0)], c=(0, 0, CYL_Z), segs=28, mat="gun_metal", bevel=0.3)
crane.cyl((HINGE[0] - 1.5, HINGE[1], HINGE[2] + 5.0), (HINGE[0] + 2.5, HINGE[1], HINGE[2] + 5.0), 1.0, segs=8, mat="gun_steel") if False else None
crane.add(screw_bm((101.0, HINGE[1] + 5.0, HINGE[2] - 1.0), (0, 1, 0), 2.0, 0.8), "gun_steel", bevel=0.1)

cyl_node = G.part("cylinder", pivot=(77.0, 0, CYL_Z), parent="crane")
CX0, CX1 = CYL_X0, CYL_X1
cprof = [(CX0, 0.0), (CX0, CYL_R - 2.2), (CX0 + 1.4, CYL_R - 0.6), (CX0 + 3.0, CYL_R), (CX1 - 2.2, CYL_R), (CX1 - 0.5, CYL_R - 1.2), (CX1, CYL_R - 2.4), (CX1, 0.0)]
cbody = lathe_bm(cprof, segs=48, c=(0, 0, CYL_Z))
ccuts = []
RCH = 13.6
for k in range(6):
    a = math.radians(90 + 60 * k)
    y, z = RCH * math.cos(a), CYL_Z + RCH * math.sin(a)
    ccuts.append(cyl_bm((CX0 + 1.9, y, z), (CX1 + 1.0, y, z), 4.95, segs=20))                  # chamber
    ccuts.append(cyl_bm((CX0 - 1.0, y, z), (CX0 + 2.3, y, z), 5.85, segs=20))                  # rim counterbore
    af = math.radians(90 + 60 * k + 30)
    fy, fz = (CYL_R + 0.4) * math.cos(af), CYL_Z + (CYL_R + 0.4) * math.sin(af)
    x_a, x_b = CX0 + 11.0, CX1 - 11.5
    fl = merge_bm([cyl_bm((x_a, fy, fz), (x_b, fy, fz), 5.5, segs=14), sphere_bm(5.5, (x_a, fy, fz), usegs=12, vsegs=6), sphere_bm(5.5, (x_b, fy, fz), usegs=12, vsegs=6)])
    ccuts.append(fl)
    # stop notches on the un-fluted rear band (between chambers' flutes: at the chamber angle)
    ny, nz = (CYL_R + 0.25) * math.cos(a), CYL_Z + (CYL_R + 0.25) * math.sin(a)
    ccuts.append(box_bm((8.0, 5.2, 1.4), c=(CX0 + 8.0, ny, nz), rot=(-(90 + 60 * k), 0, 0)))
cyl_node.add(cbody, "gun_metal", bevel=[(0.35, 2, None)], cut=ccuts)
# ratchet star at the rear face + centre pin
cyl_node.lathe([(CX0 - 1.8, 0), (CX0 - 1.8, 7.4), (CX0 + 0.5, 8.0), (CX0 + 0.5, 0)], c=(0, 0, CYL_Z), segs=14, mat="gun_steel", bevel=0.0,
               mod=lambda k: 1.0 if k % 2 == 0 else 0.62)
# chambered rounds (.357): brass case with rim/primer, jacketed bullet
for k in range(6):
    a = math.radians(90 + 60 * k)
    y, z = RCH * math.cos(a), CYL_Z + RCH * math.sin(a)
    rb = round_bms("357", segs=12, at=(CX0 + 2.6, y, z))
    cyl_node.add(rb["case"], "brass", bevel=0)
    cyl_node.add(rb["bullet"], "brass", bevel=0)
    cyl_node.add(rb["primer"], "gun_steel", bevel=0)
# ejector rod (spins with the cylinder, lives in the full lug when closed)
cyl_node.lathe([(CX0 + 2.0, 0), (CX0 + 2.0, 3.0), (236.0, 3.0), (236.5, 3.6), (240.0, 3.6), (240.0, 0)], c=(0, 0, CYL_Z), segs=16, mat="gun_steel", bevel=0.0)

# ================================================================== SOCKETS
G.socket("muzzle", (MUZZLE_X, 0, BORE_Z))
G.socket("eject", (CX0, 0, CYL_Z), rot=(0, 0, 90), parent="crane")     # +X = out of the cylinder REAR (cases are punched rearward when the crane is open)
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (6.0, 17.0, -8.0))
G.socket("mag_well", (77.0, 0, CYL_Z), parent="crane")
G.socket("sight", (-60.0, 0, 100.0))

# ---- documentation
G.motion("hammer", "rotate", (0, 1, 0), -55.0, "cock: -55 deg about the node's +X axis (glTF) swings the spur rearward (top goes back) - spur ends ~10 mm behind the frame; pivot = hammer pin.")
G.motion("trigger", "rotate", (0, 1, 0), 20.0, "pull: +20 deg about +X (glTF) swings the finger blade rearward (double action); pivot = trigger pin.")
G.motion("crane", "rotate", (1, 0, 0), -70.0, "swing-out: rotate the crane (carries `cylinder`, ejector rod, eject/mag_well sockets) by -70 deg about the node's +Z axis (glTF forward, right-hand rule) -> the cylinder swings out to the LEFT (+X) and slightly up. Pivot = crane hinge pin (x=104, left y=+16, z=33 mm in gun mm).")
G.motion("cylinder", "rotate", (1, 0, 0), 60.0, "index: spins about its own axis (local +Z glTF); 60 deg per chamber (either direction; real Colts turn clockwise seen from the rear). Origin = cylinder centre. It is a CHILD of `crane`.")
G.remark("Reload: swing the crane out (-70 deg), punch cases out rearward via `eject` (crane child), drop fresh rounds into the chambers at `mag_well` (cylinder centre), swing back. Six brass .357 rounds are modelled in the chambers.")
G.remark("Hands: right hand on the wood grip at grip_R (index on the trigger); support hand cups the left grip panel at grip_L. Hammer spur is ~ 10 mm from the web of the hand when cocked.")
G.remark("Socket orientations: `eject` +X points REARWARD (out of the cylinder rear when the crane is open), it and `mag_well` are children of `crane` so they follow the swing. `muzzle`/`grip_R`/`sight` are static.")
G.remark("Ejector rod is inside `cylinder` and hides in the full underlug bore when closed. `sight` sits 60 mm behind the frame at the sight-line height (over the rear notch).")

# ---- looks: checkered walnut, red front sight
import wood_look


def _checker(c, P):
    """checkering on both grip panels (two crossing 45 deg line families in the grip plane), plain border + medallion clear"""
    lx = P[:, 0] * _c - P[:, 2] * _s
    lz = P[:, 0] * _s + P[:, 2] * _c
    side = gunlook.smoothstep(11.0, 14.0, np.abs(P[:, 1]))
    inside = gunlook.smoothstep(-14.5, -11.5, lx) * gunlook.smoothstep(15.5, 12.5, lx) * gunlook.smoothstep(-47.0, -43.0, lz) * gunlook.smoothstep(31.0, 27.0, lz)
    med = gunlook.smoothstep(6.6, 8.2, np.hypot(lx + 3.0, lz - 20.0))
    zone = side * inside * med
    pitch = 1.65
    u = (lx + lz) / 1.4142 / pitch
    v = (lx - lz) / 1.4142 / pitch
    tu = np.abs(u - np.round(u)) * 2.0
    tv = np.abs(v - np.round(v)) * 2.0
    ridge = gunlook.smoothstep(0.10, 0.55, np.minimum(tu, tv))
    return zone, ridge


wood_look.install(grain=(math.sin(GA * D2R), 0.0, math.cos(GA * D2R)), checker=_checker, stripe=1.9, dark=(0.032, 0.011, 0.004), light=(0.125, 0.050, 0.020))
G.notes["style"] = dict(
    decals=[dict(pos=(233.4, 0, 94.0), r=2.4, color=(0.55, 0.035, 0.02), mats=["gun_steel"], rough=0.45)],
)
if G.args.get("pose"):
    import gunlib
    gunlib.OUT_DIR = os.path.join(gunlib.RL.PUBLIC, "models", "_test")
    G.name = "revolver_pose"
    _orig_export2 = gunlib.export_gltf
    def _posed2(path):
        bpy.data.objects["hammer"].rotation_euler = (math.radians(-55.0), 0, 0)      # G +Y rot == Blender +X rot
        bpy.data.objects["trigger"].rotation_euler = (math.radians(20.0), 0, 0)
        bpy.context.view_layer.update()
        _orig_export2(path)
    gunlib.export_gltf = _posed2
if G.args.get("open"):
    import gunlib
    gunlib.OUT_DIR = os.path.join(gunlib.RL.PUBLIC, "models", "_test")
    G.name = "revolver_open"
    _orig_export = gunlib.export_gltf
    def _posed(path):
        cr = bpy.data.objects["crane"]
        cr.rotation_euler = (0, math.radians(70.0), 0)       # G +X rot -70 deg  ==  Blender +Y rot +70 deg
        bpy.context.view_layer.update()
        _orig_export(path)
    gunlib.export_gltf = _posed
G.finish()
