"""RIDE OR DIE - sniper ("LONGBOW .50"): AWM-class bolt action: olive-drab thumbhole stock on an aluminium chassis, adjustable
cheek piece + butt spacers, round receiver with a bolt shroud, heavy barrel with a big multi-port brake, detachable box magazine,
folded bipod, 5-25x56 scope with turrets, rings, see-through `glass_lens` lenses and a real crosshair reticle inside the tube.
Units mm, G frame (+X fwd, +Y left, +Z up), origin = pistol-grip centre.

Contract: nodes body, bolt ((-15,0,74), 105 mm back), bolt_handle (child of bolt, same pivot, -90 deg about the bore),
trigger ((46,0,56), +12 deg), mag ((128,0,52), 130 mm down), bipod ((402,0,14), +70 deg), scope ((60,0,124), static);
sockets muzzle, eject, grip_R, grip_L, mag_well, sight, stock."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
from gunlib import bool_op
import gunkit as K

G = Gun("sniper")
BZ = 74.0
SZ = 124.0
MGX, MGZ = 128.0, 52.0
BOLT_X = -15.0
body = G.part("body")

# =========================================================================================== STOCK (OD thumbhole) + chassis
# AWM-style skeleton stock composed of overlapping rounded parts (fore-end/action body, grip, comb bridge, thumbhole bridge, butt)
fore = K.rounded_prism([(420, 40), (420, 76), (190, 80), (150, 84), (-44, 84), (-44, 32), (190, 32), (400, 32)], -23, 23, r=7.0,
                       fillet=[4, 6, 10, 6, 6, 6, 6, 6], fsegs=4, rsegs=4)
fore = bool_op(fore, [box_bm((520, 34, 30), c=(90, 0, 88)), box_bm((64, 30, 60), c=(MGX, 0, MGZ - 20)), box_bm((66, 30, 40), c=(60, 0, 34))]
               + [box_bm((40, 60, 9), c=(250 + k * 50, 0, 58)) for k in range(3)])
body.add(fore, "paint", bevel=0)
grip = K.rounded_prism([(-34, 40), (26, 40), (16, -56), (8, -64), (-20, -64), (-30, -58)], -16.5, 16.5, r=6.5, fillet=[4, 6, 8, 6, 8, 6], fsegs=4, rsegs=4)
body.add(grip, "paint", bevel=0)
comb = K.rounded_prism([(-40, 84), (-40, 60), (-90, 82), (-140, 96), (-140, 112), (-96, 104)], -19, 19, r=6.0, fillet=[4, 6, 10, 4, 4, 10], fsegs=4, rsegs=4)
body.add(comb, "paint", bevel=0)
lowb = K.rounded_prism([(-8, -40), (-24, -62), (-160, 6), (-150, 26)], -17, 17, r=6.0, fillet=[6, 6, 6, 6], fsegs=4, rsegs=4)
body.add(lowb, "paint", bevel=0)
butt = K.rounded_prism([(-120, 112), (-330, 112), (-352, 108), (-352, -12), (-330, -16), (-150, -2), (-132, 20), (-120, 70)], -21, 21, r=7.0,
                       fillet=[10, 8, 4, 4, 8, 16, 14, 10], fsegs=4, rsegs=4)
body.add(butt, "paint", bevel=0)
# chassis (black aluminium) inside the channel + trigger guard + cheek piece + spacers + pad
body.add(box_bm((360, 30, 8), c=(80, 0, 62)), "gun_black", bevel=1.0)
tg = sweep_bm([(32, 0, 40), (30, 0, 30), (40, 0, 22), (84, 0, 22), (94, 0, 30), (94, 0, 40)], radius=1.0, segs=4,
              profile=[(7.0, 2.6), (-7.0, 2.6), (-7.0, -2.6), (7.0, -2.6)], smooth=4)
body.add(tg, "gun_black", bevel=0.8)
body.add(prism_bm([(-126, 110), (-300, 112), (-306, 118), (-300, 124), (-140, 124), (-122, 118)], -19, 19, fillet=[3, 3, 3, 5, 5, 3], fsegs=3), "paint", bevel=1.0)
for sy in (1, -1):
    body.add(cyl_bm((-200, sy * 20, 116), (-200, sy * 24, 116), 5.0, segs=16, mod=lambda k: K.knurl(k, 1, 0.08)), "gun_metal", bevel=0)
for k, x0 in enumerate((-352, -358)):
    body.add(prism_bm([(x0, -12), (x0 - 6, -12), (x0 - 6, 108), (x0, 108)], -22, 22, fillet=2.0, fsegs=2), "gun_black" if k == 0 else "polymer", bevel=0.6)
pad = prism_bm([(-364, -14), (-376, -10), (-378, 50), (-376, 106), (-364, 110)], -23, 23, fillet=[3, 6, 20, 6, 3], fsegs=4)
body.add(pad, "rubber", bevel=1.0, cut=[box_bm((6, 60, 2.6), c=(-376, 0, -2 + k * 12)) for k in range(10)])
body.add(K.loop_bm((-300, 0, -14.0), (0, 0, -1), 8.0, 2.0), "gun_metal", bevel=0)
body.add(K.loop_bm((400, 0, 32.0), (0, 0, -1), 7.0, 1.8), "gun_metal", bevel=0)
for x in (-10.0, 170.0):                                                                          # action screws / chassis bolts
    for sy in (1, -1):
        body.add(K.screw_head((x, sy * 23.0, 70), (0, sy, 0), 3.0), "gun_metal", bevel=0)

# =========================================================================================== RECEIVER, BARREL, BRAKE, SCOPE RAIL
rec = lathe_bm([(-92, 0), (-92, 14.0), (-88, 16.5), (196, 16.5), (200, 15.5), (200, 0)], 36, "x", c=(0, 0, BZ))
body.add(rec, "gun_black", bevel=0, cut=[box_bm((64, 20, 16), c=(142, -12, BZ + 8)),                        # ejection port (right)
                                        box_bm((12, 16, 20), c=(BOLT_X - 2, -12, BZ - 4))])                   # bolt-handle notch
body.add(box_bm((300, 20, 10), c=(55, 0, BZ + 19)), "gun_black", bevel=1.0)                                   # scope base
body.add(rail_bm(-90, 200, BZ + 23.5, width=21.2, height=5.2, pitch=10.16, slot=5.32, base=2.0), "gun_black", bevel=0.35, segs=1, angle=30)
body.lathe([(196, 0), (196, 15.5), (212, 15.5), (218, 13.5), (690, 12.0), (690, 0)], c=(0, 0, BZ), segs=32, mat="gun_metal")
for k in range(6):                                                                                            # barrel flutes
    a = k * 60.0
    body.add(box_bm((260, 2.4, 1.6), c=(420, math.cos(math.radians(a)) * 12.4, BZ + math.sin(math.radians(a)) * 12.4), rot=(a, 0, 0)), "gun_black", bevel=0.4)
brake = lathe_bm([(688, 0), (688, 16.5), (692, 18.0), (770, 18.0), (774, 16.0), (774, 7.4), (700, 7.4), (700, 0)], 32, "x", c=(0, 0, BZ))
bcut = []
for xx in (708, 726, 744):
    bcut.append(box_bm((10, 50, 24), c=(xx, 0, BZ)))
for xx in (708, 726, 744, 760):
    bcut.append(cyl_bm((xx, 0, BZ + 10), (xx, 0, BZ + 24), 2.2, segs=10))
body.add(brake, "gun_black", bevel=0.6, cut=bcut)

# =========================================================================================== BIPOD (folded)
bpx, bpz = 392.0, 16.0
body.add(box_bm((34, 34, 16), c=(bpx + 4, 0, bpz + 14)), "gun_black", bevel=1.5)
bipod = G.part("bipod", pivot=(bpx + 10, 0, bpz - 2))
bipod.cyl((bpx + 10, -22, bpz - 2), (bpx + 10, 22, bpz - 2), 4.6, segs=14, mat="gun_metal")
bipod.add(box_bm((22, 40, 8), c=(bpx + 10, 0, bpz + 3)), "gun_black", bevel=1.2)
for sy in (-1, 1):
    bipod.cyl((bpx + 12, sy * 21, bpz - 2), (bpx + 236, sy * 21, bpz - 2), 3.8, segs=12, mat="gun_metal")
    bipod.cyl((bpx + 130, sy * 21, bpz - 2), (bpx + 228, sy * 21, bpz - 2), 5.0, segs=12, mat="gun_black")
    bipod.add(sphere_bm(6.6, c=(bpx + 240, sy * 21, bpz - 2), scale=(1.5, 1, 1), usegs=14, vsegs=8), "rubber", bevel=0)

# =========================================================================================== BOLT + HANDLE
bolt = G.part("bolt", pivot=(BOLT_X, 0, BZ))
bolt.cyl((-30, 0, BZ), (198, 0, BZ), 9.6, segs=24, mat="gun_steel")
bolt.lathe([(164, 9.6), (168, 10.6), (196, 10.6), (198, 9.2), (198, 0)], c=(0, 0, BZ), segs=24, mat="gun_steel")
for k in range(4):
    bolt.add(box_bm((80, 3.0, 1.4), c=(80, math.cos(math.radians(k * 90 + 45)) * 9.6, BZ + math.sin(math.radians(k * 90 + 45)) * 9.6), rot=(k * 90 + 45, 0, 0)), "gun_metal", bevel=0.3)
bolt.box((70, 4.0, 3.4), c=(120, -9.4, BZ + 2), mat="gun_steel", bevel=0.5)
bolt.lathe([(-96, 0), (-96, 9.0), (-92, 12.4), (-32, 12.8), (-30, 9.6), (-30, 0)], c=(0, 0, BZ), segs=28, mat="gun_black")
bolt.lathe([(-104, 0), (-104, 4.6), (-98, 6.0), (-96, 6.0), (-96, 0)], c=(0, 0, BZ), segs=16, mat="gun_steel")
hb = G.part("bolt_handle", pivot=(BOLT_X, 0, BZ), parent="bolt")
stem = sweep_bm([(BOLT_X, -8, BZ - 1), (BOLT_X - 4, -26, BZ - 10), (BOLT_X - 6, -48, BZ - 22), (BOLT_X - 6, -60, BZ - 30)], radius=4.6, segs=12, smooth=4)
hb.add(stem, "gun_steel", bevel=0)
hb.add(cyl_bm((BOLT_X, -4, BZ), (BOLT_X, -14, BZ - 1.5), 8.0, segs=16), "gun_steel", bevel=0.4)
hb.add(sphere_bm(11.0, c=(BOLT_X - 6, -66, BZ - 36), scale=(1.0, 1.0, 1.15), usegs=22, vsegs=14), "polymer", bevel=0)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(46.0, 0, 56.0))
trig.sweep([(46.5, 0, 56), (49, 0, 46), (51, 0, 38), (50, 0, 31), (47, 0, 27)], radius=1.0,
           profile=[(3.6, 2.2), (-3.6, 2.2), (-3.6, -2.2), (3.6, -2.2)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((46, -5, 56), (46, 5, 56), 1.6, segs=10, mat="gun_steel")

# =========================================================================================== MAGAZINE (5-rd box)
mag = G.part("mag", pivot=(MGX, 0, MGZ))
mag.add(box_bm((58, 26, 64), c=(MGX, 0, MGZ - 30)), "gun_black", bevel=1.6)
mag.add(box_bm((60, 28, 6), c=(MGX, 0, MGZ - 62)), "polymer", bevel=1.5)
for sy in (1, -1):
    mag.add(box_bm((40, 2.2, 3.4), c=(MGX - 4, sy * 7.6, MGZ + 1.4)), "gun_black", bevel=0.4)
    for k in range(3):
        mag.add(box_bm((44, 1.2, 2.4), c=(MGX, sy * 13.2, MGZ - 16 - k * 12)), "gun_black", bevel=0.4)
for i, sy in enumerate((3.2, -3.4)):
    rb = round_bms("300wm", segs=12, at=(MGX - 42, sy, MGZ - 3 - i * 8.8), rot=(0, 0, 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "gun_metal", bevel=0)

# =========================================================================================== SCOPE (5-25x56) with rings, turrets, lenses, reticle
scope = G.part("scope", pivot=(60.0, 0, SZ))
sp = [(-125, 0), (-125, 17.2), (-122, 21.0), (-94, 21.5), (-86, 19.0), (-66, 17.0), (-60, 15.0), (150, 15.0), (176, 17.5), (222, 30.5),
      (248, 31.0), (255, 30.2), (255, 26.6), (250, 26.4), (250, 0)]
scope.add(lathe_bm(sp, 44, "x", c=(0, 0, SZ)), "gun_black", bevel=0)
scope.add(lathe_bm([(0, 0), (0, 16.4), (0.8, 16.4), (0.8, 0)], 32, "x", c=(-121.5, 0, SZ)), "glass_lens", bevel=0)
scope.add(lathe_bm([(0, 0), (0, 26.0), (0.8, 26.0), (0.8, 0)], 40, "x", c=(247.0, 0, SZ)), "glass_lens", bevel=0)
for x0 in (-116, -104):
    scope.add(lathe_bm([(0, 21.2), (0, 22.0), (6, 22.0), (6, 21.2)], 48, "x", c=(x0, 0, SZ), mod=lambda k: K.knurl(k, 1, 0.03), cap=False), "rubber", bevel=0)
# reticle: fine crosshair + thick posts on a ring inside the tube (visible through the lenses)
ret = [box_bm((0.3, 30.0, 0.18), c=(160, 0, SZ)), box_bm((0.3, 0.18, 30.0), c=(160, 0, SZ))]
for sgn in (1, -1):
    ret.append(box_bm((0.3, 9.0, 0.7), c=(160, sgn * 10.5, SZ)))
    ret.append(box_bm((0.3, 0.7, 9.0), c=(160, 0, SZ + sgn * 10.5)))
scope.add(merge_bm(ret), "gun_black", bevel=0)
scope.add(lathe_bm([(0, 14.0), (0, 15.0), (1.5, 15.0), (1.5, 14.0)], 32, "x", c=(159.2, 0, SZ), cap=True), "gun_black", bevel=0)
# turret saddle + elevation (top, tall), windage (right), parallax (left)
scope.add(box_bm((50, 34, 24), c=(20, 0, SZ + 2)), "gun_black", bevel=4.0)
for (y, z, ax, r, h) in ((0, SZ + 14, (0, 0, 1), 13.5, 18.0), (-17, SZ, (0, -1, 0), 12.0, 14.0), (17, SZ, (0, 1, 0), 12.5, 12.0)):
    tb = lathe_bm([(0, 0), (0, r - 0.8), (1.0, r), (h - 3.0, r), (h - 2.0, r - 1.0), (h - 1.0, r * 0.7), (h, r * 0.6), (h, 0)], 36, "z",
                  mod=lambda k: K.knurl(k, 1, 0.045))
    q = Vector((0, 0, 1)).rotation_difference(Vector(ax))
    bmesh.ops.transform(tb, matrix=Matrix.Translation(Vector((20, y, z))) @ q.to_matrix().to_4x4(), verts=tb.verts)
    scope.add(tb, "gun_black", bevel=0)
# magnification ring index + throw lever
scope.add(box_bm((6, 4, 10), c=(-80, 0, SZ + 20)), "gun_black", bevel=1.0)
# rings (two, on the rail)
for xr in (-40.0, 120.0):
    ring = lathe_bm([(0, 15.1), (0, 19.5), (18, 19.5), (18, 15.1)], 36, "x", c=(xr - 9, 0, SZ), cap=True)
    scope.add(ring, "gun_black", bevel=0.6)
    scope.add(prism_bm([(xr - 9, BZ + 29), (xr + 9, BZ + 29), (xr + 9, SZ - 12), (xr - 9, SZ - 12)], -12, 12, fillet=1.5, fsegs=2), "gun_black", bevel=0.8)
    for sy in (1, -1):
        scope.add(box_bm((16, 4, 10), c=(xr, sy * 13.5, BZ + 32)), "gun_black", bevel=0.8)
    for zz in (SZ + 6, SZ - 6):
        scope.add(K._hex(xr - 4, -20.5, zz, r=2.2), "gun_metal", bevel=0)
        scope.add(K._hex(xr + 4, -20.5, zz, r=2.2), "gun_metal", bevel=0)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (774.0, 0, BZ))
G.socket("eject", (140.0, -22.0, BZ + 6.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (250.0, 0, 34.0))
G.socket("mag_well", (MGX, 0, MGZ))
G.socket("sight", (-180.0, 0, SZ))
G.socket("stock", (-376.0, 0, 48.0))

G.motion("bolt", "translate", (-1, 0, 0), 105.0, "cycling: after the handle is lifted, the bolt slides straight back 105 mm along the bore axis, then forward again. bolt_handle is its child.")
G.motion("bolt_handle", "rotate", (1, 0, 0), -90.0, "unlock: rotate -90 deg about the node's +Z (glTF, the bolt axis = forward) raises the handle from the modelled down-right position to straight up. Pivot on the bolt axis at the handle root.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0, -1), 130.0, "drops straight out of the magwell (down). Origin = top centre of the magazine where it seats; rounds visible at the feed lips.")
G.motion("bipod", "rotate", (0, 1, 0), 70.0, "modelled FOLDED forward under the fore-end; deploy = +70 deg about the node's +X (glTF), legs swing down. Pivot = hinge pin at the fore-end clamp.")
G.remark("scope: separate static node (origin on the scope axis over the receiver). Lenses are `glass_lens` (see-through in the viewmodel); a crosshair reticle with thick outer posts sits inside the tube at x=160 mm, visible through both lenses. `sight` = eye point 55 mm behind the eyepiece.")
G.remark("Hands: right hand on the vertical thumbhole grip (grip_R), left hand under the fore-end at grip_L. Stock: OD green `paint` (tintable) on a black chassis; `stock` = recoil pad centre (moved 11 mm back for the new pad).")
G.notes["style"] = dict(wear=0.8, dust=0.45, rust=0.15, paint_color=(0.028, 0.034, 0.015), paint_under=(0.03, 0.03, 0.03), paint_metal_under=0.0, paint_rough=0.72,
                        polymer_color=(0.02, 0.02, 0.021),
                        engrave=[dict(text="LONGBOW .50", pos=(60.0, -16.7, BZ - 2.0), u=(1, 0, 0), v=(0, 0, 1), h=3.6, depth=0.07, mats=["gun_black"], slab=3.0),
                                 dict(text="5-25X56", pos=(-80.0, 0.0, SZ + 17.2), u=(0, -1, 0), v=(1, 0, 0), h=2.6, depth=0.05, fill="light", mats=["gun_black"], slab=3.0)])
G.finish()
