"""RIDE OR DIE - SMG: compact 9mm submachine gun (MP5 / MP7 / UZI vibes), folding wire stock.  Units mm, G frame (+X fwd, +Y left, +Z up)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *

G = Gun("smg")
BZ = 64.0                        # bore axis height (receiver centre)
GA = 18.0                        # pistol-grip rake (bottom rearward)
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)


def gp(lx, lz, y=0.0):
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


def rr(w, h, r=10.0, n=3):
    return rrect_ring(w, h, r, n=n)


def lift(z):
    return Matrix.Translation((0, 0, z))


def edge_axis(e, axis):
    """helper: is the edge parallel to the given axis (0=x,1=y,2=z)?"""
    a, b = e.verts[0].co, e.verts[1].co
    d = [abs(a.x - b.x), abs(a.y - b.y), abs(a.z - b.z)]
    return d[axis] > 2.0 * (sum(d) - d[axis]) and d[axis] > 1.5


# =========================================================================================== RECEIVER (stamped steel tube)
body = G.part("body")
REC_X0, REC_X1 = -101.0, 122.0
rec = loft_bm([(REC_X0, rr(37, 37, 13)), (REC_X0 + 3.5, rr(43, 43, 15)), (REC_X1 - 5, rr(43, 43, 15)), (REC_X1, rr(40, 40, 13))], xf=lift(BZ))
cav = loft_bm([(-93, rr(39, 39, 12)), (114, rr(39, 39, 12))], xf=lift(BZ))
port = prism_bm([(26, 55), (86, 55), (90, 70), (86, 86), (26, 86)], -32, -8, fillet=[5, 5, 0, 6, 6], fsegs=4)   # ejection port (right)
slot = box_bm((78, 14, 5.2), c=(30, 24, 70))                                                                      # charging-handle slot (left wall)
magcut = box_bm((34.4, 24.2, 20), c=(75, 0, 44))
cuts = [cav, port, slot, magcut]
body.add(rec, "gun_black", bevel=[(1.0, 2, None)], cut=cuts)
# stamped ribs: top + side beads
body.box((190, 12, 3.2), c=(10, 0, BZ + 22.4), mat="gun_black", bevel=1.0)
for sy in (1, -1):
    body.box((176, 4.2, 5.0), c=(12, sy * 21.6, 56), mat="gun_black", bevel=1.5)
    body.box((70, 3.2, 3.2), c=(60, sy * 21.8, 76), mat="gun_black", bevel=1.0)
# ejection-port deflector lip + brass ramp
body.box((50, 1.6, 4), c=(56, -21.4, 87.2), mat="gun_black", bevel=0.6)
# barrel nut / front receiver ring
body.lathe([(112, 0), (112, 26.5), (116, 27.0), (126, 27.0), (127, 25.0), (127, 0)], c=(0, 0, BZ), segs=32, mat="gun_metal", bevel=0.0)
# rear end cap + buffer + stock hinge bosses
body.lathe([(-101, 0), (-101, 14.5), (-104, 15.5), (-110, 15.5), (-112, 12.5), (-112, 0)], c=(0, 0, BZ), segs=28, mat="gun_metal", bevel=0.0)
for sy in (1, -1):
    body.cyl((-104, sy * 20.0, 56), (-104, sy * 27.4, 56), 6.4, segs=20, mat="gun_metal", bevel=0.4, angle=40)
    body.cyl((-104, sy * 27.4, 56), (-104, sy * 28.4, 56), 3.2, segs=12, mat="gun_steel", bevel=0.2, angle=40)
# receiver pins / rivets (both sides)
for (px, pz) in ((-12.0, 48.0), (40.0, 50.0), (104.0, 50.0), (-80.0, 50.0)):
    for sy in (1, -1):
        body.cyl((px, sy * 21.0, pz), (px, sy * 23.4, pz), 2.6, segs=12, mat="gun_metal", bevel=0.25, angle=40)
for (px, pz) in ((-90.0, 78.0), (-20.0, 78.0), (96.0, 78.0)):
    for sy in (1, -1):
        body.cyl((px, sy * 21.0, pz), (px, sy * 22.8, pz), 1.7, segs=10, mat="gun_metal", bevel=0.15, angle=40)
# takedown pin (cross) at the rear
body.cyl((-84, -26, 66), (-84, 26, 66), 3.3, segs=12, mat="gun_steel", bevel=0.2, angle=40)

# =========================================================================================== TRIGGER HOUSING + PISTOL GRIP (polymer)
top = Vector(gp(0, 38))
secs = [(0, rr(31, 36, 9)), (10, rr(33, 38, 10)), (55, rr(33.5, 40, 11)), (92, rr(34, 43, 11)), (104, rr(35.5, 46, 11))]
grip = loft_bm(secs, xf=Matrix.Translation(top) @ Matrix.Rotation((90 + GA) * D2R, 4, "Y"))
hp = [(-34, 46), (60, 46), (60, 28), (56, 16), (50, 8), (44, 5), (26, 5), (17, 10), (10, 24), (-14, 32), (-30, 38)]
housing = prism_bm(hp, -17.0, 17.0, fillet=[1, 1, 3, 4, 4, 3, 3, 4, 0, 0, 3], fsegs=3)
hous = bool_op(housing, [grip], "UNION")
hcuts = [prism_bm([(19, 12.5), (48, 12.5), (50, 46), (23, 46)], -25, 25, fillet=[2.5, 2.5, 0, 0], fsegs=3),           # trigger opening
         box_bm((34.4, 24.2, 60), c=(75, 0, 30))]                                                                    # mag well passage
for lz in (-2.0, -24.0, -46.0):                                                                                      # finger grooves (front strap)
    hcuts.append(cyl_bm(gp(23.5, lz, -25), gp(23.5, lz, 25), 6.0, segs=20))
body.add(hous, "polymer", bevel=[(1.2, 2, lambda e: abs(e.verts[0].co.y) > 15.5 and abs(e.verts[1].co.y) > 15.5 and not edge_axis(e, 0)), (0.6, 2, None)], cut=hcuts)
# rubber grip backstrap panel + butt cap
body.box((6.0, 30, 84), c=gp(-17.6, -22, 0), rot=(0, GA, 0), mat="rubber", bevel=1.5)
body.box((40, 35.6, 5), c=gp(0, -71.5), rot=(0, GA, 0), mat="rubber", bevel=1.2)
# magazine well (steel), flared mouth
well = box_bm((42, 28.6, 30), c=(75, 0, 32))
body.add(well, "gun_black", bevel=[(1.2, 2, None)], cut=[box_bm((34.4, 24.2, 40), c=(75, 0, 30)), box_bm((37.5, 27.0, 3.6), c=(75, 0, 17.0))])
body.box((44, 30.6, 2.2), c=(75, 0, 17.2), mat="gun_black", bevel=0.7)
# mag catch (left) + selector (both sides)
body.cyl((54, 15.4, 32), (54, 19.4, 32), 4.6, segs=20, mat="gun_metal", bevel=0.4, angle=40)
for sy in (1, -1):
    body.cyl((-6, sy * 16.6, 40), (-6, sy * 19.2, 40), 5.8, segs=20, mat="gun_metal", bevel=0.5, angle=40)
    ang = 25 if sy > 0 else -25
    body.prism([(-6, 37.6), (-20, 38.8), (-22, 42), (-8, 45.4), (2, 43.4)], sy * 19.0, sy * 21.6, mat="gun_metal", bevel=0.4, fillet=1.0, fsegs=3)
# trigger pin heads
for sy in (1, -1):
    body.cyl((36, sy * 16.6, 40), (36, sy * 17.8, 40), 2.0, segs=12, mat="gun_metal", bevel=0.2, angle=40)
# sling loop (rear left)
body.sweep([(-116 + 4 * math.cos(a * math.pi / 7.0), 0, BZ - 2 + 6 * math.sin(a * math.pi / 7.0)) for a in range(14)], radius=1.6, segs=8, mat="gun_steel", closed=True)

# =========================================================================================== HANDGUARD (polymer, ventilated) + BARREL
hg = loft_bm([(122, rr(50, 47, 15)), (130, rr(50, 47, 15)), (250, rr(46, 43, 14)), (262, rr(43, 40, 13))], xf=lift(BZ - 1))
hg_in = loft_bm([(119, rr(36, 36, 11)), (259, rr(34, 34, 11))], xf=lift(BZ))
hg_cuts = [hg_in]
for row, zz in enumerate((BZ + 9.5, BZ - 8.0)):
    for k in range(6 if row == 0 else 5):
        x0 = 150.0 + k * 19.0 + (0 if row == 0 else 9.5)
        hg_cuts.append(box_bm((13.0, 60, 6.4), c=(x0, 0, zz)))
body.add(hg, "polymer", bevel=[(0.9, 1, None)], cut=hg_cuts)
# finger ribs under the handguard
for k in range(4):
    body.box((6, 22, 3.2), c=(178 + k * 17, 0, BZ - 24.6), mat="polymer", bevel=0.9)
# front handguard band + sling swivel
body.lathe([(258, 0), (258, 22.0), (262, 22.0), (262, 0)], c=(0, 0, BZ - 1), segs=28, mat="gun_metal", bevel=0.0, scale=(1, 0.92))
body.cyl((236, -3, BZ - 24), (236, 3, BZ - 24), 3.0, segs=12, mat="gun_steel", bevel=0.3, angle=40)
body.sweep([(236, 0, BZ - 26.5 - 5 * math.cos(a * math.pi / 8.0)) for a in range(17)], radius=1.5, segs=8, mat="gun_steel")
# barrel (gun_metal, chamber block inside the receiver)
bar = [(50, 12.5), (72, 12.5), (72, 9.6), (110, 9.0), (120, 8.6), (262, 8.6), (292, 8.6), (300, 8.6), (304, 8.6), (304, 0)]
body.lathe(bar, c=(0, 0, BZ), segs=32, mat="gun_metal", bevel=0.0)
# front sight assembly: base block + hood ring + post
body.box((17, 9, 20), c=(297, 0, 80.0), mat="gun_black", bevel=1.0)
ring = [(288.5, 7.4), (288.5, 9.8), (305.5, 9.8), (305.5, 7.4), (288.5, 7.4)]
body.lathe(ring, c=(0, 0, 97.0), segs=24, mat="gun_black", bevel=0.0, cap=False)
body.cyl((297, 0, 88.5), (297, 0, 98.6), 1.15, segs=10, mat="gun_steel", bevel=0.0)
# flash hider (3 prong) with slots
fh = [(303, 9.0), (306, 10.6), (326, 10.6), (332, 9.6), (334, 8.2), (334, 4.6), (309, 4.6), (309, 0)]
slots_ = [box_bm((20, 3.4, 30), c=(326, 0, 0), rot=(a, 0, 0)) for a in (0, 60, 120)]
slots_ = [bm_ for bm_ in slots_]
fhbm = lathe_bm(fh, 24, "x", c=(0, 0, BZ))
for sl in slots_:
    bmesh.ops.transform(sl, matrix=Matrix.Translation((0, 0, BZ)), verts=sl.verts)
body.add(fhbm, "gun_metal", bevel=0.5, cut=slots_)

# =========================================================================================== REAR SIGHT (drum + guard wings)
body.box((36, 18, 4.5), c=(-70, 0, BZ + 24.4), mat="gun_black", bevel=0.8)
drum = lathe_bm([(-8.6, 12.0), (8.6, 12.0)], 28, "y", c=(-68, 0, 89.5), mod=lambda k: 0.965 if k % 2 else 1.0)
ap = [cyl_bm((-84, 0, 98.6), (-50, 0, 98.6), 1.55, segs=12)]
body.add(drum, "gun_metal", bevel=0.3, cut=ap)
body.prism([(-82, 88), (-82, 98), (-78, 101.5), (-58, 101.5), (-54, 98), (-54, 88)], 9.6, 13.0, mat="gun_black", bevel=0.6, sym=True, fillet=1.0, fsegs=2)
body.cyl((-68, -14, 89.5), (-68, 14, 89.5), 2.4, segs=12, mat="gun_steel", bevel=0.2, angle=40)
body.cyl((-68, 13.0, 89.5), (-68, 18.0, 89.5), 5.6, segs=24, mat="gun_metal", bevel=0.3, angle=40, mod=lambda k: 0.94 if k % 2 else 1.0)

# =========================================================================================== BOLT (moves inside the receiver, visible through the port)
BOLT_PIV = (-40.0, 0, BZ)
bolt = G.part("bolt", pivot=BOLT_PIV)
bp = [(-40, 0), (-40, 15.5), (-38, 17.0), (60, 17.0), (62, 16.0), (62, 13.0), (72, 13.0), (72, 0)]
bolt.lathe(bp, c=(0, 0, BZ), segs=28, mat="gun_metal", bevel=0.0)
# bolt details: flutes, extractor claw, ejector slot, cocking lug
bolt.box((16, 3.2, 6.0), c=(66, -12.6, BZ + 6.0), mat="gun_steel", bevel=0.5)
bolt.box((60, 8, 12), c=(28, 15.0, BZ + 6), mat="gun_metal", bevel=1.0)            # cocking lug block
bolt.box((3.0, 34.5, 3.0), c=(52, 0, BZ + 16.8), mat="gun_steel", bevel=0.3)
# cocking piece on the left (goes through the receiver slot) is part of charging_handle

# =========================================================================================== CHARGING HANDLE (left side, slides in the slot)
CH_PIV = (58.0, 22.0, 70.0)
ch = G.part("charging_handle", pivot=CH_PIV)
ch.box((16, 22, 5), c=(58, 19.0, 70), mat="gun_metal", bevel=0.8)                    # stem through the slot
ch.prism([(52, 60), (52, 82), (56, 86), (72, 86), (72, 58), (58, 56)], 30.0, 34.5, mat="gun_metal", bevel=0.8, fillet=2.0, fsegs=3)   # paddle
for k in range(5):
    ch.box((1.6, 3.0, 20), c=(56 + k * 3.4, 35.4, 72), mat="gun_black", bevel=0.3)
ch.cyl((64, 34.5, 72), (64, 36.5, 72), 2.4, segs=12, mat="gun_steel", bevel=0.2, angle=40)

# =========================================================================================== TRIGGER
trig = G.part("trigger", pivot=(36.0, 0, 40.0))
tpath = [(37, 0, 40.0), (40, 0, 36.0), (43, 0, 28.0), (44.0, 0, 20.0), (43.0, 0, 14.5)]
trig.sweep(tpath, radius=1.0, profile=[(4.0, 2.3), (-4.0, 2.3), (-4.0, -2.3), (4.0, -2.3)], mat="gun_metal", bevel=0.6, smooth=5)
trig.cyl((36, -6, 40), (36, 6, 40), 1.8, segs=10, mat="gun_steel")
trig.box((16, 3.0, 3.2), c=(28.0, 0, 41.0), mat="gun_steel", bevel=0.4)

# =========================================================================================== MAGAZINE (curved, 30-rd 9mm)
R_MAG = 290.0
STRAIGHT = 45.0
MAG_TOP = (75.0, 0.0, 47.0)


def mag_at(s):
    """position (x,z) and unit tangent (tx,tz) (pointing down the mag) at arc length s"""
    if s <= STRAIGHT:
        return (MAG_TOP[0], MAG_TOP[2] - s), (0.0, -1.0)
    th = (s - STRAIGHT) / R_MAG
    return (MAG_TOP[0] + R_MAG * (1 - math.cos(th)), MAG_TOP[2] - STRAIGHT - R_MAG * math.sin(th)), (math.sin(th), -math.cos(th))


def mag_path(s0, s1, n=22):
    pts = []
    for i in range(n + 1):
        s = s0 + (s1 - s0) * i / n
        (x, z), _ = mag_at(s)
        pts.append((x, 0.0, z))
    return pts


MAG_LEN = 176.0
mag = G.part("mag", pivot=MAG_TOP)
outer = sweep_bm(mag_path(0, MAG_LEN), 1.0, profile=rr(23.0, 33.4, 4.0, 2), up=(0, 1, 0))
inner = sweep_bm(mag_path(-3, MAG_LEN - 2.5), 1.0, profile=rr(20.6, 31.0, 3.0, 2), up=(0, 1, 0))
wcuts = [inner]
for s in (22, 46, 70, 94):                                     # witness slots through both sides
    (x, z), (tx, tz) = mag_at(s)
    ang = -math.degrees(math.atan2(tx, -tz))
    for sy in (1, -1):
        wcuts.append(box_bm((22, 8, 8.5), c=(x, sy * 11.0, z), rot=(0, ang, 0)))
mag.add(outer, "gun_black", bevel=0.5, segs=1, cut=wcuts)
# vertical stamped ribs on the front of the mag
for s in range(16, 170, 14):
    (x, z), (tx, tz) = mag_at(s)
    ang = -math.degrees(math.atan2(tx, -tz))
    fx, fz = -tz, tx
    mag.box((1.8, 14.0, 6.0), c=(x + fx * 17.0, 0, z + fz * 17.0), rot=(0, ang, 0), mat="gun_black", bevel=0.5)
# baseplate + floorplate
(x, z), (tx, tz) = mag_at(MAG_LEN)
ang = -math.degrees(math.atan2(tx, -tz))
mag.box((36.5, 26.0, 7.0), c=(x + tx * 2.0, 0, z + tz * 2.0), rot=(0, ang, 0), mat="polymer", bevel=1.4)
# feed lips
(x, z), (tx, tz) = mag_at(1.5)
for sy in (1, -1):
    mag.box((28, 2.6, 3.4), c=(x - 1.5, sy * 8.8, z), mat="gun_black", bevel=0.4)
# visible rounds (zig-zag double column) + follower core below
for i in range(16):
    s = 8.0 + i * 5.85
    (x, z), (tx, tz) = mag_at(s)
    fx, fz = -tz, tx
    ang = math.degrees(math.atan2(-fz, fx))
    sy = 4.7 if i % 2 == 0 else -4.7
    head = (x - fx * 15.0, sy, z - fz * 15.0)
    rb = round_bms("9mm", segs=8, at=head, rot=(0, ang, 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "brass", bevel=0)
mag.sweep(mag_path(100, MAG_LEN - 6, 8), 1.0, profile=rr(19.0, 28.8, 3.0, 2), mat="gun_metal", bevel=0.0)

# =========================================================================================== FOLDING WIRE STOCK (extended at rest)
HINGE = (-104.0, 0.0, 56.0)
stock = G.part("stock_fold", pivot=HINGE)
for sy in (1, -1):
    path = [(-104, sy * 24.0, 56.0), (-125, sy * 24.0, 55.6), (-200, sy * 24.0, 50.0), (-280, sy * 24.0, 45.0), (-312, sy * 24.0, 43.0)]
    stock.sweep(path, radius=3.4, segs=10, mat="gun_metal", smooth=4)
    stock.cyl((-104, sy * 21.0, 56), (-104, sy * 26.6, 56), 5.4, segs=16, mat="gun_metal", bevel=0.3, angle=40)
for xs in (-160.0, -235.0):
    stock.cyl((xs, -24.0, 49.0 + (xs + 160) * 0.06), (xs, 24.0, 49.0 + (xs + 160) * 0.06), 2.4, segs=8, mat="gun_metal", bevel=0.0)
stock.cyl((-312, -25, 43), (-312, 25, 43), 3.4, segs=10, mat="gun_steel", bevel=0.0)
# butt plate: steel backing + rubber pad
padp = [(-309, 82), (-322, 79), (-330, 60), (-331, 26), (-326, 10), (-309, 12), (-303, 30), (-303, 66)]
stock.prism(padp, -24.0, 24.0, mat="rubber", bevel=1.6, fillet=[3, 6, 6, 6, 6, 3, 3, 3], fsegs=3)
stock.prism([(-303, 74), (-303, 20), (-306, 16), (-308, 18), (-308, 76)], -21.0, 21.0, mat="gun_metal", bevel=0.6)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (334.0, 0, BZ))
G.socket("eject", (52.0, -22.0, 74.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (188.0, 4.0, 40.0))
G.socket("mag_well", MAG_TOP)
G.socket("sight", (-150.0, 0, 98.6))
G.socket("stock", (-322.0, 0, 44.0))

G.motion("bolt", "translate", (-1, 0, 0), 52.0, "cycling / recoil: bolt slides straight back inside the receiver (visible through the right ejection port). Origin = bolt rear centre on the bore axis.")
G.motion("charging_handle", "translate", (-1, 0, 0), 52.0, "cocking: paddle on the LEFT side slides back in the receiver slot together with the bolt; return spring-loaded. Origin = base of the stem.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0, -1), 190.0, "eject/insert straight down through the mag well (curved lower half swings out clear of the well). Origin = magazine top where the feed lips seat.")
G.motion("stock_fold", "rotate", (0, 1, 0), -160.0, "optional fold: -160 deg about the node's +X (glTF) swings the wire stock down and forward under the receiver. Pivot = hinge bosses at the receiver rear.")
G.remark("Reload: left hand drops the mag straight down (grip_L is under the ventilated handguard), fresh mag enters the well at mag_well from below, then slap the charging handle (left side) back 52 mm.")
G.remark("Right hand on the pistol grip, index on the trigger (blade at ~x=43 mm, z=28 mm from the origin). Wire stock is modelled EXTENDED; `stock` socket is the centre of the rubber butt pad.")
G.remark("Sights: drum rear aperture (z=98.6) and hooded front post on the same line; `sight` socket is the eye point 80 mm behind the rear sight.")

G.notes["style"] = dict(
    decals=[dict(pos=(297.0, 0, 98.4), r=1.1, color=(0.5, 0.52, 0.45), mats=["gun_steel"])],
    edge_gain=1.0, wear=0.8,
)
G.finish()
if G.args.get("qa"):
    import qa_lift
    qa_lift.export_lifted("smg", 0.16)
if G.args.get("pose"):
    import qa_lift
    for n in ("bolt", "charging_handle"):
        G.objs[n].location.y += 0.052
    G.objs["mag"].location.z -= 0.09
    G.objs["trigger"].rotation_euler.x = math.radians(12)
    G.objs["stock_fold"].rotation_euler.x = math.radians(-160)
    qa_lift.export_lifted("smg_pose", 0.16)
