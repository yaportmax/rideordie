"""RIDE OR DIE - rifle: AK-pattern assault rifle (AK / M4 hybrid: railed dust cover + holo optic, banana 30-rd 7.62x39, wood + polymer + rubber).
Units mm, G frame (+X fwd, +Y left, +Z up).  Origin = pistol-grip centre."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *

# ---- local wood recipe (straighter, longer AK-style grain than the shared recipe; monkeypatched only for this script) ----
import numpy as np
import gunlook as GL


def wood_ak(c, style):
    N = c.N
    st = style or {}
    P = c.P
    q0, q1 = P[:, 1], P[:, 2]
    wob = (c.nM - 0.5) * 2.2 + (c.nL - 0.5) * 7.0
    r = np.sqrt(q0 ** 2 + (q1 * 1.1) ** 2) + wob + 0.03 * P[:, 0]
    ring = (0.5 + 0.5 * np.sin(r * 1.35)) ** 1.6
    fine = GL.vnoise(P, (0.035, min(c.fmax * 1.2, 1.6), min(c.fmax * 1.2, 1.6)), 91)
    streak = GL.vnoise(P, (0.02, 0.9, 0.9), 133)
    grain = ring * 0.5 + fine * 0.3 + streak * 0.2
    dark = np.array(st.get("wood_dark", (0.05, 0.018, 0.007)), np.float32)
    light = np.array(st.get("wood_light", (0.22, 0.09, 0.035)), np.float32)
    alb = dark + (light - dark) * grain[:, None]
    alb = alb * (0.72 + 0.5 * c.nL[:, None])
    hi, lo, grime = GL._wear_common(c, st, 1.0, 0.7, 0.8)
    wear = np.clip(hi + lo * 0.7, 0, 1)
    bleach = np.array([0.24, 0.16, 0.085], np.float32)
    alb = alb * (1 - wear[:, None] * 0.65) + bleach * wear[:, None] * 0.65 * (0.7 + 0.5 * c.nH[:, None])
    alb = alb * (1 - grime[:, None] * 0.65) + np.array([0.026, 0.019, 0.013], np.float32) * grime[:, None] * 0.65
    alb = alb * (0.4 + 0.6 * c.ao_s[:, None])
    oil = GL.smoothstep(0.45, 0.75, c.nL2)
    rough = 0.52 - 0.14 * oil + 0.15 * wear + 0.15 * grime + 0.06 * (c.nH - 0.5)
    h = (ring - 0.5) * 0.006 - 0.03 * np.maximum(c.scr_a, c.scr_b)     # keep the wood normal map nearly flat: small PNG, grain lives in the albedo
    return alb, np.clip(rough, 0.2, 1.0), np.zeros(N, np.float32), h


GL.RECIPES["wood"] = wood_ak

G = Gun("rifle")
BZ = 92.0                        # bore axis height
GA = 22.0                        # grip rake
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)
RX0, RX1 = -162.0, 208.0         # receiver rear / front trunnion face
MUZZLE_X = 568.0


def gp(lx, lz, y=0.0):
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


def ring_ak(w, h, rt, rb, zc, n=4):
    """AK receiver-style ring: flat sides, big radius on the (dust-cover) top corners, small at the bottom.  Points are (y, z)."""
    pts = [(w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2), (-w / 2, -h / 2)]
    p2 = fillet_poly(pts, [rb, rt, rt, rb], n)
    return [(y, z + zc) for y, z in p2]


def edge_dir(e):
    a, b = e.verts[0].co, e.verts[1].co
    return abs(a.x - b.x), abs(a.y - b.y), abs(a.z - b.z)


# =========================================================================================== RECEIVER (stamped steel + dust cover)
body = G.part("body")
ZC = BZ - 1.0
rec = loft_bm([(RX0, ring_ak(40, 62, 14, 5, ZC)), (RX0 + 4, ring_ak(46, 66, 20, 6, ZC)), (RX1 - 4, ring_ak(46, 66, 20, 6, ZC)), (RX1, ring_ak(44, 64, 19, 6, ZC))])
cav = loft_bm([(RX0 + 6, ring_ak(42.0, 59.0, 17, 4, ZC - 0.5)), (RX1 - 8, ring_ak(42.0, 59.0, 17, 4, ZC - 0.5))])
port = prism_bm([(14, BZ - 14), (168, BZ - 14), (172, BZ + 2), (168, BZ + 18), (14, BZ + 18)], -34, -10, fillet=[4, 4, 0, 5, 5], fsegs=3)
slot = box_bm((200, 12, 6), c=(60, -24, BZ + 12))                                                # charging-handle slot along the right side
magopen = box_bm((60, 30.0, 26), c=(115, 0, 58))
cuts = [cav, port, slot, magopen]
body.add(rec, "gun_black", bevel=[(1.0, 1, None)], cut=cuts)
# rail on the dust cover
rail = rail_bm(-150, 150, 123.2, width=21.2, height=5.6, pitch=10.16, slot=5.32, base=2.4)
body.add(rail, "gun_black", bevel=0.35, segs=1, angle=30)
# stamped ribs / reinforcement beads on the receiver sides + lower rim
for sy in (1, -1):
    body.box((300, 4.4, 5.0), c=(20, sy * 23.4, BZ - 22), mat="gun_black", bevel=1.5)
    body.box((150, 3.6, 4.0), c=(-70, sy * 23.4, BZ + 20), mat="gun_black", bevel=1.2)
# front trunnion block + barrel nut
body.box((30, 47, 62), c=(RX1 - 12, 0, ZC), mat="gun_metal", bevel=2.0)
body.lathe([(RX1, 0), (RX1, 15.5), (RX1 + 2, 16), (RX1 + 14, 16), (RX1 + 16, 14.5), (RX1 + 16, 0)], c=(0, 0, BZ), segs=28, mat="gun_metal", bevel=0.0)
# rear tang + stock bolt plate
body.box((30, 30, 8), c=(RX0 - 6, 0, BZ + 30), mat="gun_black", bevel=1.5)
body.cyl((RX0 - 6, 0, BZ + 34), (RX0 - 6, 0, BZ + 38), 5.0, segs=16, mat="gun_metal", bevel=0.4, angle=40)
# rivets: two rows both sides
for sy in (1, -1):
    for k in range(9):
        body.cyl((RX0 + 24 + k * 38.0, sy * 22.4, BZ - 8), (RX0 + 24 + k * 38.0, sy * 24.6, BZ - 8), 2.4, segs=10, mat="gun_metal", bevel=0.2, angle=40)
    for k in range(6):
        body.cyl((RX0 + 30 + k * 50.0, sy * 22.4, BZ + 24), (RX0 + 30 + k * 50.0, sy * 24.0, BZ + 24), 2.0, segs=10, mat="gun_metal", bevel=0.2, angle=40)
# magazine well rim + dimples + mag catch
body.box((66, 34, 3.0), c=(115, 0, 44.6), mat="gun_black", bevel=0.8)
body.box((12, 3, 6), c=(118, -17.5, 50.6), mat="gun_metal", bevel=0.8)
body.box((10, 6, 24), c=(83, 0, 41), mat="gun_black", bevel=1.0)                 # catch bar (rear of the well)
# trigger guard strap
tg = sweep_bm([(10, 0, 56.5), (7, 0, 44), (16, 0, 30), (44, 0, 21), (78, 0, 26), (90, 0, 42), (92, 0, 56)], radius=1.0, segs=4,
              profile=[(9.0, 1.7), (-9.0, 1.7), (-9.0, -1.7), (9.0, -1.7)], smooth=5)
body.add(tg, "gun_black", bevel=0.6)
# selector shaft + pivot boss (lever is its own node)
body.cyl((22, -24.0, BZ - 6), (22, 24.0, BZ - 6), 3.4, segs=12, mat="gun_metal", bevel=0.2, angle=40)
body.cyl((22, -25.0, BZ - 6), (22, -28.0, BZ - 6), 6.0, segs=20, mat="gun_metal", bevel=0.4, angle=40)

# =========================================================================================== PISTOL GRIP (polymer + rubber)
top = Vector(gp(0, 72))
gsecs = [(0, rrect_ring(30, 36, 10, n=3)), (18, rrect_ring(31, 38, 10, n=3)), (26, rrect_ring(34, 40, 11, n=3)), (67, rrect_ring(35, 41.5, 12, n=3)), (110, rrect_ring(35, 44, 12, n=3)), (118, rrect_ring(36, 45, 12, n=3))]
grip = loft_bm(gsecs, xf=Matrix.Translation(top) @ Matrix.Rotation((90 + GA) * D2R, 4, "Y"))
gcuts = [cyl_bm(gp(22.5, lz, -25), gp(22.5, lz, 25), 5.4, segs=16) for lz in (28.0, 10.0, -8.0, -26.0)]
body.add(grip, "polymer", bevel=[(1.0, 2, None)], cut=gcuts)
body.cyl(gp(0, -46, -6), gp(0, -47.6, -6), 4.2, segs=14, mat="gun_metal", bevel=0.3, angle=40)               # grip screw cap (bottom)
body.box((3, 20, 62), c=gp(-18.0, 4, 0), rot=(0, GA, 0), mat="rubber", bevel=1.0)                            # rubber backstrap insert

# =========================================================================================== BARREL + GAS SYSTEM + FURNITURE
barrel = [(RX1 - 40, 13.0), (RX1 + 12, 13.0), (RX1 + 12, 10.2), (395, 10.2), (405, 8.7), (505, 8.7), (MUZZLE_X - 30, 8.7), (MUZZLE_X - 30, 0)]
body.lathe(barrel, c=(0, 0, BZ), segs=32, mat="gun_metal", bevel=0.0)
# rear sight base + leaf (on the barrel just ahead of the receiver)
body.box((52, 30, 12), c=(238, 0, BZ + 16), mat="gun_black", bevel=1.2)
body.prism([(214, BZ + 22), (250, BZ + 22), (262, BZ + 34), (216, BZ + 30)], -8.0, 8.0, mat="gun_black", bevel=0.6)
body.box((6, 16, 3), c=(256, 0, BZ + 34.6), mat="gun_black", bevel=0.4)
body.cyl((236, 0, BZ + 30), (236, 0, BZ + 33), 3.4, segs=10, mat="gun_metal", bevel=0.2, angle=40)
# gas tube (under the upper handguard) + gas block
body.lathe([(RX1 + 12, 0), (RX1 + 12, 9.4), (398, 9.4), (398, 0)], c=(0, 0, BZ + 21.5), segs=20, mat="gun_metal", bevel=0.0)
gb = box_bm((34, 24, 26), c=(402, 0, BZ + 9))
body.add(gb, "gun_black", bevel=1.6, cut=[cyl_bm((398, 0, BZ + 21.5), (430, 0, BZ + 21.5), 6.0, segs=16)])
body.lathe([(396, 0), (396, 11.0), (398, 12.0), (428, 12.0), (430, 10.0), (430, 0)], c=(0, 0, BZ), segs=24, mat="gun_black", bevel=0.0)
body.cyl((408, -6, BZ - 14), (408, 6, BZ - 14), 4.0, segs=12, mat="gun_metal", bevel=0.4, angle=40)         # bayonet lug / sling loop base
body.sweep([(408, 0, BZ - 16 - 6 * math.cos(a * math.pi / 8.0)) for a in range(17)], radius=1.6, segs=8, mat="gun_metal")
# cleaning rod under the barrel
body.cyl((424, 0, BZ - 14), (532, 0, BZ - 14), 3.0, segs=10, mat="gun_metal", bevel=0.0)
body.lathe([(532, 0), (532, 4.4), (536, 4.4), (536, 0)], c=(0, 0, BZ - 14), segs=14, mat="gun_metal")
# front sight base with post + hood
fsb = box_bm((28, 20, 24), c=(524, 0, BZ + 12))
body.add(fsb, "gun_black", bevel=1.4, cut=[cyl_bm((510, 0, BZ), (545, 0, BZ), 8.7, segs=24)])
body.cyl((524, 0, BZ + 22), (524, 0, BZ + 48), 2.0, r1=1.5, segs=12, mat="gun_metal", bevel=0.0)
body.lathe([(0, 6.6), (0, 8.0), (12, 8.0), (12, 6.6), (0, 6.6)], c=(524, 0, BZ + 36), axis="z", segs=20, mat="gun_black", bevel=0.0, cap=False)
for sy in (1, -1):
    body.box((14, 3.0, 12), c=(524, sy * 9.5, BZ + 27), mat="gun_black", bevel=0.6)       # hood ears
# muzzle brake (slant compensator)
mb = lathe_bm([(MUZZLE_X - 34, 9.8), (MUZZLE_X - 30, 12.4), (MUZZLE_X - 4, 12.4), (MUZZLE_X, 11.4), (MUZZLE_X, 4.2), (MUZZLE_X - 30, 4.2), (MUZZLE_X - 30, 0)], 28, "x", c=(0, 0, BZ))
body.add(mb, "gun_metal", bevel=0.5, cut=[box_bm((30, 40, 22), c=(MUZZLE_X + 1, 0, BZ + 16), rot=(0, 38, 0)), cyl_bm((MUZZLE_X - 22, -14, BZ + 3), (MUZZLE_X - 22, 14, BZ + 3), 2.6, segs=10)])

# lower handguard (wood) with finger grooves; upper handguard (wood) over the gas tube
lg = loft_bm([(RX1 + 2, rrect_ring(46, 50, 13, n=3, c=(0, BZ - 12))), (RX1 + 10, rrect_ring(46, 50, 13, n=3, c=(0, BZ - 12))),
              (376, rrect_ring(42, 46, 12, n=3, c=(0, BZ - 13))), (396, rrect_ring(39, 42, 11, n=3, c=(0, BZ - 13)))])
lg_cuts = [cyl_bm((262 + k * 33, -30, BZ - 43), (262 + k * 33, 30, BZ - 43), 8.0, segs=20) for k in range(4)]
lg_cuts.append(cyl_bm((RX1 - 5, 0, BZ), (420, 0, BZ), 9.4, segs=24))
body.add(lg, "wood", bevel=[(1.2, 2, None)], cut=lg_cuts)
ug_pts = []
ug_ring = fillet_poly([(21, -13), (21, 13), (-21, 13), (-21, -13)], [3, 17, 17, 3], 4)
ug = loft_bm([(262, [(y, z + BZ + 20.0) for y, z in ug_ring]), (270, [(y, z + BZ + 20.0) for y, z in ug_ring]),
              (376, [(y * 0.95, z + BZ + 19.5) for y, z in ug_ring]), (388, [(y * 0.9, z + BZ + 19.0) for y, z in ug_ring])])
body.add(ug, "wood", bevel=[(1.1, 2, None)], cut=[cyl_bm((260, 0, BZ + 21.5), (392, 0, BZ + 21.5), 9.9, segs=20)])
# heat-shield liner ring (steel) at the rear of the upper handguard
body.box((10, 42, 5), c=(RX1 + 8, 0, BZ + 32), mat="gun_black", bevel=0.8)

# =========================================================================================== STOCK (wood) + butt pad (rubber)
ssecs = [(RX0 - 4, rrect_ring(30, 66, 10, n=3, c=(0, 87))), (-200, rrect_ring(31, 68, 11, n=3, c=(0, 86))), (-232, rrect_ring(31, 78, 12, n=3, c=(0, 78))),
         (-270, rrect_ring(33, 92, 13, n=3, c=(0, 65))), (-322, rrect_ring(35, 106, 13, n=3, c=(0, 51)))]
stk = loft_bm(ssecs)
body.add(stk, "wood", bevel=[(1.4, 2, None)])
pad = loft_bm([(-322, rrect_ring(35.6, 107, 13, n=3, c=(0, 51))), (-329, rrect_ring(35.6, 108, 13, n=3, c=(0, 51))), (-333, rrect_ring(34.0, 104, 12, n=3, c=(0, 51)))])
body.add(pad, "rubber", bevel=[(1.3, 2, None)])
# butt plate screws, trap door, sling swivels
for zz in (12, 90):
    body.cyl((-333, 0, zz), (-335, 0, zz), 3.0, segs=12, mat="gun_metal", bevel=0.2, angle=40)
body.cyl((-290, -4, 22), (-290, 4, 22), 3.0, segs=12, mat="gun_metal", bevel=0.3, angle=40)

# =========================================================================================== BOLT CARRIER (visible through the ejection port)
BPIV = (-30.0, 0, BZ - 1.0)
bolt = G.part("bolt", pivot=BPIV)
bcar = box_bm((200, 32, 28), c=(70, 0, BZ + 2))
bolt.add(bcar, "gun_metal", bevel=2.6, cut=[box_bm((78, 40, 8), c=(86, 0, BZ + 16)), box_bm((26, 40, 11), c=(150, 0, BZ + 10))])
bolt.cyl((150, 0, BZ + 4), (250, 0, BZ + 4), 7.0, segs=16, mat="gun_steel", bevel=0.0)                 # gas piston (goes into the gas tube)
bolt.cyl((94, 0, BZ + 3), (176, 0, BZ + 3), 9.4, segs=16, mat="gun_steel", bevel=0.5, angle=40)          # bolt body (inside the carrier window)
bolt.box((14, 3.0, 6.0), c=(172, -8.6, BZ + 6), mat="gun_steel", bevel=0.5)                              # extractor claw
bolt.box((18, 10, 14), c=(120, -18.0, BZ + 6), mat="gun_metal", bevel=1.0)                                # handle boss
bolt.cyl((-30, 0, BZ + 2), (-60, 0, BZ + 2), 5.0, segs=14, mat="gun_metal", bevel=0.0)                   # rear return-spring guide
for k in range(6):
    bolt.box((1.4, 34, 3.4), c=(-6 + k * 5.0, 0, BZ + 16.6), mat="gun_black", bevel=0.2)

# =========================================================================================== CHARGING HANDLE (right side)
CH = (124.0, -22.0, BZ + 10.0)
ch = G.part("charging_handle", pivot=CH)
ch.box((16, 12, 5.0), c=(124, -25.0, BZ + 10), mat="gun_metal", bevel=0.8)                    # stem through the slot
ch.prism([(126, BZ + 8), (128, BZ + 11), (139, BZ + 22), (149, BZ + 21), (142, BZ + 7)], -31.0, -27.0, mat="gun_metal", bevel=0.7, fillet=1.6, fsegs=3)
ch.cyl((144, -31.0, BZ + 20), (144, -34.5, BZ + 20), 6.2, segs=20, mat="gun_metal", bevel=0.4, angle=40, mod=lambda k: 0.93 if k % 2 else 1.0)

# =========================================================================================== SELECTOR LEVER (right side, shown in FIRE position)
sel = G.part("selector", pivot=(22.0, -25.0, BZ - 6))
sel.prism([(18, BZ - 4), (30, BZ - 12), (60, BZ - 13), (108, BZ - 10), (114, BZ - 12), (114, BZ - 5), (104, BZ - 2), (60, BZ - 5), (34, BZ + 0), (22, BZ + 8), (8, BZ + 14), (4, BZ + 8), (8, BZ)], -25.6, -23.4, mat="gun_black", bevel=0.5, fillet=1.5, fsegs=3)
sel.cyl((22, -25.6, BZ - 6), (22, -27.2, BZ - 6), 4.0, segs=14, mat="gun_metal", bevel=0.3, angle=40)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(56.0, 0, 66.0))
trig.sweep([(57, 0, 66), (60, 0, 58), (64, 0, 46), (64.5, 0, 36), (61, 0, 27.5)], radius=1.0, profile=[(4.0, 2.3), (-4.0, 2.3), (-4.0, -2.3), (4.0, -2.3)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((56, -7.5, 66), (56, 7.5, 66), 2.0, segs=10, mat="gun_metal", bevel=0.0)

# =========================================================================================== MAGAZINE (banana, 30 x 7.62x39)
MAG_TOP = (115.0, 0.0, 56.0)
TH0 = 6.0 * D2R
RM = 440.0
MAG_LEN = 244.0


def mag_at(s):
    th = TH0 + s / RM
    x = MAG_TOP[0] + RM * (math.cos(TH0) - math.cos(th))
    z = MAG_TOP[2] - RM * (math.sin(th) - math.sin(TH0))
    return (x, z), (math.sin(th), -math.cos(th)), th


def mag_path(s0, s1, n=26):
    return [(mag_at(s0 + (s1 - s0) * i / n)[0][0], 0.0, mag_at(s0 + (s1 - s0) * i / n)[0][1]) for i in range(n + 1)]


mag = G.part("mag", pivot=MAG_TOP)
outer = sweep_bm(mag_path(0, MAG_LEN), 1.0, profile=rrect_ring(27.6, 58.0, 5.0, n=2), up=(0, 1, 0))
inner = sweep_bm(mag_path(-4, MAG_LEN - 3), 1.0, profile=rrect_ring(24.8, 55.0, 3.5, n=2), up=(0, 1, 0))
wc = [inner]
for s in (26, 50, 74):
    (x, z), (tx, tz), th = mag_at(s)
    for sy in (1, -1):
        wc.append(box_bm((26, 8.0, 9.0), c=(x + 2, sy * 12.0, z), rot=(0, -math.degrees(th), 0)))
mag.add(outer, "gun_black", bevel=0.55, segs=1, cut=wc)
# horizontal stamped ribs on the sides (AK look)
for s in range(12, 236, 12):
    (x, z), (tx, tz), th = mag_at(s)
    for sy in (1, -1):
        if s in (26, 50, 74) or abs(s - 26) < 7 or abs(s - 50) < 7 or abs(s - 74) < 7:
            continue
        mag.box((44, 1.6, 2.6), c=(x, sy * 13.9, z), rot=(0, -math.degrees(th), 0), mat="gun_black", bevel=0.0)
# rear and front ribs
for s in (30, 90, 150, 210):
    (x, z), (tx, tz), th = mag_at(s)
    fx, fz = math.cos(th), math.sin(th)
    mag.box((2.6, 12, 7.0), c=(x + fx * 29.0, 0, z + fz * 29.0), rot=(0, -math.degrees(th), 0), mat="gun_black", bevel=0.5)
# floor plate (steel) + latch lug at the rear top
(x, z), (tx, tz), th = mag_at(MAG_LEN)
mag.box((59, 29.0, 6.0), c=(x + tx * 2.0, 0, z + tz * 2.0), rot=(0, -math.degrees(th), 0), mat="gun_metal", bevel=1.3)
(x, z), (tx, tz), th = mag_at(6)
mag.box((6, 12, 8), c=(x - 31.5, 0, z + 4), rot=(0, -math.degrees(th), 0), mat="gun_metal", bevel=0.8)
mag.box((8, 14, 6), c=(x + 30.5, 0, z + 2), rot=(0, -math.degrees(th), 0), mat="gun_metal", bevel=0.8)      # front hook
# feed lips
(x, z), (tx, tz), th = mag_at(2)
for sy in (1, -1):
    mag.box((44, 2.6, 3.4), c=(x, sy * 9.6, z), rot=(0, -math.degrees(th), 0), mat="gun_black", bevel=0.4)
# visible rounds (zig-zag double column) + follower/core below
for i in range(10):
    s = 10.0 + i * 6.6
    (x, z), (tx, tz), th = mag_at(s)
    fx, fz = math.cos(th), math.sin(th)
    sy = 6.0 if i % 2 == 0 else -6.0
    head = (x - fx * 27.6, sy, z - fz * 27.6)
    rb = round_bms("762x39", segs=7, at=head, rot=(0, -math.degrees(th), 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "brass", bevel=0)
core = sweep_bm(mag_path(96, MAG_LEN - 6, 8), 1.0, profile=rrect_ring(23.0, 52.0, 3.0, n=2), up=(0, 1, 0))
mag.add(core, "gun_metal", bevel=0.0)

# =========================================================================================== OPTIC (compact 4x prism sight, ACOG-style)
OPT = (-20.0, 0.0, 129.0)
OZ = 158.5                                                                    # optical axis height
optic = G.part("optic", pivot=OPT)
optic.box((72, 30, 5), c=(-20, 0, 131.5), mat="gun_black", bevel=0.8)         # mount plate on the rail
for sy in (1, -1):
    optic.box((22, 4.4, 12), c=(-30, sy * 16.0, 127.0), mat="gun_black", bevel=0.8)      # clamp jaws around the rail
optic.cyl((-30, -16.0, 127.0), (-30, 24.0, 127.0), 2.4, segs=10, mat="gun_metal", bevel=0.2, angle=40)   # clamp bolt
optic.cyl((-30, 24.0, 127.0), (-30, 28.5, 127.0), 4.6, segs=16, mat="gun_metal", bevel=0.3, angle=40, mod=lambda k: 0.93 if k % 2 else 1.0)  # QD knob
optic.box((60, 24, 12), c=(-24, 0, 139.5), mat="gun_black", bevel=1.4)                   # riser
sbody = [(-92, 0), (-92, 12.0), (-90, 13.4), (-84, 14.4), (-70, 17.6), (-63, 19.4), (5, 19.4), (10, 21.8), (36, 21.8), (36, 0)]
optic.lathe(sbody, c=(0, 0, OZ), segs=32, mat="gun_black", bevel=0.0)
optic.lathe([(-92, 10.6), (-91.2, 11.2), (-91.2, 0)], c=(0, 0, OZ), segs=24, mat="glass_lens", bevel=0.0)          # eyepiece lens
optic.lathe([(35.4, 0), (35.4, 19.4), (36.6, 19.6), (36.6, 0)], c=(0, 0, OZ), segs=32, mat="glass_lens", bevel=0.0)   # objective lens
optic.lathe([(8, 21.8), (8.4, 22.6), (10, 22.6), (10, 21.8)], c=(0, 0, OZ), segs=32, mat="gun_metal", bevel=0.0)      # bell ring
optic.box((70, 7, 3.4), c=(-27, 0, OZ + 20.4), mat="gun_black", bevel=0.6)                                   # fibre channel rib
optic.cyl((-58, 0, OZ + 22.4), (6, 0, OZ + 22.4), 1.5, segs=8, mat="brass", bevel=0.0)                        # fibre-optic rod
optic.cyl((-25, 0, OZ + 18), (-25, 0, OZ + 27.5), 6.6, segs=20, mat="gun_metal", bevel=0.3, angle=40, mod=lambda k: 0.94 if k % 2 else 1.0)   # elevation turret
optic.cyl((-25, -18, OZ), (-25, -27, OZ), 6.2, segs=20, mat="gun_metal", bevel=0.3, angle=40, mod=lambda k: 0.94 if k % 2 else 1.0)       # windage turret
optic.cyl((-25, 18, OZ), (-25, 21.5, OZ), 5.0, segs=16, mat="gun_metal", bevel=0.3, angle=40)               # brightness cap (left)
optic.box((16, 2.0, 5), c=(-60, 0, OZ - 19.4), mat="gun_metal", bevel=0.4)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (MUZZLE_X, 0, BZ))
G.socket("eject", (110.0, -24.0, BZ + 8.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (325.0, 8.0, BZ - 44.0))
G.socket("mag_well", MAG_TOP)
G.socket("sight", (-150.0, 0, OZ))
G.socket("stock", (-333.0, 0, 51.0))

G.motion("bolt", "translate", (-1, 0, 0), 95.0, "cycling / recoil: bolt carrier + bolt slide straight back inside the receiver (visible through the right ejection port). Origin = carrier rear centre on the bore axis.")
G.motion("charging_handle", "translate", (-1, 0, 0), 95.0, "cocking: knob on the RIGHT side slides back in the receiver slot with the carrier (same 95 mm as `bolt`). Origin = stem base.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("selector", "rotate", (0, 1, 0), -55.0, "AK safety lever is modelled in FIRE (down). Safe = -55 deg about the node's +X (glTF), lever swings up over the ejection slot. Pivot = lever axle on the right side.")
G.motion("mag", "translate", (math.sin(TH0), 0, -math.cos(TH0)), 260.0, "eject/insert along the mag's top axis (down and 6 deg FORWARD along the seated top axis); the curved lower half needs a small forward rock at the end (rotate about the front hook) if you want the real AK rock-in.")
G.remark("Reload: press mag catch (behind the mag), rock the mag forward and out, hook the fresh mag's front lug in first, rock back at mag_well, then pull the charging handle (right side) back 95 mm and release.")
G.remark("Right hand on the pistol grip (grip_R at the grip centre), left hand cups the lower wood handguard at grip_L (x=325 mm). Optic (compact 4x prism sight) is a separate static `optic` node (hide it for an iron-sight variant); the AK iron sights sit lower on the same line.")
G.remark("Sight line: `sight` socket is on the prism sight optical axis (z=158.5 mm), 58 mm behind the eyepiece.")

G.notes["style"] = dict(
    wood_axis=0, wear=0.85,
    wood_dark=(0.045, 0.016, 0.006), wood_light=(0.21, 0.085, 0.032),
    decals=[dict(pos=(524.0, 0, BZ + 47.6), r=1.5, color=(0.55, 0.56, 0.5), mats=["gun_metal"])],
)
G.finish()
if G.args.get("qa"):
    import qa_lift
    qa_lift.export_lifted("rifle", 0.16)
if G.args.get("pose"):
    import qa_lift
    for n in ("bolt", "charging_handle"):
        G.objs[n].location.y += 0.095            # Blender +Y = rearward
    G.objs["mag"].location.z -= 0.09
    G.objs["trigger"].rotation_euler.x = math.radians(12)
    G.objs["selector"].rotation_euler.x = math.radians(55)
    qa_lift.export_lifted("rifle_pose", 0.16)
