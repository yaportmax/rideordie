"""RIDE OR DIE - SMG ("VIPER SMG"): MP5A3-class 9x19 roller-delayed SMG: stamped receiver with the side channels, cocking tube
with the handle at the front left, drum rear sight + hooded front post, 3-lug barrel, tropical handguard, curved 30-rd magazine,
polymer 'Navy' trigger group with pictogram selector, retractable A3 stock.  Units mm, G frame (+X fwd, +Y left, +Z up), origin = grip.

Contract: nodes body, bolt (rear centre on the bore (-40,0,64), 52 mm back), charging_handle (52 mm back; now at the FRONT-LEFT on
the cocking tube), trigger (pin (36,0,40), +12 deg), mag (seat (75,0,47), straight down 190 mm); sockets muzzle, eject, grip_R, grip_L,
mag_well, sight, stock."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
from gunlib import bool_op
import gunkit as K

G = Gun("smg")
BZ = 64.0
RX0, RX1 = -100.0, 152.0
TZ = 90.0                        # cocking-tube axis
GA = 16.0
MAG_TOP = (75.0, 0.0, 47.0)
body = G.part("body")

# =========================================================================================== RECEIVER (stamped tube with the side channels)
def rec_ring(k=1.0):
    pts = fillet_poly([(17.5, 44), (17.5, 82), (0, 99), (-17.5, 82), (-17.5, 44)], [3, 14, 16, 14, 3], 5)
    out = []
    for y, z in pts:
        # the pressed channel along each side (MP5 signature)
        if abs(abs(y) - 17.5) < 0.2 and 58 < z < 74:
            y -= math.copysign(2.2 * math.sin(math.pi * (z - 58) / 16.0), y)
        out.append((y * k, z))
    return out


rec = loft_bm([(RX0, rec_ring(0.97)), (RX0 + 4, rec_ring()), (RX1 - 2, rec_ring()), (RX1, rec_ring(0.98))])
cuts = [box_bm((44, 12, 16), c=(52, -17.5, 76)),                                      # ejection port (right)
        box_bm((40, 24, 14), c=(MAG_TOP[0], 0, 44))]                                   # magazine opening
body.add(rec, "gun_black", bevel=[(0.8, 2, None)], cut=cuts)
# weld spots + pins along the lower edge, rear end cap with the stock latch
for sy in (1, -1):
    for x in range(-80, 140, 22):
        body.add(K.rivet((x, sy * 17.5, 50.0), (0, sy, 0), 1.5, 0.4, segs=8), "gun_black", bevel=0)
    body.add(K.rivet((-30, sy * 17.6, 52.0), (0, sy, 0), 2.6, 0.9), "gun_steel", bevel=0)
    body.add(K.rivet((20, sy * 17.6, 52.0), (0, sy, 0), 2.6, 0.9), "gun_steel", bevel=0)
body.add(loft_bm([(RX0 - 10, [(y * 0.92, z) for y, z in rec_ring()]), (RX0 + 1, rec_ring(1.02))]), "gun_black", bevel=0.8)
body.add(box_bm((10, 14, 8), c=(RX0 - 12, 0, 50)), "gun_metal", bevel=1.0)
# cocking tube (front, above the barrel) with the handle slot on the left + front sight hood
tube = lathe_bm([(RX1 - 4, 0), (RX1 - 4, 11.0), (296, 11.0), (300, 10.0), (300, 0)], 28, "x", c=(0, 0, TZ))
body.add(tube, "gun_black", bevel=0, cut=[box_bm((96, 12, 5.0), c=(214, 10, TZ - 1))])
fsh = lathe_bm([(0, 0), (0, 9.8), (14, 9.8), (14, 0)], 28, "x", c=(286, 0, TZ + 14), cap=False)
body.add(fsh, "gun_black", bevel=0, cut=[box_bm((20, 30, 12), c=(293, 0, TZ + 26))])
body.add(prism_bm([(280, TZ + 6), (302, TZ + 6), (300, TZ + 13), (282, TZ + 13)], -11.0, 11.0, fillet=1.5, fsegs=2), "gun_black", bevel=0.5)
body.add(cyl_bm((293, 0, TZ + 8), (293, 0, TZ + 21.5), 1.4, r1=1.0, segs=10), "gun_black", bevel=0)
# rear drum sight (diopter) on its base
body.add(prism_bm([(-78, 96), (-42, 96), (-44, 101), (-76, 101)], -12, 12, fillet=1.5, fsegs=2), "gun_black", bevel=0.6)
drum = lathe_bm([(0, 0), (0, 7.0), (0.8, 7.6), (15.2, 7.6), (16, 7.0), (16, 0)], 24, "y", c=(-60, -8, 107.0))
body.add(drum, "gun_black", bevel=0, cut=[cyl_bm((-80, 0, 107), (-40, 0, 107), 1.5, segs=10)])
for sy in (1, -1):
    body.add(prism_bm([(-74, 100), (-46, 100), (-48, 112), (-72, 112)], sy * 11.0 - 1.4, sy * 11.0 + 1.4, fillet=2.0, fsegs=2), "gun_black", bevel=0.4)
# barrel with the 3 lugs + muzzle
body.lathe([(RX1, 0), (RX1, 9.0), (318, 8.2), (320, 10.0), (330, 10.0), (332, 9.2), (334, 9.2), (334, 5.0), (324, 5.0), (324, 0)], c=(0, 0, BZ), segs=28, mat="gun_metal")
for k in range(3):
    a = k * 120.0 + 30
    body.add(box_bm((10, 5, 3.4), c=(325, math.cos(math.radians(a)) * 10.4, BZ + math.sin(math.radians(a)) * 10.4), rot=(a - 90, 0, 0)), "gun_metal", bevel=0.6)

# =========================================================================================== HANDGUARD (tropical, polymer)
hsecs = []
for i in range(9):
    t = i / 8
    x = 150 + 136 * t
    w = 45.0 - 3.0 * abs(t - 0.5) * 2
    hsecs.append((x, fillet_poly([(w / 2, 40), (w / 2, 78), (w / 2 - 8, 86), (-w / 2 + 8, 86), (-w / 2, 78), (-w / 2, 40)], [8, 6, 5, 5, 6, 8], 4)))
hg = loft_bm(hsecs)
hcut = [cyl_bm((140, 0, BZ), (300, 0, BZ), 10.5, segs=20), cyl_bm((140, 0, TZ), (300, 0, TZ), 11.5, segs=20)]
for k in range(5):                                                                     # vent slots + finger grooves
    for sy in (1, -1):
        hcut.append(box_bm((13, 8, 5), c=(172 + k * 24, sy * 22.5, 72)))
    hcut.append(cyl_bm((170 + k * 24, -30, 34.5), (170 + k * 24, 30, 34.5), 7.0, segs=16))
body.add(hg, "polymer", bevel=[(1.0, 2, None)], cut=hcut)

# =========================================================================================== MAGAZINE WELL + LOWER (polymer Navy group) + GRIP
mw = loft_bm([(MAG_TOP[0] - 22, fillet_poly([(14, 22), (14, 48), (-14, 48), (-14, 22)], [3, 1, 1, 3], 3)),
              (MAG_TOP[0] + 22, fillet_poly([(14, 22), (14, 48), (-14, 48), (-14, 22)], [3, 1, 1, 3], 3))])
body.add(mw, "gun_black", bevel=0.8, cut=[box_bm((38, 24.4, 40), c=(MAG_TOP[0], 0, 30))])
body.add(prism_bm([(44, 32), (52, 32), (54, 40), (50, 46), (44, 46)], -7, 7, fillet=1.2, fsegs=2), "gun_metal", bevel=0.5)      # paddle release
lower = prism_bm([(-66, 46), (48, 46), (50, 38), (40, 26), (-36, 26), (-60, 34)], -16.5, 16.5, fillet=[3, 1, 3, 5, 5, 4], fsegs=3)
body.add(lower, "polymer", bevel=[(1.0, 2, None)], cut=[box_bm((46, 20, 20), c=(22, 0, 26))])
tg = sweep_bm([(10, 0, 28), (8, 0, 18), (16, 0, 11), (40, 0, 11), (50, 0, 18), (50, 0, 28)], radius=1.0, segs=4,
              profile=[(6.5, 2.2), (-6.5, 2.2), (-6.5, -2.2), (6.5, -2.2)], smooth=4)
body.add(tg, "polymer", bevel=0.7)
body.add(K.modern_grip(GA, top=30.0, width=29.0, depth=44.0), "polymer", bevel=0)
# selector (left side, pictograms) + pins
body.add(prism_bm([(-24, 50), (-6, 47), (-4, 51), (-22, 54)], 16.6, 18.4, fillet=1.2, fsegs=2), "gun_metal", bevel=0.4)
body.add(cyl_bm((-22, 16.4, 50), (-22, 19.0, 50), 3.6, segs=14), "gun_metal", bevel=0)
for x in (-40.0, 30.0):
    body.add(cyl_bm((x, -17.8, 40), (x, 17.8, 40), 2.6, segs=12), "gun_steel", bevel=0)

# =========================================================================================== A3 RETRACTABLE STOCK (rods + butt plate)
for sy in (1, -1):
    body.add(cyl_bm((RX0 - 8, sy * 14.0, 64), (-300, sy * 14.0, 64), 4.2, segs=14), "gun_metal", bevel=0)
    body.add(cyl_bm((-300, sy * 14.0, 64), (-300, sy * 14.0, 40), 4.2, segs=14), "gun_metal", bevel=0)
bp = prism_bm([(-306, 28), (-296, 28), (-294, 96), (-306, 96)], -20, 20, fillet=[2, 2, 4, 4], fsegs=3)
body.add(bp, "gun_black", bevel=1.0)
pad = loft_bm([(-306, rrect_ring(40, 72, 10, n=3, c=(0, 62))), (-318, rrect_ring(42, 74, 11, n=3, c=(0, 62))), (-322, rrect_ring(40, 70, 10, n=3, c=(0, 62)))])
body.add(pad, "rubber", bevel=[(1.0, 2, None)], cut=[box_bm((6, 50, 2.4), c=(-321, 0, 36 + k * 9)) for k in range(7)])
body.add(box_bm((16, 30, 12), c=(RX0 - 14, 0, 64)), "gun_black", bevel=1.2)
body.add(box_bm((10, 20, 6), c=(RX0 - 20, 0, 76)), "gun_metal", bevel=1.0)                       # stock release

# =========================================================================================== BOLT (visible in the port)
bolt = G.part("bolt", pivot=(-40.0, 0, BZ))
bolt.add(box_bm((116, 22, 22), c=(20, 0, BZ + 2)), "gun_steel", bevel=1.5)
bolt.cyl((78, 0, BZ), (84, 0, BZ), 9.0, segs=20, mat="gun_steel")
for sy in (1, -1):
    bolt.cyl((72, sy * 9, BZ), (72, sy * 11.5, BZ), 3.0, segs=10, mat="gun_steel")               # rollers

# =========================================================================================== CHARGING HANDLE (front left, on the cocking tube)
CH = (240.0, 11.0, TZ)
ch = G.part("charging_handle", pivot=CH)
ch.add(box_bm((8, 8, 5), c=(240, 12.5, TZ - 1)), "gun_steel", bevel=0.8)
ch.add(prism_bm([(232, TZ - 4), (246, TZ - 4), (250, TZ + 2), (236, TZ + 4)], 16.0, 30.0, fillet=1.8, fsegs=3), "gun_metal", bevel=0.8)
ch.add(cyl_bm((238, 30, TZ), (238, 33, TZ), 5.0, segs=14), "gun_metal", bevel=0)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(36.0, 0, 40.0))
trig.sweep([(36.5, 0, 40), (39.0, 0, 32), (40.5, 0, 25), (39.5, 0, 19), (37.0, 0, 15.5)], radius=1.0,
           profile=[(3.4, 2.2), (-3.4, 2.2), (-3.4, -2.2), (3.4, -2.2)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((36, -5, 40), (36, 5, 40), 1.6, segs=10, mat="gun_steel")

# =========================================================================================== MAGAZINE (curved 30 x 9 mm)
mag = G.part("mag", pivot=MAG_TOP)
at = K.mag_arc(MAG_TOP, 0.0, 520.0)
path = [(at(s)[0][0], 0.0, at(s)[0][1]) for s in [i * 230.0 / 24 for i in range(25)]]
mag.add(sweep_bm(path, 1.0, profile=rrect_ring(23.4, 36.0, 4.5, n=3), up=(0, 1, 0)), "gun_black", bevel=0)
for s in range(40, 220, 18):
    (x, z), (tx, tz), th = at(s)
    for sy in (1, -1):
        mag.add(box_bm((24, 1.4, 2.6), c=(x - 1, sy * 11.9, z), rot=(0, -math.degrees(th), 0)), "gun_black", bevel=0.5)
(x, z), (tx, tz), th = at(230)
mag.add(box_bm((38, 26, 5), c=(x + tx * 2, 0, z + tz * 2), rot=(0, -math.degrees(th), 0)), "gun_black", bevel=1.3)
for sy in (1, -1):
    mag.add(box_bm((26, 1.8, 3), c=(MAG_TOP[0] - 2, sy * 7.8, MAG_TOP[2] + 1)), "gun_black", bevel=0.4)
for i, (s, sy) in enumerate(((0.5, 2.6), (8.0, -2.8))):
    (x, z), _, th = at(s)
    h = (x - 15.0, sy, z + (1.8 if i == 0 else -0.2))
    rb = round_bms("9mm", segs=12, at=h, rot=(0, -math.degrees(th), 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "gun_metal", bevel=0)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (334.0, 0, BZ))
G.socket("eject", (52.0, -22.0, 74.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (188.0, 4.0, 40.0))
G.socket("mag_well", MAG_TOP)
G.socket("sight", (-150.0, 0, 107.0))
G.socket("stock", (-322.0, 0, 62.0))

G.motion("bolt", "translate", (-1, 0, 0), 52.0, "cycling / recoil: bolt slides straight back inside the receiver (visible through the right ejection port). Origin = bolt rear centre on the bore axis.")
G.motion("charging_handle", "translate", (-1, 0, 0), 52.0, "cocking: handle at the FRONT LEFT of the cocking tube (MP5 style) slides back 52 mm in its slot. Origin = stem base on the tube.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0, -1), 190.0, "eject/insert straight down through the mag well (the curved lower half swings clear). Origin = magazine top where the feed lips seat.")
G.remark("Reload: left hand drops the mag (paddle release behind it), inserts a new one at mag_well, then slaps the FRONT-LEFT cocking handle (charging_handle, on the cocking tube above the handguard) back 52 mm.")
G.remark("Right hand on the pistol grip; left hand on the tropical handguard at grip_L. Stock = A3 retractable (static, extended); `stock` = rubber pad centre. Sights: drum diopter rear (aperture centre z=107) + hooded front post; `sight` = eye point 150 mm behind the grip on that line.")
G.notes["style"] = dict(wear=0.85, dust=0.55, rust=0.2, polymer_color=(0.02, 0.02, 0.021),
                        engrave=[dict(text="VIPER 9MM", pos=(10.0, 17.8, 80.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.2, depth=0.07, mats=["gun_black"]),
                                 dict(text="VP-9 20614", pos=(10.0, -17.8, 80.0), u=(1, 0, 0), v=(0, 0, 1), h=2.8, depth=0.06, mats=["gun_black"])])
G.finish()
