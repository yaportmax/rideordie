"""build - assemble, finish and export one (or all) player truck(s).

    blender -b --factory-startup -P tools/blender/vehicles/player/build.py -- --tier 1 [--fast] [--out models/_test/dev.glb]
    --fast  : skip AO bake + textures       --tier all : truck_t1..t4
"""
import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *  # noqa
import vlib
from tiers import tier
from truck import Truck
import kits


MERGE_ALL = {'plastic': 'rubber', 'canvas': 'fabric', 'brass': 'metal_dark'}
MERGE_WHEEL = {'chrome': 'rim', 'metal_bare': 'rim', 'rust': 'metal_dark'}


def build(n, fast=False, out=None, notex=False, noao=False):
    t0 = time.time()
    new_scene()
    C = tier(n)
    T = Truck(C, seed=n)
    kit = kits.KITS.get(n)
    T.build_all(kit=kit)
    body = T.b.build()
    panels = [p.build() for p in T.parts.values()]
    wheels = [p.build() for p in T.wheels.values()]
    objs = [body] + panels
    for o in objs + wheels:
        remap_materials(o, MERGE_ALL)
    for o in wheels:
        remap_materials(o, MERGE_WHEEL)
    for o in objs + wheels:
        weighted_normals(o)
    print("T%d geometry %.1fs  tris %d" % (n, time.time() - t0, mesh_stats(objs + wheels)))
    # ---- textures (UV + grunge)
    for o in objs + wheels:
        box_uv(o, 0.8)
    if notex:
        pass
    g_paint = make_grunge("wear_paint_t%d" % n, 1024, 'paint', C.wear, seed=n * 7)
    g_paint2 = make_grunge("wear_paint2_t%d" % n, 1024, 'paint', min(1.0, C.wear + 0.15), seed=n * 7 + 3)
    g_metal = make_grunge("wear_metal_t%d" % n, 1024, 'metal', C.wear, seed=n * 7 + 5)
    if not notex:
        hook_texture('paint', g_paint)
        hook_texture('paint2', g_paint2)
    used = set()
    for o in objs + wheels:
        for m in o.data.materials:
            used.add(m.name)
    for mn, st in (('metal_bare', 1.0), ('rust', 1.0), ('armor', 0.8), ('wood', 1.0), ('fabric', 0.7), ('interior', 0.6), ('metal_dark', 0.5), ('leather', 0.7), ('rim', 0.6), ('spike', 0.6)):
        if mn in used and not notex:
            hook_colored(mn, g_metal, st, tag='_t%d' % n)
    if not fast and not noao:
        finish_colors(objs, wheels, wear=C.wear)
    else:
        fill_col(objs + wheels, 1.0)
    dst = out or ("models/vehicles/%s.glb" % C.id)
    export(dst, objs + wheels + vlib._SOCKETS)
    print("T%d done %.1fs" % (n, time.time() - t0))
    return T


if __name__ == "__main__":
    a = rod_lib.argv()
    fast = 'fast' in a
    tt = a.get('tier', '1')
    tiers_ = [1, 2, 3, 4] if tt == 'all' else [int(tt)]
    for n in tiers_:
        build(n, fast=fast, out=a.get('out'), notex='notex' in a, noao='noao' in a)
