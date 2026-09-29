"""RIDE OR DIE - pistol ("RANGER 9"): polymer-frame 9x19 striker pistol (G17 class).  Units mm, G frame (+X fwd, +Y left,
+Z up).  Origin = pistol-grip centre.

Contract (unchanged): nodes body, slide (pivot bore axis at the slide rear, travel 38 mm back), trigger (pin at (34,0,26), +12 deg),
mag (seat at gp(0,37) on the 20 deg grip axis, 135 mm travel down the grip axis); sockets muzzle, eject, grip_R, grip_L, mag_well, sight."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *
import gunkit as K

G = Gun("pistol")
GA = 20.0
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)


def gp(lx, lz, y=0.0):
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


BORE_Z = 58.0
SX0, SX1 = -20.0, 160.0              # slide rear / front
SZ0, SZ1 = 40.5, 71.5                # slide bottom / top
SW = 25.4                            # slide width

# =========================================================================================== FRAME (polymer)
body = G.part("body")
# upper frame + dust cover (under the slide), with the accessory rail below the dust cover
fr_side = [(-16, 33), (-12, 41), (150, 41), (152, 38), (150, 31), (96, 29), (92, 30), (60, 31), (26, 32)]
frame = prism_bm(fr_side, -11.8, 11.8, fillet=[4, 1, 1, 1.5, 2, 3, 3, 3, 3], fsegs=3)
body.add(frame, "polymer", bevel=[(1.0, 2, None)])
# rail slots under the dust cover
rail = prism_bm([(100, 25.5), (146, 25.5), (148, 29.5), (98, 29.5)], -10.5, 10.5)
from gunlib import bool_op
rail = bool_op(rail, [box_bm((4.2, 30, 3.0), c=(106 + k * 10.0, 0, 25.5)) for k in range(4)])
body.add(rail, "polymer", bevel=0.5)
# trigger guard: squared, serrated front face
tg = sweep_bm([(26, 0, 32), (24, 0, 22), (27, 0, 12), (35, 0, 7.5), (74, 0, 7.5), (84, 0, 9.5), (91, 0, 26), (92, 0, 31)], radius=1.0, segs=4,
              profile=[(5.8, 2.3), (-5.8, 2.3), (-5.8, -2.3), (5.8, -2.3)], smooth=4)
body.add(tg, "polymer", bevel=0.8)
for k in range(5):
    t = 0.2 + k * 0.15
    x, z = 84 + (91 - 84) * t, 9.5 + (26 - 9.5) * t
    body.add(box_bm((1.2, 9.6, 1.4), c=(x + 2.3, 0, z), rot=(0, -68, 0)), "polymer", bevel=0.3)
# grip: raked loft, stippled panels (texture), beavertail on top, finger grooves on the front strap
def gring(dep, wid, rf=9.0, rb=11.0, cx=0.0):
    return [(lx, y) for lx, y, _ in K.rr_ring2(dep, wid, rf, rb, cx=cx, n=4)]


gsecs = [(34, 44.0, 27.0, 8, 10, 0.0), (26, 45.5, 29.5, 8.5, 11, 0.0), (0, 47.5, 30.4, 9, 12, 0.0), (-30, 48.5, 30.6, 9, 12, 0.0),
         (-58, 50.5, 31.0, 9, 12, 0.5), (-64, 52.0, 32.5, 9, 12, 0.5), (-68, 52.4, 32.8, 9, 12, 0.5)]
rings = []
for lz, dep, wid, rf, rb, cx in gsecs:
    ring = gring(dep, wid, rf, rb, cx)
    # finger grooves on the front strap
    fg = 0.0
    for gz in (-6.0, -26.0, -46.0):
        fg += 1.4 * math.exp(-((lz - gz) / 6.0) ** 2)
    ring = [(lx - (fg if lx > dep / 2 - 3 else 0.0), y) for lx, y in ring]
    rings.append((lz, ring))
n = len(rings[0][1])
bm = bmesh.new()
vr = [[bm.verts.new(Vector(gp(lx, lz, y))) for lx, y in ring] for lz, ring in rings]
for i in range(len(vr) - 1):
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((vr[i][k], vr[i][k2], vr[i + 1][k2], vr[i + 1][k]))
bm.faces.new(list(reversed(vr[0])))
bm.faces.new(vr[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
gcut = [box_bm((80, 60, 40), c=(10, 0, 55.0)),                                              # flat top under the frame rails
        box_bm((34.0, 23.6, 40), c=gp(0.5, -86.0), rot=(0, GA, 0))]                          # magazine well (open at the bottom)
body.add(bool_op(bm, gcut), "polymer", bevel=[(0.9, 2, None)])
# beavertail + backstrap top
body.add(loft_bm([(-26, rrect_ring(26, 10, 4.5, n=3, c=(0, 32))), (-16, rrect_ring(27, 12, 5, n=3, c=(0, 34))), (-8, rrect_ring(27, 13, 5, n=3, c=(0, 35.5)))]),
         "polymer", bevel=0.6)
# magazine release (left, behind the trigger guard), slide stop (left), takedown tabs (both sides)
body.add(box_bm((7.0, 3.2, 9.0), c=(22.5, 12.6, 25)), "polymer", bevel=1.0)
body.add(prism_bm([(34, 38.5), (60, 38.5), (63, 40.8), (38, 41.2)], 12.0, 13.6, fillet=1.0, fsegs=2), "gun_steel", bevel=0.4)
body.add(box_bm((10, 2.2, 3.2), c=(40, 13.6, 42.6)), "gun_steel", bevel=0.5)
for sy in (1, -1):
    body.add(box_bm((8.0, 1.6, 3.0), c=(70, sy * 12.3, 37.8)), "gun_steel", bevel=0.4)
body.cyl((30, -12.4, 36), (30, 12.4, 36), 1.6, segs=10, mat="gun_steel")                  # trigger pin heads
body.cyl((60, -12.4, 34), (60, 12.4, 34), 1.6, segs=10, mat="gun_steel")
# locking block pin, frame rails peeking out at the rear
body.box((6, 20.5, 3.2), c=(-11, 0, 42.0), mat="gun_steel", bevel=0.4)
# barrel muzzle crown (fixed) + guide rod tip
body.lathe([(146, 0), (146, 5.4), (SX1 + 0.6, 5.4), (SX1 + 1.0, 4.9), (SX1 + 1.0, 4.4), (SX1 - 2, 4.3), (SX1 - 2, 0)], c=(0, 0, BORE_Z), segs=24, mat="gun_metal")
body.cyl((140, 0, 45.5), (SX1 + 0.2, 0, 45.5), 3.2, segs=14, mat="gun_metal")
# chamber hood (visible through the ejection port) + chambered round
body.add(box_bm((42, 18.6, 12.6), c=(47, 0, BORE_Z + 2.5)), "gun_metal", bevel=0.7)
body.cyl((26, 0, BORE_Z), (70, 0, BORE_Z), 7.2, segs=20, mat="gun_metal")
# grip bottom: magazine baseplate sits here (mag node)

# =========================================================================================== SLIDE
slide = G.part("slide", pivot=(SX0, 0, BORE_Z))
sprof = [(SX0, SZ0), (SX0, SZ1 - 1.0), (SX0 + 1.5, SZ1), (SX1 - 14, SZ1), (SX1, SZ1 - 3.0), (SX1, SZ0 + 7.0), (SX1 - 7.0, SZ0)]
sl = prism_bm(sprof, -SW / 2, SW / 2, fillet=[0.8, 1.0, 1.5, 4.0, 1.5, 2.0, 0.8], fsegs=3)
cuts = []
for sy in (1, -1):                                                                               # top chamfers along the slide
    cuts.append(box_bm((SX1 - SX0 + 20, 8, 8), c=((SX0 + SX1) / 2, sy * (SW / 2 + 1.2), SZ1 + 1.2), rot=(45, 0, 0)))
for k in range(8):                                                                               # rear serrations (vertical, both sides)
    for sy in (1, -1):
        cuts.append(box_bm((1.3, 1.6, 23.0), c=(SX0 + 4.0 + k * 3.1, sy * (SW / 2 + 0.2), SZ0 + 14.5), rot=(0, 4, 0)))
for k in range(6):                                                                               # front serrations
    for sy in (1, -1):
        cuts.append(box_bm((1.3, 1.6, 18.0), c=(SX1 - 34.0 + k * 3.1, sy * (SW / 2 + 0.2), SZ0 + 13.0), rot=(0, -4, 0)))
cuts.append(box_bm((40.0, 12.0, 17.0), c=(49.0, -6.8, SZ1 - 3.0)))                              # ejection port (right side + top)
cuts.append(box_bm((SX1 - SX0 - 20, SW - 5.0, 20), c=((SX0 + SX1) / 2 + 8, 0, SZ0 + 5.0)))      # underside channel (frame rails)
cuts.append(cyl_bm((SX1 - 20, 0, BORE_Z), (SX1 + 5, 0, BORE_Z), 5.6, segs=20))                  # muzzle bore
cuts.append(cyl_bm((SX1 - 20, 0, 45.5), (SX1 + 5, 0, 45.5), 3.6, segs=14))                      # guide rod hole
cuts.append(box_bm((5.0, 12.0, 4.5), c=(-11.5, 0, SZ1 + 0.8)))                                   # rear sight dovetail slot
cuts.append(box_bm((6.0, 3.6, 2.4), c=(SX1 - 12, 0, SZ1 + 0.4)))                                 # front sight slot
slide.add(sl, "gun_black", bevel=[(0.55, 2, None)], cut=cuts)
# rear plate (slide cover) + striker channel
slide.box((1.2, 18.0, 16.0), c=(SX0 - 0.3, 0, 55.0), mat="gun_black", bevel=0.4)
slide.cyl((SX0 - 0.8, 0, BORE_Z), (SX0 - 1.4, 0, BORE_Z), 1.8, segs=12, mat="gun_steel")
# rear sight (dovetail, U notch with white outline) + front post (white dot)
rs = prism_bm([(-15.0, SZ1 - 1.2), (-15.0, SZ1 + 5.4), (-8.5, SZ1 + 6.0), (-6.5, SZ1 - 1.2)], -6.5, 6.5, fillet=[0.4, 1.0, 1.0, 0.4], fsegs=2)
rs = bool_op(rs, [box_bm((12, 3.6, 5.0), c=(-10, 0, SZ1 + 6.5)), box_bm((12, 5.6, 1.0), c=(-10, 0, SZ1 + 6.2))])
slide.add(rs, "gun_black", bevel=0.35)
fs = prism_bm([(SX1 - 15.0, SZ1 - 1.0), (SX1 - 15.0, SZ1 + 5.2), (SX1 - 9.5, SZ1 + 5.6), (SX1 - 9.0, SZ1 - 1.0)], -1.75, 1.75, fillet=[0.3, 0.8, 0.8, 0.3], fsegs=2)
slide.add(fs, "gun_black", bevel=0.25)
# extractor (right side at the port rear) + loaded-chamber tab
slide.add(prism_bm([(20, 59), (32, 60), (34, 63), (21, 63.5)], -SW / 2 - 0.6, -SW / 2 + 0.6, fillet=0.8, fsegs=2), "gun_steel", bevel=0.25)
slide.cyl((22, -SW / 2 - 0.2, 61.2), (22, -SW / 2 - 0.9, 61.2), 1.1, segs=8, mat="gun_steel")

# =========================================================================================== TRIGGER (flat face + safety blade)
trig = G.part("trigger", pivot=(34.0, 0, 26.0))
trig.sweep([(34.5, 0, 27.5), (41.0, 0, 26.0), (45.8, 0, 21.6), (47.6, 0, 16.0), (47.0, 0, 11.5)], radius=1.0,
           profile=[(3.8, 2.6), (-3.8, 2.6), (-3.8, -2.6), (3.8, -2.6)], mat="polymer", bevel=0.6, smooth=5)
trig.add(prism_bm([(45.0, 22.5), (47.2, 18.0), (48.3, 13.2), (47.4, 13.0), (46.2, 17.6), (44.3, 21.6)], -1.2, 1.2), "gun_metal", bevel=0.2)
trig.box((16, 2.6, 3.0), c=(26, 0, 27.3), mat="gun_steel", bevel=0.5)
trig.cyl((34, -5.5, 26), (34, 5.5, 26), 1.5, segs=10, mat="gun_steel")

# =========================================================================================== MAGAZINE (polymer-over-steel, 17 rd)
magp = gp(0, 37.0)
mag = G.part("mag", pivot=magp)
ML = 37 + 84
mag.add(box_bm((31.6, 22.2, ML), c=gp(0.4, 37 - ML / 2), rot=(0, GA, 0)), "polymer", bevel=1.4)
mag.add(box_bm((27.0, 18.4, 3.0), c=gp(-0.5, 37.6), rot=(0, GA, 0)), "gun_steel", bevel=0.5)            # steel feed lips band
for sy in (1, -1):
    mag.add(box_bm((24.0, 1.8, 3.2), c=gp(-2.0, 38.0, sy * 8.4), rot=(0, GA, 0)), "gun_steel", bevel=0.4)
bp = loft_bm([(0, rrect_ring(34.0, 24.4, 6.0, n=3)), (6.5, rrect_ring(34.6, 25.0, 6.5, n=3)), (8.5, rrect_ring(33.4, 23.8, 5.8, n=3))],
             xf=Matrix.Translation(Vector(gp(0.6, -84.0))) @ Matrix.Rotation((90 + GA) * D2R, 4, "Y"))
mag.add(bp, "polymer", bevel=0.6)
for k, lz in enumerate(range(24, -76, -12)):                                                             # witness holes on the back
    mag.add(cyl_bm(gp(-16.0, lz), gp(-15.2, lz), 1.5, segs=10), "gun_metal", bevel=0)
for i, (lz, sy) in enumerate(((34.8, 2.6), (29.6, -2.9))):                                              # rounds at the lips
    h = gp(-13.5, lz, sy)
    rb = round_bms("9mm", segs=12, at=h, rot=(0, GA, 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "gun_metal", bevel=0)

# =========================================================================================== SOCKETS / DOCS
G.socket("muzzle", (158.3, 0, BORE_Z))
G.socket("eject", (38.0, -12.0, 64.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (14.0, 15.0, 4.0))
G.socket("mag_well", magp)
G.socket("sight", (-70.0, 0, 77.2))

G.motion("slide", "translate", (-1, 0, 0), 38.0, "recoil / rack: slides straight back along the bore; barrel and guide rod stay fixed. Pivot = bore axis at the rear face.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) rotates the finger blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (-math.sin(GA * D2R), 0, -math.cos(GA * D2R)), 135.0, "eject/insert along the grip axis (down and rearward, 20 deg rake). Origin = top of the magazine where it seats.")
G.remark("The chamber hood and a chambered round show through the ejection port (part of `body`). Two rounds sit in the magazine lips; witness holes on the back.")
G.remark("Hands: right palm on the backstrap / right panel around grip_R; support hand cups the left panel at grip_L. Three-dot sights (white dots are texture).")
L_ = SW / 2
G.notes["style"] = dict(
    wear=0.85, dust=0.5, rust=0.1, polymer_color=(0.02, 0.02, 0.021),
    polymer_stip=[((-60, 40), (-20, 20), (-80, 30))],
    decals=[dict(pos=(SX1 - 12.2, 0, SZ1 + 3.6), r=1.0, color=(0.85, 0.85, 0.8), mats=["gun_black"]),
            dict(pos=(-15.3, 3.6, SZ1 + 3.2), r=0.9, color=(0.85, 0.85, 0.8), mats=["gun_black"]),
            dict(pos=(-15.3, -3.6, SZ1 + 3.2), r=0.9, color=(0.85, 0.85, 0.8), mats=["gun_black"])],
    engrave=[
        dict(text="RANGER 9", pos=(70.0, L_ + 0.2, 58.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.8, depth=0.07, mats=["gun_black"]),
        dict(text="9X19", pos=(118.0, L_ + 0.2, 52.0), u=(-1, 0, 0), v=(0, 0, 1), h=3.0, depth=0.06, mats=["gun_black"]),
        dict(text="RDA 0917", pos=(55.0, -L_ - 0.2, 47.0), u=(1, 0, 0), v=(0, 0, 1), h=2.6, depth=0.06, mats=["gun_black"]),
        dict(text="9X19", pos=(48.0, 0.0, BORE_Z + 8.8), u=(0, -1, 0), v=(1, 0, 0), h=2.4, depth=0.05, mats=["gun_metal"], slab=2.0),
    ])
G.finish()
