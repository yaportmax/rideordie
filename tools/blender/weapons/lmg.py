"""RIDE OR DIE - LMG ("REAPER LMG"): M249-class belt-fed 5.56 light machine gun: wide riveted receiver, hinged feed cover with a
rail + rear aperture, linked belt rising from a 200-rd plastic box under the left side into the feed tray, quick-change barrel with
a carry handle, gas block with the front post, folded bipod, polymer handguard, skeleton stock.
Units mm, G frame (+X fwd, +Y left, +Z up), origin = pistol-grip centre.

Contract: nodes body, trigger (58,0,46), feed_cover (hinge (-20,0,129), -72 deg), bolt ((75,0,84), open bolt +90 mm), charging_handle
((40,-31,76)), mag (ammo box, top centre at the belt entry), belt (tray entry, 14 mm steps), bipod ((454,0,48), +70 deg);
sockets muzzle, eject, grip_R, grip_L, mag_well, sight, stock."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
from gunlib import bool_op
import gunkit as K

G = Gun("lmg")
BZ = 90.0
RX0, RX1 = -70.0, 150.0
RW = 52.0
GA = 14.0
body = G.part("body")

# =========================================================================================== RECEIVER
def rring(w, zb, zt, rt=5.0, rb=4.0):
    return fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [rb, rt, rt, rb], 4)


rec = loft_bm([(RX0, rring(RW - 4, 54, 114)), (RX0 + 4, rring(RW, 50, 118)), (RX1 - 4, rring(RW, 50, 118)), (RX1, rring(RW - 3, 52, 116))])
cuts = [box_bm((40, 20, 14), c=(92, -12, 50)),                                         # ejection port (bottom right)
        box_bm((52, 14, 8), c=(40, -RW / 2, 76)),                                      # charging-handle slot (right)
        box_bm((60, 20, 16), c=(56, RW / 2, 118)),                                     # belt entry (left, top)
        box_bm((110, 44, 10), c=(55, 0, 120))]                                         # feed tray recess (under the cover)
body.add(rec, "gun_black", bevel=[(1.0, 2, None)], cut=cuts)
# side ribs + rivet rows + trunnion block
for sy in (1, -1):
    body.add(box_bm((RX1 - RX0 - 20, 2.0, 4.0), c=((RX0 + RX1) / 2, sy * (RW / 2 + 0.6), 64)), "gun_black", bevel=0.6)
    for x in range(-56, 150, 26):
        body.add(K.rivet((x, sy * RW / 2, 104), (0, sy, 0), 2.0, 0.7, segs=8), "gun_black", bevel=0)
    for (x, z) in ((126, 70), (126, 100), (140, 85)):
        body.add(K.rivet((x, sy * RW / 2, z), (0, sy, 0), 2.8, 1.0), "gun_metal", bevel=0)
body.add(box_bm((30, RW + 1.0, 64), c=(RX1 - 12, 0, 84)), "gun_metal", bevel=1.5)
# feed tray + a round sitting in it (visible when the cover opens)
body.add(box_bm((100, 40, 3), c=(55, 0, 114.5)), "gun_steel", bevel=0.6)
for sy in (1, -1):
    body.add(box_bm((100, 3, 6), c=(55, sy * 16, 118)), "gun_steel", bevel=0.5)
# trigger group (polymer housing under the receiver rear) + guard + grip
tgh = prism_bm([(-40, 52), (98, 52), (100, 44), (90, 32), (-10, 32), (-34, 42)], -18, 18, fillet=[3, 2, 4, 6, 6, 4], fsegs=3)
body.add(tgh, "polymer", bevel=[(1.0, 2, None)], cut=[box_bm((52, 22, 22), c=(58, 0, 32))])
tg = sweep_bm([(30, 0, 34), (28, 0, 22), (38, 0, 15), (76, 0, 15), (86, 0, 22), (86, 0, 34)], radius=1.0, segs=4,
              profile=[(7.0, 2.4), (-7.0, 2.4), (-7.0, -2.4), (7.0, -2.4)], smooth=4)
body.add(tg, "polymer", bevel=0.7)
body.add(K.modern_grip(GA, top=36.0, width=31.0, depth=46.0), "polymer", bevel=0)
body.add(box_bm((10, 8, 8), c=(-8, 18.5, 46)), "gun_metal", bevel=1.2)                  # push-button safety ends
body.add(box_bm((10, 8, 8), c=(-8, -18.5, 46)), "gun_metal", bevel=1.2)

# =========================================================================================== BARREL, CARRY HANDLE, GAS BLOCK, SIGHTS
body.lathe([(RX1 - 6, 0), (RX1 - 6, 17.0), (RX1 + 18, 17.0), (RX1 + 22, 13.0), (440, 12.5), (470, 12.0), (620, 11.5), (620, 0)], c=(0, 0, BZ), segs=32, mat="gun_metal")
# flash hider (birdcage)
fh = lathe_bm([(618, 0), (618, 11.6), (622, 12.8), (652, 12.8), (652, 9.0), (624, 9.0), (624, 0)], 32, "x", c=(0, 0, BZ))
fhc = []
for k in range(5):
    a = k * 72.0
    fhc.append(box_bm((20, 4.0, 12), c=(640, math.cos(math.radians(a)) * 12, BZ + math.sin(math.radians(a)) * 12), rot=(a, 0, 0)))
body.add(fh, "gun_metal", bevel=0.3, cut=fhc)
# carry handle (folded down on the right) on the barrel collar
body.add(lathe_bm([(0, 12.5), (0, 16.0), (22, 16.0), (22, 12.5)], 28, "x", c=(250, 0, BZ), cap=True), "gun_black", bevel=0.6)
hd = sweep_bm([(252, -10, BZ + 12), (252, -24, BZ + 30), (330, -24, BZ + 30), (340, -12, BZ + 16)], radius=6.0, segs=12, smooth=4)
body.add(hd, "polymer", bevel=0)
# gas block + regulator + front post
gb = loft_bm([(440, rring(30, BZ - 46, BZ + 14, 8, 6)), (476, rring(30, BZ - 46, BZ + 14, 8, 6))])
body.add(gb, "gun_black", bevel=[(1.4, 2, None)], cut=[cyl_bm((430, 0, BZ), (490, 0, BZ), 12.6, segs=24)])
body.add(lathe_bm([(0, 0), (0, 10.0), (14, 10.0), (14, 0)], 20, "y", c=(466, -22, BZ - 30)), "gun_metal", bevel=0.6)
fp = prism_bm([(588, BZ + 10), (612, BZ + 10), (608, BZ + 50), (596, BZ + 50)], -3.0, 3.0, fillet=[1, 1, 2, 2], fsegs=2)
body.add(fp, "gun_black", bevel=0.4)
for sy in (1, -1):
    body.add(prism_bm([(586, BZ + 10), (614, BZ + 10), (608, BZ + 52), (592, BZ + 52)], sy * 10 - 1.6, sy * 10 + 1.6, fillet=[1, 1, 3, 3], fsegs=2), "gun_black", bevel=0.4)
body.add(lathe_bm([(0, 11.6), (0, 14.5), (26, 14.5), (26, 11.6)], 28, "x", c=(586, 0, BZ), cap=True), "gun_black", bevel=0.6)
# gas tube under the barrel into the handguard
body.cyl((RX1, 0, BZ - 30), (440, 0, BZ - 30), 9.0, segs=18, mat="gun_metal")

# =========================================================================================== HANDGUARD (polymer, under the barrel)
hsecs = []
for i in range(7):
    t = i / 6
    x = RX1 + 4 + (330 - RX1 - 4) * t
    hsecs.append((x, fillet_poly([(27, 52), (27, BZ - 4), (15, BZ + 6), (-15, BZ + 6), (-27, BZ - 4), (-27, 52)], [9, 5, 4, 4, 5, 9], 4)))
hg = loft_bm(hsecs)
hc = [cyl_bm((RX1, 0, BZ), (340, 0, BZ), 13.5, segs=24), cyl_bm((RX1, 0, BZ - 30), (340, 0, BZ - 30), 9.6, segs=18)]
for k in range(6):
    for sy in (1, -1):
        hc.append(box_bm((16, 8, 7), c=(176 + k * 25, sy * 27, BZ - 20)))
body.add(hg, "polymer", bevel=[(1.2, 2, None)], cut=hc)

# =========================================================================================== STOCK (skeleton, polymer) + pad
outer = [(RX0 + 2, 112), (-402 + 12, 104), (-402, 110), (-402, 6), (-402 + 12, 0), (RX0 - 10, 48), (RX0 + 2, 54)]
stk = K.rounded_prism(outer, -19, 19, r=6.0, fillet=[3, 6, 3, 3, 6, 8, 3], fsegs=3, rsegs=3)
hole = prism_bm([(-120, 94), (-360, 90), (-362, 30), (-150, 58)], -30, 30, fillet=[8, 8, 8, 8], fsegs=3)
body.add(bool_op(stk, [hole]), "polymer", bevel=[(1.2, 2, None)])
pad = loft_bm([(-402, rrect_ring(40, 112, 12, n=3, c=(0, 56))), (-410, rrect_ring(42, 114, 13, n=3, c=(0, 56)))])
body.add(pad, "rubber", bevel=[(1.0, 2, None)])
body.add(K.loop_bm((-300, 0, 2.0), (0, 0, -1), 8.0, 2.0), "gun_metal", bevel=0)

# =========================================================================================== FEED COVER (hinged at the rear)
fc = G.part("feed_cover", pivot=(-20.0, 0, 129.0))
cov = loft_bm([(-22, rring(RW - 2, 116, 132, 8, 1)), (128, rring(RW - 2, 116, 132, 8, 1)), (134, rring(RW - 6, 116, 128, 6, 1))])
fc.add(cov, "gun_black", bevel=[(0.9, 2, None)], cut=[box_bm((140, RW - 8, 14), c=(55, 0, 118))])
fc.add(rail_bm(-10, 120, 132.0, width=21.2, height=5.0, pitch=10.16, slot=5.32, base=2.0), "gun_black", bevel=0.35, segs=1, angle=30)
fc.add(box_bm((14, 30, 8), c=(128, 0, 130)), "gun_metal", bevel=1.2)                       # front latch
fc.cyl((-20, -26, 129), (-20, 26, 129), 3.2, segs=14, mat="gun_steel")                     # hinge pin
# rear aperture sight (on the cover rear, on the sight line z=146)
fc.add(prism_bm([(-18, 132), (-4, 132), (-6, 140), (-16, 140)], -12, 12, fillet=1.5, fsegs=2), "gun_black", bevel=0.5)
fc.add(lathe_bm([(0, 2.2), (0, 5.2), (3.0, 5.2), (3.0, 2.2)], 24, "x", c=(-12, 0, 146), cap=True), "gun_black", bevel=0.35)
for sy in (1, -1):
    fc.add(prism_bm([(-18, 138), (-6, 138), (-8, 152), (-16, 152)], sy * 8.5 - 1.5, sy * 8.5 + 1.5, fillet=1.0, fsegs=2), "gun_black", bevel=0.35)
fc.add(box_bm((6, 26, 5), c=(-12, 0, 138)), "gun_black", bevel=0.6)

# =========================================================================================== BOLT (open bolt, at the rear)
bolt = G.part("bolt", pivot=(75.0, 0, 84.0))
bolt.add(box_bm((90, 26, 26), c=(40, 0, 86)), "gun_steel", bevel=1.6)
bolt.cyl((84, 0, 90), (92, 0, 90), 8.0, segs=16, mat="gun_steel")

# =========================================================================================== CHARGING HANDLE (right side)
ch = G.part("charging_handle", pivot=(40.0, -31.0, 76.0))
ch.add(box_bm((14, 8, 10), c=(40, -30, 76)), "gun_steel", bevel=1.0)
ch.add(prism_bm([(30, 70), (52, 70), (56, 76), (52, 82), (30, 82)], -44, -34, fillet=2.0, fsegs=3), "gun_black", bevel=0.8)
ch.add(cyl_bm((42, -44, 76), (42, -52, 76), 5.0, segs=16, mod=lambda k: K.knurl(k, 1, 0.08)), "gun_black", bevel=0)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(58.0, 0, 46.0))
trig.sweep([(58.5, 0, 46), (61, 0, 37), (63, 0, 29), (62.5, 0, 22), (59.5, 0, 17.5)], radius=1.0,
           profile=[(3.8, 2.3), (-3.8, 2.3), (-3.8, -2.3), (3.8, -2.3)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((58, -5.5, 46), (58, 5.5, 46), 1.6, segs=10, mat="gun_steel")

# =========================================================================================== AMMO BOX (mag) under the left side
MX, MY, MZ = 56.0, 44.0, 48.0
mag = G.part("mag", pivot=(MX, MY, MZ))
bx = box_bm((150, 74, 118), c=(MX, MY, MZ - 60))
mag.add(bx, "polymer", bevel=[(3.0, 3, None)], cut=[box_bm((60, 28, 8), c=(MX, MY - 20, MZ + 2))])
mag.add(box_bm((154, 78, 8), c=(MX, MY, MZ - 118)), "rubber", bevel=2.0)
for kx in range(5):                                                                        # moulded ribs on the outer face
    mag.add(box_bm((4, 2.4, 80), c=(MX - 52 + kx * 26, MY + 37.4, MZ - 64)), "polymer", bevel=0.8)
mag.add(box_bm((62, 10, 16), c=(MX, MY + 38, MZ - 10)), "polymer", bevel=1.8)
mag.sweep([(MX - 26, MY + 38, MZ - 2), (MX - 26, MY + 48, MZ + 6), (MX + 26, MY + 48, MZ + 6), (MX + 26, MY + 38, MZ - 2)], radius=3.6, segs=10, mat="gun_metal", smooth=4)
mag.add(box_bm((86, 16, 18), c=(MX, MY - 32, MZ - 6)), "gun_metal", bevel=1.4)              # latch / rail hook
for xx in (MX - 64, MX + 64):
    mag.add(box_bm((10, 8, 28), c=(xx, MY + 38, MZ - 26)), "gun_metal", bevel=1.0)
# the belt tail going into the box mouth
for k in range(3):
    rb = round_bms("556", segs=10, at=(MX - 28, MY - 20 + k * 1.5, MZ - 4 - k * 11), rot=(0, 0, 0))
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "brass", bevel=0)

# =========================================================================================== BELT (tray -> box), linked 5.56
belt = G.part("belt", pivot=(56.0, 8.0, 124.0))
BX = 56.0
chain = [(-10, 118), (4, 118), (18, 118), (30, 117), (40, 112), (46, 104), (48, 94), (46, 82), (40, 70), (34, 58)]
path = catmull([Vector((BX, y, z)) for y, z in chain], 8)
res = [path[0]]
for i in range(1, len(path)):
    if (path[i] - res[-1]).length >= 12.0:
        res.append(path[i])
tang = [(res[min(i + 1, len(res) - 1)] - res[max(i - 1, 0)]).normalized() for i in range(len(res))]
for i, p in enumerate(res):
    roll = math.degrees(math.atan2(tang[i].z, tang[i].y))
    rb = round_bms("556", segs=10, at=(0, 0, 0), rot=(0, 0, 0))
    M = Matrix.Translation((BX - 30.0, p.y, p.z)) @ Matrix.Rotation(math.radians(roll), 4, "X")
    for k in ("case", "bullet"):
        bmesh.ops.transform(rb[k], matrix=M, verts=rb[k].verts)
        belt.add(rb[k], "brass" if k == "case" else "gun_metal", bevel=0)
    for xl in (BX - 30.0 + 14.0, BX - 30.0 + 34.0):
        lk = lathe_bm([(0, 5.2), (0, 6.2), (7.0, 6.2), (7.0, 5.2)], 12, "x", cap=True)
        bmesh.ops.transform(lk, matrix=Matrix.Translation((xl - 3.5, p.y, p.z)) @ Matrix.Rotation(math.radians(roll), 4, "X"), verts=lk.verts)
        belt.add(lk, "gun_steel", bevel=0)

# =========================================================================================== BIPOD (folded forward)
bp = G.part("bipod", pivot=(454.0, 0, BZ - 42.0))
bp.add(box_bm((30, 42, 12), c=(462, 0, BZ - 40)), "gun_black", bevel=1.5)
bp.cyl((454, -24, BZ - 42), (454, 24, BZ - 42), 4.6, segs=14, mat="gun_metal")
for sy in (-1, 1):
    bp.cyl((460, sy * 20, BZ - 44), (610, sy * 20, BZ - 44), 5.0, segs=12, mat="gun_metal")
    bp.cyl((540, sy * 20, BZ - 44), (604, sy * 20, BZ - 44), 6.2, segs=12, mat="gun_black")
    bp.add(sphere_bm(7.4, c=(612, sy * 20, BZ - 44), scale=(1.4, 1, 1), usegs=14, vsegs=8), "rubber", bevel=0)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (652.0, 0, BZ))
G.socket("eject", (92.0, -33.0, 98.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (312.0, 0, BZ - 22.0))
G.socket("mag_well", (MX, MY, MZ))
G.socket("sight", (-170.0, 0, 146.0))
G.socket("stock", (-406.0, 0, 56.0))

G.motion("feed_cover", "rotate", (0, 1, 0), -72.0, "opens: rotate -72 deg about the node's +X (glTF) = front of the cover lifts. Pivot = rear hinge pin. Reveals the tray and a round.")
G.motion("bolt", "translate", (1, 0, 0), 90.0, "open bolt: rests cocked at the rear; on each shot it runs forward 90 mm and returns.")
G.motion("charging_handle", "translate", (-1, 0, 0), 0.0, "rides the bolt: use the same +/-90 mm travel as `bolt` when charging (right side slot).")
G.motion("trigger", "rotate", (0, 1, 0), 14.0, "pull: +14 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0.5, -1), 120.0, "ammo box: unhooks down-and-outwards (+Y left / -Z) about 120 mm. Origin = top centre of the box at the belt entry (moved: the box now hangs under the receiver's left side, centre 44 mm left of the bore).")
G.motion("belt", "translate", (0, 1, 0), 14.0, "feed step: belt advances along its chain; cosmetic. Origin at the tray entry.")
G.motion("bipod", "rotate", (0, 1, 0), 70.0, "modelled FOLDED forward under the barrel; deploy = +70 deg about the node's +X (glTF). Pivot = hinge pin under the gas block.")
G.remark("Two-hand hold: right hand on the pistol grip (grip_R); left hand on the polymer handguard (grip_L) or the bipod.")
G.remark("Reload: open feed_cover (-72 deg), unhook the box (`mag`), fit a new one at mag_well, lay the belt on the tray, close the cover, pull the charging handle.")
G.notes["style"] = dict(wear=0.85, dust=0.6, rust=0.2, polymer_color=(0.02, 0.02, 0.021),
                        engrave=[dict(text="REAPER 5.56", pos=(40.0, -RW / 2 - 0.2, 96.0), u=(1, 0, 0), v=(0, 0, 1), h=4.0, depth=0.08, mats=["gun_black"]),
                                 dict(text="LMG-4 11206", pos=(20.0, RW / 2 + 0.2, 90.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.0, depth=0.06, mats=["gun_black"]),
                                 dict(text="200 RDS", pos=(MX, MY + 37.2, MZ - 30.0), u=(-1, 0, 0), v=(0, 0, 1), h=6.0, depth=0.1, fill="light", mats=["polymer"], color=(0.5, 0.5, 0.45), metal=0.0)])
G.finish()
