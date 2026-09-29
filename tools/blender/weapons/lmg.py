"""RIDE OR DIE - lmg: belt-fed 7.62x51 light machine gun (M249/PKM vibes).  Units mm, G frame (+X fwd, +Y left, +Z up)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gunlib import *

G = Gun("lmg")
BZ = 90.0                                # bore axis height
SEG = 24


def edges_x(zmin, ymin, minlen=20.0, zmax=1e9):
    """bevel selector: long edges running along x near (|y|>=ymin, z in [zmin,zmax])"""
    def f(e):
        a, b = e.verts[0].co, e.verts[1].co
        return abs(a.y) >= ymin and abs(b.y) >= ymin and zmin <= a.z <= zmax and zmin <= b.z <= zmax and abs(a.x - b.x) > minlen and abs(a.z - b.z) < 0.5
    return f


def dome_bm(pos, axis, r=2.0, h=1.5, segs=6):
    p = Vector(pos); a = Vector(axis).normalized()
    bm = lathe_bm([(-0.3, r), (h * 0.55, r * 0.9), (h, 0)], segs, "z", cap=False)
    q = Vector((0, 0, 1)).rotation_difference(a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ q.to_matrix().to_4x4(), verts=bm.verts)
    return bm


def rivets(part, xs, y, z, sy, mat="gun_metal", r=2.0):
    for x in xs:
        part.add(dome_bm((x, y, z), (0, sy, 0), r=r), mat, bevel=0)


def tube_prof(x0, x1, ro, ri):
    return [(x0, ri), (x0, ro), (x1, ro), (x1, ri)]


# ==================================================================================== RECEIVER (static body)
body = G.part("body")
rp = [(-118, 50), (-118, 108), (-106, 118), (250, 118), (258, 110), (258, 66), (244, 50)]
rec = prism_bm(rp, -33.0, 33.0, fillet=[3, 3, 3, 3, 3, 2, 2], fsegs=3)
cuts = [
    box_bm((350, 52, 42), c=(62, 0, 91)),                                             # bolt cavity
    box_bm((178, 56, 14), c=(65, 0, 121)),                                            # feed-tray opening (top)
    prism_bm([(38, 84), (146, 84), (146, 110), (38, 110)], -40, -18, fillet=7, fsegs=4),  # ejection port (right)
    prism_bm([(-6, 100), (154, 100), (154, 126), (-6, 126)], 18, 40, fillet=7, fsegs=4),  # belt entry slot (left)
    box_bm((190, 12, 9), c=(45, -30, 74)),                                            # charging handle slot (right)
    box_bm((60, 60, 3), c=(215, 0, 116)),                                             # front cover seat
]
body.add(rec, "gun_black", bevel=[(2.6, 3, edges_x(100, 30, 40)), (1.0, 2, None)], cut=cuts)
# embossed ribs on receiver sides
for sy in (-1, 1):
    for zz in (66, 100):
        body.box((330, 2.4, 4.0), c=(60, sy * 33.6, zz), mat="gun_black", bevel=0.8)
# rivet rows along the top/bottom seams, boss plate around the ejection port
for sy in (-1, 1):
    rivets(body, [x for x in range(-104, 246, 15)], sy * 33.0, 55.0, sy)
    rivets(body, [x for x in range(-104, 246, 15)], sy * 33.0, 113.0, sy)
    rivets(body, [x for x in range(-104, 30, 15)] + [x for x in range(160, 246, 15)], sy * 33.0, 84.0, sy, r=1.6)
body.box((150, 1.6, 50), c=(92, -33.6, 96), mat="gun_black", bevel=0.6, cut=[prism_bm([(38, 84), (146, 84), (146, 110), (38, 110)], -40, -18, fillet=7, fsegs=4)])
for (px, pz) in ((26, 118), (158, 118), (26, 80), (158, 80)):
    body.add(hex_bolt_bm((px, -34.4, pz), (0, -1, 0), r=3.2, h=1.8), "gun_steel", bevel=0.15)
# receiver front collar (barrel nut) + rear buffer housing
body.lathe([(250, 0), (250, 32), (262, 32), (262, 26), (274, 26), (274, 0)], c=(0, 0, BZ), segs=SEG, mat="gun_metal", bevel=0.0)
body.lathe([(-160, 0), (-160, 24), (-118, 24), (-118, 0)], c=(0, 0, BZ - 2), segs=SEG, mat="gun_metal")
# feed tray floor + guides + one round waiting in the tray (axis along +x)
body.box((170, 52, 3), c=(66, 0, 112.5), mat="gun_steel", bevel=0.6)
for yy in (-19, 19):
    body.box((166, 2.5, 8), c=(66, yy, 117), mat="gun_black", bevel=0.6)
body.box((6, 46, 8), c=(148, 0, 116.5), mat="gun_black", bevel=0.8)               # tray front stop
# selector lever (right), safety button, screws
body.box((30, 4, 8), c=(-2, -35.5, 52), mat="gun_steel", bevel=0.8, rot=(0, 0, 0))
body.cyl((-10, -33, 52), (-10, -38.5, 52), 5.5, segs=16, mat="gun_metal", bevel=0.3)
for (px, pz) in ((-100, 60), (-100, 108), (230, 62), (230, 110), (20, 58), (150, 58)):
    for sy in (-1, 1):
        body.add(screw_bm((px, sy * 33.0, pz), (0, sy, 0), r=3.0, h=1.6), "gun_steel", bevel=0.0)
# ammo-box mounting rail on the left underside
body.box((150, 8, 6), c=(60, 37, 52), mat="gun_black", bevel=0.8)
body.box((150, 3, 14), c=(60, 34.5, 58), mat="gun_black", bevel=0.6)

# ---- barrel
barrel_prof = [(120, 0), (120, 11.5), (254, 11.5), (254, 12.5), (300, 12.5), (300, 11.0), (440, 11.0), (446, 10.0), (600, 10.0), (600, 0)]
body.lathe(barrel_prof, c=(0, 0, BZ), segs=SEG, mat="gun_metal", bevel=0.0)
# fluted section between 470 and 596
body.lathe([(470, 9.7), (474, 10.8), (592, 10.8), (596, 9.7), (596, 8.7), (470, 8.7)], c=(0, 0, BZ), segs=SEG, mat="gun_black", mod=lambda k: 1.0 if k % 4 in (0, 3) else 0.9)
# flash hider: slotted cylinder
fh = lathe_bm([(596, 8.6), (596, 15.5), (600, 16.5), (648, 16.5), (652, 14.5), (652, 9.4), (620, 9.4), (620, 8.6)], SEG, "x", c=(0, 0, BZ))
fh_cut = []
for k in range(3):
    b_ = box_bm((34, 4.2, 44), c=(636, 0, 0))
    bmesh.ops.transform(b_, matrix=Matrix.Translation((0, 0, BZ)) @ Matrix.Rotation(math.radians(k * 60 + 15), 4, "X"), verts=b_.verts)
    fh_cut.append(b_)
body.add(fh, "gun_black", bevel=0.5, cut=fh_cut)
body.lathe([(596, 8.7), (596, 12), (606, 12), (606, 8.7)], c=(0, 0, BZ), segs=SEG, mat="gun_steel", bevel=0.0)   # crush washer
# ---- polymer handguard (rear) and vented steel shroud (front)
hg = lathe_bm(tube_prof(258, 372, 33.0, 29.0), SEG, "x", c=(0, 0, BZ))
hg_cuts = []
for ang in (-60, 0, 60):
    for kx in range(4):
        b = box_bm((15, 7, 12), c=(278 + kx * 21, 0, 31.0))
        bmesh.ops.transform(b, matrix=Matrix.Translation((0, 0, BZ)) @ Matrix.Rotation(math.radians(ang), 4, "X"), verts=b.verts)
        hg_cuts.append(b)
body.add(hg, "polymer", bevel=0.6, cut=hg_cuts)
for gx in (296, 322, 348):
    body.lathe([(gx - 3, 33.05), (gx, 31.6), (gx + 3, 33.05)], c=(0, 0, BZ), segs=SEG, mat="rubber")
sh = lathe_bm(tube_prof(372, 452, 31.0, 28.5), SEG, "x", c=(0, 0, BZ))
sh_cuts = []
for ang in (45, -45, 135, -135):
    for kx in range(6):
        b = box_bm((7, 5, 12), c=(384 + kx * 12.5, 0, 29.5))
        bmesh.ops.transform(b, matrix=Matrix.Translation((0, 0, BZ)) @ Matrix.Rotation(math.radians(ang), 4, "X"), verts=b.verts)
        sh_cuts.append(b)
body.add(sh, "gun_black", bevel=0.0, cut=sh_cuts)
body.lathe([(370, 31.5), (372, 34.5), (376, 34.5), (378, 31.5)], c=(0, 0, BZ), segs=SEG, mat="gun_metal", bevel=0.0)
# ---- gas system: block, tube under the barrel, regulator, front sight
body.lathe([(440, 0), (440, 14), (444, 17.5), (480, 17.5), (484, 14), (484, 0)], c=(0, 0, BZ), segs=SEG, mat="gun_metal", bevel=0.0)
body.cyl((256, 0, BZ - 26.5), (470, 0, BZ - 26.5), 8.2, segs=16, mat="gun_metal", bevel=0.0)
body.cyl((452, 0, BZ - 26.5), (480, 0, BZ - 26.5), 10.5, segs=16, mat="gun_black", bevel=0.4)
body.cyl((256, 0, BZ - 16), (256, 0, BZ - 30), 6.0, segs=12, mat="gun_metal")
body.box((30, 10, 22), c=(262, 0, BZ - 18), mat="gun_metal", bevel=1.0)
# front sight: base + post + protective ears
body.box((26, 16, 9), c=(464, 0, BZ + 20), mat="gun_black", bevel=1.0)
body.prism([(457, BZ + 22), (458, BZ + 47), (462, BZ + 47), (464, BZ + 22)], -1.4, 1.4, mat="gun_black", bevel=0.4)
for sy in (-1, 1):
    body.prism([(452, BZ + 22), (452, BZ + 42), (470, BZ + 42), (476, BZ + 22)], sy * 6.0, sy * 8.6, mat="gun_black", bevel=0.5, fillet=1.2)
# carry handle folded along the right side of the barrel
ch_path = [(444, -25, BZ + 10), (438, -38, BZ + 8), (392, -40, BZ + 6), (338, -40, BZ + 6), (312, -38, BZ + 8), (306, -27, BZ + 10)]
body.sweep(ch_path, radius=5.0, mat="gun_metal", segs=10, smooth=4, bevel=0.0)
for px in (446, 302):
    body.cyl((px, -20, BZ + 10), (px, -38, BZ + 10), 6.5, segs=12, mat="gun_metal", bevel=0.4)

# ==================================================================================== STOCK / GRIP / TRIGGER GUARD
stock_prof = [(-392, 108), (-392, 8), (-340, 2), (-125, 50), (-118, 60), (-118, 112), (-200, 116), (-330, 114)]
stk = prism_bm(stock_prof, -22.0, 22.0, fillet=[9, 9, 6, 3, 3, 3, 12, 12], fsegs=5)
stk_cut = [prism_bm([(-350, 88), (-350, 26), (-330, 22), (-215, 63), (-205, 72), (-205, 100), (-215, 102), (-330, 106)], -30, 30, fillet=6, fsegs=4)]
body.add(stk, "polymer", bevel=[(5.5, 4, lambda e: abs(e.verts[0].co.y) > 20 and abs(e.verts[1].co.y) > 20), (0.8, 2, None)], cut=stk_cut)
body.box((10, 44, 100), c=(-395.5, 0, 58), mat="rubber", bevel=2.0)      # recoil pad
body.box((12, 34, 5), c=(-330, 0, 116), mat="polymer", bevel=1.0)         # comb
# pistol grip (loft along a 12 degree rake)
gA = 12.0
ca, sa = math.cos(gA * D2R), math.sin(gA * D2R)
def gp(lx, lz, y=0.0):
    return (lx * ca + lz * sa, y, -lx * sa + lz * ca)
gtop = Vector(gp(0, 56))
secs = [(0, rrect_ring(30, 36, 8, 3)), (14, rrect_ring(34, 40, 9, 3)), (60, rrect_ring(35, 41, 9, 3)), (100, rrect_ring(37, 45, 9, 3)), (118, rrect_ring(37, 44, 9, 3))]
grip = loft_bm(secs, xf=Matrix.Translation(gtop) @ Matrix.Rotation((90 + gA) * D2R, 4, "Y"))
body.add(grip, "polymer", bevel=0.9)
# trigger guard (side profile, opening cut)
tgo = [(12, 50), (12, 12), (24, -10), (96, -10), (112, 10), (114, 50)]
tgi = [(26, 52), (27, 14), (35, -1), (86, -1), (100, 13), (100, 52)]
body.prism(tgo, -7.5, 7.5, mat="gun_black", bevel=[(1.4, 3, None)], fillet=[0, 3, 5, 5, 4, 0], fsegs=4, cut=[prism_bm(tgi, -12, 12, fillet=[0, 3, 3, 3, 3, 0], fsegs=3)])
body.box((70, 18, 6), c=(66, 0, 50), mat="gun_black", bevel=0.8)
# grip finger grooves
for k in range(3):
    body.add(cyl_bm(gp(21.5, 34 - k * 19, -20), gp(21.5, 34 - k * 19, 20), 4.6, segs=14), "polymer", bevel=0.0, op="DIFFERENCE", cut=None) if False else None
# trigger housing pins
for px in (44, 88):
    for sy in (-1, 1):
        body.cyl((px, sy * 32.6, 48), (px, sy * 34.4, 48), 2.8, segs=12, mat="gun_steel", bevel=0.2)

# ==================================================================================== TRIGGER
trig = G.part("trigger", pivot=(58.0, 0, 46.0))
tp = [(58, 0, 45), (63, 0, 32), (63.5, 0, 18), (59, 0, 6)]
trig.sweep(tp, radius=1.0, profile=[(2.6, 5.2), (-2.6, 5.2), (-2.6, -5.2), (2.6, -5.2)], mat="gun_black", bevel=0.7, smooth=5)
trig.cyl((58, -8, 46), (58, 8, 46), 2.2, segs=10, mat="gun_steel")

# ==================================================================================== FEED COVER (hinged at the rear, pivot = hinge axis)
fc = G.part("feed_cover", pivot=(-20.0, 0, 129.0))
cp = [(-20, 116), (-20, 130), (-12, 138), (138, 138), (152, 133), (156, 122), (156, 116)]
cov = prism_bm(cp, -33.0, 33.0, fillet=[2, 4, 4, 5, 5, 2, 1], fsegs=3)
cov_cut = [box_bm((166, 56, 20), c=(68, 0, 119.5)), box_bm((70, 12, 14), c=(75, 0, 137))]
fc.add(cov, "gun_black", bevel=[(2.0, 3, edges_x(130, 30, 40)), (0.8, 2, None)], cut=cov_cut)
# hinge knuckles
for yy in (-26, 26):
    fc.cyl((-20, yy - 6, 129), (-20, yy + 6, 129), 5.6, segs=16, mat="gun_metal", bevel=0.0)
# top Picatinny rail (short) + rear sight assembly
fc.add(rail_bm(2, 142, 137.0, width=21.2, height=5.2), "gun_black", bevel=0.35)
fc.box((16, 26, 5), c=(-10, 0, 141), mat="gun_black", bevel=0.8)
fc.prism([(-14, 143), (-14, 152), (-8, 156), (-4, 156), (-2, 143)], -5.5, 5.5, mat="gun_black", bevel=0.5)
fc.box((3, 3.2, 8), c=(-8.5, 0, 153), mat="gun_black", bevel=0.2)    # notch shadow block
fc.cyl((-9, 8.5, 149), (-9, 14, 149), 3.2, segs=16, mat="gun_steel", bevel=0.3)   # windage knob
# front latch tab + grip ribs
fc.box((14, 30, 4), c=(153, 0, 128), mat="gun_metal", bevel=0.8)
for k in range(5):
    fc.box((1.4, 60, 1.0), c=(70 + k * 10, 0, 138.4), mat="gun_black", bevel=0.2)

# ==================================================================================== BOLT (open bolt, at the rear when cocked) + CHARGING HANDLE
bolt = G.part("bolt", pivot=(75.0, 0, 84.0))
bolt.box((136, 34, 24), c=(8, 0, 88), mat="gun_steel", bevel=1.6)
bolt.box((110, 20, 10), c=(14, 0, 103), mat="gun_black", bevel=1.2)
bolt.cyl((75, 0, 90), (98, 0, 90), 8.0, segs=16, mat="gun_steel", bevel=0.0)
bolt.box((30, 10, 30), c=(-38, 0, 92), mat="gun_black", bevel=1.0)
bolt.lathe([(72, 3.0), (78, 3.0), (78, 0)], c=(0, 0, 90), segs=10, mat="gun_metal")
bolt.box((3, 22, 2.2), c=(20, -16.8, 88), mat="gun_metal", bevel=0.3)
G.part("charging_handle", pivot=(40.0, -31.0, 76.0))
ch = G.parts["charging_handle"]
ch.box((14, 8, 10), c=(40, -30, 76), mat="gun_steel", bevel=1.0)
ch.box((8, 16, 8), c=(40, -41, 76), mat="gun_black", bevel=1.2)
ch.cyl((40, -41, 76), (40, -58, 76), 5.2, segs=16, mat="gun_black", bevel=0.4, mod=lambda k: 1.0 if k % 2 else 0.92)
ch.sphere(7.0, c=(40, -60, 76), scale=(1, 0.8, 1), mat="gun_black")

# ==================================================================================== AMMO BOX  (`mag`)  hanging on the left
MX, MY, MZ = 56.0, 84.0, 58.0              # seat point: top centre of the box
mag = G.part("mag", pivot=(MX, MY, MZ))
bx = box_bm((178, 96, 146), c=(MX, MY, MZ - 73))
mag.add(bx, "polymer", bevel=[(4.0, 3, None)], cut=[box_bm((60, 30, 5), c=(MX, MY - 24, MZ)), box_bm((150, 3, 34), c=(MX, MY + 46.5, MZ - 56)), box_bm((150, 3, 34), c=(MX, MY - 46.5, MZ - 56))])
mag.box((182, 100, 6), c=(MX, MY, MZ - 148), mat="rubber", bevel=2.0)                    # base bumper
mag.box((170, 90, 8), c=(MX, MY, MZ + 2), mat="polymer", bevel=2.0, cut=[box_bm((60, 30, 14), c=(MX, MY - 24, MZ + 2))])   # lid
mag.box((20, 30, 6), c=(MX, MY + 48, MZ + 4), mat="gun_metal", bevel=1.0)
for xx in (-20, 132):                                                                     # latches
    mag.box((14, 9, 34), c=(xx, MY + 52, MZ - 28), mat="gun_metal", bevel=1.2)
    mag.box((10, 6, 14), c=(xx, MY + 56, MZ - 12), mat="gun_black", bevel=1.0)
mag.box((70, 16, 18), c=(MX, MY + 52, MZ - 4), mat="polymer", bevel=2.2)                  # carry handle base
mag.sweep([(MX - 34, MY + 50, MZ + 4), (MX - 34, MY + 62, MZ + 12), (MX + 34, MY + 62, MZ + 12), (MX + 34, MY + 50, MZ + 4)], radius=4.5, segs=10, mat="gun_metal", smooth=4)
mag.box((92, 18, 26), c=(MX, MY - 43, MZ - 12), mat="gun_metal", bevel=1.5)                # rail hook block
mag.box((10, 60, 12), c=(MX - 82, MY, MZ - 130), mat="gun_black", bevel=1.0)
mag.box((10, 60, 12), c=(MX + 82, MY, MZ - 130), mat="gun_black", bevel=1.0)
for kx in range(6):                                                                        # embossed ribs
    mag.box((3, 2, 90), c=(MX - 60 + kx * 24, MY + 48.4, MZ - 76), mat="polymer", bevel=0.6)

# ==================================================================================== BELT  (rounds lie along +x, chain hangs from the tray into the box)
belt = G.part("belt", pivot=(56.0, 8.0, 124.0))
BX = 56.0                                                      # x of the round centres
chain = [(-6, 120), (8, 120), (22, 120), (36, 118.5), (46, 113), (53, 105), (57, 95), (60, 84), (61, 72), (62, 62)]
# resample the chain at 14 mm pitch
pts = [Vector((BX, y, z)) for y, z in chain]
path = catmull(pts, 8)
res = [path[0]]
acc = 0.0
for i in range(1, len(path)):
    d = (path[i] - res[-1]).length
    if d >= 14.0:
        res.append(path[i])
tang = []
for i, p in enumerate(res):
    a = res[max(i - 1, 0)]; b = res[min(i + 1, len(res) - 1)]
    tang.append((b - a).normalized())
for i, p in enumerate(res):
    # cartridge axis along +x, oriented about x by the chain tangent (roll of the link)
    roll = math.degrees(math.atan2(tang[i].z, tang[i].y))
    rb = round_bms("762x51", segs=10, at=(0, 0, 0), rot=(0, 0, 0))
    M = Matrix.Translation((BX - 46.0, p.y, p.z)) @ Matrix.Rotation(math.radians(roll), 4, "X")
    for k in ("case", "bullet"):
        bmesh.ops.transform(rb[k], matrix=M, verts=rb[k].verts)
        belt.add(rb[k], "brass", bevel=0)
    # steel link (two loops around the case and one around the bullet base)
    for xl, wl, hl in ((BX - 46.0 + 24.0, 5.5, 8.6), (BX - 46.0 + 40.0, 5.5, 8.0)):
        lk = box_bm((6.0, 14.0, 13.0), c=(0, 0, 0))
        bmesh.ops.transform(lk, matrix=Matrix.Translation((xl, p.y, p.z)) @ Matrix.Rotation(math.radians(roll), 4, "X"), verts=lk.verts)
        belt.add(lk, "gun_steel", bevel=1.0)

# ==================================================================================== BIPOD (folded forward; pivot at the hinge)
bp = G.part("bipod", pivot=(454.0, 0, BZ - 42.0))
bp.box((32, 46, 12), c=(462, 0, BZ - 37), mat="gun_black", bevel=1.5)
bp.cyl((454, -30, BZ - 42), (454, 30, BZ - 42), 5.0, segs=14, mat="gun_metal", bevel=0.0)
for sy in (-1, 1):
    bp.cyl((458, sy * 26, BZ - 42), (640, sy * 26, BZ - 42), 5.2, segs=12, mat="gun_metal", bevel=0.0)
    bp.cyl((550, sy * 26, BZ - 42), (632, sy * 26, BZ - 42), 6.4, segs=12, mat="gun_black", bevel=0.4)
    bp.sphere(7.6, c=(640, sy * 26, BZ - 42), scale=(1.5, 1, 1), mat="rubber", usegs=14, vsegs=8)
bp.box((22, 62, 6), c=(480, 0, BZ - 48), mat="gun_metal", bevel=1.0)

# ==================================================================================== SOCKETS + notes
G.socket("muzzle", (652.0, 0, BZ))
G.socket("eject", (92.0, -33.0, 98.0), rot=(0, 0, 180))
G.socket("grip_R", (0, 0, 0))
G.socket("grip_L", (312.0, 0, BZ - 22.0))
G.socket("mag_well", (MX, MY, MZ))
G.socket("sight", (-170.0, 0, 146.0))
G.socket("stock", (-402.0, 0, 58.0))

G.motion("feed_cover", "rotate", (0, 1, 0), -72.0, "opens: rotate -72 deg about the node's +X (glTF) = front of the cover lifts. Pivot = rear hinge pin. Reveals tray, bolt and a round.")
G.motion("bolt", "translate", (1, 0, 0), 90.0, "open-bolt: rests cocked at the rear; on each shot it runs forward 90 mm and returns. Charging handle rides with it.")
G.motion("charging_handle", "translate", (-1, 0, 0), 0.0, "rides the bolt: use the same +/-90 mm travel as `bolt` when charging (handle slot on the right side).")
G.motion("trigger", "rotate", (0, 1, 0), 14.0, "pull: +14 deg about the node's +X (glTF) swings the blade rearward. Pivot = trigger pin.")
G.motion("mag", "translate", (0, 0.5, -1), 120.0, "ammo box: unhooks down-and-outwards (+Y left / -Z) about 120 mm. Origin = top centre of the box at the belt entry.")
G.motion("belt", "translate", (0, 1, 0), 14.0, "feed step: belt advances one round (14 mm pitch) along its chain (into the tray, -Y direction); cosmetic. Origin at the tray entry.")
G.motion("bipod", "rotate", (0, 1, 0), 70.0, "modelled FOLDED forward along the barrel; deploy = +70 deg about the node's +X (glTF): legs swing down and slightly forward. Pivot = hinge pin under the gas block.")
G.remark("Two-hand hold: right hand grip_R on the pistol grip; left hand grip_L on the polymer handguard (or bipod when deployed).")
G.remark("Reload: open feed_cover (-72 deg), drop `mag` box down/left, snap the new box to mag_well, drop the belt end on the tray, close the cover, pull the charging handle.")
G.remark("`eject`: spent cases and links leave to the right (its +X = ejection direction).")
G.finish()
