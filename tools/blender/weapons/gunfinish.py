"""Texture pipeline for the weapon set (runs inside Blender, headless).

  1. UV-unwrap every mesh of the gun into ONE atlas with uniform texel density.
  2. Cycles-bake geometric masks into that atlas: AO (small+large), convex edge mask, world position, normal, material id.
  3. Composite worn / dirty / oiled PBR maps in numpy from those masks (per palette material recipe).
  4. Replace the flat palette materials by textured glTF-friendly materials (base colour + ORM + normal) that keep the palette NAMES.
"""
import bpy
import bmesh
import math
import os
import time
import numpy as np
from mathutils import Vector
from gunlook import compose, MAT_IDS, DBG_DIR



# ---------------------------------------------------------------------------------------------- UV atlas
def unwrap_atlas(objs, margin=0.003):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")


# ---------------------------------------------------------------------------------------------- Cycles bake
def _setup_cycles(samples=16):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    try:
        pref = bpy.context.preferences.addons["cycles"].preferences
        pref.compute_device_type = "OPTIX"
        pref.get_devices()
        ok = False
        for d in pref.devices:
            d.use = d.type == "OPTIX"
            ok = ok or d.use
        cy.device = "GPU" if ok else "CPU"
    except Exception as ex:
        print("bake: CPU fallback", ex)
        cy.device = "CPU"
    cy.samples = samples
    cy.use_denoising = False
    cy.use_adaptive_sampling = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.display_settings.display_device = "sRGB"
    sc.render.bake.margin = 10
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_clear = True
    sc.render.bake.target = "IMAGE_TEXTURES"
    w = bpy.data.worlds.new("bakeworld")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    return sc


def _bake_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m, nt, em, tex


def bake_masks(objs, size, mats_by_slot, log=print):
    """Return dict of numpy arrays (H,W,C) in Blender image order (row0 = bottom)."""
    sc = _setup_cycles()
    t0 = time.time()
    img_names = {}

    def new_img(name, float_buf):
        im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buf)
        im.colorspace_settings.name = "Non-Color"
        return im

    # shared bake material + per-id materials
    bm_mat, nt, em, tex = _bake_material("BAKE")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    bev = nt.nodes.new("ShaderNodeBevel")
    bev.samples = 24
    bev.inputs["Radius"].default_value = 0.0018
    dot = nt.nodes.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    nt.links.new(bev.outputs["Normal"], dot.inputs[0])
    nt.links.new(geo.outputs["True Normal"], dot.inputs[1])
    one = nt.nodes.new("ShaderNodeMath"); one.operation = "SUBTRACT"; one.inputs[0].default_value = 1.0
    nt.links.new(dot.outputs["Value"], one.inputs[1])
    gain = nt.nodes.new("ShaderNodeMath"); gain.operation = "MULTIPLY"; gain.inputs[1].default_value = 6.0
    nt.links.new(one.outputs["Value"], gain.inputs[0])
    id_mats = {}
    for k, n in enumerate(MAT_IDS):
        m, nt2, em2, tex2 = _bake_material("ID_" + n)
        em2.inputs["Color"].default_value = ((k + 1) / 32.0, 0, 0, 1)
        em2.inputs["Strength"].default_value = 1.0
        id_mats[n] = (m, tex2)

    def set_objs_mat(per_id=False):
        for o in objs:
            names = mats_by_slot[o.name]
            for i, n in enumerate(names):
                o.data.materials[i] = id_mats[n][0] if per_id else bm_mat

    def run(kind, imgname, float_buf=False, samples=8, per_id=False, em_src=None, ao_dist=None):
        im = new_img(imgname, float_buf)
        tex.image = im
        for n, (m, t2) in id_mats.items():
            t2.image = im
        for nn, mm in ([("BAKE", bm_mat)] + [(n, id_mats[n][0]) for n in id_mats]):
            ntree = mm.node_tree
            for nd in ntree.nodes:
                nd.select = False
            tn = next(x for x in ntree.nodes if x.type == "TEX_IMAGE")
            tn.select = True
            ntree.nodes.active = tn
        sc.cycles.samples = samples
        if em_src is not None:
            for l in list(nt.links):
                if l.to_node == em and l.to_socket.name == "Color":
                    nt.links.remove(l)
            nt.links.new(em_src, em.inputs["Color"])
        if ao_dist is not None:
            sc.world.light_settings.distance = ao_dist
        set_objs_mat(per_id)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type=kind)
        arr = np.zeros(size * size * 4, np.float32)
        im.pixels.foreach_get(arr)
        log("  baked %-8s %.1fs" % (imgname, time.time() - t0))
        out = arr.reshape(size, size, 4).copy()
        bpy.data.images.remove(im)
        return out

    res = {}
    res["ao_s"] = run("AO", "ao_s", samples=48, ao_dist=0.012)[..., 0]
    res["ao_b"] = run("AO", "ao_b", samples=48, ao_dist=0.09)[..., 0]
    res["edge"] = run("EMIT", "edge", samples=32, em_src=gain.outputs["Value"])[..., 0]
    res["id"] = run("EMIT", "id", samples=1, per_id=True)[..., 0]
    res["id"] = np.rint(res["id"] * 32.0).astype(np.int16)
    geo_pos = nt.nodes.new("ShaderNodeNewGeometry")
    res["pos"] = run("EMIT", "pos", float_buf=True, samples=1, em_src=geo_pos.outputs["Position"])[..., :3]
    res["nrm"] = run("EMIT", "nrm", float_buf=True, samples=1, em_src=geo_pos.outputs["Normal"])[..., :3]
    return res


def dbg_save(name, arr):
    """debug: dump a mask (H,W) or (H,W,3) as PNG in ROD_DBG"""
    if not DBG_DIR:
        return
    a = np.asarray(arr, np.float32)
    if a.ndim == 2:
        a = np.stack([a, a, a], 2)
    h, w = a.shape[:2]
    im = bpy.data.images.new("dbg_" + name, w, h, alpha=False)
    im.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(a, 0, 1)
    im.pixels.foreach_set(rgba.ravel())
    im.file_format = "PNG"
    os.makedirs(DBG_DIR, exist_ok=True)
    im.filepath_raw = os.path.join(DBG_DIR, "dbg_" + name + ".png")
    im.save()
    bpy.data.images.remove(im)


# ---------------------------------------------------------------------------------------------- images / materials
def _mk_image(name, arr3, colorspace, fmt="PNG", quality=93):
    import tempfile
    h, w = arr3.shape[:2]
    tmp = bpy.data.images.new(name + "_tmp", w, h, alpha=False)
    tmp.colorspace_settings.name = colorspace
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr3, 0, 1)
    tmp.pixels.foreach_set(rgba.ravel())
    d = os.path.join(tempfile.gettempdir(), "rod_tex")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, name + (".jpg" if fmt == "JPEG" else ".png"))
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.quality = quality
    if fmt == "PNG":
        sc.render.image_settings.compression = 90
    tmp.save_render(path, scene=sc)
    if DBG_DIR:
        os.makedirs(DBG_DIR, exist_ok=True)
        tmp.save_render(os.path.join(DBG_DIR, name + ".png"), scene=sc) if fmt == "PNG" else None
        import shutil
        shutil.copy(path, os.path.join(DBG_DIR, os.path.basename(path)))
    bpy.data.images.remove(tmp)
    im = bpy.data.images.load(path)
    im.name = name
    im.colorspace_settings.name = colorspace
    print("  texture %s %dx%d %.0f KB" % (name, w, h, os.path.getsize(path) / 1024))
    return im


def _occlusion_group():
    if "glTF Material Output" in bpy.data.node_groups:
        return bpy.data.node_groups["glTF Material Output"]
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupInput")
    return g


def textured_material(name, alb, orm, nrm, k=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs["BSDF"], out.inputs["Surface"])
    ta = nt.nodes.new("ShaderNodeTexImage"); ta.image = alb
    to = nt.nodes.new("ShaderNodeTexImage"); to.image = orm
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nrm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nm = nt.nodes.new("ShaderNodeNormalMap")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs["B"].default_value = (1.0 - 0.004 * k, 1.0 - 0.002 * k, 1.0, 1.0)     # unique per material name (keeps glTF materials distinct; runtime tint slot)
    nt.links.new(ta.outputs["Color"], mix.inputs["A"])
    nt.links.new(mix.outputs["Result"], bs.inputs["Base Color"])
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    grp = nt.nodes.new("ShaderNodeGroup"); grp.node_tree = _occlusion_group()
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    SPEC = {"polymer": 0.24, "rubber": 0.20, "wood": 0.30, "gun_black": 0.34}
    if "Specular IOR Level" in bs.inputs:
        bs.inputs["Specular IOR Level"].default_value = SPEC.get(name, 0.5)
    m.use_backface_culling = True
    return m


# ---------------------------------------------------------------------------------------------- entry
def finish_textures(gun, size=2048, style=None):
    t0 = time.time()
    style = dict(style or {})
    style.update(gun.notes.get("style", {}))
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    mats_by_slot = {o.name: [m.name for m in o.data.materials] for o in objs}
    log = print
    log("FINISH %s: %d meshes, atlas %d" % (gun.name, len(objs), size))
    unwrap_atlas(objs)
    log("  uv unwrap %.1fs" % (time.time() - t0))
    import tempfile
    cache = os.path.join(tempfile.gettempdir(), "rod_tex", "%s_%d_masks.npz" % (gun.name, size))
    if gun.args.get("recompose") and os.path.exists(cache):
        z = np.load(cache)
        masks = {k: z[k] for k in z.files}
        log("  masks loaded from cache")
    else:
        masks = bake_masks(objs, size, mats_by_slot, log)
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        np.savez_compressed(cache, **masks)
    A, O, NM, texel = compose(masks, size, style, log, dbg_save)
    ia = _mk_image(gun.name + "_albedo", A, "sRGB", "JPEG")
    io = _mk_image(gun.name + "_orm", O, "Non-Color", "JPEG")
    inn = _mk_image(gun.name + "_normal", NM, "Non-Color", "PNG")
    used = sorted(set(x for v in mats_by_slot.values() for x in v), key=lambda n: MAT_IDS.index(n) if n in MAT_IDS else 99)
    import gunlib
    dummy = bpy.data.materials.new("_dummy")
    for o in objs:
        for i in range(len(mats_by_slot[o.name])):
            o.data.materials[i] = dummy
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    gunlib.RL._MATS.clear()
    tm = {}
    for k, n in enumerate(used):
        tm[n] = None if n == "glass_lens" else textured_material(n, ia, io, inn, k)
        if n == "glass_lens":
            tm[n] = gunlib.palette_mat(n)
    for o in objs:
        for i, n in enumerate(mats_by_slot[o.name]):
            o.data.materials[i] = tm[n]
    bpy.data.materials.remove(dummy)
    log("  finish done %.1fs" % (time.time() - t0))
    return dict(albedo=ia, orm=io, normal=inn, texel=texel)
