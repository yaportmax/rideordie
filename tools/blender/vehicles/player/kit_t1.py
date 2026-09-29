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
    tail = [pts[-1], (cx + 0.05, cf - 0.10, zb + 0.05), (cx - 0.14, cf + 0.30, zb + 0.12), (-0.66, C.f_bf - 0.46, zb + 0.55), (-0.66, C.f_bf - 0.46, zb + 0.76)]
    b.tube('canvas', tail, 0.0115, n=6, rad=0.10, k=3)
    # rope wraps around the post
    for i in range(4):
        b.torus('canvas', (-0.66, C.f_bf - 0.46, zb + 0.72 - i * 0.014), 0.028, 0.0095, axis='z', nR=10, nr=5)
    # ---- duct tape over the windshield crack
    ws = T.ws
    for (u, s, ang, L) in ((-0.30, ws['slope'] * 0.55, 20.0, 0.34), (-0.22, ws['slope'] * 0.50, -55.0, 0.30)):
        du, ds = math.cos(math.radians(ang)) * L / 2, math.sin(math.radians(ang)) * L / 2
        p0, p1 = T.wpos(u - du, s - ds, 0.006), T.wpos(u + du, s + ds, 0.006)
        b.sweep('metal_bare', [p0, p1], [(0.026, 0.0015), (-0.026, 0.0015), (-0.026, -0.0015), (0.026, -0.0015)], up=(0, 1, 0.3))
    # ---- fuzzy dice from the mirror
    m0 = T.wpos(0.12 * k, ws['slope'] - 0.08, -0.03)
    for i, x in enumerate((0.09, 0.15)):
        b.box('fabric', (x * k, m0[1] - 0.06, m0[2] - 0.22 - i * 0.02), (0.045, 0.045, 0.045), bev=0.008, rot=(15 * i, 30 + 40 * i, 10))
        b.cyl2('rubber', (x * k, m0[1] - 0.06, m0[2] - 0.20 - i * 0.02 + 0.02), (x * k, m0[1] - 0.05, m0[2] - 0.075), 0.002, n=4)
    # ---- bent whip aerial on the right front fender
    b.tube('metal_dark', [(-C.fender_hw + 0.06, C.fa + 0.1, C.fender_top - 0.02), (-C.fender_hw + 0.05, C.fa + 0.1, C.fender_top + 0.35), (-C.fender_hw + 0.02, C.fa + 0.14, C.fender_top + 0.62), (-C.fender_hw - 0.10, C.fa + 0.18, C.fender_top + 0.70)], 0.004, n=5)
    b.cyl('metal_dark', (-C.fender_hw + 0.06, C.fa + 0.1, C.fender_top), 0.014, 0.03, axis='z', n=8)
    # ---- a spare bald tyre? no: a crumpled tarp scrap and a tyre iron on the floor
    b.tube('metal_bare', [(0.15, C.f_tail + 0.55, zb + 0.02), (0.40, C.f_tail + 0.75, zb + 0.02), (0.44, C.f_tail + 0.8, zb + 0.04)], 0.008, n=6, rad=0.04)
    b.box('canvas', (0.2, C.f_tail + 0.35, zb + 0.02), (0.36, 0.30, 0.03), bev=0.01, rot=(0, 20, 0))
