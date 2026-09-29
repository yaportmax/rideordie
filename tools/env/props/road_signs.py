"""Road furniture: sign_speed, sign_warning, sign_exit, sign_gas, billboard, mile_marker.
   READABLE FACE = +Y in Blender = -Z in glTF (toward oncoming traffic when the road runs +Z).
   blender -b --factory-startup -P tools/env/props/road_signs.py -- [name ...]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *

FACE_NOTE = "readable face points to -Z in glTF (toward oncoming traffic when the road runs +Z); rotate 180 deg about Y for the other direction."


def face_mat(name, rough=0.62, metal=0.05):
    return pmat(name, albedo_file=os.path.join(PTEX, name + ".jpg"), rough=rough, metal=metal)


def lean_all(mb, euler_deg, pivot=(0, 0, 0)):
    M = rot_about(pivot, euler_deg)
    for (m, bm) in mb.bms.values():
        bmesh.ops.transform(bm, matrix=M, verts=list(bm.verts))


def sign_speed():
    new_scene(); M = std()
    G = M["galv"]
    F = face_mat("sign_speed")
    mb = MB()
    mb.box(G, (0, -0.045, 1.30), (0.06, 0.04, 2.6), bevel=0.004)                       # post
    for z in (1.72, 2.30):                                                             # clamps + bolts
        mb.box(G, (0, -0.02, z), (0.10, 0.012, 0.045), bevel=0.003)
        hexbolt(mb, G, (0, 0.026, z), (0, 1, 0), 0.008, 0.008)
    plate(mb, F, G, (0, 0.0, 2.0), 0.76, 0.95, thick=0.012, seg=(12, 14), amp=0.004, dents=4, dent_depth=0.022, dent_r=0.10, corner_r=0.05, seed=5,
          rot=(0, -4, 0), fold=(1, -1, 0.5, 0.06))
    lean_all(mb, (2.5, 0, 3.0))
    finish("sign_speed", mb, "furniture", ao=dict(samples=16, dist=0.3, strength=0.6), post=lambda o: grime_vc(o, 21, dirt=0.4, ground=0.4, ground_h=0.5),
           notes="US-style speed limit 65 plate 0.76 x 0.95 m on a 2.6 m post, dented/bent, bullet holes + rust in the texture. " + FACE_NOTE)


def sign_warning():
    new_scene(); M = std()
    G = M["galv"]
    F = face_mat("sign_warning")
    mb = MB()
    mb.box(G, (0, -0.045, 1.30), (0.06, 0.04, 2.6), bevel=0.004)
    for z in (1.70, 2.30):
        mb.box(G, (0, -0.02, z), (0.10, 0.012, 0.045), bevel=0.003)
        hexbolt(mb, G, (0, 0.026, z), (0, 1, 0), 0.008, 0.008)
    plate(mb, F, G, (0, 0.0, 2.0), 0.76, 0.95, thick=0.012, seg=(12, 14), amp=0.004, dents=3, dent_depth=0.02, dent_r=0.12, corner_r=0.05, seed=9,
          rot=(0, 6, 0), fold=(-1, 1, 0.55, 0.07))
    lean_all(mb, (-2.0, 1.5, 0), (0, 0, 0))
    finish("sign_warning", mb, "furniture", ao=dict(samples=16, dist=0.3, strength=0.6), post=lambda o: grime_vc(o, 23, dirt=0.4, ground=0.4, ground_h=0.5),
           notes="Chevron / curve-arrow warning plate 0.76 x 0.95 m (arrow points to the viewer's right) on a 2.6 m post, drooping and bent. " + FACE_NOTE)


def sign_exit():
    new_scene(); M = std()
    G = M["galv"]
    F = face_mat("sign_exit")
    mb = MB()
    pf = ibeam_profile(0.10, 0.16, 0.009, 0.007)
    for x in (-1.4, 1.4):
        beam(mb, G, pf, (x, -0.16, 0.0), (x, -0.16, 4.7))
        mb.box(G, (x, -0.16, 0.05), (0.30, 0.30, 0.10), bevel=0.005)                       # base plate
    for z in (2.55, 4.15):                                                              # horizontal channels behind the plate
        beam(mb, G, channel_profile(0.06, 0.09, 0.006, 0.006), (-1.9, -0.06, z), (1.9, -0.06, z), roll=90)
    for x in (-1.4, 1.4):
        for z in (2.55, 4.15):
            hexbolt(mb, G, (x, -0.075, z), (0, 1, 0), 0.012, 0.010)
    plate(mb, F, G, (0, 0.0, 3.35), 4.0, 2.0, thick=0.02, seg=(22, 11), amp=0.008, dents=5, dent_depth=0.05, dent_r=0.16, corner_r=0.08, seed=12,
          fold=(1, 1, 0.62, 0.22))
    for x in (-0.9, 0.9):                                                               # lamp arms on top
        mb.tube(G, [Vector((x, -0.08, 4.36)), Vector((x, 0.05, 4.62)), Vector((x, 0.45, 4.72)), Vector((x, 0.62, 4.64))], 0.018, seg=6)
        mb.box(G, (x, 0.65, 4.60), (0.32, 0.16, 0.10), bevel=0.01)
    lean_all(mb, (0, 0, 0.8), (0, 0, 0))
    finish("sign_exit", mb, "furniture", ao=dict(samples=12, dist=0.5, strength=0.6), post=lambda o: grime_vc(o, 25, dirt=0.4, ground=0.4, ground_h=0.8),
           notes="Big green highway EXIT sign 4.0 x 2.0 m on two I-beam posts (plate bottom 2.35 m, top 4.35 m), lamp arms, folded corner. " + FACE_NOTE)


def sign_gas():
    new_scene(); M = std()
    G, C, R = M["galv"], M["concrete"], M["rust"]
    Fc = face_mat("sign_gas_cabinet")
    Fp = face_mat("sign_gas_prices")
    mb = MB()
    mb.cyl(C, Vector((0, 0, 0.0)), Vector((0, 0, 0.30)), 0.42, 0.40, seg=12)             # pier
    mb.cyl(G, Vector((0, 0, 0.30)), Vector((0, 0, 0.34)), 0.34, 0.34, seg=12)            # base plate
    for k in range(6):
        a = k * math.pi / 3
        mb.cyl(G, Vector((0.28 * math.cos(a), 0.28 * math.sin(a), 0.34)), Vector((0.28 * math.cos(a), 0.28 * math.sin(a), 0.39)), 0.02, 0.018, seg=6)
    mb.cyl(G, Vector((0, 0, 0.34)), Vector((0, 0, 8.55)), 0.21, 0.16, seg=12, rings=4)   # pole
    zc = 7.75                                                                            # cabinet
    mb.box(R, (0, 0.0, zc), (3.16, 0.27, 1.5), bevel=0.01)
    for (cx, cz, sx, sz) in ((0, zc + 0.80, 3.30, 0.10), (0, zc - 0.80, 3.30, 0.10), (-1.63, zc, 0.10, 1.66), (1.63, zc, 0.10, 1.66)):
        mb.box(G, (cx, 0, cz), (sx, 0.34, sz), bevel=0.008)
    plate(mb, Fc, G, (0, 0.155, zc), 3.16, 1.5, thick=0.02, seg=(14, 8), amp=0.006, dents=4, dent_depth=0.04, dent_r=0.2, corner_r=0.05, seed=31)
    plate(mb, Fc, G, (0, -0.155, zc), 3.16, 1.5, thick=0.02, seg=(14, 8), amp=0.006, dents=3, dent_depth=0.04, dent_r=0.2, corner_r=0.05, seed=32, rot=(0, 0, 180))
    # price board hanging under the right half of the cabinet by chains, tilted (left chain broke)
    zb, xb = 5.95, 1.0
    rotb = (0, -9, 0)
    mb.box(R, (xb, 0.0, zb), (1.36, 0.10, 1.36), bevel=0.008)
    plate(mb, Fp, G, (xb, 0.07, zb), 1.4, 1.4, thick=0.018, seg=(8, 8), amp=0.006, dents=3, dent_depth=0.03, dent_r=0.15, corner_r=0.05, seed=33, rot=rotb)
    plate(mb, Fp, G, (xb, -0.07, zb), 1.4, 1.4, thick=0.018, seg=(8, 8), amp=0.006, dents=3, dent_depth=0.03, dent_r=0.15, corner_r=0.05, seed=34, rot=(0, -9, 180))
    for (x0, z0) in ((xb + 0.55, zb + 0.72), (xb - 0.62, zb + 0.55)):
        mb.tube(G, [Vector((x0, 0.05, z0)), Vector((x0 + 0.02, 0.05, z0 + 0.3)), Vector((x0 + 0.02, 0.05, zc - 0.78))], 0.012, seg=4)
    mb.tube(G, [Vector((xb + 0.55, -0.05, zb + 0.72)), Vector((xb + 0.57, -0.05, zc - 0.78))], 0.012, seg=4)
    lean_all(mb, (0, 1.2, 0), (0, 0, 0))
    finish("sign_gas", mb, "furniture", ao=dict(samples=10, dist=0.6, strength=0.6), post=lambda o: grime_vc(o, 27, dirt=0.4, ground=0.4, ground_h=1.0),
           notes="Roadside gas-station pole sign, 8.6 m: double-sided GAS cabinet 3.2 x 1.5 m + hanging price board 1.4 x 1.4 m (right half, one chain broken), concrete pier. Both faces readable "
                 "(+Y and -Y in Blender).")


def billboard():
    new_scene(); M = std()
    G, R = M["galv"], M["rust"]
    F = face_mat("billboard_ad", rough=0.7, metal=0.0)
    mb = MB()
    pf = ibeam_profile(0.30, 0.40, 0.022, 0.016)
    for x in (-3.6, 3.6):
        beam(mb, G, pf, (x, -0.45, 0.0), (x, -0.45, 10.45))
        mb.box(G, (x, -0.45, 0.06), (0.8, 0.8, 0.12), bevel=0.01)
    zc = 8.0
    plate(mb, F, G, (0, 0.0, zc), 12.0, 4.0, thick=0.14, seg=(24, 8), amp=0.03, dents=6, dent_depth=0.12, dent_r=0.5, corner_r=0.10, seed=41, fold=(-1, -1, 0.66, 0.55))
    # frame + purlins behind the panel
    for (cx, cz, sx, sz) in ((0, zc + 2.08, 12.3, 0.16), (0, zc - 2.08, 12.3, 0.16), (-6.08, zc, 0.16, 4.3), (6.08, zc, 0.16, 4.3)):
        mb.box(G, (cx, -0.02, cz), (sx, 0.26, sz), bevel=0.008)
    for z in (zc - 1.2, zc, zc + 1.2):
        beam(mb, G, channel_profile(0.10, 0.14, 0.008, 0.008), (-6.0, -0.22, z), (6.0, -0.22, z), roll=90)
    for x in (-3.6, 3.6):                                                             # braces post -> frame
        mb.tube(G, [Vector((x, -0.45, 6.2)), Vector((x + math.copysign(1.4, x), -0.25, 7.2))], 0.045, seg=6)
        mb.tube(G, [Vector((x, -0.45, 9.8)), Vector((x - math.copysign(1.3, x), -0.25, 8.9))], 0.045, seg=6)
    # catwalk in front of the panel bottom
    zw = 5.5
    mb.box(G, (0, 0.65, zw), (12.4, 1.0, 0.06))
    for i in range(0, 13):
        x = -6.0 + i * 1.0
        mb.tube(G, [Vector((x, 1.12, zw + 0.03)), Vector((x, 1.12, zw + 1.05))], 0.02, seg=5)
    mb.tube(G, [Vector((-6.0, 1.12, zw + 1.05)), Vector((6.0, 1.12, zw + 1.05))], 0.025, seg=6)
    mb.tube(G, [Vector((-6.0, 1.12, zw + 0.55)), Vector((6.0, 1.12, zw + 0.55))], 0.02, seg=5)
    for x in (-5.0, -2.0, 2.0, 5.0):                                                  # catwalk brackets
        mb.tube(G, [Vector((x, 1.1, zw - 0.03)), Vector((x, -0.3, zw - 1.0))], 0.03, seg=5)
    # ladder on the right post
    for dx in (-0.22, 0.22):
        mb.tube(G, [Vector((3.6 + dx, -0.95, 0.3)), Vector((3.6 + dx, -0.95, zw))], 0.02, seg=5)
    for i in range(16):
        z = 0.5 + i * (zw - 0.7) / 15
        mb.box(G, (3.6, -0.95, z), (0.44, 0.03, 0.03))
    for z in (0.8, 2.6, 4.4):
        mb.box(G, (3.6, -0.7, z), (0.05, 0.5, 0.05))
    # a few flood-light arms on top
    for x in (-4.0, 0.0, 4.0):
        mb.tube(G, [Vector((x, 0.0, zc + 2.1)), Vector((x, 0.35, zc + 2.6)), Vector((x, 1.25, zc + 2.8))], 0.025, seg=5)
        mb.box(G, (x, 1.3, zc + 2.75), (0.5, 0.25, 0.16), bevel=0.012)
    finish("billboard", mb, "furniture", ao=dict(samples=6, dist=1.2, strength=0.55, gradient=0.1), post=lambda o: grime_vc(o, 29, dirt=0.35, ground=0.4, ground_h=1.5),
           notes="Large faded ad billboard: 12 x 4 m panel (bottom edge 6 m, top 10 m) on two I-beam columns with catwalk, ladder, flood lights; peeling ad texture, torn lower-left corner. " + FACE_NOTE)


def mile_marker():
    new_scene(); M = std()
    G, W = M["galv"], M["white"]
    F = face_mat("mile_marker")
    mb = MB()
    mb.box(G, (0, -0.03, 0.68), (0.07, 0.035, 1.36), bevel=0.004)
    mb.box(W, (0, 0.0, 0.25), (0.075, 0.02, 0.28), bevel=0.003)                         # reflective strip on the post
    plate(mb, F, G, (0, 0.0, 1.03), 0.30, 0.45, thick=0.008, seg=(6, 8), amp=0.002, dents=2, dent_depth=0.012, dent_r=0.08, corner_r=0.03, seed=51, rot=(0, 3, 0))
    hexbolt(mb, G, (0, 0.006, 0.86), (0, 1, 0), 0.007, 0.006)
    lean_all(mb, (3.0, 4.0, 0), (0, 0, 0))
    finish("mile_marker", mb, "furniture", ao=dict(samples=12, dist=0.2, strength=0.55), post=lambda o: grime_vc(o, 31, dirt=0.4, ground=0.7, ground_h=0.4),
           notes="Highway mile marker MILE 87, plate 0.30 x 0.45 m on a 1.36 m post, leaning. " + FACE_NOTE)


BUILD = dict(sign_speed=sign_speed, sign_warning=sign_warning, sign_exit=sign_exit, sign_gas=sign_gas, billboard=billboard, mile_marker=mile_marker)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in [x for x in a if x in BUILD] or list(BUILD):
        BUILD[n]()
