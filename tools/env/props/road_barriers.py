"""Road furniture: jersey_barrier, guardrail_4m, road_cone, bollard, fence_chainlink_4m, tire_stack, crate_stack, debris_pile.
   blender -b --factory-startup -P tools/env/props/road_barriers.py -- [name ...]"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from roadlib import *


def jersey_barrier():
    new_scene(); M = std()
    mb = MB()
    C = M["concrete"]
    prof = [(-0.30, 0), (0.30, 0), (0.30, 0.075), (0.165, 0.34), (0.075, 0.795), (0.06, 0.81), (-0.06, 0.81), (-0.075, 0.795), (-0.165, 0.34), (-0.30, 0.075)]
    mb.extrude(C, prof, -1.83, 1.83)
    chips = [(Vector((0.05, 1.83, 0.75)), 0.24, 0.10), (Vector((-0.3, -1.83, 0.06)), 0.22, 0.06), (Vector((0.06, -0.9, 0.81)), 0.12, 0.03),
             (Vector((0.30, 0.6, 0.05)), 0.16, 0.04), (Vector((-0.10, 1.4, 0.7)), 0.14, 0.03)]
    subdiv_noise(mb, C, y_cuts=14, prof_cuts=1, amp=0.005, freq=4.5, seed=3, chips=chips)
    # steel lifting loops (rebar) on top + rebar sticking out of the broken corner
    for y0 in (-0.85, 0.85):
        pts = [Vector((0, y0 + 0.07 * math.cos(t), 0.80 + 0.085 * math.sin(t))) for t in [math.pi * i / 8 for i in range(9)]]
        mb.tube(M["rust"], pts, 0.011, seg=6, cap_start=True)
    for k, (x, z) in enumerate([(-0.02, 0.70), (0.03, 0.73), (0.06, 0.66)]):
        mb.tube(M["rust"], [Vector((x, 1.72, z)), Vector((x + 0.01 * k, 1.82, z + 0.02)), Vector((x + 0.03, 1.90, z + 0.07 * (k - 1)))], 0.008, seg=5, cap_start=True)
    finish("jersey_barrier", mb, "furniture", ao=dict(samples=20, dist=0.6, strength=0.8), post=lambda o: grime_vc(o, 3, dirt=0.5, ground=0.7),
           notes="NJ concrete barrier 3.66 m long along Z (glTF), 0.81 m high, chipped end with exposed rebar (top-corner at +Z end)")


def guardrail_4m():
    new_scene(); M = std()
    mb = MB()
    G = M["galv"]
    dz = [(0.020, 0.000), (0.020, 0.012), (0.045, 0.035), (0.083, 0.062), (0.083, 0.092), (0.050, 0.125), (0.000, 0.156), (0.050, 0.187), (0.083, 0.220),
          (0.083, 0.250), (0.045, 0.277), (0.020, 0.300), (0.020, 0.312)]
    z0, x0 = 0.40, 0.10                      # rail bottom height, back plane x
    path = [(x0 + d, z0 + z) for (d, z) in dz]
    outline = offset_outline(path, 0.005)
    mb.extrude(G, outline, -2.0, 2.0)
    subdiv_noise(mb, G, y_cuts=9, prof_cuts=0, amp=0.0035, freq=3.0, seed=5, chips=[(Vector((x0 + 0.08, 0.55, z0 + 0.22)), 0.42, 0.028), (Vector((x0 + 0.08, -1.2, z0 + 0.08)), 0.25, 0.012)])
    # posts (W6x9) at y = +-1.0, offset blocks, bolts
    for y in (-1.0, 1.0):
        beam(mb, G, ibeam_profile(0.10, 0.15, 0.009, 0.007), (-0.05, y, 0.0), (-0.05, y, 0.80), roll=0.0)
        mb.box(M["wood"], (0.0625, y, 0.55), (0.075, 0.09, 0.15))
        mb.box(G, (-0.128, y, 0.79), (0.008, 0.10, 0.02))
        hexbolt(mb, G, (x0 + 0.004, y, z0 + 0.156), (1, 0, 0), 0.016, 0.012)
        mb.cyl(G, Vector((x0 + 0.002, y, z0 + 0.156)), Vector((x0 + 0.006, y, z0 + 0.156)), 0.03, 0.03, seg=10)
    for y in (-1.92, -1.86, 1.86, 1.92):          # splice bolts at the segment ends
        for zz in (0.062, 0.25):
            hexbolt(mb, G, (x0 + 0.085, y, z0 + zz + 0.015), (1, 0, 0), 0.011, 0.009)
    finish("guardrail_4m", mb, "furniture", ao=dict(samples=16, dist=0.35, strength=0.75), post=lambda o: grime_vc(o, 5, dirt=0.5, ground=0.6, ground_h=0.5),
           notes="W-beam guardrail, 4.0 m along Z (glTF); traffic side is +X (right shoulder when driving +Z; rotate 180 deg about Y for the left shoulder). "
                 "Posts at z=+-1.0 so instances placed every 4.0 m keep a uniform 2 m post spacing; rail runs edge to edge.",
           extra=dict(segment_length=4.0))


def road_cone():
    new_scene(); M = std()
    m = pmat("road_cone", tex="road_cone", rough=0.6)
    mb = MB()
    bm = mb.bm(m)
    mb.box(m, (0, 0, 0.018), (0.36, 0.36, 0.036), bevel=0.012, segs=2)
    base_faces = list(bm.faces)
    uvl = bm.loops.layers.uv.verify()
    for f in base_faces:                                                # rubber strip region of the texture
        for lp in f.loops:
            lp[uvl].uv = (0.5 + lp.vert.co.x * 0.8, 0.07 + lp.vert.co.y * 0.02)
    r_at = lambda z: 0.135 - (0.135 - 0.032) * (z - 0.036) / (0.70 - 0.036)
    zs = [0.036 + (0.70 - 0.036) * i / 9 for i in range(10)]
    n0 = len(bm.faces)
    mb.lathe(m, [(r_at(z), z) for z in zs] + [(0.030, 0.70), (0.0, 0.70)], seg=16, close=False)
    cyl_uv(bm, 0.036, 0.70, 0.15, 1.0, faces=list(bm.faces)[n0:])
    finish("road_cone", mb, "furniture", ao=dict(samples=16, dist=0.3, strength=0.7), post=lambda o: grime_vc(o, 7, dirt=0.5, ground=0.6, ground_h=0.3, tint=(0.6, 0.5, 0.4)),
           notes="0.70 m safety cone; single textured material (orange + 2 reflective bands + rubber base painted in the texture)")


def bollard():
    new_scene(); M = std()
    m = pmat("bollard", tex="bollard", rough=0.6)
    mb = MB()
    bm = mb.bm(m)
    prof = [(0.0, 0.0), (0.17, 0.0), (0.17, 0.02), (0.13, 0.03), (0.105, 0.04), (0.100, 0.06), (0.100, 0.90), (0.097, 0.96), (0.085, 0.99), (0.06, 1.005), (0.0, 1.01)]
    mb.lathe(m, prof, seg=18, close=False)
    cyl_uv(bm, 0.0, 1.01, 0.0, 1.0)
    G = M["galv"]
    for k in range(4):                                     # anchor bolts on the base flange
        a = math.pi / 4 + k * math.pi / 2
        mb.cyl(G, Vector((0.14 * math.cos(a), 0.14 * math.sin(a), 0.02)), Vector((0.14 * math.cos(a), 0.14 * math.sin(a), 0.036)), 0.014, 0.012, seg=6)
    finish("bollard", mb, "furniture", ao=dict(samples=16, dist=0.4, strength=0.7), post=lambda o: grime_vc(o, 9, dirt=0.4, ground=0.6, ground_h=0.5, tint=(0.55, 0.45, 0.35)),
           notes="1.0 m steel bollard, faded yellow paint (texture) with two reflective bands, flanged base with anchor bolts")


BUILD = dict(jersey_barrier=jersey_barrier, guardrail_4m=guardrail_4m, road_cone=road_cone, bollard=bollard)

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = [x for x in a if x in BUILD] or list(BUILD)
    for n in names:
        BUILD[n]()
