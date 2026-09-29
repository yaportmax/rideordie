"""Numpy helpers for the RIDE OR DIE environment textures (all ops are periodic => tileable stays tileable)."""
import numpy as np
from PIL import Image, ImageFile
ImageFile.MAXBLOCK = 1 << 27

def load(path, mode="RGB"):
    return np.asarray(Image.open(path).convert(mode), dtype=np.float32) / 255.0

def save_jpg(a, path, q=86, sub=2):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, quality=q, subsampling=sub, optimize=True)

def save_png(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)

def resize(a, n):
    if a.shape[0] == n and a.shape[1] == n: return a
    planes = [a] if a.ndim == 2 else [a[..., c] for c in range(a.shape[2])]
    out = [np.asarray(Image.fromarray(np.ascontiguousarray(p, dtype=np.float32), mode="F").resize((n, n), Image.LANCZOS)) for p in planes]
    return out[0] if a.ndim == 2 else np.stack(out, -1)

def s2l(x): return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
def l2s(x):
    x = np.clip(x, 0, None)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
def lum(rgb): return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722

def hue_rot(rgb, deg):
    """rotate hue around the grey axis (YIQ-ish, cheap)"""
    a = np.deg2rad(deg); c, s = np.cos(a), np.sin(a)
    T = np.array([[0.299, 0.587, 0.114], [0.596, -0.274, -0.322], [0.211, -0.523, 0.312]])
    Ti = np.linalg.inv(T)
    R = np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    M = Ti @ R @ T
    return rgb @ M.T

def grade(rgb_srgb, hue=0.0, sat=1.0, gain=1.0, contrast=1.0, tint=(1, 1, 1), lift=0.0):
    """grading in linear light. contrast pivots on the image mean luminance."""
    x = s2l(rgb_srgb)
    if hue: x = hue_rot(x, hue)
    L = lum(x)[..., None]
    x = L + (x - L) * sat
    if contrast != 1.0:
        piv = float(L.mean())
        x = piv + (x - piv) * contrast
    x = x * np.array(tint, np.float32) * gain + lift
    return np.clip(l2s(np.clip(x, 0, None)), 0, 1)

def tone(rgb_srgb, mean, sat=1.0, contrast=1.0, floor=0.0):
    """re-colour an sRGB albedo so its average colour (sRGB 0-255) matches `mean`, keeping its internal variation.
       Positive-only maths: luminance detail (relative to the mean) is raised to `contrast`, per-pixel colour deviation from the
       mean colour is raised to `sat`.  floor = minimum relative luminance (lifts dark blotches, e.g. snow)."""
    x = np.clip(s2l(rgb_srgb), 1e-4, None)
    L = lum(x)
    d = L / L.mean()
    if floor: d = np.maximum(d, floor)
    d = d ** contrast
    c = x / L[..., None]
    cm = np.exp(np.log(c).mean((0, 1)))
    rel = (c / cm) ** sat
    tgt = s2l(np.array(mean, np.float32) / 255.0)
    out = tgt * d[..., None] * rel
    out *= lum(tgt) / lum(out).mean()
    return np.clip(l2s(np.clip(out, 0, 1)), 0, 1)

def flatten(rgb_srgb, sigma_frac=0.07, amount=0.85, chroma=0.7):
    """remove the tile-scale low-frequency brightness/colour blotches of a photoscan (so the tile signature doesn't show when it repeats).
       Works in linear light: x *= (mean / lowpass)^amount, per-channel with `chroma` weight."""
    n = rgb_srgb.shape[0]
    x = np.clip(s2l(rgb_srgb), 1e-4, None)
    sig = n * sigma_frac
    low = np.stack([np.real(np.fft.ifft2(np.fft.fft2(x[..., c]) * np.exp(-2 * (np.pi * sig / n) ** 2 * (_freqs(n)[0] ** 2 + _freqs(n)[1] ** 2)))) for c in range(3)], -1)
    low = np.clip(low, 1e-4, None)
    Ll = lum(low)[..., None]
    k_l = (Ll.mean() / Ll) ** amount
    k_c = ((low / Ll) ** -1.0)                       # chroma ratio of the low-pass
    k_c = (k_c / np.exp(np.log(k_c).mean((0, 1)))) ** (amount * chroma)
    return np.clip(l2s(np.clip(x * k_l * k_c, 0, 1)), 0, 1)


# ------------------------------------------------------------------ periodic noise
def _freqs(n):
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    return fx, fy

def noise(n, beta=2.0, seed=0, fmin=0.0, fmax=None):
    """periodic fractal noise, zero mean unit std. beta = spectral slope (2 = smooth clouds, 1 = rougher)."""
    rng = np.random.default_rng(seed)
    fx, fy = _freqs(n)
    r = np.sqrt(fx * fx + fy * fy); r[0, 0] = 1
    amp = r ** (-beta / 2.0); amp[0, 0] = 0
    if fmin: amp = amp * (r >= fmin)
    if fmax: amp = amp * np.exp(-(r / fmax) ** 4)
    spec = amp * np.exp(1j * rng.uniform(0, 2 * np.pi, (n, n)))
    a = np.real(np.fft.ifft2(spec))
    a -= a.mean(); a /= a.std() + 1e-9
    return a.astype(np.float32)

def aniso_noise(n, cx, cy, seed=0, beta=0.0):
    """band-limited periodic noise: cx / cy = cutoff frequencies (cycles per tile) along x (columns) / y (rows).
       small cy + big cx => streaks running along y (vertical)."""
    rng = np.random.default_rng(seed)
    fx, fy = _freqs(n)
    r = np.sqrt(fx * fx + fy * fy); r[0, 0] = 1
    filt = np.exp(-((fx / cx) ** 2 + (fy / cy) ** 2)) * (r ** (-beta / 2.0))
    filt[0, 0] = 0
    spec = np.fft.fft2(rng.standard_normal((n, n))) * filt
    a = np.real(np.fft.ifft2(spec)); a -= a.mean(); a /= a.std() + 1e-9
    return a.astype(np.float32)

def smoothstep(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)

def blur(a, sigma):
    """periodic gaussian blur via FFT"""
    n = a.shape[0]
    fx, fy = _freqs(n)
    g = np.exp(-2 * (np.pi * sigma / n) ** 2 * (fx * fx + fy * fy))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1).astype(np.float32)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g)).astype(np.float32)

# ------------------------------------------------------------------ normals
def dec_n(a): 
    n = a * 2 - 1
    return n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)
def enc_n(n):
    n = n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)
    return n * 0.5 + 0.5

def height_to_n(h, strength=1.0):
    """OpenGL (Y+ = toward image top) tangent normal from a periodic height field (units: pixels)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)

def add_n(n1, n2):
    """whiteout blend of two decoded normal fields"""
    n = np.stack([n1[..., 0] + n2[..., 0], n1[..., 1] + n2[..., 1], n1[..., 2] * n2[..., 2]], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)

def scale_n(n, k):
    m = np.stack([n[..., 0] * k, n[..., 1] * k, n[..., 2]], -1)
    return m / np.linalg.norm(m, axis=-1, keepdims=True)

def seam_error(a):
    """mean abs difference across the wrap edges relative to inner neighbour differences (about 1.0 = seamless)"""
    a = a if a.ndim == 2 else a.mean(-1)
    wrap = (np.abs(a[:, 0] - a[:, -1]).mean() + np.abs(a[0] - a[-1]).mean()) / 2
    inner = (np.abs(a[:, 1:] - a[:, :-1]).mean() + np.abs(a[1:] - a[:-1]).mean()) / 2
    return float(wrap / (inner + 1e-9))
