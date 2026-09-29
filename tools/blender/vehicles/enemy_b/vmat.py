"""Palette materials + procedurally generated (numpy) tiling detail textures for the enemy_b vehicles.

Every material is a Principled BSDF whose maps are exporter-friendly:
  Base Color <- albedo image (sRGB), Roughness/Metallic <- G/B of an ORM-style image (Non-Color), Normal <- normal image.
`paint` / `paint2` albedo is grayscale, near white (runtime tints it).  Everything else has its colour baked in.
Textures are tileable and mapped in WORLD SCALE (see vlib.uv_project) so texel density is uniform across the vehicle.
"""
import bpy
import numpy as np

# ---------------------------------------------------------------------------------- noise helpers (tileable)
def _smooth(t):
    return t * t * (3 - 2 * t)


def vnoise(n, fx, fy, rng):
    """Tileable value noise on an n x n grid with fx*fy lattice cells -> float32 in [0,1]."""
    g = rng.random((fy, fx)).astype(np.float32)
    ys = np.arange(n) * fy / n
    xs = np.arange(n) * fx / n
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    ty = _smooth(ys - y0)[:, None]; tx = _smooth(xs - x0)[None, :]
    y0a = (y0 % fy)[:, None]; y1a = ((y0 + 1) % fy)[:, None]
    x0a = (x0 % fx)[None, :]; x1a = ((x0 + 1) % fx)[None, :]
    v00 = g[y0a, x0a]; v10 = g[y0a, x1a]; v01 = g[y1a, x0a]; v11 = g[y1a, x1a]
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty


def fbm(n, base, octaves, rng, ax=1.0, ay=1.0, gain=0.5):
    out = np.zeros((n, n), np.float32); amp = 1.0; tot = 0.0
    for o in range(octaves):
        fx = max(1, int(base * ax * (2 ** o))); fy = max(1, int(base * ay * (2 ** o)))
        if fx > n or fy > n:
            break
        out += amp * vnoise(n, fx, fy, rng); tot += amp; amp *= gain
    out /= max(tot, 1e-6)
    lo, hi = out.min(), out.max()
    return (out - lo) / max(hi - lo, 1e-6)


def sstep(a, b, x):
    t = np.clip((x - a) / max(b - a, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def ramp(t, stops):
    """stops = [(pos, (r,g,b)), ...] -> (n,n,3)"""
    pos = [s[0] for s in stops]
    return np.stack([np.interp(t, pos, [s[1][c] for s in stops]) for c in range(3)], -1).astype(np.float32)


def normal_from_height(h, strength=2.0):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    ln = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL (Y+): image rows are flipped when written to bpy images, compensated by -dy handedness below
    return np.stack([-dx / ln * 0.5 + 0.5, dy / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1).astype(np.float32)


def hexc(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def s2l(c):
    c = np.asarray(c, np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------------------------- texture recipes
def tex_paint(n, rng):
    low = fbm(n, 3, 4, rng); mid = fbm(n, 10, 4, rng); fine = fbm(n, 90, 2, rng)
    drips = fbm(n, 70, 4, rng, ax=1.0, ay=0.05, gain=0.6)          # vertical streaks
    scr = fbm(n, 300, 2, rng, ax=0.012, ay=1.0)                      # long horizontal scratches
    scr2 = fbm(n, 300, 2, rng, ax=1.0, ay=0.012)
    gray = 0.76 + 0.07 * (low - .5) + 0.06 * (mid - .5) + 0.035 * (fine - .5)
    gray -= 0.20 * sstep(0.55, 0.95, drips) * sstep(0.35, 0.7, low)
    chip_zone = sstep(0.62, 0.78, fbm(n, 5, 3, rng))
    chips = chip_zone * sstep(0.64, 0.70, fbm(n, 90, 3, rng, gain=0.55))
    gray = gray * (1 - chips) + 0.40 * chips
    scratch = np.maximum(sstep(0.86, 0.9, scr), sstep(0.88, 0.92, scr2))
    gray = gray * (1 - 0.35 * scratch) + 0.10 * scratch * 0
    gray = np.clip(gray, 0.15, 1.0)
    alb = np.repeat(gray[..., None], 3, -1)
    rough = np.clip(0.72 + 0.12 * (fine - .5) + 0.25 * chips + 0.1 * sstep(0.5, 0.9, drips), 0, 1)
    metal = 0.08 + 0.7 * chips
    h = 0.6 + 0.08 * (fine - .5) - 0.45 * chips - 0.1 * scratch
    return alb, np.stack([np.ones_like(rough), rough, metal], -1), h, 1.8


def _steel(n, rng, base, rust=0.2, rough=0.55, metal=0.9, brushed=0.5, dirt=0.25, tint=(1, 1, 1)):
    low = fbm(n, 4, 4, rng); mid = fbm(n, 14, 4, rng); fine = fbm(n, 110, 2, rng)
    br = fbm(n, 200, 2, rng, ax=0.02, ay=1.0)
    lum = base * (1 + 0.22 * (mid - .5) + 0.12 * (low - .5) + brushed * 0.16 * (br - .5) + 0.08 * (fine - .5))
    steel = lum[..., None] * np.array(tint, np.float32)
    rmask = sstep(0.62 - rust, 0.85 - rust * .5, low * 0.6 + mid * 0.4) if rust > 0 else np.zeros_like(low)
    rcol = ramp(fbm(n, 30, 4, rng), [(0, (0.13, 0.055, 0.03)), (0.5, (0.30, 0.13, 0.05)), (1, (0.46, 0.22, 0.08))])
    pits = sstep(0.72, 0.80, fbm(n, 150, 3, rng))
    alb = steel * (1 - rmask[..., None]) + rcol * rmask[..., None]
    alb *= (1 - 0.25 * pits[..., None])
    dirtm = sstep(0.45, 0.85, fbm(n, 8, 5, rng)) * dirt
    alb *= (1 - dirtm[..., None] * np.array([0.5, 0.58, 0.68], np.float32))
    rgh = np.clip(rough + 0.28 * rmask + 0.12 * (fine - .5) + 0.15 * dirtm, 0.05, 1)
    mtl = np.clip(metal * (1 - 0.85 * rmask) * (1 - 0.3 * dirtm), 0, 1)
    h = 0.5 + 0.10 * (br - .5) * brushed + 0.25 * (fine - .5) * rmask - 0.4 * pits + 0.1 * (mid - .5) * rmask
    return np.clip(alb, 0, 1), np.stack([np.ones_like(rgh), rgh, mtl], -1), h, 2.5


def tex_armor(n, rng):
    return _steel(n, rng, 0.30, rust=0.16, rough=0.58, metal=0.85, brushed=0.7, dirt=0.35, tint=(1.0, 1.02, 1.0))


def tex_mdark(n, rng):
    return _steel(n, rng, 0.13, rust=0.10, rough=0.62, metal=0.8, brushed=0.4, dirt=0.4)


def tex_mbare(n, rng):
    return _steel(n, rng, 0.58, rust=0.14, rough=0.42, metal=1.0, brushed=1.0, dirt=0.25)


def tex_rim(n, rng):
    return _steel(n, rng, 0.33, rust=0.18, rough=0.5, metal=0.9, brushed=0.4, dirt=0.5, tint=(1.0, 1.0, 0.95))


def tex_spike(n, rng):
    return _steel(n, rng, 0.42, rust=0.12, rough=0.4, metal=1.0, brushed=1.2, dirt=0.3, tint=(1.0, 0.98, 0.94))


def tex_chrome(n, rng):
    low = fbm(n, 3, 4, rng); mid = fbm(n, 12, 4, rng); fine = fbm(n, 110, 2, rng)
    streak = fbm(n, 40, 4, rng, ax=1.0, ay=0.06, gain=0.6)
    scr = sstep(0.84, 0.9, fbm(n, 260, 2, rng, ax=0.02, ay=1.0))
    grime = sstep(0.5, 0.9, streak) * 0.5 + sstep(0.55, 0.9, mid) * 0.25
    g = 0.52 - 0.20 * grime - 0.12 * scr + 0.06 * (low - .5)
    alb = np.repeat(np.clip(g, 0.1, 1)[..., None], 3, -1) * np.array([1.0, 1.0, 1.02], np.float32)
    rgh = np.clip(0.24 + 0.22 * grime + 0.25 * scr + 0.08 * (fine - .5) + 0.10 * (low - .5), 0.06, 0.9)
    mtl = np.clip(1.0 - 0.35 * grime, 0, 1)
    h = 0.5 + 0.06 * (fine - .5) + 0.1 * (mid - .5) - 0.15 * scr
    return alb, np.stack([np.ones_like(rgh), rgh, mtl], -1), h, 1.2


def tex_rust(n, rng):
    low = fbm(n, 5, 5, rng); mid = fbm(n, 20, 4, rng); fine = fbm(n, 120, 2, rng)
    t = np.clip(0.55 * low + 0.35 * mid + 0.15 * fine, 0, 1)
    alb = ramp(t, [(0, (0.15, 0.07, 0.035)), (0.35, (0.34, 0.15, 0.06)), (0.65, (0.52, 0.25, 0.09)), (1, (0.62, 0.36, 0.15))])
    pit = sstep(0.7, 0.8, fbm(n, 80, 3, rng))
    alb *= (1 - 0.4 * pit[..., None])
    rgh = np.clip(0.86 + 0.12 * (fine - .5), 0, 1)
    h = 0.5 + 0.5 * (fine - .5) + 0.5 * (mid - .5) - 0.3 * pit
    return alb, np.stack([np.ones_like(rgh), rgh, np.full_like(rgh, 0.15)], -1), h, 3.5


def tex_rubber(n, rng, base=0.045):
    low = fbm(n, 6, 3, rng); fine = fbm(n, 140, 3, rng)
    g = base * (0.8 + 0.5 * low) * (0.85 + 0.3 * fine)
    dust = sstep(0.55, 0.9, fbm(n, 9, 4, rng)) * 0.5
    g = g + dust * 0.10
    alb = np.repeat(np.clip(g, 0, 1)[..., None], 3, -1) * np.array([1.0, 0.98, 0.95], np.float32)
    rgh = np.clip(0.85 + 0.1 * (fine - .5) - 0.1 * dust, 0, 1)
    return alb, np.stack([np.ones_like(rgh), rgh, np.zeros_like(rgh)], -1), 0.5 + 0.4 * (fine - .5), 1.5


def tex_canvas(n, rng, base=(0.52, 0.45, 0.30)):
    # woven cloth: fine grid + low freq stains
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    per = 6.0
    weave = 0.5 + 0.25 * np.sin(xx * 2 * np.pi / per * 4) * np.sin(yy * 2 * np.pi / per * 4)
    weave = weave * 0.6 + 0.4 * fbm(n, 160, 2, rng)
    low = fbm(n, 4, 4, rng); stain = sstep(0.5, 0.85, fbm(n, 9, 4, rng))
    lum = (0.78 + 0.3 * (weave - .5)) * (0.85 + 0.3 * (low - .5))
    alb = lum[..., None] * np.array(base, np.float32)
    alb *= (1 - 0.35 * stain[..., None] * np.array([0.3, 0.45, 0.7], np.float32))
    rgh = np.full((n, n), 0.92, np.float32)
    return np.clip(alb, 0, 1), np.stack([np.ones_like(rgh), rgh, np.zeros_like(rgh)], -1), weave, 3.0


def tex_wood(n, rng):
    grain = fbm(n, 6, 4, rng, ax=1.0, ay=0.03, gain=0.6)
    fine = fbm(n, 200, 2, rng, ax=1.0, ay=0.02)
    low = fbm(n, 3, 3, rng)
    t = 0.5 * grain + 0.3 * fine + 0.2 * low
    alb = ramp(t, [(0, (0.16, 0.10, 0.06)), (0.5, (0.32, 0.20, 0.11)), (1, (0.46, 0.31, 0.18))])
    gray = np.clip(1.0 - 0.3 * sstep(0.5, 0.9, fbm(n, 8, 4, rng)), 0, 1)
    alb *= gray[..., None]
    rgh = np.full((n, n), 0.85, np.float32)
    return alb, np.stack([np.ones_like(rgh), rgh, np.zeros_like(rgh)], -1), 0.5 + 0.3 * (fine - .5), 2.0


def tex_cloth(n, rng, base):
    weave = fbm(n, 120, 2, rng)
    low = fbm(n, 4, 4, rng)
    lum = (0.8 + 0.25 * (weave - .5)) * (0.8 + 0.3 * (low - .5))
    alb = lum[..., None] * np.array(base, np.float32)
    rgh = np.full((n, n), 0.9, np.float32)
    return np.clip(alb, 0, 1), np.stack([np.ones_like(rgh), rgh, np.zeros_like(rgh)], -1), weave, 1.5


TEX = {
    'paint': (1024, tex_paint), 'armor': (1024, tex_armor), 'mdark': (512, tex_mdark), 'mbare': (512, tex_mbare),
    'rim': (512, tex_rim), 'spike': (512, tex_spike), 'rust': (512, tex_rust), 'rubber': (512, tex_rubber),
    'canvas': (512, tex_canvas), 'chrome': (512, tex_chrome), 'wood': (512, tex_wood),
    'fabric': (256, lambda n, r: tex_cloth(n, r, (0.32, 0.12, 0.10))),
    'leather': (256, lambda n, r: tex_cloth(n, r, (0.26, 0.15, 0.09))),
    'cloth_red': (256, lambda n, r: tex_cloth(n, r, (0.55, 0.06, 0.05))),
}
# world-space size (m) covered by one tile of each texture
TILE = {'paint': 2.4, 'armor': 2.0, 'mdark': 1.5, 'mbare': 1.5, 'rim': 1.0, 'spike': 0.8, 'rust': 1.6, 'rubber': 0.8, 'chrome': 1.4,
        'canvas': 0.7, 'wood': 1.2, 'fabric': 0.5, 'leather': 0.5, 'cloth_red': 1.0}

# name -> dict(tex=key | color=hex, rough, metal, emit, alpha)
PAL = {
    'paint': dict(tex='paint'), 'paint2': dict(tex='paint'),
    'metal_dark': dict(tex='mdark'), 'metal_bare': dict(tex='mbare'), 'rust': dict(tex='rust'),
    'armor': dict(tex='armor'), 'rim': dict(tex='rim'), 'spike': dict(tex='spike'),
    'rubber_tire': dict(tex='rubber'), 'rubber': dict(tex='rubber'),
    'canvas': dict(tex='canvas'), 'wood': dict(tex='wood'), 'fabric': dict(tex='fabric'), 'leather': dict(tex='leather'),
    'cloth_red': dict(tex='cloth_red'),
    'chrome': dict(tex='chrome'),
    'plastic': dict(color='#b9b5a6', rough=0.55, metal=0.0),
    'interior': dict(color='#2a2622', rough=0.8, metal=0.0),
    'brass': dict(color='#b08a3c', rough=0.35, metal=1.0),
    'gun_metal': dict(color='#33373a', rough=0.4, metal=0.9),
    'gun_black': dict(color='#121314', rough=0.45, metal=0.7),
    'gun_steel': dict(color='#7b7f83', rough=0.35, metal=1.0),
    'decal_red': dict(color='#a4241b', rough=0.6, metal=0.0),
    'decal_yellow': dict(color='#d9a516', rough=0.6, metal=0.0),
    'glass': dict(color='#42636b', rough=0.05, metal=0.0, alpha=0.4),
    'glass_lens': dict(color='#9fc4d0', rough=0.05, metal=0.0, alpha=0.5),
    'light_head': dict(color='#fff3d8', rough=0.1, metal=0.0, emit='#ffe9b8', es=3.5),
    'light_tail': dict(color='#a80c0c', rough=0.2, metal=0.0, emit='#ff1208', es=2.2),
    'light_amber': dict(color='#e09010', rough=0.2, metal=0.0, emit='#ff8c0a', es=2.6),
}
NO_GRIME = {'light_head', 'light_tail', 'light_amber', 'glass', 'glass_lens'}

_MATS = {}
_IMGS = {}


def _img(name, arr, srgb):
    n = arr.shape[0]
    im = bpy.data.images.new(name, n, n, alpha=False)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'   # must precede pixel writes (it clears the buffer)
    im.file_format = 'JPEG'
    rgba = np.ones((n, n, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    im.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).ravel())   # bpy images are stored bottom-up
    return im


def _textures(key):
    if key in _IMGS:
        return _IMGS[key]
    n, fn = TEX[key]
    rng = np.random.default_rng(sum(ord(c) * (i + 3) for i, c in enumerate(key)) + 11)
    alb, orm, h, ns = fn(n, rng)
    nm = normal_from_height(h, ns)
    r = (_img('t_%s_alb' % key, alb, True), _img('t_%s_orm' % key, orm, False), _img('t_%s_nrm' % key, nm, False))
    _IMGS[key] = r
    return r


def reset():
    _MATS.clear(); _IMGS.clear()


def get(name):
    if name in _MATS:
        return _MATS[name]
    if name not in PAL:
        raise KeyError("unknown material " + name)
    spec = PAL[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    if 'tex' in spec:
        alb, orm, nrm = _textures(spec['tex'])
        t1 = nt.nodes.new('ShaderNodeTexImage'); t1.image = alb; t1.interpolation = 'Linear'
        nt.links.new(t1.outputs['Color'], b.inputs['Base Color'])
        t2 = nt.nodes.new('ShaderNodeTexImage'); t2.image = orm
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t2.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        t3 = nt.nodes.new('ShaderNodeTexImage'); t3.image = nrm
        nn = nt.nodes.new('ShaderNodeNormalMap'); nn.inputs['Strength'].default_value = 1.0
        nt.links.new(t3.outputs['Color'], nn.inputs['Color'])
        nt.links.new(nn.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    else:
        col = s2l(hexc(spec['color']))
        b.inputs['Base Color'].default_value = (*col.tolist(), 1.0)
        b.inputs['Roughness'].default_value = spec.get('rough', 0.5)
        b.inputs['Metallic'].default_value = spec.get('metal', 0.0)
        if 'emit' in spec:
            e = s2l(hexc(spec['emit']))
            b.inputs['Emission Color'].default_value = (*e.tolist(), 1.0)
            b.inputs['Emission Strength'].default_value = spec.get('es', 3.0)
    a = spec.get('alpha', 1.0)
    if a < 1.0:
        b.inputs['Alpha'].default_value = a
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        m.use_backface_culling = False
    else:
        m.use_backface_culling = True
    m.diffuse_color = (0.5, 0.5, 0.5, 1)
    _MATS[name] = m
    return m
