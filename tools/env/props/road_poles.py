"""Road furniture: utility_pole, wire_span, street_lamp.
   The utility pole's cross arm runs along X (across the road); wires run along glTF +Z (= Blender -Y).
   blender -b --factory-startup -P tools/env/props/road_poles.py -- [name ...]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *

POLE_H = 10.0
LEAN = (0.06, 0.03)                       # top offset of the leaning pole (x, y) in metres


def pole_c(z):
    return Vector((LEAN[0] * z / POLE_H, LEAN[1] * z / POLE_H, z))


ARM_Z = 9.15
ATTACH = [Vector((-0.95, 0, ARM_Z + 0.06 + 0.175)) + Vector((pole_c(ARM_Z).x, pole_c(ARM_Z).y, 0)),
          Vector((0.95, 0, ARM_Z + 0.06 + 0.175)) + Vector((pole_c(ARM_Z).x, pole_c(ARM_Z).y, 0)),
          Vector((pole_c(10.03).x, pole_c(10.03).y, 10.03 + 0.175))]


def insulator(mb, m, base, scale=1.0):
    prof = [(0.0, 0.0), (0.014, 0.0), (0.014, 0.05), (0.040, 0.05), (0.048, 0.062), (0.040, 0.074), (0.052, 0.094), (0.060, 0.106), (0.046, 0.124),
            (0.054, 0.142), (0.040, 0.158), (0.022, 0.172), (0.012, 0.175), (0.0, 0.175)]
    prof = [(r * scale, z * scale) for r, z in prof]
    mb.lathe(m, prof, seg=8, close=False, center=base)


def utility_pole():
    new_scene(); M = std()
    wood = pmat("wood_pole", tex="wood_pole", uv_m=0.5, rough=0.9)
    G, GL, GR = M["galv"], M["glass"], M["grey"]
    mb = MB()
    rnd = random.Random(5)
    zs = [POLE_H * i / 9 for i in range(10)]
    pts = [pole_c(z) + Vector((rnd.uniform(-0.01, 0.01), rnd.uniform(-0.01, 0.01), 0)) for z in zs]
    rad = [0.20 - 0.085 * (z / POLE_H) + rnd.uniform(-0.006, 0.006) for z in zs]
    mb.tube(wood, pts, rad, seg=10, cap_start=False, cap_end=True)
    c = pole_c(ARM_Z)
    mb.box(wood, (c.x, c.y, ARM_Z), (2.5, 0.10, 0.12))                                          # cross arm
    for sx in (-1, 1):                                                                          # diagonal steel braces
        mb.tube(G, [Vector((c.x + sx * 0.09, c.y + 0.07, ARM_Z - 0.6)), Vector((c.x + sx * 0.90, c.y + 0.07, ARM_Z - 0.03))], 0.016, seg=5)
        hexbolt(mb, G, (c.x + sx * 0.90, c.y + 0.056, ARM_Z), (0, 1, 0), 0.011, 0.008)
    hexbolt(mb, G, (c.x, c.y + 0.056, ARM_Z), (0, 1, 0), 0.016, 0.012)
    hexbolt(mb, G, (c.x, c.y - 0.056, ARM_Z), (0, -1, 0), 0.016, 0.012)
    for sx in (-1, 1):
        insulator(mb, GL, (c.x + sx * 0.95, c.y, ARM_Z + 0.06))
    top = pole_c(10.0)
    mb.cone(G, Vector((top.x, top.y, 10.0)), Vector((top.x, top.y, 10.05)), 0.115, seg=10)          # cap
    insulator(mb, GL, (pole_c(10.03).x, pole_c(10.03).y, 10.03))
    # transformer can
    tc = pole_c(8.4)
    mb.cyl(GR, Vector((tc.x + 0.34, tc.y, 8.15)), Vector((tc.x + 0.34, tc.y, 8.75)), 0.21, 0.21, seg=12)
    mb.cone(GR, Vector((tc.x + 0.34, tc.y, 8.75)), Vector((tc.x + 0.34, tc.y, 8.92)), 0.21, seg=12)
    for dz in (8.3, 8.6):
        mb.box(G, (tc.x + 0.16, tc.y, dz), (0.20, 0.06, 0.05))
    for dx in (0.28, 0.40):
        insulator(mb, GL, (tc.x + dx, tc.y, 8.92), 0.6)
    # step bolts
    for i in range(9):
        z = 2.0 + i * 0.5
        s = 1 if i % 2 == 0 else -1
        p = pole_c(z)
        mb.cyl(G, Vector((p.x, p.y + s * 0.10, z)), Vector((p.x, p.y + s * 0.30, z)), 0.011, 0.011, seg=5, caps=(False, True))
    # burnt/creosote band at the base + a metal ground-wire guard strip
    mb.box(G, (0.0, -0.20, 1.6), (0.03, 0.01, 3.0))
    finish("utility_pole", mb, "furniture", ao=dict(samples=10, dist=0.6, strength=0.6, gradient=0.3), post=lambda o: grime_vc(o, 41, dirt=0.5, ground=0.7, ground_h=2.5, soot=0.35),
           notes="10 m leaning wooden utility pole (cross arm along X, 2.5 m), 3 glass insulators, transformer can, step bolts. Wire attach points (glTF x,y,z): "
                 "(-0.9,9.4,0) (1.0,9.4,0) (0.06,10.2,0) approx; see wire_span.",
           extra=dict(attach_points=[[round(p.x, 3), round(p.z, 3), round(-p.y, 3)] for p in ATTACH]))


def wire_span():
    new_scene(); M = std()
    wire = pmat("wire", color=(0.03, 0.03, 0.032), rough=0.55, metal=0.5)
    mb = MB()
    N = 12
    L = 20.0
    for k, a in enumerate(ATTACH):
        sag = 0.55 + 0.1 * k
        pts = []
        for i in range(N + 1):
            t = i / N
            pts.append(Vector((a.x, a.y - L * t, a.z - 4 * sag * t * (1 - t))))
        mb.tube(wire, pts, 0.013, seg=3, cap_start=True, cap_end=True)
    finish("wire_span", mb, "furniture", ao=None, keep_origin=True, uv=False,
           notes="3 sagging power wires spanning 20 m along glTF +Z from the attach points of utility_pole (origin at the ground under pole A: place with the same transform "
                 "as pole A, pole B stands at z=+20). Thin dark 3-sided tubes, no textures.", extra=dict(span=20.0))


def street_lamp():
    new_scene(); M = std()
    G, LN = M["galv"], M["lens"]
    mb = MB()
    mb.cyl(G, Vector((0, 0, 0.0)), Vector((0, 0, 0.035)), 0.27, 0.27, seg=10)                       # base flange
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        mb.cyl(G, Vector((0.21 * math.cos(a), 0.21 * math.sin(a), 0.035)), Vector((0.21 * math.cos(a), 0.21 * math.sin(a), 0.075)), 0.022, 0.02, seg=6)
    mb.cyl(G, Vector((0, 0, 0.035)), Vector((0, 0, 8.4)), 0.145, 0.078, seg=8, rings=5)              # tapered octagonal pole
    mb.box(G, (0, 0.135, 1.05), (0.16, 0.03, 0.42), bevel=0.006)                                   # access door
    hexbolt(mb, G, (0, 0.152, 1.20), (0, 1, 0), 0.01, 0.008)
    hexbolt(mb, G, (0, 0.152, 0.90), (0, 1, 0), 0.01, 0.008)
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(Vector((2.7 * t, 0, 8.3 + 0.95 * (1 - (1 - t) ** 2))))
    mb.tube(G, pts, [0.070 - 0.03 * (i / 8) for i in range(9)], seg=8)
    mb.cyl(G, Vector((0, 0, 8.25)), Vector((0, 0, 8.55)), 0.10, 0.09, seg=8)                        # arm collar
    end = pts[-1]
    mb.sphere(G, (end.x + 0.12, 0, end.z - 0.05), (0.62, 0.23, 0.12), subdiv=2, rot=(0, -4, 0))    # cobra head housing
    mb.sphere(LN, (end.x + 0.16, 0, end.z - 0.15), (0.50, 0.19, 0.04), subdiv=2, rot=(0, -4, 0))   # lens
    mb.box(G, (end.x - 0.32, 0, end.z + 0.04), (0.16, 0.14, 0.10), bevel=0.01)
    finish("street_lamp", mb, "furniture", ao=dict(samples=10, dist=0.5, strength=0.6), post=lambda o: grime_vc(o, 43, dirt=0.4, ground=0.6, ground_h=1.5),
           notes="Highway street lamp, 9.3 m: tapered octagonal pole, 2.7 m curved arm toward +X (traffic side), cobra-head luminaire with dark 'lamp_lens' glass "
                 "(swap for an emissive material if lit).")
    return


BUILD = dict(utility_pole=utility_pole, wire_span=wire_span, street_lamp=street_lamp)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in [x for x in a if x in BUILD] or list(BUILD):
        BUILD[n]()
