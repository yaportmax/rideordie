"""Tileable detail textures (albedo grey-scale, normal, ORM) for gear materials.  1 tile = TILE metres (kit uv = m / 0.25)."""
import os

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

import uvbake as U

TILE = 0.25
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_cache")
_mem = {}


def _px_per_m(size):
    return size / TILE


def cells(size, n, seed):
    """Wrapped cellular noise: returns (F1 distance, F2-F1 edge measure, cell id-random) at size x size."""
    rng = np.random.default_rng(seed)
    pts = rng.random((n, 2))
    pad = np.vstack([pts + [dx, dy] for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    tree = cKDTree(pad)
    g = (np.arange(size) + 0.5) / size
    X, Y = np.meshgrid(g, g)
    q = np.stack([X.ravel(), Y.ravel()], axis=1)
    d, i = tree.query(q, k=2)
    f1 = d[:, 0].reshape(size, size)
    edge = (d[:, 1] - d[:, 0]).reshape(size, size)
    cid = rng.random(len(pad))[i[:, 0]].reshape(size, size)
    return f1, edge, cid


def _norm_from_height(h, size, strength):
    # h in "tile units": convert to metres roughly by treating range 0..1 as 1.5 mm
    return U.height_to_normal(h * 0.0015, _px_per_m(size), strength)


def make(kind, size=512, seed=1):
    """Returns dict(albedo (HxWx3 uint8), normal (HxWx3 uint8), orm (HxWx3 uint8) or None)."""
    key = (kind, size, seed)
    if key in _mem:
        return _mem[key]
    fn = globals()["_tex_" + kind]
    out = fn(size, seed)
    _mem[key] = out
    return out


def _g(a):
    a = np.clip(a, 0, 1)
    return np.repeat((a * 255 + 0.5).astype(np.uint8)[..., None], 3, axis=2)


def _tex_leather(size, seed):
    f1, edge, cid = cells(size, 7000, seed)
    n1 = U.fbm((size, size), 40, 3, seed + 1)
    n2 = U.fbm((size, size), 3.0, 2, seed + 2)
    crack = 1.0 - U.smoothstep(0.0, 0.0028, edge)          # grain lines between cells
    dome = 1.0 - np.clip(f1 / 0.010, 0, 1) ** 2
    h = 0.55 * dome + 0.35 * n2 - 0.9 * crack * (0.5 + n1)
    h = (h - h.min()) / (h.max() - h.min())
    alb = 0.72 + 0.16 * (n1 - 0.5) + 0.10 * (n2 - 0.5) - 0.28 * crack + 0.06 * (cid - 0.5)
    rough = 0.55 + 0.25 * crack + 0.1 * (n1 - 0.5)
    orm = np.stack([np.clip(1.0 - 0.6 * crack, 0, 1), rough, np.zeros_like(rough)], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.7), orm=(np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8))


def _weave(size, seed, period_px, slub=0.25, twill=False):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    rng = np.random.default_rng(seed)
    k = 2 * np.pi / period_px
    if twill:
        a = np.sin((x + y) * k) * 0.5 + 0.5
        b = np.sin((x - y * 0.25) * k * 0.5) * 0.5 + 0.5
        h = a * 0.7 + b * 0.3
    else:
        a = np.sin(x * k)
        b = np.sin(y * k)
        h = 0.5 + 0.25 * (a + b) + 0.15 * a * b
    n = U.fbm((size, size), 2.0, 2, seed, wrap=True)
    sl = U.fbm((size, size), 14.0, 2, seed + 3, wrap=True)
    h = h * (1 - slub) + slub * n
    alb = 0.78 + 0.22 * (h - 0.5) + 0.10 * (sl - 0.5)
    return h, alb


def _tex_canvas(size, seed):
    h, alb = _weave(size, seed, size / 40.0, 0.35)
    orm = np.stack([0.9 + 0 * h, 0.9 + 0 * h, 0 * h], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.8), orm=(orm * 255).astype(np.uint8))


def _tex_denim(size, seed):
    h, alb = _weave(size, seed, size / 48.0, 0.3, twill=True)
    orm = np.stack([0.9 + 0 * h, 0.92 + 0 * h, 0 * h], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.7), orm=(orm * 255).astype(np.uint8))


def _tex_knit(size, seed):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    period = size / 64.0
    ribs = 0.5 + 0.5 * np.sin(x * 2 * np.pi / period)
    v = 0.5 + 0.5 * np.sin((y + 0.5 * (x // period) * 3) * 2 * np.pi / (period * 0.8))
    h = 0.6 * ribs + 0.3 * v * ribs + 0.1 * U.fbm((size, size), 2.0, 2, seed)
    alb = 0.82 + 0.2 * (h - 0.5) + 0.08 * (U.fbm((size, size), 20.0, 2, seed + 1) - 0.5)
    orm = np.stack([0.9 + 0 * h, 0.95 + 0 * h, 0 * h], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.7), orm=(orm * 255).astype(np.uint8))


def _tex_webbing(size, seed):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    period = size / 90.0
    h = 0.5 + 0.5 * np.sin(y * 2 * np.pi / period) * 0.6 + 0.2 * np.sin(x * 2 * np.pi / (period * 3))
    n = U.fbm((size, size), 3.0, 2, seed)
    h = h * 0.8 + n * 0.2
    alb = 0.75 + 0.2 * (h - 0.5)
    orm = np.stack([0.9 + 0 * h, 0.9 + 0 * h, 0 * h], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.8), orm=(orm * 255).astype(np.uint8))


def _scratches(size, seed, count, length=(0.05, 0.25), horizontal_bias=0.6):
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(seed)
    im = Image.new("L", (size * 3, size * 3), 0)
    d = ImageDraw.Draw(im)
    for _ in range(count):
        x, y = rng.random(2) * size * 3
        L = rng.uniform(*length) * size
        a = rng.normal(0, 0.25) if rng.random() < horizontal_bias else rng.uniform(0, np.pi)
        d.line([(x, y), (x + np.cos(a) * L, y + np.sin(a) * L)], fill=int(rng.uniform(80, 255)), width=1)
    a = np.asarray(im, np.float32) / 255.0
    # wrap by folding the 3x3 canvas back to one tile
    a = np.maximum.reduce([a[i * size:(i + 1) * size, j * size:(j + 1) * size] for i in range(3) for j in range(3)])
    return a


def _tex_metal(size, seed, rust=0.5):
    n_low = U.fbm((size, size), 90.0, 4, seed)
    n_hi = U.fbm((size, size), 4.0, 3, seed + 1)
    streak = ndimage.gaussian_filter(np.random.default_rng(seed).standard_normal((size, size)), sigma=(0.6, 14.0), mode="wrap")
    streak = streak / streak.std()
    sc = _scratches(size, seed, 260)
    pits = U.fbm((size, size), 2.0, 2, seed + 5)
    rust_m = U.smoothstep(0.52 - rust * 0.15, 0.68, n_low * 0.75 + n_hi * 0.25) * rust
    rust_m = np.clip(rust_m + 0.25 * rust * (pits > 0.72), 0, 1)
    h = 0.5 + 0.06 * streak + 0.35 * rust_m * (0.5 + n_hi) - 0.5 * sc
    h = (h - h.min()) / (h.max() - h.min())
    lum = 0.42 + 0.05 * streak + 0.35 * sc * 0.5 + 0.06 * (n_hi - 0.5)
    alb = np.stack([lum * (1 - rust_m) + rust_m * 0.36,
                    lum * (1 - rust_m) + rust_m * 0.19,
                    lum * (1 - rust_m) + rust_m * 0.09], axis=-1)
    rough = 0.42 + 0.3 * rust_m + 0.08 * streak - 0.15 * sc + 0.1 * n_hi
    metal = np.clip(1.0 - rust_m * 1.2, 0, 1) * 0.95
    orm = np.stack([1.0 - 0.4 * rust_m, np.clip(rough, 0.15, 1), metal], axis=-1)
    return dict(albedo=(np.clip(alb, 0, 1) * 255 + 0.5).astype(np.uint8),
                normal=_norm_from_height(h, size, 0.9), orm=(np.clip(orm, 0, 1) * 255 + 0.5).astype(np.uint8))


def _tex_metal_dark(size, seed):
    return _tex_metal(size, seed, rust=0.25)


def _tex_armor(size, seed):
    return _tex_metal(size, seed + 11, rust=0.55)


def _tex_rubber(size, seed):
    n = U.fbm((size, size), 3.0, 3, seed)
    h = n
    alb = 0.35 + 0.1 * (n - 0.5)
    orm = np.stack([np.ones_like(n), 0.85 + 0.1 * (n - 0.5), np.zeros_like(n)], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.8), orm=(orm * 255).astype(np.uint8))


def _tex_plastic(size, seed):
    n = U.fbm((size, size), 3.0, 3, seed)
    sc = _scratches(size, seed, 120, (0.02, 0.1), 0.3)
    alb = 0.8 + 0.06 * (n - 0.5) - 0.2 * sc
    h = 0.5 + 0.2 * n - 0.4 * sc
    orm = np.stack([np.ones_like(n), 0.45 + 0.25 * sc + 0.1 * n, np.zeros_like(n)], axis=-1)
    return dict(albedo=_g(alb), normal=_norm_from_height(h, size, 0.7), orm=(np.clip(orm, 0, 1) * 255).astype(np.uint8))
