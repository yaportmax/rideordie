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


# ================================================================== BODY: frame (stainless forging, rounded edges)
body = G.part("body")
import gunkit as K
from gunlib import bool_op

fp = [(-21, 60), (-19, 72), (-12, 82), (2, 88.5), (30, 90.5), (104, 90.5), (111, 88), (111, 40), (106, 31), (96, 28.5), (42, 29.5), (30, 33),
      (20, 40), (-8, 47), (-17, 52)]
fr = [2, 6, 8, 8, 4, 1.5, 2, 3, 5, 3, 6, 6, 6, 5, 3]
frame_bm = K.rounded_prism(fp, -FRAME_HW, FRAME_HW, r=3.2, fillet=fr, fsegs=5, rsegs=3)
# cylinder window with radiused corners (forged frame, not a milled box)
_wx0, _wx1, _wz0, _wz1 = CYL_X0 - 0.5, CYL_X1 + 1.0, 37.0, 81.5
_win = prism_bm([(_wx0, _wz0), (_wx1, _wz0), (_wx1, _wz1), (_wx0, _wz1)], -30, 30, fillet=[3.5, 3.5, 5.0, 5.0], fsegs=4)
# top strap: broad chamfers along both upper edges (trapezoid section) + lower front edges of the frame under the cylinder
_ch = []
for sy in (-1, 1):
    _ch.append(box_bm((116.0, 9.0, 9.0), c=(45.0, sy * (FRAME_HW + 1.2), 91.2), rot=(45, 0, 0)))
    _ch.append(box_bm((62.0, 7.0, 7.0), c=(84.0, sy * (FRAME_HW + 1.4), 28.2), rot=(45, 0, 0)))
cuts = [_win,                                                                                                                      # cylinder window
        box_bm((40, 11.4, 30), c=(10, 0, 84)),                                                                                    # hammer slot
        box_bm((16, 8.6, 12), c=(38, 0, 32)),                                                                                     # trigger slot
        box_bm((6, 14, 22), c=(103.5, 13, 46)),                                                                                   # crane recess (left)
        cyl_bm((103, 0, BORE_Z), (115, 0, BORE_Z), 11.4, segs=28)] + _ch                                                          # barrel shank hole
body.add(bool_op(frame_bm, cuts), "gun_steel", bevel=0)
# recoil shield boss (raised round face behind the cylinder, both sides) - breaks up the flat frame side
for sy in (-1, 1):
    _rs = cyl_bm((47.0, sy * (FRAME_HW - 0.5), CYL_Z), (47.0, sy * (FRAME_HW + 0.7), CYL_Z), 16.5, segs=40)
    body.add(bool_op(_rs, [box_bm((40, 10, 40), c=(47.0 + 20.0 + 6.5, sy * FRAME_HW, CYL_Z))]), "gun_steel", bevel=0.5)
# round trigger guard (part of the frame)
tg = sweep_bm([(32, 0, 32), (30, 0, 22), (38, 0, 13.5), (56, 0, 10.5), (78, 0, 12.5), (92, 0, 20), (96, 0, 29)], radius=1.0, segs=4,
              profile=[(5.6, 2.3), (-5.6, 2.3), (-5.6, -2.3), (5.6, -2.3)], smooth=5)
body.add(tg, "gun_steel", bevel=0.8)
# side plate outline (right) + screws, pins
for (sx, sz) in ((HAMMER_PIN[0], HAMMER_PIN[1]), (TRIG_PIN[0], TRIG_PIN[1])):
    body.add(K.rivet((sx, -FRAME_HW, sz), (0, -1, 0), 2.6, 0.6), "gun_steel", bevel=0)
for (sx, sz) in ((0, 76), (44, 82), (48, 48), (8, 50)):
    body.add(K.screw_head((sx, FRAME_HW, sz), (0, 1, 0), 2.1, 0.8), "gun_steel", bevel=0)
body.add(K.screw_head((94, -FRAME_HW, 34), (0, -1, 0), 2.0, 0.7), "gun_steel", bevel=0)
# cylinder release latch (thumbpiece, left side behind the recoil shield) with grooves
latch = box_bm((11, 4.2, 13), c=(47.5, FRAME_HW + 1.8, 66), rot=(0, 4, 0))
gr = [box_bm((0.9, 5, 13.2), c=(43.2 + k * 2.0, FRAME_HW + 2.5, 66)) for k in range(5)]
body.add(bool_op(latch, gr), "gun_metal", bevel=0.5)
body.cyl((54.6, 0, 76.0), (52.0, 0, 76.0), 2.1, segs=14, mat="gun_steel", bevel=0.1)
# rear sight (adjustable, black) on the top strap
body.add(box_bm((17, 12.4, 3.6), c=(42, 0, 92.2)), "gun_black", bevel=0.6)
rs_blade = prism_bm([(33.6, 93.8), (34.0, 99.6), (38.8, 99.6), (39.2, 93.8)], -5.2, 5.2)
body.add(bool_op(rs_blade, [box_bm((6, 3.2, 3.4), c=(36.4, 0, 99.2))]), "gun_black", bevel=0.45)
body.add(K.screw_head((42, 6.3, 92.0), (0, 1, 0), 2.0, 1.0), "gun_steel", bevel=0)
body.add(K.screw_head((46, 0, 94.0), (0, 0, 1), 1.8, 0.9), "gun_steel", bevel=0)

# ================================================================== BODY: barrel + full lug + vent rib (stainless)
bp = [(104.0, 11.8), (150, 11.5), (200, 10.7), (238, 10.2), (249.5, 10.0), (251.4, 9.4), (252.0, 8.6), (252.0, 4.9), (244.0, 4.9), (244.0, 0.0)]
barrel = lathe_bm(bp, segs=40, c=(0, 0, BORE_Z))
lug_ring = rrect_ring(22.0, 28.0, 8.5, n=3, c=(0, 59.0))
lug = loft_bm([(104.0, lug_ring), (234.0, lug_ring), (238.5, rrect_ring(20.0, 26.0, 8.0, n=3, c=(0, 59.0))), (241.0, rrect_ring(15.0, 21.0, 6.5, n=3, c=(0, 58.0)))])
bl = bool_op(barrel, [lug], "UNION")
body.add(bl, "gun_steel", bevel=[(0.9, 3, lambda e: e.verts[0].co.x > 235 and e.verts[1].co.x > 235), (0.45, 2, None)],
         cut=[cyl_bm((103.0, 0, CYL_Z), (238.0, 0, CYL_Z), 4.0, segs=20)])
rib_z0, rib_z1 = 87.6, 90.0
body.box((249.0 - 104.0, 6.4, rib_z1 - rib_z0), c=((104 + 249) / 2, 0, (rib_z0 + rib_z1) / 2), mat="gun_steel", bevel=0.5)
for k in range(0, 14):
    body.box((4.2, 4.6, rib_z0 - 84.6 + 0.6), c=(107.0 + 10.5 * k, 0, (84.6 + rib_z0) / 2 - 0.3), mat="gun_steel", bevel=0.25)
fs = prism_bm([(228.0, rib_z1 - 0.6), (231.0, 96.8), (243.5, 98.4), (246.6, 98.0), (247.6, rib_z1 - 0.6)], -1.9, 1.9)
body.add(fs, "gun_black", bevel=0.45, cut=[prism_bm([(230.6, 95.4), (232.6, 95.4), (233.5, 92.2), (231.4, 92.2)], -0.9, 0.9)])
body.add(box_bm((3.2, 2.0, 5.0), c=(233.4, 0, 94.0), rot=(0, -28, 0)), "paint2", bevel=0.2)
body.lathe([(101.0, 0), (101.0, 12.3), (104.5, 12.3), (104.5, 0)], c=(0, 0, BORE_Z), segs=40, mat="gun_steel", bevel=0.35)
body.cyl((240.9, 0, 58.0), (241.3, 0, 58.0), 2.2, segs=12, mat="gun_steel", bevel=0.0)

# ================================================================== GRIP (checkered walnut, round butt) + medallions
# grip-local sections (lz along the grip axis, lx forward): front, back, width.  Palm swell at lz ~ -10, round butt.
GRIP = [(56, 15.0, -20.0, 29.5), (46, 16.2, -22.5, 31.0), (30, 18.4, -25.8, 32.8), (12, 20.2, -28.0, 34.4), (-6, 20.8, -28.9, 35.2),
        (-22, 20.2, -28.6, 35.2), (-36, 18.6, -27.4, 34.2), (-46, 15.8, -25.2, 32.6), (-52, 11.8, -22.0, 30.4), (-55.4, 6.0, -17.0, 27.2),
        (-57.4, -1.0, -11.0, 21.0), (-58.2, -4.5, -7.5, 11.0)]


def grip_half_w(lz):
    zs = [g[0] for g in GRIP][::-1]
    return float(np.interp(lz, zs, [g[3] for g in GRIP][::-1])) / 2


def revolver_grip(N=56, e=3.2):
    rings = []
    for lz, fr, bk, wd in GRIP:
        cx, a, b = (fr + bk) / 2, (fr - bk) / 2, wd / 2
        ring = []
        for k in range(N):
            t = 2 * math.pi * k / N
            ct, st = math.cos(t), math.sin(t)
            lx = cx + a * math.copysign(abs(ct) ** (2 / e), ct)
            y = b * math.copysign(abs(st) ** (2 / e), st)
            if ct > 0.35:                      # finger grooves on the front strap (middle / ring finger)
                g = sum(2.1 * math.exp(-((lz - c0) / 6.5) ** 2) for c0 in (-4.0, -27.0))
                lx -= g * min(1.0, (ct - 0.35) / 0.4)
            ring.append(gv(lx, lz, y))
        rings.append(ring)
    bm = bmesh.new()
    vr = [[bm.verts.new(v) for v in r] for r in rings]
    for i in range(len(vr) - 1):
        for k in range(N):
            k2 = (k + 1) % N
            bm.faces.new((vr[i][k], vr[i][k2], vr[i + 1][k2], vr[i + 1][k]))
    bm.faces.new(list(reversed(vr[0])))
    bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


body.add(revolver_grip(), "wood", bevel=0)
for sy in (-1, 1):
    body.add(K.rivet(gp(-4.0, 22.0, sy * (grip_half_w(22.0) - 0.25)), (0, sy, 0), 5.8, 0.8, segs=24), "gun_steel", bevel=0)
    body.add(K.screw_head(gp(-4.0, -22.0, sy * (grip_half_w(-22.0) - 0.15)), (0, sy, 0), 2.4, 0.8), "gun_steel", bevel=0)
# (butt: the wood wraps the round butt completely - no steel butt cap)

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
crane.add(arm, "gun_steel", bevel=0.6)
crane.cyl((98.5, HINGE[1], HINGE[2]), (109.5, HINGE[1], HINGE[2]), 5.2, segs=20, mat="gun_steel", bevel=0.4)
crane.cyl((97.8, HINGE[1], HINGE[2]), (98.6, HINGE[1], HINGE[2]), 3.4, segs=14, mat="gun_steel", bevel=0.0)
# yoke barrel (tube around the ejector rod, seen just in front of the cylinder)
crane.lathe([(100.2, 0), (100.2, 6.6), (103.9, 6.6), (103.9, 0)], c=(0, 0, CYL_Z), segs=28, mat="gun_steel", bevel=0.3)
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
cyl_node.add(cbody, "gun_steel", bevel=[(0.35, 2, None)], cut=ccuts)
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
    wear=0.7, dust=0.35, rust=0.05, paint2_color=(0.6, 0.03, 0.02), steel_rough=0.42, steel_base=(0.22, 0.22, 0.225),
    engrave=[dict(text="MAGNUM .357", pos=(172.0, 11.2, 60.0), u=(-1, 0, 0), v=(0, 0, 1), h=4.6, depth=0.08, mats=["gun_steel"], slab=2.5),
             dict(text="RDA ARMS", pos=(172.0, -11.2, 60.0), u=(1, 0, 0), v=(0, 0, 1), h=3.2, depth=0.06, mats=["gun_steel"], slab=2.5),
             dict(text="357", pos=(80.0, -12.8, 34.0), u=(1, 0, 0), v=(0, 0, 1), h=2.4, depth=0.05, mats=["gun_steel"], slab=2.0)],
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
