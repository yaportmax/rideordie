"""RIDE OR DIE - pistol: 9mm striker-fired semi-auto (Glock/M9 vibes).  Units mm, G frame (+X fwd, +Y left, +Z up)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *

G = Gun("pistol")
GA = 20.0                       # grip rake (bottom rearward)
_c, _s = math.cos(GA * D2R), math.sin(GA * D2R)


def gp(lx, lz, y=0.0):
    """grip-local (lx forward-ish, lz along grip axis up) -> gun frame."""
    return (lx * _c + lz * _s, y, -lx * _s + lz * _c)


def gv(lx, lz, y=0.0):
    return Vector(gp(lx, lz, y))


BORE_Z = 58.0
SLIDE_X0, SLIDE_X1 = -20.0, 156.0
SLIDE_Z0, SLIDE_Z1 = 39.0, 71.0

# ================================================================== FRAME (polymer)
body = G.part("body")

top = gv(0, 38)
def gring(w, h, r=9.5):
    return rrect_ring(w, h, r, n=3)
secs = [(0, gring(27, 38)), (8, gring(29, 41)), (26, gring(30, 42)), (80, gring(30.5, 43)), (98, gring(31, 45, 10)), (108, gring(32.5, 47, 10))]
grip = loft_bm(secs, cap=True, xf=Matrix.Translation(top) @ Matrix.Rotation(110 * D2R, 4, "Y"))

fp = [(-18, 40.0), (138, 40.0), (138, 28.5), (74.5, 28.5), (72.5, 15.0), (68.5, 10.5), (30.0, 10.5), (23.5, 14.0),
      (8, 24), (-8, 31), (-17.5, 35.5)]
fr = [0.6, 0.6, 1.0, 1.5, 3.0, 3.0, 3.0, 3.0, 0, 0, 1.5]
upper = prism_bm(fp, -13.0, 13.0, fillet=fr, fsegs=4)
frame = bool_op(upper, [grip], "UNION")

cutters = []
# trigger-guard opening
cutters.append(prism_bm([(30.5, 17.5), (64.0, 17.5), (66.0, 29.5), (32.5, 29.5)], -20, 20, fillet=[2.0, 2.0, 0, 0], fsegs=3))
# finger grooves (front strap)
for lz in (3.0, -15.5, -34.0):
    cutters.append(cyl_bm(gp(24.6, lz, -20), gp(24.6, lz, 20), 6.4, segs=20))
# magazine well
cutters.append(box_bm((33.8, 23.8, 122), c=gp(0, -25), rot=(0, GA, 0)))
# dust cover cross slots
for x in (94, 114):
    cutters.append(box_bm((3.4, 40, 5.5), c=(x, 0, 28.5)))
# slide-rail relief notches under the beavertail (rear)
cutters.append(box_bm((14, 40, 3.0), c=(-11.5, 0, 40.9)))
body.add(frame, "polymer", bevel=[(1.4, 3, lambda e: abs(e.verts[0].co.y) > 12 and abs(e.verts[1].co.y) > 12 and abs(e.verts[0].co.z - e.verts[1].co.z) + abs(e.verts[0].co.x - e.verts[1].co.x) > 3), (0.7, 2, None)],
         cut=cutters)

# frame details: trigger pins, lanyard eyelet, slide stop lever, takedown lever, mag release
for (px, pz) in ((34.0, 26.0), (53.0, 31.0), (8.0, 33.0)):
    for sy in (13.05, -13.05):
        body.cyl((px, sy - (0.4 if sy > 0 else -0.4), pz), (px, sy + (0.45 if sy > 0 else -0.45), pz), 1.7, segs=10, mat="gun_steel", bevel=0.15, angle=20)
body.prism([(6.5, 34.2), (9.5, 37.3), (28.0, 37.6), (40.5, 34.5), (44.0, 33.6), (44.0, 32.0), (30.0, 32.2), (8.5, 32.4)], 12.9, 15.3, mat="gun_metal", bevel=0.4, fillet=0.8, fsegs=3)
body.prism([(6.5, 34.2), (9.5, 37.3), (28.0, 37.6), (40.5, 34.5), (44.0, 33.6), (44.0, 32.0), (30.0, 32.2), (8.5, 32.4)], -13.0, -14.6, mat="gun_metal", bevel=0.3, fillet=0.8, fsegs=3) if False else None
body.prism([(46, 31.8), (49, 34.4), (60, 34.4), (62, 31.6), (60, 30.0), (48, 30.0)], 12.9, 14.9, mat="gun_metal", bevel=0.4, fillet=0.7, fsegs=3)
body.cyl((18.5, 13.0, 15.6), (18.5, 17.6, 15.6), 4.3, mat="gun_metal", bevel=0.35, segs=20)
body.cyl((18.5, 17.6, 15.6), (18.5, 17.0, 15.6), 3.2, mat="gun_metal", segs=16)

# ================================================================== BARREL group (static, in body)
# hood with ejection slot
hood = box_bm((44, 15.0, 15.2), c=(40.0, 0, BORE_Z))
body.add(hood, "gun_metal", bevel=1.2, cut=[box_bm((22, 9.2, 8), c=(38, 0, BORE_Z + 7.5)), box_bm((14, 1.2, 4), c=(30, 0, 66))])
# round barrel
bp = [(60, 7.3), (108, 7.3), (150, 7.3), (156.6, 7.3), (157.8, 6.9), (158.3, 6.4), (158.3, 4.6), (146, 4.6), (146, 0.0)]
body.lathe(bp, c=(0, 0, BORE_Z), segs=32, mat="gun_metal", bevel=0.0)
# barrel locking lug block + feed ramp
body.box((16, 13.6, 6), c=(56, 0, BORE_Z - 8.5), mat="gun_metal", bevel=0.8)
# guide rod + recoil spring
body.cyl((62, 0, 46.0), (149.5, 0, 46.0), 3.0, segs=12, mat="gun_steel", bevel=0.0)
coil = [(64.0, 0.0)]
xx = 64.0
while xx < 148:
    coil += [(xx, 4.5), (xx + 1.8, 4.5), (xx + 2.4, 3.5), (xx + 3.6, 3.5)]
    xx += 4.5
coil += [(xx, 3.5), (xx, 0)]
body.lathe(coil, c=(0, 0, 46.0), segs=12, mat="gun_steel", bevel=0.0)
# chambered cartridge case visible through the ejection slot
rb = round_bms("9mm", segs=16, at=(26.0, 0, BORE_Z))
body.add(rb["case"], "brass", bevel=0)
body.add(rb["primer"], "gun_steel", bevel=0)

# ================================================================== SLIDE (moving part, pivot on the bore axis at the rear face)
slide = G.part("slide", pivot=(SLIDE_X0, 0, BORE_Z))
sp = [(SLIDE_X0, SLIDE_Z0), (SLIDE_X0, 67.0), (SLIDE_X0 + 3.0, SLIDE_Z1), (134.0, SLIDE_Z1), (SLIDE_X1, 66.8), (SLIDE_X1, SLIDE_Z0)]
outer = prism_bm(sp, -12.75, 12.75)
cuts = []
cuts.append(box_bm((SLIDE_X1 - 6 - (SLIDE_X0 + 8), 19.8, 30), c=((SLIDE_X0 + 8 + SLIDE_X1 - 6) / 2, 0, 39.0 - 15 + 28.0)))  # interior cavity, roof at z=67
cuts.append(prism_bm([(16, 53.0), (66, 53.0), (62.0, 74), (19.5, 74)], -14.5, 3.0))  # ejection port
cuts.append(cyl_bm((140, 0, BORE_Z), (160, 0, BORE_Z), 7.9, segs=32))                # muzzle hole
cuts.append(cyl_bm((140, 0, 46.0), (160, 0, 46.0), 4.6, segs=16))                    # guide rod hole
for k in range(6):
    xk = -16.6 + k * 3.0
    for sy in (12.75, -12.75):
        cuts.append(box_bm((1.5, 3.0, 25), c=(xk, sy, 54.5), rot=(0, 12, 0)))
for k in range(5):
    xk = 119.0 + k * 3.0
    for sy in (12.75, -12.75):
        cuts.append(box_bm((1.5, 3.0, 25), c=(xk, sy, 54.5), rot=(0, 12, 0)))
# scallop cuts at the rear top for the sight dovetail
cuts.append(box_bm((13, 11.4, 1.6), c=(-9.5, 0, SLIDE_Z1 - 0.2)))


def _top_long(e):
    a, b = e.verts[0].co, e.verts[1].co
    return a.z > 70 and b.z > 70 and abs(a.y) > 12.4 and abs(b.y) > 12.4 and abs(a.x - b.x) > 6


def _vert_front(e):
    a, b = e.verts[0].co, e.verts[1].co
    return abs(a.y) > 12.4 and abs(b.y) > 12.4 and abs(a.x - b.x) < 0.2 and abs(a.z - b.z) > 6


slide.add(outer, "gun_black", bevel=[(2.6, 4, _top_long), (1.6, 3, _vert_front), (0.55, 2, None)], cut=cuts)
# rear sight (dovetail block with U notch) and front sight
rear_sight = prism_bm([(-15.0, SLIDE_Z1 - 0.8), (-15.0, 76.8), (-6.0, 77.2), (-4.6, SLIDE_Z1 - 0.8)], -5.6, 5.6)
slide.add(rear_sight, "gun_black", bevel=0.5, cut=[box_bm((14, 3.4, 4.2), c=(-10, 0, 77.2))])
for sy in (-3.6, 3.6):
    slide.cyl((-15.0, sy, 74.6), (-15.35, sy, 74.6), 1.15, segs=12, mat="gun_steel", bevel=0.0)
fs = prism_bm([(139.5, 68.2), (141.0, 76.6), (146.2, 76.6), (149.5, 67.4)], -1.9, 1.9)
slide.add(fs, "gun_black", bevel=0.45)
slide.box((11, 5.6, 2.2), c=(145, 0, 68.6), mat="gun_black", bevel=0.4)
slide.cyl((141.0, 0, 74.2), (140.6, 0, 74.2), 1.1, segs=12, mat="gun_steel", bevel=0.0)
# extractor (right side of chamber) + loaded-chamber indicator
slide.prism([(36, 57.0), (64, 57.0), (66.5, 61.0), (64, 68.0), (36, 68.0)], -10.9, -9.2, mat="gun_steel", bevel=0.35, fillet=0.6, fsegs=2)
slide.box((5, 1.8, 2.6), c=(65.6, -9.4, 61.5), mat="gun_steel", bevel=0.3)
# screws / rivets on slide sides
# rear face: firing pin retaining plate
slide.box((0.8, 12.5, 8.0), c=(SLIDE_X0 - 0.35, 0, 60.5), mat="gun_steel", bevel=0.3)
slide.cyl((SLIDE_X0 - 0.5, 0, 60.5), (SLIDE_X0 - 0.9, 0, 60.5), 1.2, segs=12, mat="gun_metal")
# underside: slide rails (inner lip)
for sy in (-1, 1):
    slide.box((SLIDE_X1 - SLIDE_X0 - 30, 1.6, 2.0), c=((SLIDE_X0 + SLIDE_X1) / 2 - 2, sy * 10.4, 40.2), mat="gun_black", bevel=0.3)

# ================================================================== TRIGGER
trig = G.part("trigger", pivot=(34.0, 0, 26.0))
tpath = [(34.5, 0, 27.5), (41.5, 0, 26.2), (47.0, 0, 21.8), (49.6, 0, 16.5), (49.2, 0, 11.6)]
trig.sweep(tpath, radius=1.0, profile=[(3.9, 2.7), (-3.9, 2.7), (-3.9, -2.7), (3.9, -2.7)], mat="polymer", bevel=0.7, smooth=5)
trig.sweep([(41.5, 0, 26.2), (47.0, 0, 21.8), (49.6, 0, 16.5), (49.0, 0, 13.2)], radius=1.0, profile=[(1.7, 3.6), (-1.7, 3.6), (-1.7, -1.0), (1.7, -1.0)], mat="gun_metal", bevel=0.35, smooth=5)
trig.box((18, 3.0, 3.2), c=(26, 0, 27.0), mat="gun_steel", bevel=0.5)
trig.cyl((34, -5.5, 26), (34, 5.5, 26), 1.5, segs=10, mat="gun_steel")

# ================================================================== MAGAZINE
magp = gp(0, 37.0)
mag = G.part("mag", pivot=magp)
mag_len = 37 + 78
mag_body = box_bm((33.0, 22.8, mag_len), c=gp(0, 37 - mag_len / 2), rot=(0, GA, 0))
inner = box_bm((30.8, 20.4, mag_len - 2.0), c=gp(0, 37 - (mag_len - 2.0) / 2 + 2.0), rot=(0, GA, 0))
wcuts = [inner]
for lz in (12, -4, -20, -36, -52, -68):
    for sy in (11.4, -11.4):
        wcuts.append(box_bm((9.5, 5.0, 4.6), c=gp(-3.0, lz, sy), rot=(0, GA, 0)))
mag.add(mag_body, "gun_black", bevel=0.7, cut=wcuts)
# baseplate
mag.box((34.6, 24.6, 7.0), c=gp(0, -80.5), rot=(0, GA, 0), mat="polymer", bevel=1.2)
mag.box((33.0, 22.0, 1.4), c=gp(0, -76.4), rot=(0, GA, 0), mat="gun_steel", bevel=0.3)
# feed lips
for sy in (-1, 1):
    mag.box((27.5, 2.4, 3.4), c=gp(-1.5, 35.8, sy * 8.9), rot=(0, GA, 0), mat="gun_black", bevel=0.4)
# follower spring stack (visible through windows) + rounds
rounds_z = 32.6
for i in range(11):
    lz = rounds_z - i * 6.3
    sy = 4.7 if i % 2 == 0 else -4.7
    h = gp(-15.0, lz, sy)
    rb = round_bms("9mm", segs=10, at=h, rot=(0, GA, 0), primer=False)
    mag.add(rb["case"], "brass", bevel=0)
    mag.add(rb["bullet"], "brass", bevel=0)
# remaining stack: dark core seen through the lower windows
mag.box((29.5, 19.0, 40), c=gp(0, -47), rot=(0, GA, 0), mat="gun_metal", bevel=0.3)

# ================================================================== SOCKETS
G.socket("muzzle", (158.3, 0, BORE_Z))
G.socket("eject", (38.0, -12.0, 64.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (14.0, 15.0, 4.0))
G.socket("mag_well", magp)
G.socket("sight", (-70.0, 0, 77.2))

# ---- documentation of motion + look hooks
G.motion("slide", "translate", (-1, 0, 0), 38.0, "recoil / rack: slides straight back along the bore; barrel and guide rod stay fixed. Pivot = bore axis at the rear face.")
G.motion("trigger", "rotate", (0, 1, 0), 12.0, "pull: +12 deg about the node's +X (glTF) rotates the finger blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (-math.sin(GA * D2R), 0, -math.cos(GA * D2R)), 135.0, "eject/insert along the grip axis (down and rearward, 20 deg rake). Origin = top of the magazine where it seats.")
G.remark("Rounds are visible in the mag windows and the chambered round shows through the ejection port. Chambered case is part of `body`.")
G.remark("Hands: right palm on the backstrap/right panel around grip_R; support hand cups the left panel at grip_L with the index finger along the trigger guard.")
G.notes["style"] = dict(
    polymer_stip=[((-52, 34), (-16, 16), (-75, 32))],
    grooves=[dict(axis="z", at=43.0, width=0.5, depth=0.2, box=((-14, 150), (None, None), (None, None)), mats=["gun_black"]),
             dict(axis="x", at=126.0, width=0.5, depth=0.2, box=((None, None), (None, None), (40, 66)), mats=["gun_black"])],
    decals=[dict(pos=(141.0, 0, 74.2), r=1.25, color=(0.55, 0.56, 0.5), mats=["gun_steel"]),
            dict(pos=(-15.4, 3.6, 74.6), r=1.3, color=(0.55, 0.56, 0.5), mats=["gun_steel"]),
            dict(pos=(-15.4, -3.6, 74.6), r=1.3, color=(0.55, 0.56, 0.5), mats=["gun_steel"])],
)
G.finish()
