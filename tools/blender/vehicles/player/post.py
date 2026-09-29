"""post - finishing passes for the player trucks: weighted normals, vertex AO/dirt, grunge textures, export."""
import bpy
import bmesh
import math
import os
import sys
import numpy as np
from mathutils import Vector, Matrix

from vlib import *  # noqa
import vlib
import rod_lib


# ------------------------------------------------------------------------------------------------- normals
def weighted_normals(obj, weight=70):
    md = obj.modifiers.new("WN", "WEIGHTED_NORMAL")
    md.mode = 'FACE_AREA'
    md.weight = weight
    md.keep_sharp = True
    md.thresh = 0.01
    rod_lib.apply_modifiers(obj)


def mesh_stats(objs):
    tris = 0
    for o in objs:
        if o.type == 'MESH':
            me = o.data
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
    return tris


# ------------------------------------------------------------------------------------------------- textures
def _noise(rng, s, beta, aniso=(1.0, 1.0)):
    f = np.fft.fftfreq(s)
    fx, fy = np.meshgrid(f * aniso[0], f * aniso[1])
    r = np.sqrt(fx ** 2 + fy ** 2)
    r[0, 0] = 1.0
    spec = (rng.normal(size=(s, s)) + 1j * rng.normal(size=(s, s))) / (r ** beta)
    spec[0, 0] = 0
    n = np.fft.ifft2(spec).real
    return (n - n.mean()) / (n.std() + 1e-9)


def _blur(a, sigma):
    s = a.shape[0]
    f = np.fft.fftfreq(s)
    fx, fy = np.meshgrid(f, f)
    k = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.ifft2(np.fft.fft2(a) * k).real


def _scratches(rng, s, count, length=(0.03, 0.25), vert=0.3):
    a = np.zeros((s, s))
    for _ in range(count):
        x0, y0 = rng.uniform(0, s, 2)
        ang = rng.uniform(0, math.pi) if rng.random() > vert else math.pi / 2 + rng.normal() * 0.15
        L = rng.uniform(*length) * s
        n = int(L)
        t = np.linspace(0, 1, max(n, 2))
        xs = (x0 + np.cos(ang) * L * t + rng.normal(0, 0.6, n if n >= 2 else 2).cumsum() * 0.05) % s
        ys = (y0 + np.sin(ang) * L * t) % s
        w = rng.uniform(0.4, 1.0)
        np.add.at(a, (ys.astype(int), xs.astype(int)), w)
    return np.clip(_blur(a, 0.7) * 3.0, 0, 1)


def make_grunge(name, size=1024, kind='paint', wear=0.5, seed=1, out_dir=None):
    """Tileable grayscale wear map. kind: 'paint' (sun fade, chips, scratches, streaks) or 'metal'."""
    rng = np.random.default_rng(seed)
    s = size
    if kind == 'paint':
        v = np.full((s, s), 0.90)
        v += 0.05 * _noise(rng, s, 2.4) * (0.4 + wear)
        v += 0.025 * _noise(rng, s, 1.0)
        streak = _noise(rng, s, 1.7, aniso=(1.0, 0.05))
        v *= 1.0 - np.clip(streak * 0.14 * wear + 0.03 * wear, 0, 0.32)
        blot = _noise(rng, s, 2.6)
        v *= 1.0 - np.clip(blot - 0.6, 0, 3) * 0.16 * wear
        chips = _noise(rng, s, 1.15)
        ch = np.clip((chips - (2.10 - wear * 0.35)) * 3.0, 0, 1)
        ch = _blur(ch, 0.8)
        v = v * (1 - ch * 0.50)
        sc = _scratches(rng, s, int(70 * (0.3 + wear)), (0.02, 0.12))
        v = v * (1 - sc * 0.22 * (0.4 + wear))
        sc2 = _scratches(rng, s, int(24 * (0.3 + wear)), (0.03, 0.15), 0.1)
        v = np.clip(v + sc2 * 0.08, 0, 1.0)
    else:
        v = np.full((s, s), 0.82)
        v += 0.10 * _noise(rng, s, 2.2) * (0.4 + wear)
        v += 0.05 * _noise(rng, s, 1.0)
        streak = _noise(rng, s, 1.6, aniso=(1.0, 0.05))
        v *= 1.0 - np.clip(streak * 0.18 * wear + 0.04 * wear, 0, 0.35)
        sc = _scratches(rng, s, int(120 * (0.3 + wear)), (0.02, 0.14))
        v = np.clip(v + sc * 0.22, 0, 1.0)
        blot = _noise(rng, s, 2.4)
        v *= 1.0 - np.clip(blot - 0.3, 0, 3) * 0.20 * wear
    v = np.clip(v, 0.03, 0.97)
    rgba = np.ones((s, s, 4), dtype=np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = v
    img = bpy.data.images.new(name, s, s, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(rgba.ravel())
    out_dir = out_dir or os.path.join(ROOT, "shots", "vehicles", "_tex")
    os.makedirs(out_dir, exist_ok=True)
    fp = os.path.join(out_dir, name + ".png")
    img.filepath_raw = fp
    img.file_format = 'PNG'
    img.save()
    img2 = bpy.data.images.load(fp)
    img2.name = name
    bpy.data.images.remove(img)
    img2.name = name
    return img2


def hook_texture(matname, img):
    m = M(matname)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    base = tuple(bsdf.inputs['Base Color'].default_value)
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0
    mix.inputs['Color2'].default_value = base
    nt.links.new(tex.outputs['Color'], mix.inputs['Color1'])
    nt.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])


# ------------------------------------------------------------------------------------------------- UV (world box projection)
def box_uv(obj, scale=1.0, layer='UVMap'):
    """Per-face dominant-axis planar projection in world (game) space. 1 uv unit = 1/scale metres... i.e. uv = metres*scale."""
    me = obj.data
    if layer not in me.uv_layers:
        me.uv_layers.new(name=layer)
    uv = me.uv_layers[layer]
    nl = len(me.loops)
    if nl == 0:
        return
    nv = len(me.vertices)
    co = np.empty(nv * 3, dtype=np.float64)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3) + np.array(obj.matrix_world.translation)
    lv = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get('vertex_index', lv)
    npoly = len(me.polygons)
    pn = np.empty(npoly * 3, dtype=np.float64)
    me.polygons.foreach_get('normal', pn)
    pn = np.abs(pn.reshape(-1, 3))
    lt = np.empty(npoly, dtype=np.int32)
    me.polygons.foreach_get('loop_total', lt)
    lp = np.repeat(np.arange(npoly), lt)
    ax = np.argmax(pn, axis=1)[lp]
    p = co[lv]
    x, y, z = p[:, 0], -p[:, 1], p[:, 2]
    u = np.where(ax == 0, y, x)
    v = np.where(ax == 2, y, z)
    # small per-object offset so parts do not all repeat identically
    off = (hash(obj.name) % 997) / 997.0
    uvs = np.stack([u * scale + off, v * scale + off * 0.7], axis=1).astype(np.float32)
    uv.data.foreach_set('uv', uvs.ravel())


# ------------------------------------------------------------------------------------------------- vertex colours (AO + dirt)
def ensure_col(obj):
    me = obj.data
    if 'Col' not in me.color_attributes:
        me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = me.color_attributes['Col']
    try:
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    except Exception:
        pass


def bake_ao(objs, dist=1.0, samples=48, ground=True):
    """Cycles AO bake to vertex colours for all objs at once (scene geometry occludes)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    w = bpy.data.worlds.new("aow")
    w.use_nodes = True
    sc.world = w
    w.light_settings.distance = dist
    gobj = None
    if ground:
        bpy.ops.mesh.primitive_circle_add(vertices=48, radius=25, fill_type='NGON', location=(0, 0, -0.001))
        gobj = bpy.context.active_object
        gobj.name = "__ground"
    for o in objs:
        ensure_col(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    if gobj is not None:
        bpy.data.objects.remove(gobj, do_unlink=True)


def shade_vcol(objs, fn, ao_strength=0.85):
    """Rewrite Col = fn(ao, x, f, z, nx, nf, nz) per point (world game coords). fn returns (r,g,b) arrays or a gray array."""
    for o in objs:
        me = o.data
        if 'Col' not in me.color_attributes:
            continue
        ca = me.color_attributes['Col']
        n = len(me.vertices)
        col = np.empty(n * 4, dtype=np.float32)
        ca.data.foreach_get('color', col)
        col = col.reshape(-1, 4)
        ao = col[:, 0].copy()
        co = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3) + np.array(o.matrix_world.translation)
        nm = np.empty(n * 3, dtype=np.float64)
        me.vertices.foreach_get('normal', nm)
        nm = nm.reshape(-1, 3)
        x, f, z = co[:, 0], -co[:, 1], co[:, 2]
        res = fn(ao ** ao_strength if False else ao, x, f, z, nm[:, 0], -nm[:, 1], nm[:, 2])
        if isinstance(res, tuple):
            r, g, b = res
        else:
            r = g = b = res
        col[:, 0], col[:, 1], col[:, 2], col[:, 3] = r, g, b, 1.0
        ca.data.foreach_set('color', col.ravel())


def fill_col(objs, v=1.0):
    for o in objs:
        ensure_col(o)
        me = o.data
        ca = me.color_attributes['Col']
        n = len(me.vertices)
        col = np.full(n * 4, v, dtype=np.float32)
        col[3::4] = 1.0
        ca.data.foreach_set('color', col)


def vnoise(x, y, z, freq=1.0, seed=0.0):
    """cheap smooth 3D noise ~[-1,1] from sin products."""
    a = np.sin(x * 3.1 * freq + seed) * np.sin(y * 2.7 * freq + seed * 1.3) + np.sin(z * 4.3 * freq + seed * 0.7) * np.sin(x * 1.9 * freq + y * 2.3 * freq)
    b = np.sin(x * 9.7 * freq + z * 5.1 * freq + seed) * np.sin(y * 8.3 * freq - z * 6.7 * freq)
    return 0.7 * a * 0.5 + 0.3 * b


# ------------------------------------------------------------------------------------------------- export
def export(path, objs, quality=85):
    vs = bpy.context.scene.view_settings
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure = 0.0
    vs.gamma = 1.0
    if not os.path.isabs(path):
        path = os.path.join(PUBLIC, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    sel = set()

    def add(o):
        sel.add(o)
        for c in o.children:
            add(c)
    for o in objs:
        add(o)
    for o in sel:
        o.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
              export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=False,
              export_image_format='JPEG', export_jpeg_quality=quality, export_texcoords=True, export_normals=True,
              export_tangents=False, export_vertex_color='ACTIVE', export_animations=False, export_skins=False)
    bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", path, "%.0f KB" % (os.path.getsize(path) / 1024))
    return path


# ------------------------------------------------------------------------------------------------- material textures (colour x grunge)
def _srgb(c):
    return c ** (1 / 2.2) if c > 0 else 0.0


def hook_colored(matname, grunge_img, strength=1.0, tint=None, tag='', size=None):
    """Bake  material base colour x grunge  into its own image (exporter cannot export texture x factor)."""
    m = M(matname)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    base = list(bsdf.inputs['Base Color'].default_value)[:3]
    if tint is not None:
        base = [a * b for a, b in zip(base, tint)]
    s = grunge_img.size[0]
    px = np.empty(s * s * 4, dtype=np.float32)
    grunge_img.pixels.foreach_get(px)
    g = px.reshape(s, s, 4)[..., 0]
    if size and size < s:
        k_ = s // size
        g = g.reshape(size, k_, size, k_).mean(axis=(1, 3))
        s = size
    g = 1.0 - (1.0 - g) * strength
    out = np.ones((s, s, 4), dtype=np.float32)
    for i in range(3):
        out[..., i] = np.clip(base[i] * g, 0, 1)
    name = "tex_" + matname + tag
    img = bpy.data.images.new(name, s, s, alpha=False)
    img.pixels.foreach_set(out.ravel())
    d = os.path.join(ROOT, "shots", "vehicles", "_tex")
    os.makedirs(d, exist_ok=True)
    fp = os.path.join(d, name + ".png")
    img.filepath_raw = fp
    img.file_format = 'PNG'
    img.save()
    img2 = bpy.data.images.load(fp)
    img2.name = name
    bpy.data.images.remove(img)
    img2.name = name
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img2
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])


def vert_mask(o, names):
    me = o.data
    mask = np.zeros(len(me.vertices), dtype=bool)
    idx = [i for i, m in enumerate(me.materials) if m and m.name in names]
    if not idx:
        return mask
    for p in me.polygons:
        if p.material_index in idx:
            for v in p.vertices:
                mask[v] = True
    return mask


def finish_colors(objs, wheel_objs, wear=0.5, ao_dist=0.55, samples=40, dirt=0.35):
    """AO bake + dirt/grime gradient into Col (grayscale, multiplies base colour in the engine)."""
    allo = objs + wheel_objs
    for o in allo:
        ensure_col(o)
    # 1) body + panels AO with the wheels in the scene (arches darken tyres' neighbours)
    bake_ao(objs, dist=ao_dist, samples=samples)
    # 2) wheels alone: hide everything else, no ground
    for o in objs:
        o.hide_render = True
    bake_ao_only(wheel_objs, dist=ao_dist * 0.6, samples=samples)
    for o in objs:
        o.hide_render = False

    def body_fn(ao, x, f, z, nx, nf, nz):
        a = 0.30 + 0.70 * np.clip(ao, 0, 1) ** 1.25
        low = 1.0 - dirt * (1.0 - np.clip((z - 0.15) / 0.9, 0, 1)) ** 1.5
        n = 1.0 + 0.07 * vnoise(x, f, z, 1.3, 2.0) + 0.05 * vnoise(x, f, z, 4.0, 5.0)
        up = 1.0 + 0.06 * np.clip(nz, 0, 1) * (1.0 - wear * 0.3)
        g = np.clip(a * low * n * up, 0.05, 1.0)
        return g * 1.0, g * (0.985 - 0.03 * (1 - low)), g * (0.96 - 0.08 * (1 - low))
    shade_vcol(objs, body_fn)

    def wheel_fn(ao, x, f, z, nx, nf, nz):
        a = 0.35 + 0.65 * np.clip(ao, 0, 1) ** 1.2
        n = 1.0 + 0.10 * vnoise(x * 3, f * 3, z * 3, 2.0, 1.0)
        g = np.clip(a * n, 0.05, 1.0)
        return g, g * 0.97, g * 0.93
    shade_vcol(wheel_objs, wheel_fn)
    # chrome / bright metal: keep reflections lively (AO floor)
    for o in allo:
        mask = vert_mask(o, ('chrome',))
        if mask.any():
            me = o.data
            ca = me.color_attributes['Col']
            col = np.empty(len(me.vertices) * 4, dtype=np.float32)
            ca.data.foreach_get('color', col)
            col = col.reshape(-1, 4)
            col[mask, :3] = np.maximum(col[mask, :3], 0.78)
            ca.data.foreach_set('color', col.ravel())
    # glass / emissive stay clean
    for o in allo:
        mask = vert_mask(o, ('glass', 'glass_lens', 'light_head', 'light_tail', 'light_amber'))
        if mask.any():
            me = o.data
            ca = me.color_attributes['Col']
            col = np.empty(len(me.vertices) * 4, dtype=np.float32)
            ca.data.foreach_get('color', col)
            col = col.reshape(-1, 4)
            col[mask, :3] = 1.0
            ca.data.foreach_set('color', col.ravel())


def bake_ao_only(objs, dist=0.3, samples=32):
    sc = bpy.context.scene
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    sc.world.light_settings.distance = dist
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)


def remap_materials(o, mapping):
    """Fold minor materials into major ones (fewer primitives / draw calls per node)."""
    me = o.data
    names = [m.name for m in me.materials]
    new_names, idxmap = [], {}
    for i, n in enumerate(names):
        t = mapping.get(n, n)
        if t not in new_names:
            new_names.append(t)
        idxmap[i] = new_names.index(t)
    if new_names == names:
        return
    pidx = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('material_index', pidx)
    pidx = np.array([idxmap[int(i)] for i in pidx], dtype=np.int32)
    me.materials.clear()
    for n in new_names:
        me.materials.append(M(n))
    me.polygons.foreach_set('material_index', pidx)
