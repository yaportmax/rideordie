"""build - assemble, finish and export one (or all) player truck(s).

    blender -b --factory-startup -P tools/blender/vehicles/player/build.py -- --tier 1 [--fast] [--out models/_test/dev.glb]
    --fast  : skip AO bake        --tier all : truck_t1..t4
Texture inputs come from tools/blender/vehicles/player/tex/ (regenerate with gen_tex.py, see its header).
"""
import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from post import *  # noqa
import vlib
from tiers import tier
from truck import Truck
from interior import STYLE
import kits


TIER_PAL = {
    1: dict(paint=dict(rough=0.64, clearcoat=0.0), paint2=dict(rough=0.66, clearcoat=0.0)),
    2: dict(paint=dict(rough=0.56, clearcoat=0.05), paint2=dict(rough=0.6, clearcoat=0.0)),
    3: dict(paint=dict(rough=0.72, clearcoat=0.0), paint2=dict(rough=0.6, clearcoat=0.0), armor=dict(rough=0.62)),
    4: dict(),
}
TIER_TWEAK = {3: dict(paint=dict(spec=0.18), paint2=dict(spec=0.3)), 4: dict(paint=dict(spec=0.28), paint2=dict(spec=0.35))}
MERGE_ALL = {'plastic': 'rubber'}
MERGE_WHEEL = {'chrome': 'rim', 'metal_bare': 'rim', 'rust': 'metal_dark', 'metal_dark': 'rubber_tire'}
NODE_MERGE = {
    'panel_fender': {'rubber': 'metal_dark', 'metal_bare': 'metal_dark'},
    'panel_door': {'rubber': 'metal_dark'},
    'panel_tailgate': {'chrome': 'metal_bare'},
    'panel_armor': {'chrome': 'metal_bare', 'metal_dark': 'armor'},
    'panel_hood': {'rust': 'rust'},
}
# per material: (UV0 scale = albedo/grunge, UV1 scale = detail normal)   [uv = metres * scale]
UVS = {'paint': (0.8, 1.0), 'paint2': (0.8, 1.0), 'metal_dark': (0.8, 1.6), 'metal_bare': (0.8, 1.6), 'rust': (0.8, 2.0), 'armor': (0.8, 1.2),
       'rim': (0.8, 2.0), 'spike': (0.8, 2.0), 'interior': (0.8, 6.0), 'leather': (0.8, 6.0), 'fabric': (0.8, 5.0), 'rubber': (0.8, 6.0),
       'wood': (1.2, 2.0), 'rubber_tire': (0.8, 2.0), 'chrome': (0.8, 1.0), 'decal': (1.0, 1.0), 'canvas': (0.8, 4.0), 'brass': (0.8, 1.0)}
# per material: (normal image, strength, uv layer)
NMAP = {'paint': ('n_metal.png', 0.3), 'paint2': ('n_metal.png', 0.3), 'metal_dark': ('n_metal.png', 0.45), 'metal_bare': ('n_metal.png', 0.55),
        'rust': ('n_cast.png', 1.0), 'armor': ('n_cast.png', 0.6), 'rim': ('n_metal.png', 0.35), 'spike': ('n_metal.png', 0.35),
        'interior': ('n_stipple.png', 0.35), 'leather': ('n_grain.png', 0.3), 'fabric': ('n_weave.png', 0.6), 'rubber': ('n_grain.png', 0.25),
        'wood': ('n_cast.png', 0.35), 'canvas': ('n_weave.png', 0.8)}


def tier_palette(n):
    st = STYLE[n]
    pal = {k: dict(v) for k, v in TIER_PAL.get(n, {}).items()}
    hb = 1.0 / CAB_BASE          # vertex-colour headroom in the cab (post.finish_colors)
    pal.setdefault('leather', {}).update(base=tuple(c * hb for c in st['pad_col']), rough=st['leather_rough'])
    pal.setdefault('interior', {}).update(base=tuple(c * hb for c in st['face_col']), rough=0.8 if n < 4 else 0.5)
    pal.setdefault('fabric', {}).update(base=tuple(c * hb for c in st['fabric_col']))
    if n == 4:
        pal['interior'].update(metal=0.0)
    return pal


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
    override_palette(**tier_palette(n))
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
    for mn, sp in (('interior', 0.12 if n < 4 else 0.3), ('leather', 0.14), ('fabric', 0.08), ('canvas', 0.08), ('rubber', 0.15), ('rubber_tire', 0.2), ('decal', 0.2), ('wood', 0.15)):
        tweak_mat(mn, spec=sp)
    # ---- textures (UV + grunge + detail normals + decal atlas)
    uvs = dict(UVS)
    if n == 4:
        uvs['interior'] = (5.0, 5.0)          # carbon weave: albedo + normal share UV0
    for o in objs + wheels:
        box_uv2(o, uvs)
        decal_uv(o)
    g_paint = make_grunge("wear_paint_t%d" % n, 1024, 'paint', C.wear, seed=n * 7)
    g_paint2 = make_grunge("wear_paint2_t%d" % n, 1024, 'paint', min(1.0, C.wear + 0.15), seed=n * 7 + 3)
    g_metal = make_grunge("wear_metal_t%d" % n, 1024, 'metal', C.wear, seed=n * 7 + 5)
    g_soft = make_grunge("wear_soft_t%d" % n, 1024, 'soft', C.wear, seed=n * 7 + 9)
    used = set()
    for o in objs + wheels:
        for m in o.data.materials:
            used.add(m.name)
    if not notex:
        hook_colored('paint', g_paint, 1.0, tag='_t%d' % n)
        hook_colored('paint2', g_paint2, 1.0, tag='_t%d' % n)
        for mn, stn in (('metal_bare', 1.0), ('rust', 1.0), ('armor', 0.8), ('wood', 1.0), ('fabric', 0.7), ('canvas', 0.9), ('interior', 0.6), ('metal_dark', 0.5), ('leather', 0.7), ('rim', 0.6), ('spike', 0.6), ('brass', 0.5)):
            if mn not in used:
                continue
            detail, dk, size = None, 1.0, (512 if mn in ('metal_dark', 'interior', 'fabric', 'leather', 'rim', 'spike', 'wood', 'canvas', 'brass') else None)
            if mn == 'leather' and n == 1:
                detail, dk, size = 'a_crack.png', 0.85, 1024
            if mn == 'interior' and n == 4:
                detail, dk, size = 'a_carbon.png', 0.8, 1024
            if mn == 'wood':
                detail, dk, size = 'a_wood.png', 1.0, 512
            hook_colored(mn, g_soft if mn in ('leather', 'interior', 'fabric') else g_metal, stn, tag='_t%d' % n, size=size, detail=detail, detail_k=dk)
        for mn, (img, strength) in NMAP.items():
            if mn in used:
                carbon = mn == 'interior' and n == 4
                s0, s1 = uvs.get(mn, (0.8, 1.0))
                hook_normal(mn, load_tex('n_carbon.png' if carbon else img, noncolor=True), 0.6 if carbon else strength, scale=1.0 if carbon else s1 / s0)
        if 'decal' in used:
            hook_image('decal', load_tex('decal_atlas.png'))
    if not fast and not noao:
        finish_colors(objs, wheels, wear=C.wear, cab=(C.door_hw - 0.05, C.f_back - 0.02, C.f_cowl + 0.01, C.z_floor - 0.1, C.z_roof - 0.01))
    else:
        fill_col(objs + wheels, 1.0)
    for w in wheels:
        vs = np.array([tuple(v.co) for v in w.data.vertices])
        c = (vs.min(axis=0) + vs.max(axis=0)) / 2
        sz = vs.max(axis=0) - vs.min(axis=0)
        print("  %s local bbox centre (%.3f %.3f %.3f) size (%.3f %.3f %.3f)" % (w.name, c[0], c[1], c[2], sz[0], sz[1], sz[2]))
    # ---- steering wheel: child of the steering_wheel socket, geometry in the socket frame (local Z = column)
    sw = next((o for o in panels if o.name == 'steering_wheel_mesh'), None)
    sock = next((s for s in vlib._SOCKETS if s.name == 'steering_wheel'), None)
    if sw is not None and sock is not None:
        bpy.context.view_layer.update()
        mw = sw.matrix_world.copy()
        sw.parent = sock
        sw.matrix_parent_inverse.identity()
        local = sock.matrix_world.inverted() @ mw
        sw.data.transform(local)
        sw.matrix_basis.identity()
    # ---- sockets that ride on detachable panels (door mirror glass)
    for sname, pname in getattr(T, 'socket_parent', {}).items():
        so = next((s for s in vlib._SOCKETS if s.name == sname), None)
        po = next((o for o in panels if o.name == pname), None)
        if so is not None and po is not None:
            bpy.context.view_layer.update()
            mw = so.matrix_world.copy()
            so.parent = po
            so.matrix_parent_inverse.identity()
            so.matrix_world = mw
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
