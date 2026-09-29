"""rocks x6, canyon boulders x3, canyon pillars x2.   blender -b --factory-startup -P tools/env/props/rocks.py -- [only_name ...]"""
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from envlib import *
from rocklib import add_rock, add_pillar
import bpy, bmesh
from mathutils import Vector, noise as mnoise

only = [a for a in sys.argv[sys.argv.index("--") + 1:]] if "--" in sys.argv else []


def want(n):
    return not only or n in only


def grey():
    return pmat("rock_grey", tex="rock_grey", uv_m=2.7, rough=0.9)


def red():
    return pmat("rock_red", tex="rock_red", uv_m=1.8, rough=0.9)


def sandstone():
    return pmat("cliff", tex="cliff", uv_m=2.0, rough=0.9)


# ------------------------------------------------------------------------------------------ rocks
ROCKS = {
    # name: (list of (size, offset, subdiv, cuts, seed, kwargs), uv_m, ao dist)
    "rock_01": ([((0.52, 0.42, 0.34), (0, 0, 0), 3, 6, 11, dict(rough=0.05))], 0.8, 0.35),
    "rock_02": ([((0.90, 0.68, 0.52), (0, 0, 0), 3, 7, 12, dict(rough=0.05))], 1.2, 0.5),
    "rock_03": ([((1.35, 1.0, 0.82), (0, 0, 0), 4, 8, 13, dict(rough=0.055))], 1.8, 0.7),
    "rock_04": ([((2.3, 1.5, 0.6), (0, 0, 0), 4, 9, 14, dict(rough=0.05, stretch=(1.0, 1.0, 0.7), bury=0.18))], 2.6, 0.9),
    "rock_05": ([((2.7, 2.3, 1.9), (0, 0, 0), 4, 8, 15, dict(rough=0.055)),
                 ((1.0, 0.85, 0.65), (1.9, -0.9, 0), 3, 6, 25, dict(rough=0.05)),
                 ((0.65, 0.55, 0.42), (-1.7, 1.2, 0), 3, 6, 35, dict(rough=0.05))], 3.4, 1.1),
    "rock_06": ([((4.6, 3.8, 2.9), (0, 0, 0), 4, 9, 16, dict(rough=0.06, ridge=0.04)),
                 ((1.7, 1.4, 1.1), (3.1, -1.6, 0), 3, 7, 26, dict(rough=0.05)),
                 ((1.1, 0.95, 0.75), (-2.9, 2.0, 0), 3, 6, 36, dict(rough=0.05))], 4.5, 1.6),
}

BOULDERS = {
    "boulder_01": ((3.4, 2.9, 2.6), 4, 5, 41, 3.0, 2.4),
    "boulder_02": ((4.6, 3.8, 3.3), 4, 5, 42, 4.5, 3.0),
    "boulder_03": ((6.2, 4.8, 4.2), 4, 6, 43, 6.0, 4.0),
}


def build_rock(name, spec, mat=None, variant_of=None):
    parts, uvm, aod = spec
    mb = MB()
    m = mat() if mat else grey()
    for (size, off, sub, cuts, seed, kw) in parts:
        add_rock(mb, m, seed=seed, size=size, center=off, subdiv=sub, cuts=cuts, **kw)
    extra = dict(variants=["rock_grey", "rock_red", "cliff"]) if not variant_of else dict(variant_of=variant_of)
    finish(name, mb, "rock", notes="angular rock; material %s (swap by name for other biomes: rock_grey / rock_red / cliff)" % m.name,
           ao=dict(samples=24, dist=aod, strength=0.8, gradient=0.3), uv_m=uvm, extra=extra)


def build_boulder(name, spec):
    size, sub, cuts, seed, uvm, aod = spec
    mb = MB()
    m = red()
    add_rock(mb, m, seed=seed, size=size, subdiv=sub, cuts=cuts, rough=0.05, strata=1.2, roundness=0.6, cut_strength=0.8, bury=0.16, macro=0.2)
    # a couple of buried satellite blocks for a believable footprint
    rnd = random.Random(seed)
    for k in range(2):
        a = rnd.uniform(0, 6.28)
        d = size[0] * rnd.uniform(0.38, 0.47)
        s = size[2] * rnd.uniform(0.28, 0.42)
        add_rock(mb, m, seed=seed + 7 + k, size=(s * 1.3, s * 1.1, s * 0.8), center=(math.cos(a) * d, math.sin(a) * d, 0), subdiv=3, cuts=6, strata=1.0, roundness=0.6, rough=0.04)
    finish(name, mb, "boulder", notes="rounded canyon sandstone boulder with strata; material rock_red",
           ao=dict(samples=28, dist=aod, strength=0.85, gradient=0.35), uv_m=uvm)


# ------------------------------------------------------------------------------------------ pillars
def build_pillar(name, height, profile, seed, layers, tile=6.0, **kw):
    m = red()
    mb = MB()
    lk = add_pillar(mb, m, height, profile, seed, layers, tile=tile, **kw)
    objs = mb.to_objects(name, 42.0)
    o = objs[0]
    bake_ao(o, samples=28, dist=max(3.0, height * 0.18), strength=0.7, gradient=0.55, floor=0.35)
    me = o.data
    ca = me.color_attributes["Col"]
    W = o.matrix_world
    off = Vector((seed * 3.7, seed * 1.3, seed * 2.1))
    for i, v in enumerate(me.vertices):
        p = W @ v.co
        t = p.z / height
        lf = t * layers
        k = int(min(layers - 1, math.floor(lf)))
        fk = lf - k
        tone = lk[k] * (1 - fk) + lk[k + 1] * fk
        band = 0.80 + 0.20 * tone
        streak = 0.9 + 0.1 * mnoise.noise(Vector((p.x * 0.9, p.y * 0.9, p.z * 0.06)) + off * 0.5)
        c = ca.data[i].color
        ca.data[i].color = (c[0] * band * streak, c[1] * band * streak * 0.97, c[2] * band * streak * 0.94, 1.0)
    finish(name, objs, "pillar", notes="canyon hoodoo/butte, strata bands in COLOR_0; cylindrical UVs at %.0f m/tile; material rock_red" % tile, ao=None, uv=False)


if __name__ == "__main__":
    for n, sp in ROCKS.items():
        if want(n):
            new_scene()
            build_rock(n, sp)
    for n in ("rock_01", "rock_02", "rock_03", "rock_05"):
        if want(n + "_red"):
            new_scene()
            build_rock(n + "_red", ROCKS[n], mat=red, variant_of=n)
    for n, sp in BOULDERS.items():
        if want(n):
            new_scene()
            build_boulder(n, sp)
    if want("canyon_pillar_a"):
        new_scene()
        build_pillar("canyon_pillar_a", 20.0, [(0, 5.2), (0.10, 3.9), (0.30, 2.9), (0.55, 2.5), (0.72, 2.7), (0.80, 3.5), (0.90, 3.9), (0.97, 3.5), (1.0, 3.0)], 5, 11, ex=1.0, ey=0.85, tile=6.0)
    if want("canyon_pillar_b"):
        new_scene()
        build_pillar("canyon_pillar_b", 30.0, [(0, 9.4), (0.08, 7.4), (0.25, 6.2), (0.55, 5.6), (0.82, 5.8), (0.95, 5.5), (1.0, 4.7)], 8, 15, ex=1.0, ey=1.15, tile=7.0, flute=0.10, erosion=0.13, lean=0.03)
