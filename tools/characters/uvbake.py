"""UV-space baking helpers (numpy): rasterise per-vertex attributes to texels, pack islands, height -> normal map, noise.

glTF UV convention is used everywhere: pixel column = u * W, pixel row = v * H (v grows DOWNWARD in the image).
Normal maps follow the glTF spec (green = +Y = toward the top of the image).
"""
import numpy as np
from scipy import ndimage


# --- rasterisation -----------------------------------------------------------------------------

def rasterize(uv, tris, attrs, size, fill=0.0):
    """Barycentric rasterisation of triangles into a (size, size, K) float32 image.
    uv: (V, 2) glTF uv, tris: (T, 3) indices, attrs: (V, K). Returns (img, mask)."""
    W = H = int(size)
    attrs = np.asarray(attrs, np.float64)
    if attrs.ndim == 1:
        attrs = attrs[:, None]
    K = attrs.shape[1]
    img = np.full((H, W, K), fill, np.float32)
    mask = np.zeros((H, W), bool)
    px = np.stack([uv[:, 0] * W, uv[:, 1] * H], axis=1)
    for t in tris:
        p0, p1, p2 = px[t[0]], px[t[1]], px[t[2]]
        x0 = int(max(np.floor(min(p0[0], p1[0], p2[0]) - 0.5), 0))
        x1 = int(min(np.ceil(max(p0[0], p1[0], p2[0]) + 0.5), W - 1))
        y0 = int(max(np.floor(min(p0[1], p1[1], p2[1]) - 0.5), 0))
        y1 = int(min(np.ceil(max(p0[1], p1[1], p2[1]) + 0.5), H - 1))
        if x1 < x0 or y1 < y0:
            continue
        den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1])
        if abs(den) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        l0 = ((p1[1] - p2[1]) * (xs - p2[0]) + (p2[0] - p1[0]) * (ys - p2[1])) / den
        l1 = ((p2[1] - p0[1]) * (xs - p2[0]) + (p0[0] - p2[0]) * (ys - p2[1])) / den
        l2 = 1.0 - l0 - l1
        eps = -0.02
        inside = (l0 >= eps) & (l1 >= eps) & (l2 >= eps)
        if not inside.any():
            continue
        val = l0[..., None] * attrs[t[0]] + l1[..., None] * attrs[t[1]] + l2[..., None] * attrs[t[2]]
        sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
        img[sl][inside] = val[inside]
        mask[sl] |= inside
    return img, mask


def dilate(img, mask, max_dist=None):
    """Fill texels outside `mask` with the nearest covered texel's value (seam padding)."""
    if mask.all():
        return img
    dist, (iy, ix) = ndimage.distance_transform_edt(~mask, return_indices=True)
    out = img[iy, ix]
    if max_dist is not None:
        keep = dist <= max_dist
        out = np.where(keep[..., None], out, img)
    return out


# --- island packing ----------------------------------------------------------------------------

def pack_islands(sizes, pad, max_size=2048):
    """Shelf-pack rectangles (w, h in px). Returns (offsets, (W, H)) with the smallest square-ish power-of-two atlas."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    for atlas in (256, 512, 1024, 2048, 4096):
        x = y = shelf_h = 0
        offs = [None] * len(sizes)
        ok = True
        for i in order:
            w, h = sizes[i][0] + pad, sizes[i][1] + pad
            if x + w > atlas:
                x, y, shelf_h = 0, y + shelf_h, 0
            if w > atlas or y + h > atlas:
                ok = False
                break
            offs[i] = (x + pad // 2, y + pad // 2)
            x += w
            shelf_h = max(shelf_h, h)
        if ok:
            return offs, atlas
    raise RuntimeError("islands do not fit")


# --- normal maps -------------------------------------------------------------------------------

def height_to_normal(h, px_per_m, strength=1.0):
    """h in metres (H, W). Returns uint8 RGB tangent-space normal (glTF convention)."""
    gy, gx = np.gradient(h.astype(np.float32))          # per pixel
    gx = gx * px_per_m * strength
    gy = gy * px_per_m * strength
    n = np.stack([-gx, gy, np.ones_like(gx)], axis=-1)   # rows go DOWN: green = +d h/d row
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255.0 + 0.5).astype(np.uint8)


def flat_normal(size):
    a = np.zeros((size, size, 3), np.uint8)
    a[..., 0] = a[..., 1] = 128
    a[..., 2] = 255
    return a


# --- noise -------------------------------------------------------------------------------------

def fbm(shape, scale=32.0, octaves=4, seed=0, gain=0.5, wrap=True):
    """Fractal noise in [0, 1]; `scale` = wavelength of the base octave in pixels."""
    rng = np.random.default_rng(seed)
    H, W = shape
    acc = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    s = float(scale)
    for _ in range(octaves):
        n = rng.standard_normal(shape).astype(np.float32)
        n = ndimage.gaussian_filter(n, sigma=max(s * 0.35, 0.4), mode="wrap" if wrap else "reflect")
        n /= max(n.std(), 1e-6)
        acc += n * amp
        tot += amp
        amp *= gain
        s *= 0.5
    acc /= tot
    acc = acc / 3.0 + 0.5
    return np.clip(acc, 0.0, 1.0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blur(a, sigma):
    return ndimage.gaussian_filter(a, sigma=sigma, mode="nearest")
