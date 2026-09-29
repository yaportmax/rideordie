"""kit_t1 - Rustbucket extras: jerry can, rope, duct-tape on the cracked windshield, fuzzy dice, bent aerial."""
import math
from mathutils import Vector
from vlib import *  # noqa
from parts import *  # noqa


def kit(T):
    C, b, k = T.C, T.b, T.k
    zb = C.z_bed
    # ---- one jerry can wedged against the headache board (driver side)
    jerry_can(b, (0.60, C.f_bf - 0.14, zb + 0.245), size=(0.34, 0.16, 0.46), m='paint2')
    # ---- rope coil on the bed floor + a loose tail tied round a post
    cx, cf = -0.50, C.f_bf - 0.52
    pts = []
    turns, per = 3.0, 12
    for i in range(int(turns * per) + 1):
        a = 2 * math.pi * i / per
        rr = 0.17 - 0.0035 * i * 0.6
        pts.append((cx + rr * math.cos(a), cf + rr * math.sin(a) * 0.85, zb + 0.014 + 0.0016 * i * 0.5))
    b.sweep('canvas', pts, circle_prof(0.0115, 6))
    px_, pf_ = T.ring_post_fr
    tail = [pts[-1], (cx + 0.05, cf - 0.10, zb + 0.05), (cx - 0.10, cf + 0.30, zb + 0.12), (px_ + 0.04, pf_ + 0.02, zb + 0.55), (px_ + 0.03, pf_, zb + 0.76)]
    b.tube('canvas', tail, 0.0115, n=6, rad=0.10, k=3)
    # rope wraps around the post
    for i in range(4):
        b.torus('canvas', (px_, pf_, zb + 0.72 - i * 0.014), 0.029, 0.0095, axis='z', nR=10, nr=5)
    # ---- fuzzy dice from the mirror
    mx, mf, mz = T.rvm_c
    for i, x in enumerate((-0.03, 0.03)):
        d = (mx + x, mf + 0.03, mz - 0.13 - i * 0.022)
        b.swatch('red')
        b.box('decal', d, (0.03, 0.03, 0.03), bev=0.008, seg=2, rot=(15 * i, 30 + 40 * i, 10))
        b.swatch('white')
        for (px, py, pz) in ((0.0, -0.0155, 0.0), (0.0155, 0.0, 0.005), (-0.005, 0.0, 0.0155)):
            b.sph('decal', (d[0] + px, d[1] + py, d[2] + pz), 0.004, n=6, sc=(1, 0.4, 1) if py else ((0.4, 1, 1) if px else (1, 1, 0.4)))
        b.swatch(None)
        b.cyl2('fabric', (d[0], d[1], d[2] + 0.017), (mx + x * 0.3, mf + 0.03, mz - 0.03), 0.0015, n=4)
    # ---- bent whip aerial on the right front fender
    b.tube('metal_dark', [(-C.fender_hw + 0.06, C.fa + 0.1, C.fender_top - 0.02), (-C.fender_hw + 0.05, C.fa + 0.1, C.fender_top + 0.35), (-C.fender_hw + 0.02, C.fa + 0.14, C.fender_top + 0.62), (-C.fender_hw - 0.10, C.fa + 0.18, C.fender_top + 0.70)], 0.004, n=5)
    b.cyl('metal_dark', (-C.fender_hw + 0.06, C.fa + 0.1, C.fender_top), 0.014, 0.03, axis='z', n=8)
    # ---- a spare bald tyre? no: a crumpled tarp scrap and a tyre iron on the floor
    b.tube('metal_bare', [(0.15, C.f_tail + 0.55, zb + 0.02), (0.40, C.f_tail + 0.75, zb + 0.02), (0.44, C.f_tail + 0.8, zb + 0.04)], 0.008, n=6, rad=0.04)
    b.box('canvas', (0.2, C.f_tail + 0.35, zb + 0.02), (0.36, 0.30, 0.03), bev=0.01, rot=(0, 20, 0))
