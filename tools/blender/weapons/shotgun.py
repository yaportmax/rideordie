"""RIDE OR DIE - shotgun: 12 ga pump-action, 20" heat-shielded barrel (Mossberg 500/590 vibes), walnut furniture.
Units mm, G frame (+X fwd, +Y left, +Z up).  Origin = wrist centre where the right palm sits (just behind the trigger guard)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gunlib
# import bevel_clean            # local fix: clean degenerate faces after bevel/boolean
from gunlib import *

G = Gun("shotgun")


def hull2(c0, r0, c1, r1, n=12):
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


def lerp_table(tab, x):
    """piecewise-linear interpolation of [(x, v), ...] sorted by decreasing x"""
    for (xa, va), (xb, vb) in zip(tab, tab[1:]):
        if xa >= x >= xb:
            t = (xa - x) / (xa - xb)
            return va + (vb - va) * t
    return tab[-1][1] if x < tab[-1][0] else tab[0][1]


# ---------------------------------------------------------------- layout (mm)
BZ = 54.0                # bore axis height
TZ = 27.0                # magazine tube axis height
RX0, RX1 = -12.0, 202.0  # receiver rear / front
RZ0, RZ1 = 14.0, 76.0    # receiver bottom / top
MUZZLE = 683.0
BREECH = 178.0           # bolt-face / breech plane (bolt closed)
TRIG_PIN = (52.0, 26.0)
PUMP_X0, PUMP_X1 = 270.0, 448.0

body = G.part("body")

# ================================================================== RECEIVER (black alloy)
rp = [(RX0, RZ0), (RX0, 70.0), (RX0 + 6.0, RZ1), (RX1 - 6.0, RZ1), (RX1, 72.0), (RX1, RZ0)]
rec = prism_bm(rp, -17.0, 17.0, fillet=[0, 5.0, 4.0, 3.0, 2.0, 0], fsegs=4)
cuts = []
cuts.append(box_bm((202.0 - (RX0 + 6.0), 21.2, 72.0 - 13.0), c=((RX0 + 6.0 + 202.0) / 2 + 1.0, 0, (13.0 + 72.0) / 2)))          # cavity, open at the bottom
cuts.append(prism_bm([(106, 46), (182, 46), (182, 70), (106, 70)], -21.0, -4.0, fillet=5.0, fsegs=4))                             # ejection port (right)
cuts.append(cyl_bm((178.0, 0, TZ), (206.0, 0, TZ), 9.9, segs=24))                                                                # magazine tube hole
cuts.append(cyl_bm((176.0, 0, BZ), (206.0, 0, BZ), 14.4, segs=32))                                                               # barrel extension bore
for sy in (-1, 1):
    cuts.append(box_bm((14.0, 6.0, 10.5), c=(196.0, sy * 14.0, 27.0)))                                                          # action-bar slots


def _top_long(e):
    a, b = e.verts[0].co, e.verts[1].co
    return a.z > 74.5 and b.z > 74.5 and abs(a.y) > 16.0 and abs(b.y) > 16.0 and abs(a.x - b.x) > 6


def _bot_long(e):
    a, b = e.verts[0].co, e.verts[1].co
    return a.z < 15.5 and b.z < 15.5 and abs(a.y) > 16.0 and abs(b.y) > 16.0 and abs(a.x - b.x) > 6


def _vert_edge(e):
    a, b = e.verts[0].co, e.verts[1].co
    return abs(a.y) > 16.0 and abs(b.y) > 16.0 and abs(a.x - b.x) < 0.2 and abs(a.z - b.z) > 6


body.add(rec, "gun_black", bevel=[(7.5, 4, _top_long), (3.0, 3, _bot_long), (2.2, 3, _vert_edge), (0.7, 2, None)], cut=cuts)

# receiver details: scope-mount screws (top), safety button + grooves, action-lock lever, cross pins
for (sx, sy) in ((36, 8.5), (36, -8.5), (150, 8.5), (150, -8.5)):
    body.add(screw_bm((sx, sy, RZ1 - 0.9), (0, 0, 1), 2.4, 0.9), "gun_steel", bevel=0.1)
sg = box_bm((22.0, 9.5, 5.5), c=(RX0 + 20.0, 0, RZ1 + 1.6))
body.add(sg, "polymer", bevel=0.9, cut=[box_bm((1.0, 12.0, 1.8), c=(RX0 + 12.0 + 2.6 * k, 0, RZ1 + 4.2)) for k in range(6)])
body.box((22.0, 3.0, 9.0), c=(112.0, 17.5, 20.0), mat="polymer", bevel=0.8, rot=(0, -8, 0))          # action lock lever (left)
for sy in (-1, 1):
    for (px, pz) in ((26.0, 22.0), (198.0, 21.0), (100.0, 12.0)):
        body.cyl((px, sy * 16.4, pz), (px, sy * 17.5, pz), 2.6, segs=12, mat="gun_steel", bevel=0.15, angle=20)
# shell stop / lifter cover on the right side under the ejection port and receiver floor plate with the loading port
floor = box_bm((84.0, 28.0, 4.0), c=(158.0, 0, 15.5))
body.add(floor, "gun_black", bevel=0.7, cut=[box_bm((46.0, 20.0, 10.0), c=(147.0, 0, 15.5))])

# ================================================================== TRIGGER GROUP (housing + guard)
th = prism_bm([(16, 15.0), (16, 4.0), (24, -6.0), (98, -6.0), (116, 4.0), (116, 15.0)], -12.6, 12.6, fillet=[0, 5.0, 6.0, 6.0, 6.0, 0][:6], fsegs=4)
body.add(th, "gun_black", bevel=[(1.4, 3, None)], cut=[prism_bm([(33, 16.5), (33, 4.5), (39, -1.6), (93, -1.6), (105, 5.0), (105, 16.5)], -20, 20, fillet=[0, 3.0, 4.0, 4.0, 4.0, 0], fsegs=4)])

# ================================================================== BARREL + EXTENSION + CHAMBER
bp = [(BREECH, 14.0), (208.0, 14.0), (214.0, 13.2), (232.0, 12.2), (300.0, 11.6), (600.0, 11.1), (668.0, 11.0), (681.0, 11.0), (682.5, 10.3), (683.0, 9.6),
      (683.0, 9.25), (668.0, 9.25), (668.0, 0.0)]
body.lathe(bp, c=(0, 0, BZ), segs=40, mat="gun_metal", bevel=0.0)
# barrel retaining ring / nut with knurl, tube clamp ring
body.lathe([(RX1 - 0.5, 0), (RX1 - 0.5, 17.0), (RX1 + 2.0, 17.4), (RX1 + 10.0, 17.4), (RX1 + 11.5, 16.2), (RX1 + 11.5, 0)], c=(0, 0, BZ), segs=40, mat="gun_metal",
           bevel=0.0, mod=lambda k: 1.0 if k % 2 == 0 else 0.985)
body.lathe([(RX1 - 0.5, 0), (RX1 - 0.5, 11.8), (RX1 + 13.0, 11.8), (RX1 + 13.0, 0)], c=(0, 0, TZ), segs=28, mat="gun_metal", bevel=0.3)
# magazine tube + cap + swivel
tube = [(RX1 - 4.0, 9.6), (655.0, 9.6), (656.0, 9.0), (656.0, 0.0)]
body.lathe(tube, c=(0, 0, TZ), segs=32, mat="gun_metal", bevel=0.0)
body.lathe([(648.0, 0), (648.0, 10.6), (650.0, 11.2), (666.0, 11.2), (667.5, 10.2), (667.5, 0)], c=(0, 0, TZ), segs=32, mat="gun_black", bevel=0.2,
           mod=lambda k: 1.0 if k % 2 == 0 else 0.955)
# barrel band joining barrel and tube near the muzzle
band = prism_x_bm(hull2((0.0, BZ), 13.8, (0.0, TZ), 11.6), 634.0, 646.0)
body.add(band, "gun_metal", bevel=0.8)
# sling swivel stud + loop on the cap
body.cyl((658.0, 0, TZ - 10.6), (658.0, 0, TZ - 15.0), 2.2, segs=12, mat="gun_steel", bevel=0.2)
body.sweep([(658.0, 4.2 * math.sin(a), TZ - 15.0 - 5.5 * (1 - math.cos(a))) for a in [i * math.pi / 8 for i in range(-8, 9)]], radius=0.9, segs=6, mat="gun_steel", bevel=0.0)
# front bead sight: base, stalk and brass bead
body.box((10.0, 5.0, 3.0), c=(668.0, 0, BZ + 11.0 + 0.8), mat="gun_metal", bevel=0.5)
body.cyl((668.0, 0, BZ + 12.5), (668.0, 0, BZ + 16.5), 1.3, segs=10, mat="gun_metal", bevel=0.0)
body.sphere(1.9, c=(668.0, 0, BZ + 17.6), mat="brass", usegs=12, vsegs=8)

# ================================================================== HEAT SHIELD (ventilated) + mounting rings
SH0, SH1 = 236.0, 500.0
shield = cyl_bm((SH0, 0, BZ), (SH1, 0, BZ), 16.4, segs=40)
inner = cyl_bm((SH0 - 1.0, 0, BZ), (SH1 + 1.0, 0, BZ), 15.0, segs=40)
vents = []
pitch = 17.4
nvent = int((SH1 - SH0 - 20.0) / pitch)
for row_ang in (90.0, 30.0, 150.0):                 # angle in the y-z plane measured from +y: 90 = top
    a = math.radians(row_ang)
    for k in range(nvent):
        xv = SH0 + 14.0 + k * pitch + (pitch * 0.5 if row_ang != 90.0 else 0.0)
        if xv > SH1 - 14.0:
            continue
        ctr = (xv, 15.6 * math.cos(a), BZ + 15.6 * math.sin(a))
        vents.append(box_bm((12.5, 4.0, 8.0), c=ctr, rot=(math.degrees(a) - 90.0, 0, 0)))
vents.append(box_bm((SH1 - SH0 + 6, 21.0, 12.0), c=((SH0 + SH1) / 2, 0, BZ - 13.0)))          # open underside
shell_bm = bool_op(shield, [inner], "DIFFERENCE")
body.add(shell_bm, "gun_black", bevel=[(0.35, 2, None)], cut=vents)
for xr in (SH0 + 3.0, SH1 - 3.0):
    body.lathe([(xr - 2.5, 11.0), (xr - 2.5, 15.6), (xr + 2.5, 15.6), (xr + 2.5, 11.0)], c=(0, 0, BZ), segs=40, mat="gun_black", bevel=0.0, cap=False) if False else None
    ring = bool_op(cyl_bm((xr - 2.5, 0, BZ), (xr + 2.5, 0, BZ), 15.6, segs=32), [cyl_bm((xr - 3.5, 0, BZ), (xr + 3.5, 0, BZ), 11.2, segs=28), box_bm((8.0, 21.0, 10.0), c=(xr, 0, BZ - 12.0))], "DIFFERENCE")
    body.add(ring, "gun_metal", bevel=0.35)

# ================================================================== STOCK (walnut) + rubber recoil pad + sling stud
top_t = [(-12, 52.0), (-40, 47.0), (-80, 41.5), (-130, 34.5), (-190, 24.0), (-250, 13.0), (-298, 4.0)]
bot_t = [(-12, -26.0), (-40, -27.0), (-80, -34.0), (-130, -46.0), (-190, -64.0), (-250, -88.0), (-298, -110.0)]
wid_t = [(-12, 34.0), (-60, 35.0), (-130, 38.0), (-200, 41.0), (-298, 43.0)]
sec = []
xs = [-12, -28, -50, -80, -115, -150, -190, -225, -260, -285, -298]
for x in xs:
    tp, bt, w = lerp_table(top_t, x), lerp_table(bot_t, x), lerp_table(wid_t, x)
    h = tp - bt
    sec.append((x, rrect_ring(w, h, min(13.0, h / 2 - 1), n=3, c=(0, (tp + bt) / 2))))
sec.reverse()      # loft runs from the rear (x=-298) to the front (x=-12)
stock = loft_bm(sec, cap=True)
body.add(stock, "wood", bevel=[(1.0, 3, None)], angle=24.0)
# wrist block under the receiver up to the trigger guard
wblock = loft_bm([(-12.0, rrect_ring(34.0, 40.0, 12.0, n=3, c=(0, -6.0))), (24.0, rrect_ring(31.0, 40.0, 11.0, n=3, c=(0, -6.0)))])
body.add(wblock, "wood", bevel=[(1.0, 3, None)], angle=24.0)
# receiver bolt/ tang screw cover on the wrist top and stock bolt washer at the butt
body.cyl((-135.0, 0, lerp_table(top_t, -135.0) - 0.3), (-135.0, 0, lerp_table(top_t, -135.0) + 0.6), 0.1, segs=6, mat="gun_steel") if False else None
# rubber recoil pad
pad_w, pad_top, pad_bot = 43.0, 4.0, -110.0
pad = loft_bm([(-298.0, rrect_ring(pad_w, pad_top - pad_bot, 11.0, n=3, c=(0, (pad_top + pad_bot) / 2))),
               (-310.0, rrect_ring(pad_w + 0.5, pad_top - pad_bot + 1.0, 11.5, n=3, c=(0, (pad_top + pad_bot) / 2 - 0.5))),
               (-318.0, rrect_ring(pad_w - 1.0, pad_top - pad_bot - 1.0, 11.0, n=3, c=(0, (pad_top + pad_bot) / 2 - 0.5)))])
body.add(pad, "rubber", bevel=[(1.4, 3, None)], angle=24.0)
# rear-face pad ribs (horizontal grooves) are baked into the rubber normal map; steel pad screws:
for zz in (-20.0, -92.0):
    body.cyl((-318.4, 0, zz), (-317.2, 0, zz), 3.0, segs=12, mat="gun_steel", bevel=0.2, angle=20)
# stock sling stud + loop (underside near the butt)
body.cyl((-250.0, 0, lerp_table(bot_t, -250.0) + 1.0), (-250.0, 0, lerp_table(bot_t, -250.0) - 4.0), 2.6, segs=12, mat="gun_steel", bevel=0.2)
body.sweep([(-250.0 + 5.0 * math.sin(a), 0, lerp_table(bot_t, -250.0) - 3.5 - 6.5 * (1 - math.cos(a))) for a in [i * math.pi / 8 for i in range(-8, 9)]], radius=1.0, segs=6, mat="gun_steel", bevel=0.0)

# ================================================================== BOLT (moving, visible through the ejection port)
bolt = G.part("bolt", pivot=(BREECH, 0, BZ))
bb = box_bm((80.0, 17.4, 21.0), c=(BREECH - 40.0 - 0.6, 0, BZ - 0.5))
bolt.add(bb, "gun_metal", bevel=[(1.2, 3, None)], cut=[box_bm((36.0, 12.0, 10.0), c=(BREECH - 26.0, -6.6, BZ + 9.5)),        # ejection slot (top right)
                                                          box_bm((70.0, 1.2, 1.2), c=(BREECH - 42.0, -9.2, BZ - 3.0))])          # panel groove
bolt.cyl((BREECH - 0.6, 0, BZ), (BREECH + 0.6, 0, BZ), 7.6, segs=28, mat="gun_metal", bevel=0.3)
bolt.cyl((BREECH + 0.5, 0, BZ), (BREECH - 1.5, 0, BZ), 1.7, segs=12, mat="gun_black")
bolt.box((9.0, 2.4, 7.0), c=(BREECH - 4.0, -8.6, BZ + 1.0), mat="gun_steel", bevel=0.3)          # extractor claw
bolt.box((6.0, 1.6, 8.0), c=(BREECH - 12.0, -9.6, BZ + 6.0), mat="gun_steel", bevel=0.3)         # extractor spring nub
bolt.box((70.0, 13.0, 9.5), c=(BREECH - 46.0, 0, BZ - 15.4), mat="gun_black", bevel=0.8)        # carrier / slide block under the bolt
bolt.box((14.0, 30.0, 6.0), c=(BREECH - 26.0, 0, 27.0 + 0.0), mat="gun_black", bevel=0.8)         # action-bar yoke

# ================================================================== PUMP (fore-end + action bars) : moving
pump = G.part("pump", pivot=(PUMP_X0, 0, TZ))
FZ = 19.0
fx = [(PUMP_X0 + 6.0, 39.0, 36.0), (PUMP_X0 + 30.0, 43.0, 40.0), (PUMP_X0 + 100.0, 44.0, 41.0), (PUMP_X1 - 22.0, 43.0, 40.0), (PUMP_X1, 38.0, 35.0)]
fsec = [(x, rrect_ring(w, h, 13.0, n=3, c=(0, FZ + (h - 40.0) / 2 - 0.5))) for x, w, h in fx]
grooves = []
for k in range(9):
    for sy in (-1, 1):
        grooves.append(box_bm((1.8, 4.2, 24.0), c=(PUMP_X0 + 22.0 + k * 7.2, sy * 21.8, FZ), rot=(0, 0, 0)))
fore = loft_bm(fsec)
pump.add(fore, "wood", bevel=[(1.0, 3, None)], angle=24.0, cut=grooves)
# rear slide cap / sleeve (black) and front end
cap = loft_bm([(PUMP_X0 - 1.0, rrect_ring(38.0, 34.5, 13.0, n=3, c=(0, FZ - 0.5 + (34.5 - 40.0) / 2))), (PUMP_X0 + 6.5, rrect_ring(39.5, 36.0, 13.0, n=3, c=(0, FZ - 0.5 + (36.0 - 40.0) / 2)))])
pump.add(cap, "gun_black", bevel=[(0.9, 2, None)])
pump.lathe([(PUMP_X0 + 4.0, 0), (PUMP_X0 + 4.0, 12.2), (PUMP_X0 + 12.0, 12.2), (PUMP_X0 + 12.0, 0)], c=(0, 0, TZ), segs=28, mat="gun_metal", bevel=0.2)
# action bars (steel) running back into the receiver
for sy in (-1, 1):
    pump.box((PUMP_X0 - 165.0, 4.6, 6.6), c=(PUMP_X0 - 82.5 + 2.0, sy * 13.4, TZ), mat="gun_metal", bevel=0.7)
    pump.box((10.0, 6.0, 9.0), c=(PUMP_X0 - 4.0, sy * 12.6, TZ), mat="gun_metal", bevel=1.0)

# ================================================================== TRIGGER
trig = G.part("trigger", pivot=(TRIG_PIN[0], 0, TRIG_PIN[1]))
tp = [(TRIG_PIN[0], 0, TRIG_PIN[1] + 0.5), (57.0, 0, 20.0), (61.0, 0, 8.0), (60.0, 0, 2.0)]
trig.sweep(tp, radius=1.0, profile=[(3.6, 2.9), (-3.6, 2.9), (-3.6, -2.9), (3.6, -2.9)], mat="gun_black", bevel=0.7, smooth=5)
trig.cyl((TRIG_PIN[0], -6.5, TRIG_PIN[1] + 0.5), (TRIG_PIN[0], 6.5, TRIG_PIN[1] + 0.5), 2.0, segs=12, mat="gun_steel")

# ================================================================== 12 GA SHELL PARTIALLY LOADED (visible from the loading port)
def shell12(x0, y, z):
    hull = [(x0 + 16.0, 0.0), (x0 + 16.0, 9.9), (x0 + 60.0, 10.0), (x0 + 66.0, 9.6), (x0 + 70.0, 8.4), (x0 + 70.0, 0.0)]
    base = [(x0 + 0.0, 0.0), (x0 + 0.0, 10.4), (x0 + 1.4, 10.9), (x0 + 2.4, 10.9), (x0 + 2.4, 10.1), (x0 + 3.4, 10.0), (x0 + 16.6, 10.0), (x0 + 17.0, 9.6), (x0 + 17.0, 0.0)]
    return hull, base


hp_, bp_ = shell12(112.0, 0.0, 33.0)
body.lathe(hp_, c=(0, 0, 33.0), segs=24, mat="paint", bevel=0.0)
body.lathe(bp_, c=(0, 0, 33.0), segs=24, mat="brass", bevel=0.0)
body.lathe([(111.9, 0), (111.9, 3.6), (112.6, 3.9), (113.4, 3.9), (113.4, 0)], c=(0, 0, 33.0), segs=14, mat="gun_steel", bevel=0.0)

# ================================================================== SOCKETS
G.socket("muzzle", (MUZZLE, 0, BZ))
G.socket("eject", (150.0, -17.5, 62.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (PUMP_X0 + 88.0, 0, FZ), parent="pump")
G.socket("mag_well", (148.0, 0, 13.0))
G.socket("sight", (-120.0, 0, 90.0))
G.socket("stock", (-317.0, 0, -52.0))

# ---- documentation
G.motion("pump", "translate", (-1, 0, 0), 62.0, "rack: fore-end (with action bars) slides straight back (62 mm, stops against the receiver front) along the magazine tube; grip_L is parented to it. Origin = rear centre of the fore-end on the tube axis.")
G.motion("bolt", "translate", (-1, 0, 0), 72.0, "moves back WITH the pump (rear travel 72 mm; game may ease it so it starts ~6 mm after the pump and travels slightly further, as the real bolt does); opens the ejection port. Origin = bolt-face centre on the bore axis.")
G.motion("trigger", "rotate", (0, 1, 0), 14.0, "pull: +14 deg about +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.remark("No detachable mag: shells are inserted one at a time at `mag_well` (the loading port under the receiver, push forward/up). One 12 ga shell is modelled partly loaded in the port (part of `body`, hide it if needed).")
G.remark("Reload/fire cycle: pump back 62 mm (bolt 72), eject a hull out of `eject` (right side, +X of the socket = ejection direction), pump forward.")
G.remark("Hands: right hand on the wrist at grip_R behind the trigger guard (index on trigger); left hand on the fore-end at grip_L (follows the pump). Shoulder pad centre = `stock`.")
G.remark("Bead sight is brass; `sight` sits over the comb line 120 mm behind the receiver rear, aligned over the receiver top and the bead.")

import wood_look
wood_look.install(grain=(1.0, 0.0, 0.0), stripe=1.55, dark=(0.030, 0.010, 0.004), light=(0.115, 0.046, 0.018))
G.notes["style"] = dict()
if G.args.get("pose"):
    gunlib.OUT_DIR = os.path.join(gunlib.RL.PUBLIC, "models", "_test")
    G.name = "shotgun_pose"
    _oe = gunlib.export_gltf
    def _posed(path):
        bpy.data.objects["pump"].location.y += 0.062            # G -X == Blender +Y
        bpy.data.objects["bolt"].location.y += 0.072
        bpy.context.view_layer.update()
        _oe(path)
    gunlib.export_gltf = _posed
G.finish()
