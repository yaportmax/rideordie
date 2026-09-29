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


TIER_PAL = {
    1: dict(paint=dict(rough=0.64, clearcoat=0.0), paint2=dict(rough=0.66, clearcoat=0.0)),
    2: dict(paint=dict(rough=0.56, clearcoat=0.05), paint2=dict(rough=0.6, clearcoat=0.0)),
    3: dict(paint=dict(rough=0.72, clearcoat=0.0), paint2=dict(rough=0.6, clearcoat=0.0), armor=dict(rough=0.62)),
    4: dict(),
}
TIER_TWEAK = {3: dict(paint=dict(spec=0.18), paint2=dict(spec=0.3)), 4: dict(paint=dict(spec=0.28), paint2=dict(spec=0.35))}
MERGE_ALL = {'plastic': 'rubber', 'canvas': 'fabric', 'brass': 'metal_dark'}
MERGE_WHEEL = {'chrome': 'rim', 'metal_bare': 'rim', 'rust': 'metal_dark', 'metal_dark': 'rubber_tire'}
NODE_MERGE = {
    'lamp_head': {'chrome': 'light_head'},
    'panel_fender': {'rubber': 'metal_dark', 'metal_bare': 'metal_dark'},
    'panel_door': {'rubber': 'metal_dark'},
    'panel_tailgate': {'chrome': 'metal_bare'},
    'panel_armor': {'chrome': 'metal_bare', 'metal_dark': 'armor'},
    'panel_hood': {'rust': 'rust'},
}


def build(n, fast=False, out=None, notex=False, noao=False):
    t0 = time.time()
    new_scene()
    if os.environ.get('ROD_QA_PAINT'):
        h = os.environ['ROD_QA_PAINT']
        override_palette(paint=dict(base=tuple((int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4))))
    if os.environ.get('ROD_QA_PAINT2'):
        h = os.environ['ROD_QA_PAINT2']
        override_palette(paint2=dict(base=tuple((int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4))))
    C = tier(n)
    override_palette(**TIER_PAL.get(n, {}))
    vlib.DENT_K = getattr(C, 'dent_k', 1.0)
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
        for pref, mp in NODE_MERGE.items():
            if o.name.startswith(pref):
                remap_materials(o, mp)
    for o in objs + wheels:
        weighted_normals(o)
    print("T%d geometry %.1fs  tris %d" % (n, time.time() - t0, mesh_stats(objs + wheels)))
    print("  per node:", {o.name: mesh_stats([o]) for o in objs + wheels[:1]})
    for mn, kw in TIER_TWEAK.get(n, {}).items():
        tweak_mat(mn, **kw)
    # ---- textures (UV + grunge)
    for o in objs + wheels:
        box_uv(o, 0.8)
    if notex:
        pass
    g_paint = make_grunge("wear_paint_t%d" % n, 1024, 'paint', C.wear, seed=n * 7)
    g_paint2 = make_grunge("wear_paint2_t%d" % n, 1024, 'paint', min(1.0, C.wear + 0.15), seed=n * 7 + 3)
    g_metal = make_grunge("wear_metal_t%d" % n, 1024, 'metal', C.wear, seed=n * 7 + 5)
    if not notex:
        hook_colored('paint', g_paint, 1.0, tag='_t%d' % n)
        hook_colored('paint2', g_paint2, 1.0, tag='_t%d' % n)
    used = set()
    for o in objs + wheels:
        for m in o.data.materials:
            used.add(m.name)
    for mn, st in (('metal_bare', 1.0), ('rust', 1.0), ('armor', 0.8), ('wood', 1.0), ('fabric', 0.7), ('interior', 0.6), ('metal_dark', 0.5), ('leather', 0.7), ('rim', 0.6), ('spike', 0.6)):
        if mn in used and not notex:
            hook_colored(mn, g_metal, st, tag='_t%d' % n, size=(512 if mn in ('metal_dark', 'interior', 'fabric', 'leather', 'rim', 'spike', 'wood') else None))
    if not fast and not noao:
        finish_colors(objs, wheels, wear=C.wear)
    else:
        fill_col(objs + wheels, 1.0)
    for w in wheels:
        vs = np.array([tuple(v.co) for v in w.data.vertices])
        c = (vs.min(axis=0) + vs.max(axis=0)) / 2
        sz = vs.max(axis=0) - vs.min(axis=0)
        print("  %s local bbox centre (%.3f %.3f %.3f) size (%.3f %.3f %.3f)" % (w.name, c[0], c[1], c[2], sz[0], sz[1], sz[2]))
    print("  mesh nodes %d, primitives %d" % (len(objs + wheels), sum(len(o.data.materials) for o in objs + wheels)))
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
