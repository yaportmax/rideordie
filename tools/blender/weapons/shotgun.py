"""RIDE OR DIE - shotgun ("HAMMER 12G"): 590-class 12 ga pump: anodised receiver with a ghost-ring rear, vented heat shield,
full-length magazine tube with a knurled cap and bayonet lug, ribbed polymer fore-end on twin action bars, pistol-grip synthetic
stock with a rubber pad, tang safety, side-saddle with six shells.  Units mm, G frame (+X fwd, +Y left, +Z up), origin = grip centre.

Contract: nodes body, bolt (bolt face (178,0,54), 72 mm back), pump (rear centre of the fore-end on the tube axis (270,0,27),
62 mm back), trigger (pin (52,0,26), +14 deg); sockets muzzle, eject, grip_R, grip_L (child of pump), mag_well, sight, stock."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
import gunkit as K

G = Gun("shotgun")
BZ = 54.0
TZ = 27.0
MUZZLE = 683.0
BREECH = 178.0
TRIG_PIN = (52.0, 26.0)
RX0, RX1 = -2.0, 206.0
RW = 33.0
PUMP_X0 = 270.0
GA = 18.0

body = G.part("body")
# =========================================================================================== RECEIVER
def rring(w, zb, zt, rt=8.0, rb=2.5):
    return fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [rb, rt, rt, rb], 4)


rec = loft_bm([(RX0, rring(RW - 2, 22, 78, 7)), (RX0 + 3, rring(RW, 18, 80)), (RX1 - 3, rring(RW, 18, 80)), (RX1, rring(RW - 1.5, 19, 79, 7.5))])
cuts = [box_bm((70, 16, 26), c=(155, -RW / 2, 57)),                                         # ejection port (right)
        box_bm((92, 23, 14), c=(145, 0, 17)),                                               # loading port (bottom)
        box_bm((84, 20, 10), c=(46, 0, 17))]                                                # trigger-group opening
body.add(rec, "gun_black", bevel=[(0.9, 2, None)], cut=cuts)
body.add(rail_bm(10, 150, 80.0, width=21.2, height=4.6, pitch=10.16, slot=5.32, base=1.8), "gun_black", bevel=0.35, segs=1, angle=30)
# receiver pins + trigger-housing pin, tang safety, action release (behind the guard)
for x in (28.0, 78.0):
    for sy in (1, -1):
        body.add(K.rivet((x, sy * RW / 2, 28.0), (0, sy, 0), 2.6, 0.7), "gun_steel", bevel=0)
body.add(box_bm((16, 12, 3.5), c=(8, 0, 81.4)), "gun_black", bevel=1.0)
for k in range(5):
    body.add(box_bm((1.0, 10.5, 1.0), c=(2 + k * 3.0, 0, 83.3)), "gun_black", bevel=0.2)
body.add(prism_bm([(12, 15), (22, 15), (26, 8), (20, 6)], -3, 3, fillet=1.0, fsegs=2), "gun_metal", bevel=0.3)
# ghost-ring rear sight on the rail (protective ears) + front post on a ramp with a fibre
gr = prism_bm([(-2, 80), (26, 80), (26, 84), (14, 86), (0, 86)], -12.0, 12.0, fillet=[0.5, 0.5, 1.5, 1.5, 1.5], fsegs=2)
body.add(gr, "gun_black", bevel=0.5)
for sy in (1, -1):
    body.add(prism_bm([(2, 85), (14, 85), (12, 95), (5, 95)], sy * 9.0 - 2.2, sy * 9.0 + 2.2, fillet=1.2, fsegs=2), "gun_black", bevel=0.5)
# Close the annular cross-section, not the aperture: endpoint caps would fill the sight's bore.
body.add(lathe_bm([(0, 3.3), (0, 5.8), (3.0, 5.8), (3.0, 3.3), (0, 3.3)], 28, "x", c=(6.5, 0, 90.0), cap=False), "gun_black", bevel=0.35)
fp = prism_bm([(640, BZ + 9), (672, BZ + 9), (668, BZ + 20), (660, BZ + 26), (655, BZ + 26), (652, BZ + 19)], -2.2, 2.2, fillet=[1, 1, 2, 0.6, 0.6, 2], fsegs=2)
body.add(fp, "gun_black", bevel=0.3)
body.add(cyl_bm((652, 0, BZ + 24.5), (661, 0, BZ + 24.5), 1.3, segs=8), "paint2", bevel=0)
for sy in (1, -1):
    body.add(prism_bm([(646, BZ + 9), (668, BZ + 9), (664, BZ + 27), (650, BZ + 27)], sy * 5.5 - 1.2, sy * 5.5 + 1.2, fillet=1.0, fsegs=2), "gun_black", bevel=0.3)
body.add(box_bm((30, 14, 4), c=(657, 0, BZ + 10)), "gun_black", bevel=0.8)

# =========================================================================================== BARREL + HEAT SHIELD + MAG TUBE
body.lathe([(RX1 - 4, 0), (RX1 - 4, 14.5), (RX1 + 10, 14.5), (RX1 + 14, 11.2), (MUZZLE - 2, 10.8), (MUZZLE, 10.2), (MUZZLE, 9.2), (MUZZLE - 10, 9.2), (MUZZLE - 10, 0)],
           c=(0, 0, BZ), segs=32, mat="gun_metal")
hs = lathe_bm([(0, 14.5), (0, 16.0), (300, 16.0), (300, 14.5)], 28, "x", c=(236, 0, BZ), cap=True)
hcuts = [box_bm((400, 40, 20), c=(386, 0, BZ - 10))]
for k in range(8):
    for ang in (-40, 0, 40):
        a = math.radians(ang)
        hcuts.append(cyl_bm((258 + k * 36, math.sin(a) * 10, BZ + math.cos(a) * 10), (258 + k * 36, math.sin(a) * 22, BZ + math.cos(a) * 22), 5.0, segs=14))
body.add(hs, "gun_black", bevel=0.4, cut=hcuts)
for x in (240.0, 530.0):
    body.add(lathe_bm([(0, 15.5), (0, 17.2), (5, 17.2), (5, 15.5)], 28, "x", c=(x - 2.5, 0, BZ), cap=True), "gun_black", bevel=0.4)
body.lathe([(RX1 - 2, 0), (RX1 - 2, 13.5), (620, 13.5), (620, 0)], c=(0, 0, TZ), segs=28, mat="gun_black")
cap = lathe_bm([(620, 0), (620, 14.8), (622, 15.6), (646, 15.6), (650, 14.0), (652, 9.0), (652, 0)], 36, "x", c=(0, 0, TZ), mod=lambda k: K.knurl(k, 1, 0.04))
body.add(cap, "gun_metal", bevel=0)
body.add(cyl_bm((648, 0, TZ), (652, 0, TZ - 8), 3.0, segs=10), "gun_metal", bevel=0)      # sling stud
# barrel clamp / bayonet lug between barrel and tube
clamp = loft_bm([(590, [(y, z) for y, z in fillet_poly([(12, TZ - 14), (12, BZ + 12), (-12, BZ + 12), (-12, TZ - 14)], [6, 10, 10, 6], 4)]),
                 (612, [(y, z) for y, z in fillet_poly([(12, TZ - 14), (12, BZ + 12), (-12, BZ + 12), (-12, TZ - 14)], [6, 10, 10, 6], 4)])])
body.add(clamp, "gun_black", bevel=[(1.0, 2, None)], cut=[cyl_bm((580, 0, BZ), (620, 0, BZ), 10.9, segs=24), cyl_bm((580, 0, TZ), (620, 0, TZ), 13.6, segs=24)])
body.add(box_bm((22, 7, 10), c=(601, 0, TZ - 17)), "gun_black", bevel=0.8)
body.add(cyl_bm((601, -13, 44), (601, 13, 44), 2.5, segs=10), "gun_steel", bevel=0)

# =========================================================================================== TRIGGER GUARD + GRIP + STOCK
tg = sweep_bm([(16, 0, 18), (14, 0, 8), (24, 0, 1), (62, 0, 0), (76, 0, 5), (84, 0, 18)], radius=1.0, segs=4,
              profile=[(6.0, 2.4), (-6.0, 2.4), (-6.0, -2.4), (6.0, -2.4)], smooth=5)
body.add(tg, "polymer", bevel=0.7)
body.add(box_bm((60, 22, 6), c=(46, 0, 19)), "polymer", bevel=1.2)
body.add(K.modern_grip(GA, top=22.0), "polymer", bevel=0)
# stock (one piece with the grip's rear top), rubber recoil pad
tbl = [(RX0 + 2, 78.0, 30.0, 30.0), (-30, 78.0, 28.0, 31.0), (-80, 78.5, 12.0, 33.0), (-160, 79.0, -10.0, 35.0), (-240, 79.5, -30.0, 37.0),
       (-296, 80.0, -40.0, 38.0)]
secs = [(x, fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [9, 12, 12, 9], 5)) for x, zt, zb, w in tbl]
stk = loft_bm(secs)
body.add(stk, "polymer", bevel=[(1.2, 2, None)], cut=[box_bm((90, 60, 60), c=(-45, 0, -8), rot=(0, -GA, 0))])
pad = loft_bm([(-296, fillet_poly([(19.2, -40.6), (19.2, 80.6), (-19.2, 80.6), (-19.2, -40.6)], [9, 12, 12, 9], 5)),
               (-306, fillet_poly([(19.6, -41.4), (19.6, 81.4), (-19.6, 81.4), (-19.6, -41.4)], [9.5, 12.5, 12.5, 9.5], 5)),
               (-317, fillet_poly([(18.6, -40.0), (18.6, 80.0), (-18.6, 80.0), (-18.6, -40.0)], [9, 12, 12, 9], 5))])
body.add(pad, "rubber", bevel=[(1.0, 2, None)], cut=[box_bm((6, 60, 3.0), c=(-310, 0, -20 + k * 14)) for k in range(8)])
body.add(K.loop_bm((-270, 0, -34.0), (0, 0, -1), 8.0, 2.0), "gun_metal", bevel=0)

# =========================================================================================== SIDE SADDLE (left) with 5 shells
body.add(box_bm((128, 2.4, 40), c=(128, RW / 2 + 1.4, 56)), "polymer", bevel=1.0)
for k in range(5):
    x = 78 + k * 25.0
    K.shotshell(body, (x, RW / 2 + 13.0, 22.0), (0, 0, 1), fired=False)
    body.add(box_bm((20, 3.0, 12), c=(x, RW / 2 + 3.8, 64)), "polymer", bevel=0.8)
body.add(box_bm((128, 3.0, 5), c=(128, RW / 2 + 3.6, 38)), "polymer", bevel=0.8)
for x in (68.0, 188.0):
    body.add(K.screw_head((x, RW / 2 + 2.6, 62), (0, 1, 0), 2.6), "gun_metal", bevel=0)

# =========================================================================================== SHELL IN THE LOADING PORT
K.shotshell(body, (148.0, 0.0, 13.0), (1, 0, 0.18), fired=False, head_back=True)

# =========================================================================================== BOLT
bolt = G.part("bolt", pivot=(BREECH, 0, BZ))
bolt.add(box_bm((64, 22, 26), c=(BREECH - 32, 0, BZ + 2)), "gun_steel", bevel=1.6)
bolt.cyl((BREECH - 2, 0, BZ), (BREECH, 0, BZ), 10.4, segs=24, mat="gun_steel")
bolt.box((12, 3, 6), c=(BREECH - 6, -10.5, BZ + 2), mat="gun_steel", bevel=0.5)              # extractor
for k in range(4):
    bolt.box((2.0, 23, 1.2), c=(BREECH - 50 + k * 8, 0, BZ + 15.4), mat="gun_metal", bevel=0.3)

# =========================================================================================== PUMP (ribbed fore-end + action bars)
pump = G.part("pump", pivot=(PUMP_X0, 0, TZ))
PL = 168.0
prof = [(0, 14.2), (0, 20.5), (4, 23.5)]
for k in range(9):
    x0 = 18 + k * 15.5
    prof += [(x0, 24.5), (x0 + 3, 22.8), (x0 + 5, 22.8), (x0 + 8, 24.5)]
prof += [(PL - 4, 24.0), (PL, 21.0), (PL, 14.2)]
fe = lathe_bm(prof, 40, "x", c=(PUMP_X0, 0, TZ - 3.0), scale=(1.0, 1.08), cap=False)
inner = lathe_bm([(-2, 14.0), (PL + 2, 14.0)], 40, "x", c=(PUMP_X0, 0, TZ), cap=False)
pump.add(fe, "polymer", bevel=0)
pump.add(inner, "polymer", bevel=0)
for sy in (1, -1):
    pump.add(box_bm((PUMP_X0 - RX1 + 20, 3.0, 8.0), c=((RX1 + PUMP_X0) / 2 - 10, sy * 11.5, TZ + 11)), "gun_steel", bevel=0.6)
pump.add(lathe_bm([(0, 14.0), (0, 17.0), (6, 17.0), (6, 14.0)], 28, "x", c=(PUMP_X0 - 6, 0, TZ), cap=True), "gun_black", bevel=0.4)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(TRIG_PIN[0], 0, TRIG_PIN[1]))
trig.sweep([(52.5, 0, 26), (55, 0, 17), (57, 0, 10), (56.5, 0, 4), (54, 0, 0.5)], radius=1.0,
           profile=[(3.8, 2.3), (-3.8, 2.3), (-3.8, -2.3), (3.8, -2.3)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((52, -5.5, 26), (52, 5.5, 26), 1.6, segs=10, mat="gun_steel")

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (MUZZLE, 0, BZ))
G.socket("eject", (150.0, -17.5, 62.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (PUMP_X0 + 88.0, 0, 19.0), parent="pump")
G.socket("mag_well", (148.0, 0, 13.0))
G.socket("sight", (-120.0, 0, 90.0))
G.socket("stock", (-317.0, 0, 20.0))

G.motion("pump", "translate", (-1, 0, 0), 62.0, "rack: fore-end (with its twin action bars) slides straight back 62 mm along the magazine tube; grip_L is parented to it. Origin = rear centre of the fore-end on the tube axis.")
G.motion("bolt", "translate", (-1, 0, 0), 72.0, "moves back WITH the pump (72 mm; may start ~6 mm after the pump); opens the ejection port. Origin = bolt-face centre on the bore axis.")
G.motion("trigger", "rotate", (0, 1, 0), 14.0, "pull: +14 deg about +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.remark("No detachable mag: shells are loaded one at a time at `mag_well` (the loading port under the receiver). One 12 ga shell sits half-way in the port (part of `body`). Six more ride in the side-saddle on the LEFT side of the receiver.")
G.remark("Hands: right hand on the polymer pistol grip at grip_R (index on the trigger); left hand on the ribbed fore-end at grip_L (follows the pump). Shoulder = rubber pad centre `stock` (moved from z=-52 to z=+20 mm: pistol-grip stock with a straight comb).")
G.remark("Sights: ghost-ring aperture on the receiver rail (centre z=90) + fibre-optic front post on a ramp; `sight` = eye point 120 mm behind the receiver.")
G.notes["style"] = dict(wear=0.85, dust=0.6, rust=0.25, paint_color=(0.42, 0.035, 0.02), paint2_color=(0.9, 0.25, 0.02),
                        polymer_color=(0.018, 0.018, 0.019),
                        engrave=[dict(text="HAMMER 12G", pos=(110.0, -RW / 2 - 0.2, 38.0), u=(1, 0, 0), v=(0, 0, 1), h=4.0, depth=0.08, mats=["gun_black"]),
                                 dict(text="12 GA 3IN", pos=(300.0, 0.0, BZ + 10.8), u=(0, -1, 0), v=(1, 0, 0), h=2.6, depth=0.06, mats=["gun_metal"], slab=2.0),
                                 dict(text="SAFE", pos=(28.0, 0, 81.0), u=(0, -1, 0), v=(1, 0, 0), h=2.2, depth=0.05, fill="light", mats=["gun_black"], slab=2.0)])
G.finish()
