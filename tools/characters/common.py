"""Shared build helpers used by every character script."""
import numpy as np

import bake
import cloth
import kit
import mh
import parts
import texlib
import uvbake as U


# --- body skin ----------------------------------------------------------------------------------------

def cull_tris(ch, covers, keep_extra=None):
    """Body triangles (ch.tv) minus those lying under garments (`covers`: list of (T,3) body-vertex triples)."""
    tv = ch.tv
    tt = ch.tt
    if not covers:
        return tv, tt
    key = np.sort(tv, axis=1)
    codes = key[:, 0] * 40000 * 40000 + key[:, 1] * 40000 + key[:, 2]
    cov = np.sort(np.concatenate(covers), axis=1)
    ccodes = cov[:, 0] * 40000 * 40000 + cov[:, 1] * 40000 + cov[:, 2]
    keep = ~np.isin(codes, ccodes)
    if keep_extra is not None:
        keep |= keep_extra
    return tv[keep], tt[keep]


def add_skin(ctx, tris, albedo, rough=0.78, normal=None):
    """Skin prim from the (culled) body triangles with the painted albedo (HxWx3 uint8/float)."""
    ch = ctx.ch
    tv, tt = tris
    nrm = mh.vertex_normals(ch.pos, ch.tv)          # normals from the FULL body (seamless at cull borders)
    m = mh.split_seams(ch.pos, nrm, ch.vt, tv, tt)
    j, w = mh.top4(ch.W[m["src"]])
    tex = ctx.glb.texture_array("skin_albedo", albedo, "jpg", 90)
    mat = ctx.material("skin", base_tex=tex, rough=rough, metallic=0.0,
                       normal_tex=None if normal is None else ctx.glb.texture_array("skin_normal", normal, "jpg", 92))
    ctx.add(dict(pos=mh.to_final(m["pos"]), nrm=mh.to_final(m["nrm"]), uv=m["uv"], joints=j, weights=w, idx=m["idx"]),
            mat, label="skin")


def add_eyes(ctx, colour="brown"):
    d, tex = parts.eyes(ctx.ch, colour)
    t = ctx.glb.texture_array("eye_" + colour, tex, "jpg", 92)
    mat = ctx.material("eye", base_tex=t, rough=0.3,
                       extensions={"KHR_materials_clearcoat": {"clearcoatFactor": 0.45, "clearcoatRoughnessFactor": 0.08}})
    ctx.add(d, mat, label="eyes")


# --- cloth atlas groups -------------------------------------------------------------------------------

def cloth_group(ctx, name, pieces, painter, ppm=500, extra=("depth", "ao"), group="main", color=(1, 1, 1, 1), rough=0.88,
                tile_ppm_min=250):
    """Pack finished pieces (from cloth.finish) into one atlas, bake attributes, paint albedo+height with `painter(bk)`
    -> (albedo float HxWx3, height metres HxW), write textures + material + skinned prims."""
    while True:
        try:
            atlas = cloth.pack(pieces, ppm)
            break
        except RuntimeError:
            ppm *= 0.85
    bk = bake.Baked(pieces, atlas, extra_names=extra)
    bk.ppm = ppm
    bk.fit = ctx.fit
    alb, h = painter(bk)
    alb, normal = finish_maps(alb, h, ppm)
    tb = ctx.glb.texture_array(name + "_albedo", alb, "jpg", 90)
    tn = ctx.glb.texture_array(name + "_normal", normal, "jpg", 92)
    mat = ctx.material(name, base_tex=tb, normal_tex=tn, rough=rough, metallic=0.0, double_sided=True, color=color)
    for pc in pieces:
        prim = dict(pos=mh.to_final(pc["pos"]), nrm=mh.to_final(pc["nrm"]), uv=pc["uv"], joints=pc["joints"], weights=pc["weights"],
                    idx=pc["idx"])
        ctx.add(prim, mat, group=group, label=name)
    return bk


def finish_maps(alb, h, ppm, cav_strength=0.35, strength=1.0):
    cav = np.clip((U.blur(h, max(0.01 * ppm, 1.0)) - h) / 0.0012, 0.0, 1.0)
    alb = np.clip(alb * (1.0 - cav_strength * cav[..., None]), 0, 1)
    return alb, U.height_to_normal(h, ppm, strength)


# --- gear materials (tiled textures) --------------------------------------------------------------------

_TEXKINDS = {"leather": "leather", "canvas": "canvas", "denim": "denim", "knit": "knit", "webbing": "webbing",
             "metal_dark": "metal_dark", "armor": "armor", "rubber": "rubber", "plastic": "plastic"}


def gear_material(ctx, name, kind, color=(1, 1, 1), rough=None, metal=None, size=512, alpha=None, seed=1,
                  double_sided=False, normal_scale=1.0):
    """A tiled-texture material named `name` (color is the tint multiplied over a grey-scale albedo)."""
    if ctx.has_material(name):
        return ctx.mats[name]
    t = texlib.make(kind, size, seed)
    glb = ctx.glb
    tb = glb.texture_array("%s_alb_%d" % (kind, seed), t["albedo"], "jpg", 88)
    tn = glb.texture_array("%s_nrm_%d" % (kind, seed), t["normal"], "jpg", 90)
    orm = t.get("orm")
    tm = glb.texture_array("%s_orm_%d" % (kind, seed), orm, "jpg", 88) if orm is not None else None
    kw = dict(base_tex=tb, normal_tex=tn, color=tuple(color) + (1.0,), normal_scale=normal_scale, double_sided=double_sided)
    if tm is not None:
        kw.update(mr_tex=tm, occ_tex=tm, rough=1.0 if rough is None else rough, metallic=1.0 if metal is None else metal)
    else:
        kw.update(rough=0.8 if rough is None else rough, metallic=0.0 if metal is None else metal)
    if alpha is not None:
        kw.update(alpha_mode="BLEND")
        kw["color"] = tuple(color) + (alpha,)
    return ctx.material(name, **kw)


def plain_material(ctx, name, color, rough=0.6, metal=0.0, alpha=None, emissive=None, double_sided=False, **kw):
    if ctx.has_material(name):
        return ctx.mats[name]
    c = tuple(color) + ((alpha,) if alpha is not None else (1.0,))
    return ctx.material(name, color=c, rough=rough, metallic=metal, alpha_mode="BLEND" if alpha is not None else None,
                        emissive=emissive, double_sided=double_sided, **kw)


# --- gear placement -----------------------------------------------------------------------------------

def add_gear(ctx, mesh, material, binder, bone=None, blend=None, group="main", label="gear", body_k=3, col=None):
    """Skin a kit mesh and add it. bone: rigid to that bone; blend: (a, b, axis_fn) or None -> use body weights."""
    if mesh is None:
        return
    P = mesh["pos"]
    if bone is not None:
        j, w = binder.bone(P, bone)
    elif blend is not None:
        a, b, t = blend
        j, w = binder.blend(P, a, b, t(P) if callable(t) else t)
    else:
        j, w = binder.body(P, k=body_k)
    p = kit.to_prim(mesh, j, w)
    ctx.add(p, material, group=group, label=label)


def hem_wear_colors(mesh, base=(1, 1, 1), edge=0.25, seed=0):
    """Vertex colours: darker with cavities/noise, lighter worn edges from normal variation (cheap)."""
    n = len(mesh["pos"])
    rng = np.random.default_rng(seed)
    col = np.ones((n, 3)) * np.asarray(base)
    col *= (1.0 - 0.10 * rng.random((n, 1)))
    m = dict(mesh)
    m["col"] = col
    return m


def add_tiled_piece(ctx, pc, material, tile=0.25, group="main", label="piece", color=None):
    """A cloth.finish() piece using a tiled material: UV = tube metres / tile."""
    prim = dict(pos=mh.to_final(pc["pos"]), nrm=mh.to_final(pc["nrm"]), uv=pc["uv_m"] / tile, joints=pc["joints"],
                weights=pc["weights"], idx=pc["idx"])
    if color is not None:
        prim["color"] = color
    ctx.add(prim, material, group=group, label=label)


def piece_ao_colors(pc, strength=0.5, base=1.0):
    """Vertex colours from the piece's baked-in per-vertex ao (darker in crevices)."""
    ao = pc.get("ao")
    if ao is None:
        return None
    c = base * (1.0 - strength * ao)
    return np.stack([c, c, c], axis=1)


def add_hair(ctx, name, colour, size=1024, rough=0.6, label="hair", strength=1.0, lift=0.0, spec_boost=None):
    """A MakeHuman hair asset recoloured and added as the `hair` material (alpha-tested, double sided)."""
    d, src = parts.hair_asset(ctx.ch, name)
    tex = parts.tint_hair_texture(src, colour, size, strength, lift)
    t = ctx.glb.texture_array("hair_" + name, tex, "png")
    mat = ctx.material("hair", base_tex=t, rough=rough, alpha_mode="MASK", alpha_cutoff=0.42, double_sided=True)
    ctx.add(d, mat, label=label)
    return d
