"""RIDE OR DIE - rpg: RPG-7 style shoulder launcher with PGO-7 style optic, wooden heat guard and a loaded HEAT warhead.
Units mm, G frame (+X fwd/muzzle, +Y left, +Z up). Origin = pistol-grip centre. Tube axis is at z = Z0."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpg_helpers import *

# (shared gunlook wood recipe: fine straight laminate grain)
install_military_paint()
G = Gun("rpg")
GA = 12.0
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)


def gp(lx, lz, y=0.0):
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


Z0 = 90.0                 # tube axis height
X_REAR, X_MUZ = -400.0, 530.0
OY, OZ = 64.0, 106.0      # optic axis (left of the tube)
HG0, HG1 = 70.0, 330.0    # heat guard extent
FG_X = 215.0              # front grip

body = G.part("body")


def top_edges(zmin):
    return lambda e: e.verts[0].co.z > zmin and e.verts[1].co.z > zmin


# ============================================================================ TUBE (venturi -> muzzle collar), hollow
tube = [(-400.0, 36.4), (-399.2, 38.4), (-397.0, 39.2), (-394.5, 38.4), (-393.6, 36.8),
        (-388.0, 33.5), (-378.0, 30.4), (-364.0, 27.8), (-348.0, 25.9), (-332.0, 24.5), (-316.0, 23.6), (-300.0, 23.0), (-296.0, 22.8),
        (495.0, 22.8), (497.0, 24.4), (500.0, 25.0), (520.0, 25.0), (524.0, 24.4), (530.0, 23.4), (530.0, 20.9),
        (-290.0, 20.9), (-300.0, 21.3), (-316.0, 22.4), (-332.0, 23.5), (-348.0, 24.9), (-364.0, 26.8), (-378.0, 29.4), (-388.0, 32.4), (-394.0, 35.0),
        (-396.5, 36.0), (-400.0, 36.4)]
body.add(lathe_loop(tube, 44, "x", (0, 0, Z0)), "gun_metal", bevel=0.0)
# venturi stiffening bands / weld seams / tube couplings
for x0, w, r in ((-345.0, 5.0, 26.9), (-296.0, 6.0, 23.9), (440.0, 5.0, 23.8), (470.0, 4.0, 23.7)):
    body.add(lathe_loop([(x0, r - 1.4), (x0, r), (x0 + w, r), (x0 + w, r - 1.4), (x0, r - 1.4)], 40, "x", (0, 0, Z0)), "gun_black", bevel=0.0)
# muzzle: rifled-tube step visible inside + crown ring
body.add(lathe_loop([(526.0, 20.9), (526.0, 22.4), (531.0, 22.4), (531.0, 20.9), (526.0, 20.9)], 40, "x", (0, 0, Z0)), "gun_steel", bevel=0.0)

# ============================================================================ HEAT GUARD (two wooden halves) + bands + fore grip
hg = [(HG0, 0.0), (HG0, 28.0), (HG0 + 2.0, 31.2), (HG0 + 6.0, 32.9), (HG0 + 14.0, 33.5), (HG1 - 12.0, 33.5), (HG1 - 5.0, 32.8), (HG1 - 1.5, 31.0), (HG1, 27.5), (HG1, 0.0)]
hg_bm = lathe_bm(hg, 32, "x", (0, 0, Z0), scale=(1.0, 0.94))
cuts = []
for sy in (1, -1):        # horizontal seam between the halves
    cuts.append(box_bm((HG1 - HG0 - 12, 3.4, 1.1), c=((HG0 + HG1) / 2, sy * 32.6, Z0)))
for gx in (150.0, 172.0, 260.0, 282.0):     # heat-dissipation finger grooves on the lower half
    cuts.append(cyl_bm((gx, -40, Z0 - 31.5), (gx, 40, Z0 - 31.5), 3.0, segs=14))
body.add(hg_bm, "wood", bevel=0.55, cut=cuts)
for x0 in (HG0 + 6.0, FG_X - 6.0, HG1 - 14.0):
    body.add(lathe_loop([(x0, 31.6), (x0, 35.6), (x0 + 12.0, 35.6), (x0 + 12.0, 31.6), (x0, 31.6)], 32, "x", (0, 0, Z0), scale=(1.0, 0.94)), "gun_metal", bevel=0.0)
    body.box((14, 10, 6), c=(x0 + 6.0, 0, Z0 - 36.0), mat="gun_metal", bevel=0.6)
    body.cyl((x0 + 6.0, -6, Z0 - 36.0), (x0 + 6.0, 6, Z0 - 36.0), 2.4, segs=10, mat="gun_metal")
    for sy in (-1, 1):
        body.add(hex_bolt_bm((x0 + 6.0, sy * 5.0, Z0 - 36.0), (0, sy, 0), 2.6, 1.6), "gun_metal", bevel=0.25)
# front vertical grip (wood) clamped to the middle band
ZT = Z0 - 33.0 * 0.94 - 3.0
fgp = [(ZT, 0.0), (ZT, 13.0), (ZT - 4.0, 15.5), (ZT - 14.0, 17.0), (ZT - 24.0, 15.6), (ZT - 30.0, 16.4), (ZT - 40.0, 15.4), (ZT - 46.0, 16.2), (ZT - 58.0, 15.2), (ZT - 68.0, 14.0), (ZT - 73.0, 11.5), (ZT - 75.0, 0.0)]
body.add(lathe_bm(fgp, 28, "z", (FG_X, 0, 0), scale=(1.0, 1.12)), "wood", bevel=0.0)
body.box((34, 34, 14), c=(FG_X, 0, ZT + 6.0), mat="gun_black", bevel=1.4)
body.cyl((FG_X, 0, ZT - 74.0), (FG_X, 0, ZT - 78.0), 11.0, 10.0, segs=24, mat="rubber", bevel=0.0)
for sx in (-1, 1):
    body.add(hex_bolt_bm((FG_X + sx * 10.0, -17.0, ZT + 6.0), (0, -1, 0), 2.6, 1.6), "gun_metal", bevel=0.25)
    body.add(hex_bolt_bm((FG_X + sx * 10.0, 17.0, ZT + 6.0), (0, 1, 0), 2.6, 1.6), "gun_metal", bevel=0.25)

# ============================================================================ FIRING GROUP: collar, housing, pistol grip, guard
body.add(lathe_bm([(-52.0, 0.0), (-52.0, 24.5), (-50.0, 27.0), (64.0, 27.0), (66.0, 24.5), (66.0, 0.0)], 40, "x", (0, 0, Z0)), "gun_black", bevel=0.0)
hp = [(-52.0, 78.0), (66.0, 78.0), (66.0, 52.0), (58.0, 42.0), (-22.0, 42.0), (-52.0, 56.0)]
body.add(prism_bm(hp, -14.0, 14.0, fillet=[2.0, 2.0, 3.0, 4.0, 4.0, 4.0], fsegs=3), "gun_black", bevel=1.0,
         cut=[box_bm((60, 6.0, 12), c=(12.0, 14.0, 62.0)), box_bm((60, 6.0, 12), c=(12.0, -14.0, 62.0))])
# access-cover plates + screws on both sides
for sy in (1, -1):
    body.box((44, 1.4, 18), c=(12.0, sy * 14.4, 62.0), mat="gun_metal", bevel=0.5)
    for sx in (-8.0, 32.0):
        body.add(screw_bm((sx, sy * 15.1, 62.0), (0, sy, 0), 2.0, 1.0), "gun_steel", bevel=0.0)
# grip (loft along the raked grip axis)
top = Vector(gp(0, 50))
def gring(w, h, r=8.5):
    return rrect_ring(w, h, r, n=3)
secs = [(0, gring(26, 34)), (10, gring(28, 37)), (50, gring(30, 39)), (98, gring(29, 37)), (112, gring(28, 35))]
grip = loft_bm(secs, xf=Matrix.Translation(top) @ Matrix.Rotation((90 + GA) * D2R, 4, "Y"))
gcuts = [cyl_bm(gp(21.5, lz, -20), gp(21.5, lz, 20), 5.2, segs=18) for lz in (10.0, -8.0, -26.0)]
body.add(grip, "polymer", bevel=1.0, cut=gcuts)
# butt cap
body.box((31.0, 29.0, 6.0), c=gp(0, -61.0), rot=(0, GA, 0), mat="gun_black", bevel=1.4)
# trigger guard (loop) in front of the grip
guard_o = [(12.0, 50.0), (72.0, 50.0), (72.0, 22.0), (64.0, 10.0), (24.0, 10.0), (14.0, 18.0)]
guard = prism_bm(guard_o, -7.0, 7.0, fillet=[1.0, 1.0, 6.0, 6.0, 5.0, 3.0], fsegs=4)
gin = prism_bm([(28.0, 21.0), (62.0, 21.0), (64.0, 44.0), (30.0, 44.0)], -12, 12, fillet=[3.0, 3.0, 0, 0], fsegs=3)
body.add(guard, "gun_black", bevel=0.9, cut=[gin])
# safety lever (left), cocking/hammer boss, pins
body.prism([(-30.0, 56.0), (-6.0, 56.0), (-2.0, 62.0), (-6.0, 68.0), (-30.0, 68.0)], 14.3, 17.5, mat="gun_metal", bevel=0.5, fillet=1.5, fsegs=3)
body.cyl((-20.0, 17.4, 62.0), (-20.0, 20.4, 62.0), 3.4, segs=16, mat="gun_steel", bevel=0.3)
body.cyl((-58.0, 12.0, 56.0), (-58.0, 21.5, 56.0), 6.0, segs=18, mat="gun_metal", bevel=0.4)
body.box((14, 10.0, 32), c=(-58.0, 17.5, 60.0), mat="gun_black", bevel=1.0)
for px, pz in ((44.0, 46.0), (-40.0, 48.0)):
    for sy in (14.4, -14.4):
        body.cyl((px, sy - 0.4 * (1 if sy > 0 else -1), pz), (px, sy + 0.5 * (1 if sy > 0 else -1), pz), 2.2, segs=10, mat="gun_steel", bevel=0.2)

# ============================================================================ SHOULDER REST (stub) + sling loops
sr = prism_bm([(-262.0, 46.0), (-188.0, 46.0), (-183.0, 24.0), (-192.0, 14.0), (-252.0, 10.0), (-266.0, 26.0)], -23.0, 23.0, fillet=[4, 4, 6, 7, 7, 6], fsegs=4)
body.add(sr, "rubber", bevel=1.2)
body.add(lathe_loop([(-256.0, 24.0), (-256.0, 27.6), (-194.0, 27.6), (-194.0, 24.0), (-256.0, 24.0)], 40, "x", (0, 0, Z0)), "gun_black", bevel=0.0)
for sy in (-1, 1):
    body.box((58.0, 2.4, 34.0), c=(-225.0, sy * 12.0, 61.0), mat="gun_black", bevel=0.7)
for x0 in (-252.0, -198.0):
    for sy in (-1, 1):
        body.add(screw_bm((x0, sy * 23.5, 30.0), (0, sy, 0), 2.4, 1.0), "gun_steel", bevel=0.0)
        body.add(screw_bm((x0, sy * 23.5, 46.0), (0, sy, 0), 2.4, 1.0), "gun_steel", bevel=0.0)
# sling loops (torus rings on lugs)
for sx, sz in ((HG1 - 8.0, Z0 - 37.0), (-190.0, 8.0)):
    body.box((6, 8, 6), c=(sx, 0, sz + 1.0), mat="gun_steel", bevel=0.6)
    body.add(ring_bm((sx, 0, sz - 7.5), (0, 1, 0), 8.0, 1.5, segs=8, tsegs=26), "gun_steel", bevel=0.0)

# ============================================================================ IRON SIGHTS
# front sight (on the muzzle collar): base, post, protective wings
body.box((18, 14, 10), c=(509.0, 0, Z0 + 26.0), mat="gun_black", bevel=0.8)
body.box((2.6, 2.6, 13), c=(509.0, 0, Z0 + 37.5), mat="gun_black", bevel=0.4)
for sy in (-1, 1):
    body.box((9, 1.8, 15), c=(509.0, sy * 5.6, Z0 + 38.0), mat="gun_black", bevel=0.4)
# rear sight (flip leaf with U notch) on top of the collar
body.box((24, 16, 6), c=(-4.0, 0, Z0 + 26.5 + 0.5), mat="gun_black", bevel=0.7)
rl = box_bm((2.6, 15.0, 17.0), c=(-9.0, 0, Z0 + 38.0))
body.add(rl, "gun_black", bevel=0.4, cut=[box_bm((6, 3.6, 8), c=(-9.0, 0, Z0 + 45.0))])

# ============================================================================ PGO-7 STYLE OPTIC (left side)
oc = (0, OY, OZ)
# mounting arms from the collar to the two optic clamp rings, clamp rings, bolts
for ax in (-40.0, 46.0):
    body.box((15.0, 26.0, 26.0), c=(ax, 37.0, OZ - 10.0), mat="gun_black", bevel=1.2)
    body.add(lathe_loop([(ax - 8.0, 19.0), (ax - 8.0, 22.6), (ax + 8.0, 22.6), (ax + 8.0, 19.0), (ax - 8.0, 19.0)], 32, "x", oc), "gun_metal", bevel=0.0)
    body.box((7.0, 7.0, 6.0), c=(ax, OY, OZ + 23.5), mat="gun_metal", bevel=0.6)
    body.add(hex_bolt_bm((ax, OY, OZ + 26.5), (0, 0, 1), 2.5, 1.6), "gun_steel", bevel=0.25)
    body.add(hex_bolt_bm((ax, 28.0 - 1.0, OZ - 22.0), (0, -1, 0), 2.6, 1.6), "gun_steel", bevel=0.25)
# eye cup (rubber), eyepiece glass, ocular housing, diopter ring, main body, objective bell + sun hood + lens
body.add(lathe_loop([(-152.0, 12.5), (-152.0, 20.8), (-148.0, 23.2), (-136.0, 22.6), (-126.0, 19.0), (-126.0, 14.5), (-136.0, 14.5), (-146.0, 12.5), (-152.0, 12.5)], 36, "x", oc), "rubber", bevel=0.0)
body.add(lathe_bm([(-141.0, 0.0), (-141.0, 12.6), (-139.4, 12.2), (-138.6, 0.0)], 30, "x", oc), "glass_lens", bevel=0.0)
body.add(lathe_bm([(-128.0, 0.0), (-128.0, 17.6), (-118.0, 17.6), (-118.0, 0.0)], 32, "x", oc), "gun_black", bevel=0.0)
body.add(lathe_bm([(-118.0, 0.0), (-118.0, 19.4), (-104.0, 19.4), (-104.0, 0.0)], 40, "x", oc, mod=knurl(2, 0.055)), "gun_metal", bevel=0.0)
body.add(lathe_bm([(-104.0, 0.0), (-104.0, 18.8), (78.0, 18.8), (78.0, 0.0)], 40, "x", oc), "gun_black", bevel=0.0)
for gx in (-84.0, 62.0):
    body.add(lathe_loop([(gx, 18.4), (gx, 19.4), (gx + 3.0, 19.4), (gx + 3.0, 18.4), (gx, 18.4)], 40, "x", oc), "gun_metal", bevel=0.0)
body.add(lathe_bm([(78.0, 0.0), (78.0, 18.8), (86.0, 21.0), (100.0, 23.8), (109.0, 24.8), (109.0, 0.0)], 40, "x", oc), "gun_black", bevel=0.0)
body.add(lathe_bm([(109.2, 0.0), (109.2, 22.4), (111.0, 22.0), (113.2, 20.6), (114.0, 0.0)], 36, "x", oc), "glass_lens", bevel=0.0)
body.add(lathe_loop([(106.0, 24.6), (106.0, 26.4), (152.0, 26.4), (152.0, 25.0), (106.0, 24.6)], 40, "x", oc), "gun_black", bevel=0.0)
# turrets: elevation (top), windage (left), reticle-light cap (rear left), bracket boss
body.box((24, 24, 7), c=(-10.0, OY, OZ + 19.0), mat="gun_black", bevel=1.0)
body.add(lathe_bm([(OZ + 21.0, 0.0), (OZ + 21.0, 9.5), (OZ + 31.0, 9.5), (OZ + 32.0, 8.0), (OZ + 32.0, 0.0)], 32, "z", (-10.0, OY, 0), mod=knurl(2, 0.07)), "gun_metal", bevel=0.0)
body.add(screw_bm((-10.0, OY, OZ + 32.0), (0, 0, 1), 5.0, 1.0, segs=14), "gun_steel", bevel=0.0)
body.box((24, 7, 24), c=(24.0, OY + 19.0, OZ), mat="gun_black", bevel=1.0)
body.add(lathe_bm([(OY + 22.0, 0.0), (OY + 22.0, 9.0), (OY + 32.0, 9.0), (OY + 33.0, 7.5), (OY + 33.0, 0.0)], 32, "y", (24.0, 0, OZ), mod=knurl(2, 0.07)), "gun_metal", bevel=0.0)
body.add(screw_bm((24.0, OY + 33.0, OZ), (0, 1, 0), 4.6, 1.0, segs=14), "gun_steel", bevel=0.0)
body.add(lathe_bm([(OY + 17.0, 0.0), (OY + 17.0, 6.6), (OY + 24.0, 6.6), (OY + 25.0, 5.4), (OY + 25.0, 0.0)], 24, "y", (-102.0, 0, OZ), mod=knurl(2, 0.08)), "gun_steel", bevel=0.0)
# mount rail plate under the optic + sight-adjust lock ring
body.box((70, 4.0, 22), c=(3.0, 30.5, OZ - 10.0), mat="gun_metal", bevel=0.8)

# ============================================================================ TRIGGER (moving)
trig = G.part("trigger", pivot=(40.0, 0, 43.0))
trig.sweep([(40.0, 0, 43.0), (44.0, 0, 35.0), (46.0, 0, 27.0), (44.0, 0, 20.5)], radius=1.0, profile=[(3.4, 2.0), (-3.4, 2.0), (-3.4, -2.0), (3.4, -2.0)], mat="gun_metal", bevel=0.5, smooth=5)
trig.box((22, 4.0, 5), c=(29.0, 0, 44.5), mat="gun_steel", bevel=0.6)
trig.cyl((40.0, -6.5, 43.0), (40.0, 6.5, 43.0), 1.8, segs=10, mat="gun_steel")

# ============================================================================ HAMMER / COCKING LEVER (moving) - modelled in the cocked position
ham = G.part("hammer", pivot=(-58.0, 17.5, 56.0))
hpts = [(-52.0, 50.0), (-60.0, 47.0), (-70.0, 52.0), (-80.0, 62.0), (-82.0, 70.0), (-75.0, 71.0), (-68.0, 66.0), (-60.0, 63.0), (-52.0, 62.0)]
hm = prism_bm(hpts, 14.5, 20.5, fillet=[1.5, 2.0, 3.0, 2.0, 1.5, 1.5, 3.0, 3.0, 2.0], fsegs=3)
ham.add(hm, "gun_metal", bevel=0.45, cut=[box_bm((1.0, 8, 6), c=(-70.5 - k * 2.4, 17.5, 66.5 + k * 1.4), rot=(0, -50, 0)) for k in range(0, 5)])
ham.cyl((-58.0, 12.5, 56.0), (-58.0, 21.0, 56.0), 2.6, segs=12, mat="gun_steel")

# ============================================================================ ROCKET (loaded HEAT warhead) - own node, origin = warhead body centre
RX = X_MUZ + 95.0            # rocket-local x=-95 (tube mouth) sits at the muzzle
rocket = G.part("rocket", pivot=(RX, 0, Z0))
warhead(rocket, (RX, 0.0, Z0))

# ============================================================================ SOCKETS + docs
G.socket("muzzle", (X_MUZ, 0, Z0))
G.socket("mag_well", (X_MUZ - 8.0, 0, Z0))
G.socket("eject", (X_REAR, 0, Z0), rot=(0, 0, 90))          # back-blast: local +X points REARWARD
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (FG_X, 0, ZT - 38.0))
G.socket("sight", (-207.0, OY, OZ))
G.socket("stock", (-224.0, 0, 30.0))
G.socket("rocket_tip", (RX + WH_NOSE_X, 0, Z0))

G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("hammer", "rotate", (0, 1, 0), 35.0, "modelled COCKED (spur up-and-back on the left rear of the housing). On fire rotate +35 deg about the node's +X (glTF) so the spur falls forward. Pivot = hammer boss.")
G.motion("rocket", "translate", (-1, 0, 0), 420.0, "RELOAD: start the node 420 mm ahead of its rest position (+Z glTF) and slide it BACK into the tube. FIRE: hide this node and spawn the projectile (rocket.glb) at this node's world transform - same origin/geometry.")
G.remark("Rocket protrudes ~340 mm ahead of the tube mouth (nose tip = `rocket_tip` socket). Tube mouth = `muzzle`/`mag_well`. Back-blast leaves from `eject` (its local +X points rearward). Keep the gunner clear: nozzle flare is at the rear of the tube, 400 mm behind the grip.")
G.remark("Hands: right hand on the pistol grip (grip_R at the grip centre, index finger through the guard on the trigger); left hand wraps the wooden vertical front grip (grip_L). Shoulder rests on the rubber pad `stock` (under the rear of the tube). Aim through the PGO-7 style optic on the left: `sight` is ~55 mm behind the eye cup (or over the iron sights on the tube).")
G.notes["style"] = dict(paint_color=(0.022, 0.027, 0.011), wood_axis=0, rust=0.45, dust=0.6, grain_pitch=1.2,
                        wood_dark=(0.032, 0.010, 0.004), wood_light=(0.12, 0.042, 0.015), wood_worn=(0.18, 0.09, 0.04),
                        engrave=[dict(text="WRECKER", pos=(-120.0, 0.0, Z0 + 20.6), u=(0, -1, 0), v=(1, 0, 0), h=4.0, depth=0.08, mats=["gun_black", "gun_metal"], slab=3.0)])
G.finish(size=2048)
