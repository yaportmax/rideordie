"""Procedural spray-paint decals (drawn with numpy, projected in the bake shader via world position)."""
from veh_lib import *
import numpy as np


def _soft(d, w):
    """signed distance (inside negative) -> alpha with soft edge width w."""
    return np.clip(0.5 - d / w, 0.0, 1.0)


def _sd_ellipse(x, y, cx, cy, rx, ry):
    return (np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) - 1.0) * min(rx, ry)


def _sd_box(x, y, cx, cy, hx, hy, r):
    qx = np.abs(x - cx) - hx + r
    qy = np.abs(y - cy) - hy + r
    return np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - r


def _sd_seg(x, y, ax, ay, bx_, by_, r):
    pax, pay = x - ax, y - ay
    bax, bay = bx_ - ax, by_ - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-9), 0, 1)
    return np.sqrt((pax - bax * h) ** 2 + (pay - bay * h) ** 2) - r


def _grid(n):
    lin = (np.arange(n) + 0.5) / n * 2 - 1
    x, y = np.meshgrid(lin, lin[::-1])       # y up, row 0 = top
    return x, y


def skull_alpha(n=512, seed=1):
    rng = np.random.RandomState(seed)
    x, y = _grid(n)
    w = 2.0 / n * 1.6
    cran = _sd_ellipse(x, y, 0.0, 0.20, 0.62, 0.58)
    jaw = _sd_box(x, y, 0.0, -0.42, 0.38, 0.30, 0.14)
    head = np.minimum(cran, jaw)
    outline = _soft(np.abs(head) - 0.04, w)
    a = outline
    for sx in (-1, 1):
        eye = _sd_ellipse(x, y, sx * 0.28, 0.10, 0.20, 0.23)
        a = np.maximum(a, _soft(eye, w))
        a = np.maximum(a, _soft(_sd_seg(x, y, sx * 0.28, -0.14, sx * 0.29, -0.34, 0.012), w))   # drip
        # cheekbone crack
        a = np.maximum(a, _soft(_sd_seg(x, y, sx * 0.50, -0.06, sx * 0.38, -0.26, 0.014), w))
    # nose (two nostrils)
    for sx in (-1, 1):
        nz = _sd_ellipse(x, y, sx * 0.055, -0.20, 0.05, 0.10)
        a = np.maximum(a, _soft(nz, w))
    # teeth
    a = np.maximum(a, _soft(_sd_seg(x, y, -0.27, -0.50, 0.27, -0.50, 0.014), w))
    for i in range(-3, 4):
        a = np.maximum(a, _soft(_sd_seg(x, y, i * 0.085, -0.50, i * 0.085, -0.66, 0.011), w))
    # forehead crack
    a = np.maximum(a, _soft(_sd_seg(x, y, 0.10, 0.76, 0.02, 0.55, 0.013), w))
    a = np.maximum(a, _soft(_sd_seg(x, y, 0.02, 0.55, 0.12, 0.42, 0.011), w))
    # spray speckle / broken edges
    speck = rng.rand(n, n)
    a = a * np.clip(0.55 + speck * 0.9, 0, 1)
    return a


def tally_alpha(n=512, seed=2):
    rng = np.random.RandomState(seed)
    x, y = _grid(n)
    w = 2.0 / n * 1.6
    a = np.zeros_like(x)
    for row, cnt in enumerate((5, 5, 3)):
        yy = 0.6 - row * 0.55
        for i in range(cnt):
            if i < 4:
                xx = -0.78 + i * 0.17 + rng.uniform(-0.01, 0.01)
                a = np.maximum(a, _soft(_sd_seg(x, y, xx, yy - 0.2, xx + rng.uniform(-0.02, 0.02), yy + 0.2, 0.03), w))
            else:
                a = np.maximum(a, _soft(_sd_seg(x, y, -0.86, yy - 0.16, -0.18, yy + 0.16, 0.03), w))
        if cnt == 5:
            # second column of strokes
            for i in range(cnt):
                if i < 4:
                    xx = 0.10 + i * 0.17
                    a = np.maximum(a, _soft(_sd_seg(x, y, xx, yy - 0.2, xx + rng.uniform(-0.02, 0.02), yy + 0.2, 0.03), w))
                else:
                    a = np.maximum(a, _soft(_sd_seg(x, y, 0.02, yy - 0.16, 0.70, yy + 0.16, 0.03), w))
    a = a * np.clip(0.6 + rng.rand(n, n) * 0.8, 0, 1)
    return a


def xmark_alpha(n=512, seed=3):
    rng = np.random.RandomState(seed)
    x, y = _grid(n)
    w = 2.0 / n * 1.6
    a = np.maximum(_soft(_sd_seg(x, y, -0.7, -0.7, 0.7, 0.72, 0.09), w), _soft(_sd_seg(x, y, -0.7, 0.7, 0.72, -0.72, 0.09), w))
    ring = _soft(np.abs(_sd_ellipse(x, y, 0, 0, 0.9, 0.9)) - 0.05, w)
    a = np.maximum(a, ring)
    # drips
    for xx in (-0.5, 0.15, 0.55):
        a = np.maximum(a, _soft(_sd_seg(x, y, xx, -0.55, xx, -0.55 - rng.uniform(0.12, 0.3), 0.012), w) * (y < -0.4))
    a = a * np.clip(0.6 + rng.rand(n, n) * 0.8, 0, 1)
    return a


def make_image(name, alpha):
    n = alpha.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=True)
    px = np.zeros((n, n, 4), dtype=np.float32)
    px[..., 3] = alpha[::-1]                     # Blender image rows go bottom -> top
    img.pixels.foreach_set(px.ravel())
    img.alpha_mode = "STRAIGHT"
    img.colorspace_settings.name = "Non-Color"
    return img


def stamp(ctx, img, origin, U, V, size, thick=0.05, n=(0, 0, 1), ncos=0.6):
    """Projected decal mask (0..1) in the bake shader.  origin (x,f,z); U,V = (x,f,z) directions of the image axes; size = (su, sv) in metres;
    the decal only lands on surfaces within `thick` of the plane through origin whose normal faces `n` (cos > ncos)."""
    g = ctx["g"]
    o = Pv(origin)
    Ub, Vb, Nb = Pv(U).normalized(), Pv(V).normalized(), Pv(n).normalized()
    d = g.new("ShaderNodeVectorMath", operation="SUBTRACT")
    g.put(d.inputs[0], ctx["pos"])
    d.inputs[1].default_value = o
    dv = d.outputs[0]

    def dotc(vec):
        nd = g.new("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        g.put(nd.inputs[0], dv)
        nd.inputs[1].default_value = vec
        return nd.outputs["Value"]
    u = g.add(g.mul(dotc(Ub), 1.0 / size[0]), 0.5)
    v = g.add(g.mul(dotc(Vb), 1.0 / size[1]), 0.5)
    w = g.math("ABSOLUTE", dotc(Nb))
    comb = g.new("ShaderNodeCombineXYZ")
    g.put(comb.inputs[0], u)
    g.put(comb.inputs[1], v)
    tex = g.new("ShaderNodeTexImage", extension="CLIP", interpolation="Linear")
    tex.image = img
    g.l.new(comb.outputs[0], tex.inputs["Vector"])
    alpha = tex.outputs["Alpha"]
    inside = g.math("LESS_THAN", w, thick)
    nd = g.new("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    g.put(nd.inputs[0], ctx["nrm"])
    nd.inputs[1].default_value = Nb
    facing = g.math("GREATER_THAN", nd.outputs["Value"], ncos)
    return g.mul(alpha, g.mul(inside, facing))
