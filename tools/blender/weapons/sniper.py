"""RIDE OR DIE - sniper: bolt-action .300 WM rifle (Remington 700 / SVD vibes) with a 4-16x50 scope.  Units mm, G frame."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *

G = Gun("sniper")
BZ = 74.0              # bore axis height above the grip centre
SZ = BZ + 50.0         # scope axis height
SEG = 24


def knurl(n=4):
    return lambda k: 1.0 if k % n else 0.93


def edges_x(zmin, ymin, minlen=20.0, zmax=1e9):
    def f(e):
        a, b = e.verts[0].co, e.verts[1].co
        return abs(a.y) >= ymin and abs(b.y) >= ymin and zmin <= a.z <= zmax and zmin <= b.z <= zmax and abs(a.x - b.x) > minlen and abs(a.z - b.z) < 0.5
    return f


def rot_x_bm(bm, ang_deg, yz0=(0.0, 0.0)):
    """rotate a shell about a line parallel to X through (y0,z0)"""
    M = Matrix.Translation((0, yz0[0], yz0[1])) @ Matrix.Rotation(math.radians(ang_deg), 4, "X") @ Matrix.Translation((0, -yz0[0], -yz0[1]))
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


# ==================================================================================== STOCK (wood)
body = G.part("body")
RK = 20.0
_ca, _sa = math.cos(RK * D2R), math.sin(RK * D2R)


def gp(lx, lz, y=0.0):
    return (lx * _ca + lz * _sa, y, -lx * _sa + lz * _ca)


def ring(w, h, zc, r=9.0):
    return rrect_ring(w, h, r, 3, c=(0.0, zc))


# butt stock: x -345 .. -20
butt = loft_bm([(-345, ring(36, 116, 47, 12)), (-318, ring(38, 116, 51, 12)), (-260, ring(41, 108, 57, 12)), (-180, ring(44, 96, 60, 12)),
                (-100, ring(46, 82, 60, 12)), (-20, ring(46, 70, 60, 11))])
body.add(butt, "wood", bevel=[(1.6, 3, None)])
# fore-end: x -20 .. 430 (flat bottom / beavertail)
fore = loft_bm([(-20, ring(46, 70, 60, 11)), (20, ring(50, 56, 52, 12)), (60, ring(50, 48, 54, 12)), (205, ring(50, 48, 54, 12)), (250, ring(46, 30, 44, 10)), (340, ring(43, 29, 44, 9)), (430, ring(39, 28, 44, 8))])
fore_cuts = [box_bm((96, 24, 70), c=(128, 0, 20)),                                       # magwell (bottom)
             ] + [box_bm((2.6, 60, 3.2), c=(300 + k * 11, 0, 30.0)) for k in range(6)]
body.add(fore, "wood", bevel=[(1.6, 3, None)], cut=fore_cuts)
# pistol grip (rake 20 deg)
gtop = Vector(gp(0, 50))
grip = loft_bm([(0, ring(30, 40, 0, 9)), (10, ring(34, 43, 0, 10)), (44, ring(37, 48, 1.5, 11)), (86, ring(35, 44, 0, 10)), (110, ring(33, 41, 0, 10))],
               xf=Matrix.Translation(gtop) @ Matrix.Rotation((90 + RK) * D2R, 4, "Y"))
body.add(grip, "wood", bevel=1.4)
# black grip cap + rubber butt pad + spacers
body.add(cyl_bm(gp(0, -62, 0), gp(0, -68, 0), 17, segs=20, cap=True), "gun_black", bevel=0.6) if False else None
body.box((6, 34, 4), c=gp(-12, -64), rot=(0, RK, 0), mat="gun_black", bevel=0.8)
body.box((20, 40, 124), c=(-355, 0, 47), mat="rubber", bevel=2.5)
body.box((5, 38, 120), c=(-343, 0, 47), mat="gun_black", bevel=1.0)
# cheek riser (adjustable comb) with posts and wheels
body.box((150, 30, 16), c=(-215, 0, 116), mat="polymer", bevel=3.0, rot=(0, 3.5, 0))
for xx in (-260, -170):
    body.cyl((xx, 0, 100), (xx, 0, 110), 4.0, segs=12, mat="gun_steel", bevel=0.2)
    body.cyl((xx, 16, 112), (xx, 22, 112), 6.5, segs=14, mat="gun_black", bevel=0.3, mod=knurl(2))
# sling studs + QD cup
body.cyl((-300, 0, 8), (-300, 0, 1), 5.5, segs=12, mat="gun_metal", bevel=0.3)
body.cyl((240, 0, 31), (240, 0, 23), 5.0, segs=12, mat="gun_metal", bevel=0.3)
body.cyl((-160, 23, 38), (-160, 27.5, 38), 7.0, segs=14, mat="gun_black", bevel=0.4)
# fore-end grooves / stipple bands (wood inlets)

# ==================================================================================== ACTION (round receiver, rail, recoil lug)
rec_prof = [(-32, 0), (-32, 19), (-28, 21), (152, 21), (156, 23.5), (206, 23.5), (206, 0)]
rec = lathe_bm(rec_prof, SEG, "x", c=(0, 0, BZ))
rc = [cyl_bm((-40, 0, BZ), (215, 0, BZ), 13.0, segs=20),                                   # bolt bore
      prism_bm([(92, BZ - 4), (178, BZ - 4), (182, BZ + 26), (96, BZ + 26)], -34, 4, fillet=[3, 3, 5, 5], fsegs=4)]     # ejection / loading port
body.add(rec, "gun_black", bevel=0.6, cut=rc)
# recoil lug, barrel nut, receiver ring
body.box((8, 46, 40), c=(204.0, 0, BZ - 16), mat="gun_metal", bevel=1.2)
body.lathe([(206, 0), (206, 22.5), (214, 22.5), (214, 0)], c=(0, 0, BZ), segs=SEG, mat="gun_metal")
# scope base rail (Picatinny) + rear bridge hump
body.add(rail_bm(-22, 202, BZ + 18.0, width=21.2, height=5.4), "gun_black", bevel=0.3)
# ejection-port bevel edge + bolt stop + floorplate + trigger guard
tgo = [(2, 60), (2, 22), (12, 4), (74, 4), (86, 18), (88, 60)]
tgi = [(14, 56), (15, 24), (21, 12), (66, 12), (76, 24), (76, 56)]
body.prism(tgo, -8.0, 8.0, mat="gun_black", bevel=[(1.4, 3, None)], fillet=[0, 3, 6, 6, 4, 0], fsegs=4, cut=[prism_bm(tgi, -14, 14, fillet=[0, 3, 3, 3, 3, 0], fsegs=3)])
body.box((98, 30, 4.5), c=(133, 0, 53.5), mat="gun_black", bevel=1.0, cut=[box_bm((88, 17, 10), c=(133, 0, 53.5))])      # magwell bezel plate
for sx in (-1, 1):
    body.box((60, 2.6, 8), c=(120, sx * 15.4, 46), mat="gun_black", bevel=0.8)
body.cyl((100, -14, 16), (100, 14, 16), 2.4, segs=10, mat="gun_steel")
body.box((14, 6, 8), c=(114, -14, 8), mat="gun_metal", bevel=0.8)      # release paddle
# action screws (guard screws)
for xx in (8, 168):
    body.add(hex_bolt_bm((xx, 0, 8), (0, 0, -1), r=4.0, h=2.0), "gun_steel", bevel=0.15)
# safety lever at the right rear
body.box((16, 5, 9), c=(-48, -13, BZ + 6), mat="gun_black", bevel=1.0)

# ---- barrel (free-floated) + muzzle brake
bar_prof = [(196, 0), (196, 15.0), (205, 15.0), (300, 14.0), (450, 12.6), (600, 11.4), (690, 10.8), (692, 10.0), (692, 0)]
body.lathe(bar_prof, c=(0, 0, BZ), segs=SEG, mat="gun_metal", bevel=0.0)
brake = lathe_bm([(690, 0), (690, 14.8), (694, 15.8), (770, 15.8), (774, 14.0), (774, 6.4), (700, 6.4), (700, 0)], SEG, "x", c=(0, 0, BZ))
bcut = [box_bm((5, 46, 20), c=(xx, 0, 0)) for xx in (706, 722, 738, 754)]
for cb in bcut:
    bmesh.ops.transform(cb, matrix=Matrix.Translation((0, 0, BZ)), verts=cb.verts)
body.add(brake, "gun_black", bevel=0.5, cut=bcut)
# muzzle brake crown + thread protector shadow line
body.lathe([(688, 11), (690, 12.2), (694, 12.2), (694, 11)], c=(0, 0, BZ), segs=SEG, mat="gun_steel")

# ---- bipod (folded forward under the fore-end)
bpx, bpz = 392.0, 16.0
body.box((30, 30, 14), c=(bpx + 4, 0, bpz + 4), mat="gun_black", bevel=1.5)                     # clamp
bipod = G.part("bipod", pivot=(bpx + 10, 0, bpz - 2))
bipod.cyl((bpx + 10, -22, bpz - 2), (bpx + 10, 22, bpz - 2), 4.2, segs=12, mat="gun_metal")
bipod.box((22, 40, 8), c=(bpx + 10, 0, bpz + 1), mat="gun_black", bevel=1.2)
for sy in (-1, 1):
    bipod.cyl((bpx + 12, sy * 22, bpz - 2), (bpx + 240, sy * 22, bpz - 2), 3.6, segs=10, mat="gun_metal")
    bipod.cyl((bpx + 130, sy * 22, bpz - 2), (bpx + 232, sy * 22, bpz - 2), 4.6, segs=10, mat="gun_black", bevel=0.2)
    bipod.cyl((bpx + 234, sy * 22, bpz - 2), (bpx + 250, sy * 22, bpz - 2), 6.2, segs=12, mat="rubber")

# ==================================================================================== BOLT + BOLT HANDLE
BOLT_X = -15.0
bolt = G.part("bolt", pivot=(BOLT_X, 0, BZ))
bolt.cyl((-30, 0, BZ), (198, 0, BZ), 9.6, segs=SEG, mat="gun_steel", bevel=0.0)
bolt.lathe([(160, 9.6), (164, 10.4), (196, 10.4), (198, 9.0), (198, 0)], c=(0, 0, BZ), segs=SEG, mat="gun_steel")   # locking lugs / bolt face
bolt.box((70, 4.5, 3.6), c=(110, -9.6, BZ + 2), mat="gun_metal", bevel=0.5)                                           # extractor claw strip
bolt.box((26, 9, 4.6), c=(60, 0, BZ + 9.4), mat="gun_black", bevel=0.6)                                              # ejector slot cover
bolt.lathe([(-90, 0), (-90, 8.5), (-86, 11.5), (-32, 12.0), (-30, 9.6), (-30, 0)], c=(0, 0, BZ), segs=SEG, mat="gun_black")   # bolt shroud
bolt.lathe([(-98, 0), (-98, 4.2), (-92, 5.6), (-90, 5.6), (-90, 0)], c=(0, 0, BZ), segs=16, mat="gun_steel")            # cocking piece
bolt.box((26, 4, 10), c=(-64, -11.6, BZ + 4), mat="gun_metal", bevel=1.0)                                              # safety-lug wing
hb = G.part("bolt_handle", pivot=(BOLT_X, 0, BZ), parent="bolt")
# handle in the DOWN position (35 deg below the horizontal, to the right)
stem = sweep_bm([(BOLT_X, -8, BZ - 1), (BOLT_X - 4, -26, BZ - 10), (BOLT_X - 6, -50, BZ - 22), (BOLT_X - 6, -64, BZ - 32)], radius=5.0, segs=12, smooth=4)
hb.add(stem, "gun_steel", bevel=0.0)
hb.add(cyl_bm((BOLT_X, -4, BZ), (BOLT_X, -14, BZ - 1.5), 8.0, segs=16), "gun_steel", bevel=0.4)
hb.sphere(11.5, c=(BOLT_X - 7, -72, BZ - 38), scale=(1.0, 1.05, 1.25), mat="polymer", usegs=20, vsegs=12)
hb.sphere(3.2, c=(BOLT_X - 7, -72, BZ - 51), scale=(1, 1, 0.6), mat="gun_black", usegs=10, vsegs=6)

# ==================================================================================== TRIGGER
trig = G.part("trigger", pivot=(46.0, 0, 56.0))
tp = [(46, 0, 55), (50, 0, 44), (50.5, 0, 32), (47, 0, 21)]
trig.sweep(tp, radius=1.0, profile=[(2.3, 4.6), (-2.3, 4.6), (-2.3, -4.6), (2.3, -4.6)], mat="gun_metal", bevel=0.7, smooth=5)
trig.cyl((46, -8, 56), (46, 8, 56), 2.2, segs=10, mat="gun_steel")
trig.box((18, 4, 4), c=(38, 0, 57), mat="gun_steel", bevel=0.4)

# ==================================================================================== MAGAZINE (detachable box, 5 x .300 WM)
MGX, MGZ = 128.0, 52.0
mag = G.part("mag", pivot=(MGX, 0, MGZ))
mbody = box_bm((94, 22.4, 68), c=(MGX, 0, MGZ - 34))
mcuts = [box_bm((90.5, 19.6, 70), c=(MGX, 0, MGZ - 32))]
for zz in (MGZ - 14, MGZ - 26, MGZ - 38, MGZ - 50):
    for sy in (-1, 1):
        mcuts.append(box_bm((10, 5, 3.6), c=(MGX - 22, sy * 11.2, zz)))
mag.add(mbody, "gun_black", bevel=0.8, cut=mcuts)
mag.box((100, 27, 7), c=(MGX, 0, MGZ - 71.5), mat="polymer", bevel=1.6)
mag.box((88, 20.0, 1.6), c=(MGX, 0, MGZ - 64), mat="gun_steel", bevel=0.3)
for sy in (-1, 1):
    mag.box((88, 2.2, 3.6), c=(MGX, sy * 8.6, MGZ - 2.2), mat="gun_black", bevel=0.4)
for i in range(5):
    zz = MGZ - 7.5 - i * 11.0
    sy = 5.0 if i % 2 == 0 else -5.0
    rb = round_bms("300wm", segs=10, at=(MGX - 42.5 + (0 if i else 1.8), sy, zz), primer=(i == 0), bullet=True)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "brass", bevel=0)
    if "primer" in rb:
        mag.add(rb["primer"], "gun_steel", bevel=0)

# ==================================================================================== RINGS (static, on the rail)
for xx in (-2.0, 128.0):
    ringb = lathe_bm([(xx - 10, 15.4), (xx - 10, 19.8), (xx + 10, 19.8), (xx + 10, 15.4)], SEG, "x", c=(0, 0, SZ))
    body.add(ringb, "gun_black", bevel=0.5)
    body.box((22, 26, 12), c=(xx, 0, SZ - 24), mat="gun_black", bevel=1.0)
    body.box((22, 6, 6), c=(xx, 0, BZ + 24.5), mat="gun_black", bevel=0.5)
    for sy in (-1, 1):
        body.box((14, 7, 12), c=(xx, sy * 19, SZ + 1), mat="gun_black", bevel=1.0)
        body.cyl((xx, sy * 17, SZ + 1), (xx, sy * 27, SZ + 1), 3.4, segs=12, mat="gun_steel", bevel=0.2)
        body.add(hex_bolt_bm((xx, sy * 27, SZ + 1), (0, sy, 0), r=3.4, h=1.6), "gun_steel", bevel=0.1)

# ==================================================================================== SCOPE (node `scope`, origin = scope axis above the receiver at x=60)
SX = 60.0
scope = G.part("scope", pivot=(SX, 0, SZ))
tube = [(-6, 0), (-6, 15.2), (148, 15.2), (148, 0)]
scope.lathe(tube, c=(0, 0, SZ), segs=SEG, mat="gun_black", bevel=0.0)
# eyepiece: taper, magnification ring, diopter ring, rear bell
scope.lathe([(-34, 15.2), (-32, 17.5), (-8, 19.8), (-6, 19.8), (-6, 15.2)], c=(0, 0, SZ), segs=SEG, mat="gun_black")
scope.lathe([(-90, 0), (-90, 21.0), (-86, 22.6), (-66, 22.6), (-62, 20.2), (-40, 17.0), (-34, 15.2), (-34, 0)], c=(0, 0, SZ), segs=SEG, mat="gun_black")
scope.lathe([(-84, 22.9), (-64, 22.9), (-64, 21.6), (-84, 21.6)], c=(0, 0, SZ), segs=36, mat="rubber", mod=knurl(2))
scope.lathe([(-32, 19.6), (-10, 19.6), (-10, 18.4), (-32, 18.4)], c=(0, 0, SZ), segs=36, mat="rubber", mod=knurl(2))
# rear lens (recessed)
scope.lathe([(-88.5, 0), (-88.5, 15.0), (-88, 15.6), (-88, 0)], c=(0, 0, SZ), segs=32, mat="glass_lens")
scope.lathe([(-90, 15.6), (-90, 16.6), (-86, 16.6), (-86, 15.6)], c=(0, 0, SZ), segs=32, mat="gun_steel")
# objective bell with sun shade
obj = [(148, 15.2), (150, 16.2), (176, 25.5), (184, 28.4), (290, 28.4), (290, 26.6), (172, 26.6)]
scope.lathe([(148, 0), (148, 15.2), (150, 16.2), (176, 25.5), (184, 28.6), (240, 28.6), (240, 0)], c=(0, 0, SZ), segs=SEG, mat="gun_black")
scope.lathe([(240, 28.6), (240, 31.2), (330, 31.2), (330, 29.6), (240, 29.6)], c=(0, 0, SZ), segs=SEG, mat="gun_black")   # sun shade
scope.lathe([(236, 28.6), (236, 27.0), (262, 27.0), (262, 0), (232, 0)], c=(0, 0, SZ), segs=SEG, mat="gun_black") if False else None
scope.lathe([(236, 0), (236, 28.7), (240, 28.7), (240, 27.2), (250, 27.2), (250, 0)], c=(0, 0, SZ), segs=SEG, mat="gun_black")
scope.lathe([(252.5, 0), (252.5, 26.2), (254.5, 26.8), (254.5, 0)], c=(0, 0, SZ), segs=40, mat="glass_lens")      # objective lens (recessed, coated)
scope.lathe([(250, 26.8), (250, 27.6), (256, 27.6), (256, 26.8)], c=(0, 0, SZ), segs=40, mat="gun_steel")
# lens retaining ring visible at the very front of the shade + flip-up cap hinge
scope.lathe([(326, 29.6), (326, 31.6), (332, 31.6), (332, 29.6)], c=(0, 0, SZ), segs=SEG, mat="gun_black")
# turret housing
scope.box((30, 34, 20), c=(SX, 0, SZ + 8), mat="gun_black", bevel=2.5) if False else None
scope.lathe([(SX - 15, 0), (SX - 15, 17.2), (SX + 15, 17.2), (SX + 15, 0)], c=(0, 0, SZ), segs=SEG, mat="gun_black") if False else None
scope.cyl((SX, 0, SZ + 10), (SX, 0, SZ + 22), 17.0, segs=SEG, mat="gun_black", bevel=0.5)
scope.cyl((SX, 0, SZ + 22), (SX, 0, SZ + 47), 15.2, segs=36, mat="gun_black", bevel=0.4, mod=knurl(3))
scope.cyl((SX, 0, SZ + 47), (SX, 0, SZ + 49.5), 12.5, segs=SEG, mat="gun_steel", bevel=0.3)
scope.lathe([(SX, 0, ), ][0:0] or [(0, 16.6), (0, 17.6), (2.6, 17.6), (2.6, 16.6)], c=(SX, 0, SZ + 24.5), axis="z", segs=SEG, mat="gun_steel") if False else None
scope.cyl((SX, 0, SZ + 26), (SX, 0, SZ + 28.4), 16.3, segs=SEG, mat="gun_steel", bevel=0.2)     # index ring
scope.cyl((SX, -10, SZ), (SX, -24, SZ), 17.0, segs=SEG, mat="gun_black", bevel=0.5)
scope.cyl((SX, -24, SZ), (SX, -44, SZ), 15.0, segs=36, mat="gun_black", bevel=0.4, mod=knurl(3))
scope.cyl((SX, -44, SZ), (SX, -46, SZ), 11.5, segs=SEG, mat="gun_steel", bevel=0.3)
scope.cyl((SX, 10, SZ), (SX, 22, SZ), 17.0, segs=SEG, mat="gun_black", bevel=0.5)
scope.cyl((SX, 22, SZ), (SX, 38, SZ), 15.0, segs=36, mat="gun_black", bevel=0.4, mod=knurl(3))
scope.cyl((SX, 38, SZ), (SX, 40, SZ), 11.0, segs=SEG, mat="gun_steel", bevel=0.3)
scope.box((3.0, 12, 3.0), c=(SX + 4, 15.2, SZ - 15), mat="gun_steel", bevel=0.3) if False else None

# ==================================================================================== SOCKETS + notes
G.socket("muzzle", (774.0, 0, BZ))
G.socket("eject", (140.0, -22.0, BZ + 6.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (250.0, 0, 34.0))
G.socket("mag_well", (MGX, 0, MGZ))
G.socket("sight", (-180.0, 0, SZ))
G.socket("stock", (-365.0, 0, 47.0))

G.motion("bolt", "translate", (-1, 0, 0), 105.0, "cycling: after the handle is lifted, the bolt slides straight back 105 mm along the bore axis, then forward again. bolt_handle is its child.")
G.motion("bolt_handle", "rotate", (1, 0, 0), -90.0, "unlock: rotate -90 deg about the node's +Z (glTF, the bolt axis; = forward) raises the handle from the modelled down-right position to straight up. Pivot on the bolt axis at the handle root.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0, -1), 130.0, "drops straight out of the magwell (down). Origin = top centre of the magazine where it seats; rounds visible at the feed lips.")
G.motion("bipod", "rotate", (0, 1, 0), 70.0, "modelled FOLDED forward under the barrel; deploy = +70 deg about the node's +X (glTF), legs swing down. Pivot = hinge pin at the fore-end clamp.")
G.remark("scope: separate node (origin on the scope axis over the receiver, x = +60 mm). Lenses use glass_lens (transparent); sight socket sits at the exit pupil ~90 mm behind the eyepiece (eye relief).")
G.remark("Hands: right hand around the pistol grip (grip_R), trigger finger through the guard; left hand supports the fore-end/bipod area at grip_L, or the rear bag under the butt (stock).")
G.remark("Reload: `mag` drops out downwards; bolt: rotate bolt_handle -90, translate bolt -105 mm (ejects a case from `eject`), push forward, rotate +90 to lock.")
G.finish()
