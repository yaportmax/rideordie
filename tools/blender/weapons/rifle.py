"""RIDE OR DIE - rifle ("RAIDER AR"): AKM-pattern 7.62x39 assault rifle, railed dust cover + compact 1x red-dot, laminated
wood furniture, bakelite-style grip, steel 30-rd magazine.  Units mm, G frame (+X fwd, +Y left, +Z up), origin = pistol-grip centre.

Contract (unchanged from the previous build): nodes body, bolt (+charging handle on the carrier's right), charging_handle, selector,
trigger, mag, optic; sockets muzzle, eject, grip_R, grip_L, mag_well, sight, stock.  Same pivots / travels (see G.motion)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
import gunkit as K

G = Gun("rifle")
BZ = 92.0                        # bore axis height
GA = 20.0                        # grip rake (deg)
R0, R1 = -160.0, 206.0           # receiver rear / front trunnion face
MUZZLE_X = 568.0
W_REC = 31.0                     # receiver width (stamped sheet)
Z_BOT = 50.0                     # receiver bottom
Z_SIDE = 103.0                   # top of the receiver side walls (dust cover sits on them)
Z_TOP = 121.5                    # dust cover top

# =========================================================================================== RECEIVER (stamped, gun_black)
body = G.part("body")


def rec_ring(w, zb, zt, rb=3.5, rt=2.0):
    return [(y, z) for y, z in fillet_poly([(w / 2, zb), (w / 2, zt), (-w / 2, zt), (-w / 2, zb)], [rb, rt, rt, rb], 3)]


# side profile of the lower receiver (x, z): bottom rises at the rear into the stock tang
rec = loft_bm([(R0 + 2, rec_ring(W_REC - 2, 70, Z_SIDE)), (R0 + 8, rec_ring(W_REC, 66, Z_SIDE)), (-128, rec_ring(W_REC, 56, Z_SIDE)),
               (-100, rec_ring(W_REC, Z_BOT, Z_SIDE)), (R1 - 2, rec_ring(W_REC, Z_BOT, Z_SIDE)), (R1, rec_ring(W_REC - 1.2, Z_BOT + 1, Z_SIDE))])
cuts = [box_bm((62, 26.0, 20), c=(115, 0, Z_BOT - 2)),                                  # magazine well opening
        box_bm((78, 22.0, 10), c=(46, 0, Z_BOT - 1)),                                   # trigger group window
        box_bm((104, 8, 9.5), c=(110, -W_REC / 2, Z_SIDE - 3.5))]                      # right side: charging-handle / ejection slot
for sy in (1, -1):                                                                      # stamped dimples above the magazine well (AKM)
    cuts.append(K.dimple_cutter((120.0, sy * (W_REC / 2), 78.0), (0, sy, 0), 14.0, 9.0, 1.1))
body.add(rec, "gun_black", bevel=[(0.9, 2, None)], cut=cuts)
for sy in (1, -1):                                                                      # side rail bend lines
    body.box((330, 1.2, 2.4), c=(20, sy * (W_REC / 2 + 0.3), Z_SIDE - 9), mat="gun_black", bevel=0.4)
# front trunnion (machined, blued) visible as a slightly proud block with rivet heads; rear trunnion rivets
body.box((34, W_REC + 1.0, 50), c=(R1 - 16, 0, 77), mat="gun_metal", bevel=1.2)
for sy in (1, -1):
    for (x, z) in ((R1 - 26, 62), (R1 - 26, 88), (R1 - 8, 62), (R1 - 8, 88), (R1 - 17, 75)):
        body.add(K.rivet((x, sy * (W_REC / 2 + 0.5), z), (0, sy, 0), 2.4, 1.1), "gun_metal", bevel=0)
    for (x, z) in ((R0 + 14, 92), (R0 + 14, 76), (R0 + 30, 84)):
        body.add(K.rivet((x, sy * (W_REC / 2), z), (0, sy, 0), 2.2, 1.0), "gun_metal", bevel=0)
    # trigger group pins (+ the shepherd's crook retaining spring on the left)
    for (x, z) in ((12.0, 66.0), (36.0, 66.0), (58.0, 70.0)):
        body.add(K.rivet((x, sy * (W_REC / 2), z), (0, sy, 0), 2.6, 0.8), "gun_steel", bevel=0)
body.sweep([(12, W_REC / 2 + 1.2, 66), (24, W_REC / 2 + 1.4, 63), (36, W_REC / 2 + 1.2, 66), (47, W_REC / 2 + 1.4, 68), (58, W_REC / 2 + 1.2, 70),
            (66, W_REC / 2 + 1.0, 74)], radius=0.9, segs=6, smooth=4, mat="gun_steel")
# selector detent plate + axle boss on the right
body.cyl((22, -W_REC / 2, 84), (22, -W_REC / 2 - 2.2, 84), 5.5, segs=20, mat="gun_metal", bevel=0.4, angle=40)
# rear sling loop plate on the receiver's left rear
body.add(K.loop_bm((R0 + 22, W_REC / 2 + 1.5, 64), (0, 1, 0), 7.0, 1.6), "gun_metal", bevel=0)

# =========================================================================================== DUST COVER (railed) + REAR SIGHT BLOCK
dc_ring = [(y, z) for y, z in fillet_poly([(16.8, Z_SIDE - 3.5), (16.8, Z_TOP - 11), (13.5, Z_TOP), (-13.5, Z_TOP), (-16.8, Z_TOP - 11), (-16.8, Z_SIDE - 3.5)],
                                          [0.8, 9.0, 4.0, 4.0, 9.0, 0.8], 4)]
dc = loft_bm([(R0 - 3, [(y * 0.97, z - 0.8) for y, z in dc_ring]), (R0 + 1, dc_ring), (168, dc_ring), (172, [(y * 0.98, z - 0.5) for y, z in dc_ring])])
dcc = loft_bm([(R0 + 4, [(y * 0.86, z - 2.2) for y, z in dc_ring]), (166, [(y * 0.86, z - 2.2) for y, z in dc_ring])])
body.add(dc, "gun_black", bevel=[(0.8, 2, None)], cut=[dcc])
# rail on the cover (optic mount) + locking lever at the rear sight end
body.add(rail_bm(-150, 60, Z_TOP - 1.0, width=21.2, height=5.8, pitch=10.16, slot=5.32, base=2.4), "gun_black", bevel=0.35, segs=1, angle=30)
body.box((6, 36, 6), c=(164, 0, Z_TOP - 6), mat="gun_black", bevel=1.0)
body.cyl((R0 - 3, 0, 110), (R0 - 9, 0, 110), 4.6, segs=16, mat="gun_metal", bevel=0.5, angle=40)          # recoil spring guide button
body.box((5, 11, 9), c=(R0 - 10, 0, 110), mat="gun_metal", bevel=1.0)
# rear sight block (on the barrel, front of the receiver) + tangent leaf
rsb = loft_bm([(R1 - 30, rec_ring(26, 96, 112, 2, 6)), (R1 + 34, rec_ring(24, 96, 112, 2, 6))])
body.add(rsb, "gun_black", bevel=[(1.0, 2, None)], cut=[cyl_bm((R1 - 40, 0, BZ), (R1 + 40, 0, BZ), 8.0, segs=20)])
body.prism([(R1 - 24, 112), (R1 + 26, 112), (R1 + 30, 116), (R1 - 20, 121.5)], -8.5, 8.5, mat="gun_metal", bevel=0.6)     # sight leaf
body.box((10, 20, 7), c=(R1 + 6, 0, 117.5), mat="gun_metal", bevel=0.8)                                                    # range slider
body.add(K.vnotch(( R1 - 22, 0, 121.5), 8.5, 3.0, 2.4), "gun_metal", bevel=0.3)                                         # rear notch plate
body.cyl((R1 + 12, -13, 104), (R1 + 12, -17, 104), 4.2, segs=14, mat="gun_metal", bevel=0.4, angle=40)                  # handguard lever axle
body.prism([(R1 + 8, 100), (R1 + 16, 100), (R1 + 26, 88), (R1 + 20, 86)], -17.5, -15.5, mat="gun_metal", bevel=0.4)     # handguard lever

# =========================================================================================== PISTOL GRIP (AK polymer grip with side ribs)
body.add(K.ak_grip(GA), "polymer", bevel=0)
body.cyl((0, 0, -58), (0, 0, -60), 5.0, segs=16, mat="gun_metal", bevel=0.3, angle=40)       # grip screw cap

# =========================================================================================== TRIGGER GUARD + MAG CATCH
tg = sweep_bm([(6, 0, Z_BOT), (4, 0, 38), (12, 0, 25), (40, 0, 20.5), (74, 0, 23), (84, 0, 36), (86, 0, Z_BOT)], radius=1.0, segs=4,
              profile=[(7.0, 1.4), (-7.0, 1.4), (-7.0, -1.4), (7.0, -1.4)], smooth=5)
body.add(tg, "gun_black", bevel=0.5)
body.prism([(84, 36), (90, 36), (92, 44), (90, 49), (84, 49)], -6, 6, mat="gun_metal", bevel=0.6)                       # mag catch paddle
body.cyl((87, -7, 44), (87, 7, 44), 1.8, segs=8, mat="gun_steel", bevel=0)

# =========================================================================================== BARREL, GAS SYSTEM, FRONT SIGHT, BRAKE
body.lathe([(R1 - 10, 0), (R1 - 10, 12.5), (R1 + 36, 12.5), (R1 + 38, 10.5), (398, 10.2), (404, 9.2), (520, 8.8), (536, 8.8), (536, 0)],
           c=(0, 0, BZ), segs=32, mat="gun_metal")
# gas tube (under the upper handguard) + its rear lock
body.lathe([(R1 + 30, 0), (R1 + 30, 9.8), (394, 9.8), (394, 0)], c=(0, 0, BZ + 22.0), segs=24, mat="gun_black")
# gas block (AKM, 45 degree port) with the cleaning-rod catch
gb = loft_bm([(392, rec_ring(24, BZ - 13, BZ + 33, 9, 8)), (420, rec_ring(24, BZ - 13, BZ + 33, 9, 8))])
body.add(gb, "gun_black", bevel=[(1.4, 2, None)], cut=[box_bm((20, 40, 30), c=(424, 0, BZ + 32), rot=(0, -45, 0)),
                                                      cyl_bm((388, 0, BZ + 22), (410, 0, BZ + 22), 7.0, segs=16)])
body.lathe([(384, 0), (384, 11.0), (386, 12.4), (394, 12.4), (394, 0)], c=(0, 0, BZ + 22.0), segs=24, mat="gun_black")     # tube collar
body.cyl((405, -13, BZ - 6), (405, 13, BZ - 6), 2.2, segs=10, mat="gun_steel", bevel=0)                                   # cross pin
# cleaning rod under the barrel
body.cyl((400, 0, BZ - 15), (540, 0, BZ - 15), 3.0, segs=10, mat="gun_steel", bevel=0)
body.box((5, 12, 6), c=(541, 0, BZ - 15), mat="gun_steel", bevel=1.0)
# front sight base: triangular block + hooded post + bayonet lug
fs = loft_bm([(506, [(y, z) for y, z in fillet_poly([(11, BZ - 18), (11, BZ + 8), (4, BZ + 24), (-4, BZ + 24), (-11, BZ + 8), (-11, BZ - 18)], [3, 5, 2, 2, 5, 3], 3)]),
              (534, [(y, z) for y, z in fillet_poly([(11, BZ - 18), (11, BZ + 8), (4, BZ + 24), (-4, BZ + 24), (-11, BZ + 8), (-11, BZ - 18)], [3, 5, 2, 2, 5, 3], 3)])])
body.add(fs, "gun_black", bevel=[(1.0, 2, None)], cut=[cyl_bm((500, 0, BZ), (540, 0, BZ), 8.9, segs=24), box_bm((10, 12, 10), c=(522, 0, BZ - 14))])
body.cyl((520, 0, BZ + 20), (520, 0, BZ + 44), 2.6, r1=2.0, segs=12, mat="gun_black")            # post drum
body.box((2.4, 2.2, 10), c=(520, 0, BZ + 48), mat="gun_black", bevel=0.3)                         # post blade
hood = lathe_bm([(0, 9.2), (14, 9.2), (14, 7.8), (0, 7.8), (0, 9.2)], 28, "x", c=(513, 0, BZ + 44), cap=False)
body.add(hood, "gun_black", bevel=0, cut=[box_bm((40, 40, 20), c=(520, 0, BZ + 60))])
body.box((22, 12, 8), c=(518, 0, BZ - 22), mat="gun_black", bevel=1.0)                            # bayonet lug
# slant muzzle brake
mb = lathe_bm([(536, 0), (536, 11.5), (538, 12.4), (566, 12.4), (MUZZLE_X, 11.6), (MUZZLE_X, 5.0), (540, 5.0), (540, 0)], 32, "x", c=(0, 0, BZ))
body.add(mb, "gun_metal", bevel=0.4, cut=[box_bm((34, 30, 24), c=(MUZZLE_X + 6, 12, BZ + 10), rot=(0, 0, -30)),
                                         cyl_bm((548, -20, BZ + 6), (548, 20, BZ + 6), 2.4, segs=10)])
body.cyl((544, 12.3, BZ - 2), (544, 13.2, BZ - 2), 2.2, segs=10, mat="gun_steel", bevel=0)        # detent

# =========================================================================================== HANDGUARDS (laminated wood)
lg = K.ak_lower_handguard(R1 + 6, 392, BZ)
body.add(lg, "wood", bevel=[(1.2, 2, None)], cut=[cyl_bm((R1, 0, BZ), (400, 0, BZ), 11.0, segs=24)])
ug = K.ak_upper_handguard(R1 + 40, 388, BZ + 22.0)
body.add(ug, "wood", bevel=[(1.0, 2, None)], cut=[cyl_bm((R1 + 30, 0, BZ + 22.0), (395, 0, BZ + 22.0), 10.2, segs=20)])
body.lathe([(390, 0), (390, 21.0), (398, 21.0), (398, 0)], c=(0, 0, BZ - 6), segs=28, mat="gun_black", scale=(1.0, 1.25))   # front ferrule
body.box((10, 36, 16), c=(R1 + 4, 0, BZ - 22), mat="gun_black", bevel=1.2)                                                  # rear retainer

# =========================================================================================== STOCK (laminated wood) + steel butt plate
body.add(K.akm_stock(R0, -328.0), "wood", bevel=[(1.3, 2, None)])
bp = K.butt_plate(-328.0, -334.0)
body.add(bp, "gun_black", bevel=[(1.0, 2, None)])
body.cyl((-334.5, 0, 88), (-336, 0, 88), 5.5, segs=16, mat="gun_metal", bevel=0.3, angle=40)       # trap-door button
for zz in (10, 104):
    body.add(K.screw_head((-334.2, 0, zz), (-1, 0, 0), 2.6), "gun_metal", bevel=0)
body.add(K.loop_bm((-300, 17.5, 24), (0, 1, 0), 7.0, 1.6), "gun_metal", bevel=0)                  # sling swivel (left)
body.box((22, 2.2, 14), c=(-300, 16.6, 24), mat="gun_metal", bevel=0.6)

# =========================================================================================== BOLT CARRIER (visible in the slot)
BPIV = (-30.0, 0, BZ - 1.0)
bolt = G.part("bolt", pivot=BPIV)
bolt.add(box_bm((190, 24, 22), c=(70, 0, BZ + 3)), "gun_steel", bevel=2.2)
bolt.cyl((150, 0, BZ + 22), (250, 0, BZ + 22), 7.0, segs=16, mat="gun_steel")                    # piston (inside the gas tube)
bolt.cyl((150, 0, BZ + 22), (160, 0, BZ + 14), 6.0, segs=12, mat="gun_steel")
bolt.cyl((96, 0, BZ + 2), (172, 0, BZ + 2), 9.0, segs=16, mat="gun_steel")
bolt.box((14, 3.0, 5.6), c=(168, -8.2, BZ + 5), mat="gun_steel", bevel=0.5)                       # extractor
for k in range(5):
    bolt.box((1.2, 25, 2.4), c=(0 + k * 5.0, 0, BZ + 14.6), mat="gun_metal", bevel=0.2)          # carrier grip grooves
bolt.cyl((-30, 0, BZ + 3), (-60, 0, BZ + 3), 4.6, segs=12, mat="gun_steel")                       # recoil spring guide

# =========================================================================================== CHARGING HANDLE (on the carrier, right side)
CH = (124.0, -22.0, BZ + 10.0)
ch = G.part("charging_handle", pivot=CH)
ch.box((12, 10, 6), c=(124, -20.0, BZ + 9), mat="gun_steel", bevel=0.8)
ch.prism([(118, BZ + 6), (130, BZ + 6), (138, BZ + 9), (146, BZ + 15), (140, BZ + 17), (122, BZ + 12)], -27.0, -22.5, mat="gun_steel", bevel=0.8, fillet=2.0, fsegs=3)
ch.add(lathe_bm([(0, 0), (0, 5.6), (1.2, 6.4), (7.5, 6.4), (8.5, 5.2), (8.5, 0)], 20, "y", c=(144, -26.0, BZ + 15),
                mod=lambda k: 0.94 if k % 2 else 1.0, rot=(0, 0, 180)), "gun_steel", bevel=0)

# =========================================================================================== SELECTOR (AK safety lever, right side, in FIRE)
sel = G.part("selector", pivot=(22.0, -25.0, BZ - 6))
sel.prism([(14, BZ - 3), (26, BZ - 10), (60, BZ - 11.5), (104, BZ - 9), (112, BZ - 11), (114, BZ - 4.5), (104, BZ - 2), (60, BZ - 4.5),
           (32, BZ + 0.5), (22, BZ + 8), (10, BZ + 13), (6, BZ + 7), (10, BZ)], -W_REC / 2 - 2.6, -W_REC / 2 - 1.0, mat="gun_metal", bevel=0.45, fillet=1.5, fsegs=3)
sel.cyl((22, -W_REC / 2 - 2.6, BZ - 6), (22, -W_REC / 2 - 4.0, BZ - 6), 3.6, segs=14, mat="gun_metal", bevel=0.3, angle=40)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(56.0, 0, 66.0))
trig.sweep([(57, 0, 66), (60, 0, 57), (63.5, 0, 45), (63.5, 0, 36), (60, 0, 28)], radius=1.0,
           profile=[(3.6, 2.1), (-3.6, 2.1), (-3.6, -2.1), (3.6, -2.1)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((56, -6.5, 66), (56, 6.5, 66), 1.8, segs=10, mat="gun_steel")

# =========================================================================================== MAGAZINE (steel AKM 30-rd)
MAG_TOP = (115.0, 0.0, 56.0)
K.akm_mag(G.part("mag", pivot=MAG_TOP), MAG_TOP)

# =========================================================================================== OPTIC (compact 1x red dot on a riser)
OZ = 158.5
optic = G.part("optic", pivot=(-20.0, 0.0, Z_TOP + 4.8))
K.micro_dot(optic, x_c=-40.0, axis_z=OZ, rail_top=Z_TOP + 4.8)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (MUZZLE_X, 0, BZ))
G.socket("eject", (110.0, -24.0, BZ + 8.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (325.0, 8.0, BZ - 44.0))
G.socket("mag_well", MAG_TOP)
G.socket("sight", (-150.0, 0, OZ))
G.socket("stock", (-333.0, 0, 51.0))

G.motion("bolt", "translate", (-1, 0, 0), 95.0, "cycling / recoil: bolt carrier + bolt slide straight back inside the receiver (visible through the right-side slot). Origin = carrier rear centre on the bore axis.")
G.motion("charging_handle", "translate", (-1, 0, 0), 95.0, "cocking: the handle on the RIGHT side rides with the carrier (same 95 mm as `bolt`). Origin = stem base.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("selector", "rotate", (0, 1, 0), -55.0, "AK safety lever is modelled in FIRE (down). Safe = -55 deg about the node's +X (glTF), lever swings up over the slot. Pivot = lever axle on the right side.")
G.motion("mag", "translate", (math.sin(6 * D2R), 0, -math.cos(6 * D2R)), 260.0, "eject/insert along the mag's top axis (down and 6 deg FORWARD); the curved lower half needs a small forward rock (rotate about the front hook) for the real AK rock-in.")
G.remark("Reload: press the paddle catch (behind the mag), rock the mag forward and out, hook the new mag's front lug, rock it back into mag_well, pull the charging handle (right side) back 95 mm and release.")
G.remark("Right hand on the pistol grip (grip_R), left hand cups the lower laminated handguard at grip_L (x=325 mm). `optic` = compact 1x red dot on a riser (static; hide it for irons: rear leaf + hooded post sit on the bore line +30/+48 mm).")
G.remark("Sight line: `sight` socket on the red-dot axis (z=158.5 mm), 70 mm behind the rear lens region -> the game's red-dot reticle quad (sight +0.14 m) sits inside the tube.")

L_ = W_REC / 2 + 0.3
G.notes["style"] = dict(
    wood_axis=0, wear=0.9, dust=0.6, rust=0.2, grain_pitch=1.25,
    wood_dark=(0.030, 0.009, 0.004), wood_light=(0.11, 0.036, 0.013), wood_worn=(0.17, 0.08, 0.035),
    polymer_color=(0.024, 0.012, 0.008),
    engrave=[
        dict(text="RA-4471", pos=(R0 + 70, L_, 60.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.4, depth=0.07, mats=["gun_black"]),
        dict(text="1987", pos=(R0 + 70, L_, 55.0), u=(-1, 0, 0), v=(0, 0, 1), h=2.6, depth=0.06, mats=["gun_black"]),
        dict(text="* ^ *", pos=(R1 - 17, W_REC / 2 + 0.8, 98.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.0, depth=0.06, mats=["gun_metal"]),
        dict(text="AB", pos=(116.0, -L_, 82.0), u=(1, 0, 0), v=(0, 0, 1), h=3.6, depth=0.08, fill="light", mats=["gun_black"]),
        dict(text="OD~", pos=(116.0, -L_, 74.5), u=(1, 0, 0), v=(0, 0, 1), h=3.6, depth=0.08, fill="light", mats=["gun_black"]),
        dict(text="RD-2", pos=(-38.0, 15.2, OZ - 9.0), u=(-1, 0, 0), v=(0, 0, 1), h=2.4, depth=0.05, fill="light", mats=["gun_black"], slab=3.0),
        dict(text="RA-4471", pos=(-10.0, 0, Z_TOP - 1.2), u=(1, 0, 0), v=(0, -1, 0), h=2.6, depth=0.06, mats=["gun_black"]),
    ])
G.finish()
