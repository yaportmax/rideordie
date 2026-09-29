"""Road furniture: barrel, barrel_explosive (200 L drums).
   blender -b --factory-startup -P tools/env/props/road_barrels.py -- [name ...]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *

H, R = 0.885, 0.293
PROFILE = [(0.0, 0.012), (0.255, 0.012), (0.262, 0.0), (0.285, 0.0), (0.292, 0.008), (0.292, 0.03), (0.284, 0.04), (0.284, 0.27),
           (0.291, 0.285), (0.293, 0.300), (0.291, 0.315), (0.284, 0.33), (0.284, 0.55), (0.291, 0.565), (0.293, 0.58), (0.291, 0.595), (0.284, 0.61),
           (0.284, 0.84), (0.292, 0.852), (0.292, 0.875), (0.285, 0.885), (0.270, 0.885), (0.264, 0.868), (0.0, 0.868)]


def make_barrel(name, tex, seed, dents, notes, tilt=0.0):
    new_scene(); M = std()
    m = pmat(name, tex=tex, rough=0.6, metal=0.3)
    mb = MB()
    bm = mb.bm(m)
    vs = mb.lathe(m, PROFILE, seg=20, close=False)
    dent_verts(vs, dents)
    # bungs on the lid
    for (x, y) in ((0.13, 0.03), (-0.07, -0.14)):
        mb.cyl(m, Vector((x, y, 0.868)), Vector((x, y, 0.870)), 0.038, 0.036, seg=10)
        mb.cyl(m, Vector((x, y, 0.870)), Vector((x, y, 0.886)), 0.028, 0.025, seg=8)
    barrel_uv(bm, H, R)
    finish(name, mb, "furniture", ao=dict(samples=16, dist=0.3, strength=0.7), post=lambda o: grime_vc(o, seed, dirt=0.3, ground=0.5, ground_h=0.4), notes=notes)


def barrel():
    make_barrel("barrel", "barrel_paint", 1, [(Vector((0.29, 0.0, 0.45)), 0.18, 0.014), (Vector((-0.2, 0.2, 0.7)), 0.14, 0.010)],
                "200 L steel drum, faded blue paint over rust, two rolling hoops, dented; textured (1024 albedo/normal/ORM)")


def barrel_explosive():
    make_barrel("barrel_explosive", "barrel_explosive", 2, [(Vector((0.0, 0.29, 0.4)), 0.16, 0.012), (Vector((-0.25, -0.15, 0.75)), 0.13, 0.010)],
                "200 L drum, red with yellow/black hazard band and flammable diamond + DANGER FLAMMABLE stencil (label faces -Y in Blender = +Z glTF, like vehicles)")


BUILD = dict(barrel=barrel, barrel_explosive=barrel_explosive)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for n in [x for x in a if x in BUILD] or list(BUILD):
        BUILD[n]()
